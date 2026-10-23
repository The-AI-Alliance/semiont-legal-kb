/**
 * build-party-graph — promote Person/Organization mentions to canonical
 * Party resources.
 *
 * Cluster + match + bind / yield.delegate + bind, mirroring the
 * gutenberg-kb's build-character-articles pattern but using yield.delegate
 * (so Party body content is grounded in the source paragraph the model
 * gathers, not a hand-built stub).
 *
 * Relationships between parties are not found by a job: SKILL.md says how
 * they are recorded.
 *
 * Usage: tsx skills/build-party-graph/script.ts [--interactive]
 */

import {
  SemiontSession,
  InMemorySessionStorage,
  httpKb,
  getBodySource,
  getEntityTypes,
  type AnnotationId,
  type ResourceId,
} from '@semiont/sdk';
import { confirm, isInteractive, close as closeInteractive } from '../../src/interactive.js';
import { getMediaType } from '../../src/media-type.js';

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 30);

const PARTY_ENTITY_TYPES = new Set(['Person', 'Organization']);

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

interface PartyAnno {
  rId: ResourceId;
  annId: AnnotationId;
  text: string;
  tags: string[];
  alreadyBound: boolean;
}

async function main(): Promise<void> {
  const gateway = new URL(process.env.SEMIONT_API_URL ?? 'http://localhost:4000');
  const opened = await SemiontSession.signInDevice({
    kb: httpKb({
      id: 'legal-build-party-graph',
      label: 'legal build-party-graph',
      host: gateway.hostname,
      port: Number(gateway.port) || 4000,
      protocol: gateway.protocol === 'https:' ? 'https' : 'http',
    }),
    storage: new InMemorySessionStorage(),
    onCode: ({ verificationUri, verificationUriComplete, userCode }) => {
      console.error(`Approve this script at ${verificationUriComplete ?? verificationUri}`);
      if (!verificationUriComplete) console.error(`Code: ${userCode}`);
    },
  });
  const semiont = opened.session.client;

  try {
    const all = (await semiont.browse.resources({ limit: 1000 }).fresh()).resources;
    const markdownResources = all.filter((r) => {
      const mt = getMediaType(r);
      return mt === 'text/markdown' || mt === 'text/plain';
    });

    if (markdownResources.length === 0) {
      console.log('No markdown corpus resources found. Run skills/ingest-corpus/script.ts first.');
      closeInteractive();
      return;
    }

    // ---------- Collect Person/Organization annotations ----------
    const partyAnnotations: PartyAnno[] = [];
    for (const r of markdownResources) {
      const rId = r['@id'];
      const annotations = await semiont.browse.annotations(rId).fresh();
      for (const ann of annotations) {
        if (ann.motivation !== 'linking') continue;
        const tags = getEntityTypes(ann);
        const partyTags = tags.filter((t) => PARTY_ENTITY_TYPES.has(t));
        if (partyTags.length === 0) continue;
        const alreadyBound = getBodySource(ann.body) !== null;
        const target = ann.target;
        const selectors =
          typeof target === 'string' || !target.selector
            ? []
            : Array.isArray(target.selector)
              ? target.selector
              : [target.selector];
        let quote = '';
        for (const s of selectors) {
          if (s.type === 'TextQuoteSelector') { quote = s.exact; break; }
        }
        partyAnnotations.push({
          rId,
          annId: ann.id,
          text: quote,
          tags: partyTags,
          alreadyBound,
        });
      }
    }

    if (partyAnnotations.length === 0) {
      console.log(
        'No Person/Organization annotations found. Run skills/mark-named-entities/script.ts first.',
      );
      closeInteractive();
      return;
    }

    // Cluster unbound annotations by canonical text
    const clusters = new Map<string, PartyAnno[]>();
    let alreadyBoundCount = 0;
    for (const a of partyAnnotations) {
      if (a.alreadyBound) {
        alreadyBoundCount++;
        continue;
      }
      const key = a.text.toLowerCase().trim();
      if (!key) {
        console.warn(
          `  skipping annotation ${a.annId} on ${a.rId} — no TextQuoteSelector ` +
            `(tags: ${a.tags.join(', ')}). Cluster key would be empty.`,
        );
        continue;
      }
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key)!.push(a);
    }

    console.log(
      `Found ${partyAnnotations.length} Person/Organization annotation(s). ` +
        `${alreadyBoundCount} already bound; ${clusters.size} unbound clusters to process.`,
    );

    if (clusters.size === 0) {
      console.log('Nothing to promote.');
    } else {
      const proceed = await confirm(
        'Proceed to match each cluster against existing Party resources, synthesize new ones where needed, and bind annotations?',
        true,
      );
      if (!proceed) {
        console.log('Aborted.');
        closeInteractive();
        return;
      }

      let bound = 0;
      let synthesized = 0;
      let skipped = 0;

      for (const [_, anns] of clusters) {
        const sample = anns[0];
        if (!sample) continue;

        const { response: context } = await semiont.gather.annotation(sample.rId, sample.annId, {
          contextWindow: 1500,
        });

        const matchResult = await semiont.match.search(sample.rId, sample.annId, context, {
          limit: 5,
          useSemanticScoring: true,
        });
        const top = matchResult.response[0];

        let targetResourceId: ResourceId;
        if (top && (top.score ?? 0) >= MATCH_THRESHOLD) {
          targetResourceId = top['@id'];
          console.log(`  ↪ "${sample.text}" → ${top.name} (existing, score ${top.score})`);
        } else {
          const proceedYield = isInteractive()
            ? await confirm(
                `No confident match for "${sample.text}". Synthesize a new Party resource?`,
                true,
              )
            : true;
          if (!proceedYield) {
            skipped++;
            console.log(`  skipped     "${sample.text}"`);
            continue;
          }

          const partyType = sample.tags.includes('Organization') ? 'Organization' : 'Person';
          const yieldEvent = await semiont.yield.delegate({
            context,
            title: sample.text,
            storageUri: `file://generated/party-${slugify(sample.text)}.md`,
            entityTypes: ['Party', partyType],
          });

          if (!yieldEvent.result || !('resourceId' in yieldEvent.result)) {
            console.warn(`  the generation made no resource for "${sample.text}"`);
            continue;
          }
          const newResourceId = yieldEvent.result && 'resourceId' in yieldEvent.result ? yieldEvent.result.resourceId : undefined;
          if (!newResourceId) {
            console.warn(`  yield.delegate gave no resourceId for "${sample.text}"`);
            continue;
          }

          targetResourceId = newResourceId;
          synthesized++;
          console.log(`  + "${sample.text}" → ${newResourceId} (synthesized as ${partyType})`);
        }

        for (const a of anns) {
          await semiont.bind.body(a.rId, a.annId, [
            {
              op: 'add',
              item: { type: 'SpecificResource', source: targetResourceId, purpose: 'linking' },
            },
          ]);
          bound++;
        }
      }

      console.log(
        `\nDone. Bound ${bound} annotations across ${clusters.size} party clusters; ` +
          `${synthesized} new Party resources synthesized; ${skipped} skipped.`,
      );
    }

    closeInteractive();
  } finally {
    opened.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
