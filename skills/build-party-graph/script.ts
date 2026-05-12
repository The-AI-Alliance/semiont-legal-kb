/**
 * build-party-graph — promote Person/Organization mentions to canonical
 * Party resources, then extract inter-party relationships.
 *
 * Pass 1: cluster + match + bind / yield.fromAnnotation + bind, mirroring
 * the gutenberg-kb's build-character-articles pattern but using
 * yield.fromAnnotation (so Party body content is grounded in the source
 * paragraph the model gathers, not a hand-built stub).
 *
 * Pass 2: mark.assist relationship-extraction pass over the corpus.
 *
 * Usage: tsx skills/build-party-graph/script.ts [--interactive]
 */

import {
  SemiontClient,
  entityType,
  resourceId as ridBrand,
  type AnnotationId,
  type GatheredContext,
  type ResourceId,
} from '@semiont/sdk';
import { confirm, isInteractive, close as closeInteractive } from '../../src/interactive.js';
import { createdCount } from '../../src/mark-result.js';

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 30);
const SKIP_RELATIONSHIP_PASS = process.env.SKIP_RELATIONSHIP_PASS === '1';

const PARTY_ENTITY_TYPES = new Set(['Person', 'Organization']);

// mark.assist with motivation 'linking' requires a non-empty entityTypes
// array (SDK validation). Pass 2's relationship-extraction tagging uses the
// standard legal entity-type list; override with the RELATIONSHIP_ENTITY_TYPES
// env var if you want to scope the relationship pass to a different
// vocabulary.
const RELATIONSHIP_ENTITY_TYPES = (
  process.env.RELATIONSHIP_ENTITY_TYPES ??
  'Person,Organization,Address,Date,MonetaryValue,LegalSection,LegalDocument,LegalTerm'
)
  .split(',')
  .map((t) => entityType(t.trim()));

const RELATIONSHIP_INSTRUCTIONS = `
For pairs of named parties (Person ↔ Person, Person ↔ Organization, or Organization ↔ Organization)
in this document, identify any explicit relationship between them and tag the span where the
relationship is established. Use a single tag value naming the relationship type, drawn from the
following vocabulary (extend as needed):
  - counterparty       (one party is the other's counterparty under a contract)
  - lessor / lessee    (landlord ↔ tenant)
  - principal / agent
  - employer / employee
  - parent / subsidiary
  - attorney / client
  - fiduciary / beneficiary
  - role-at-org        (a Person serves a role at a named Organization)
  - represented-by     (party-to-attorney representation)
Only tag relationships supported by explicit language in the document. Do not infer relationships
that aren't on the page.
`.trim();

function getMediaType(r: any): string | undefined {
  const reps = Array.isArray(r.representations)
    ? r.representations
    : r.representations
      ? [r.representations]
      : [];
  return reps[0]?.mediaType;
}

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
  const semiont = await SemiontClient.signInHttp({
    baseUrl: process.env.SEMIONT_API_URL ?? 'http://localhost:4000',
    email: process.env.SEMIONT_USER_EMAIL!,
    password: process.env.SEMIONT_USER_PASSWORD!,
  });

  const all = await semiont.browse.resources({ limit: 1000 });
  const markdownResources = all.filter((r) => {
    const mt = getMediaType(r);
    return mt === 'text/markdown' || mt === 'text/plain';
  });

  if (markdownResources.length === 0) {
    console.log('No markdown corpus resources found. Run skills/ingest-corpus/script.ts first.');
    semiont.dispose();
    closeInteractive();
    return;
  }

  // ---------- Pass 1: collect Person/Organization annotations ----------
  const partyAnnotations: PartyAnno[] = [];
  for (const r of markdownResources) {
    const rId = ridBrand(r['@id']);
    const annotations = await semiont.browse.annotations(rId);
    for (const ann of annotations) {
      if (ann.motivation !== 'linking') continue;
      const tags = (ann.body ?? [])
        .filter((b: any) => b.type === 'TextualBody' && b.purpose === 'tagging')
        .flatMap((b: any) => (Array.isArray(b.value) ? b.value : [b.value]));
      const partyTags = tags.filter((t: string) => PARTY_ENTITY_TYPES.has(t));
      if (partyTags.length === 0) continue;
      const alreadyBound = (ann.body ?? []).some(
        (b: any) => b.type === 'SpecificResource' && b.purpose === 'linking',
      );
      partyAnnotations.push({
        rId,
        annId: ann.id,
        text: ann.target?.selector?.exact ?? '',
        tags: partyTags,
        alreadyBound,
      });
    }
  }

  if (partyAnnotations.length === 0) {
    console.log(
      'No Person/Organization annotations found. Run skills/mark-named-entities/script.ts first.',
    );
    semiont.dispose();
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
    if (!key) continue;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(a);
  }

  console.log(
    `Found ${partyAnnotations.length} Person/Organization annotation(s). ` +
      `${alreadyBoundCount} already bound; ${clusters.size} unbound clusters to process.`,
  );

  if (clusters.size === 0) {
    console.log('Nothing to promote. Skipping pass 1.');
  } else {
    const proceed = await confirm(
      'Proceed to match each cluster against existing Party resources, synthesize new ones where needed, and bind annotations?',
      true,
    );
    if (!proceed) {
      console.log('Aborted before pass 1.');
      semiont.dispose();
      closeInteractive();
      return;
    }

    let bound = 0;
    let synthesized = 0;
    let skipped = 0;

    for (const [_, anns] of clusters) {
      const sample = anns[0];

      const gather = await semiont.gather.annotation(sample.rId, sample.annId, {
        contextWindow: 1500,
      });
      const context = gather.response as GatheredContext;

      const matchResult = await semiont.match.search(sample.rId, sample.annId, context, {
        limit: 5,
        useSemanticScoring: true,
      });
      const top = matchResult.response[0];

      let targetResourceId: string;
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
        const yieldEvent = await semiont.yield.fromAnnotation(sample.rId, sample.annId, {
          title: sample.text,
          storageUri: `file://generated/party-${slugify(sample.text)}.md`,
          context,
          entityTypes: ['Party', partyType],
        });

        if (yieldEvent.kind !== 'complete') {
          console.warn(`  unexpected yield event kind for "${sample.text}": ${yieldEvent.kind}`);
          continue;
        }
        const newResourceId = (
          yieldEvent.data.result as { resourceId?: string } | undefined
        )?.resourceId;
        if (!newResourceId) {
          console.warn(`  yield.fromAnnotation gave no resourceId for "${sample.text}"`);
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
      `\nPass 1 done. Bound ${bound} annotations across ${clusters.size} party clusters; ` +
        `${synthesized} new Party resources synthesized; ${skipped} skipped.`,
    );
  }

  // ---------- Pass 2: relationship extraction ----------
  if (SKIP_RELATIONSHIP_PASS) {
    console.log('Skipping pass 2 (relationship extraction) — SKIP_RELATIONSHIP_PASS=1.');
    semiont.dispose();
    closeInteractive();
    return;
  }

  console.log(
    `\nPass 2: relationship extraction across ${markdownResources.length} markdown resource(s).`,
  );
  const proceedRel = await confirm('Proceed?', true);
  if (!proceedRel) {
    console.log('Aborted before pass 2.');
    semiont.dispose();
    closeInteractive();
    return;
  }

  let totalRel = 0;
  for (const r of markdownResources) {
    const rId = ridBrand(r['@id']);
    const progress = await semiont.mark.assist(rId, 'linking', {
      entityTypes: RELATIONSHIP_ENTITY_TYPES,
      instructions: RELATIONSHIP_INSTRUCTIONS,
    });
    const n = createdCount(progress);
    totalRel += n;
    console.log(`  ${rId}: ${n} relationship annotations`);
  }

  console.log(`\nPass 2 done. Created ${totalRel} relationship annotations across the corpus.`);
  semiont.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
