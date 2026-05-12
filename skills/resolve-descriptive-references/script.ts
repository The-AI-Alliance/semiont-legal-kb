/**
 * resolve-descriptive-references — walk every descriptive-reference annotation
 * from skill 3, gather context, match against Party resources, bind where
 * evidence supports it, and synthesize an Investigation resource that
 * aggregates the resolution decisions.
 *
 * The Investigation resource is the primary deliverable — even imperfect
 * resolution produces a queryable audit trail of *which references were
 * considered, what evidence was weighed, what decision was reached*.
 *
 * Usage: tsx skills/resolve-descriptive-references/script.ts [--interactive]
 */

import {
  SemiontClient,
  resourceId as ridBrand,
  type AnnotationId,
  type GatheredContext,
  type ResourceId,
} from '@semiont/sdk';
import { confirm, isInteractive, close as closeInteractive } from '../../src/interactive.js';

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 30);
const INVESTIGATION_NAME = process.env.INVESTIGATION_NAME ?? 'Descriptive-reference investigation';

const NAMED_ENTITY_TAGS = new Set([
  'Person',
  'Organization',
  'Address',
  'Date',
  'MonetaryValue',
  'LegalSection',
  'LegalDocument',
  'LegalTerm',
]);

interface DescriptiveAnno {
  rId: ResourceId;
  rName: string;
  annId: AnnotationId;
  text: string;
}

interface ResolutionRecord {
  rName: string;
  text: string;
  outcome: 'bound-existing' | 'unresolved' | 'skipped';
  candidate?: { name: string; score: number };
  topCandidates: Array<{ name: string; score: number }>;
}

function getMediaType(r: any): string | undefined {
  const reps = Array.isArray(r.representations)
    ? r.representations
    : r.representations
      ? [r.representations]
      : [];
  return reps[0]?.mediaType;
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
    console.log('No markdown corpus resources found.');
    semiont.dispose();
    closeInteractive();
    return;
  }

  // Collect descriptive-reference annotations: linking-motivation annotations
  // whose tags don't include any named-entity type (skill 2's output is
  // tagged with Person/Organization/etc.; skill 3's descriptive-reference
  // annotations are not).
  const descriptive: DescriptiveAnno[] = [];
  for (const r of markdownResources) {
    const rId = ridBrand(r['@id']);
    const annotations = await semiont.browse.annotations(rId);
    for (const ann of annotations) {
      if (ann.motivation !== 'linking') continue;
      const alreadyBound = (ann.body ?? []).some(
        (b: any) => b.type === 'SpecificResource' && b.purpose === 'linking',
      );
      if (alreadyBound) continue;
      const tags = (ann.body ?? [])
        .filter((b: any) => b.type === 'TextualBody' && b.purpose === 'tagging')
        .flatMap((b: any) => (Array.isArray(b.value) ? b.value : [b.value]));
      const isNamedEntity = tags.some((t: string) => NAMED_ENTITY_TAGS.has(t));
      if (isNamedEntity) continue;
      descriptive.push({
        rId,
        rName: r.name ?? r['@id'],
        annId: ann.id,
        text: ann.target?.selector?.exact ?? '',
      });
    }
  }

  if (descriptive.length === 0) {
    console.log(
      'No descriptive-reference annotations found. Run skills/mark-named-entities/script.ts first (with the default INCLUDE_DESCRIPTIVE_REFERENCES=1).',
    );
    semiont.dispose();
    closeInteractive();
    return;
  }

  console.log(
    `Found ${descriptive.length} descriptive-reference annotation(s) to resolve. ` +
      `Match threshold: ${MATCH_THRESHOLD}.`,
  );
  const proceed = await confirm('Proceed?', true);
  if (!proceed) {
    console.log('Aborted.');
    semiont.dispose();
    closeInteractive();
    return;
  }

  const records: ResolutionRecord[] = [];
  let bound = 0;
  let unresolved = 0;
  let skipped = 0;

  for (const a of descriptive) {
    const gather = await semiont.gather.annotation(a.rId, a.annId, { contextWindow: 1500 });
    const context = gather.response as GatheredContext;
    const matchResult = await semiont.match.search(a.rId, a.annId, context, {
      limit: 5,
      useSemanticScoring: true,
    });
    const candidates = matchResult.response.map((c: any) => ({
      name: c.name as string,
      score: (c.score ?? 0) as number,
      id: c['@id'] as string,
    }));
    const top = candidates[0];

    if (top && top.score >= MATCH_THRESHOLD) {
      // Confident match — bind, record commentary annotation.
      const proceedBind = isInteractive()
        ? await confirm(
            `"${a.text}" → ${top.name} (score ${top.score}). Bind?`,
            true,
          )
        : true;
      if (!proceedBind) {
        skipped++;
        records.push({
          rName: a.rName,
          text: a.text,
          outcome: 'skipped',
          topCandidates: candidates.slice(0, 3),
        });
        console.log(`  skipped     "${a.text}"`);
        continue;
      }

      const auditTrail =
        `Resolved "${a.text}" → ${top.name} via match.search (score ${top.score}). ` +
        `Top candidates considered: ${candidates
          .slice(0, 3)
          .map((c) => `${c.name} [${c.score}]`)
          .join('; ')}.`;

      await semiont.bind.body(a.rId, a.annId, [
        {
          op: 'add',
          item: { type: 'SpecificResource', source: top.id, purpose: 'linking' },
        },
        {
          op: 'add',
          item: { type: 'TextualBody', purpose: 'commenting', value: auditTrail },
        },
      ]);
      bound++;
      records.push({
        rName: a.rName,
        text: a.text,
        outcome: 'bound-existing',
        candidate: { name: top.name, score: top.score },
        topCandidates: candidates.slice(0, 3),
      });
      console.log(`  bound       "${a.text}" → ${top.name} (score ${top.score})`);
    } else {
      // No confident match — leave unresolved, record decision.
      unresolved++;
      records.push({
        rName: a.rName,
        text: a.text,
        outcome: 'unresolved',
        topCandidates: candidates.slice(0, 3),
      });
      const topStr =
        candidates.length === 0
          ? '(no candidates)'
          : candidates
              .slice(0, 3)
              .map((c) => `${c.name} [${c.score}]`)
              .join('; ');
      console.log(`  unresolved  "${a.text}" — ${topStr}`);
    }
  }

  // ---------- Synthesize the Investigation resource ----------
  const lines: string[] = [
    `# ${INVESTIGATION_NAME}`,
    '',
    `Auto-generated investigation aggregating the resolution decisions for ${descriptive.length} ` +
      `descriptive references across the corpus. Match threshold: ${MATCH_THRESHOLD}.`,
    '',
    `**Outcome summary:** ${bound} bound to existing Party resources; ${unresolved} left unresolved; ${skipped} skipped.`,
    '',
    '## Reference table',
    '',
    '| Document | Reference | Outcome | Resolved to | Top candidates (name [score]) |',
    '|---|---|---|---|---|',
  ];
  for (const r of records) {
    const candidates = r.topCandidates.length
      ? r.topCandidates.map((c) => `${c.name} [${c.score}]`).join('; ')
      : '(none)';
    const resolved =
      r.outcome === 'bound-existing' && r.candidate
        ? `${r.candidate.name} (score ${r.candidate.score})`
        : '—';
    lines.push(`| ${r.rName} | ${r.text} | ${r.outcome} | ${resolved} | ${candidates} |`);
  }

  lines.push(
    '',
    '## Investigation notes',
    '',
    `- **Bound references** (${bound}) are linked from their source paragraphs to canonical Party resources. The audit trail per reference is in the source annotation's commenting body — see the per-reference comment for the candidate scores at decision time.`,
    `- **Unresolved references** (${unresolved}) had no candidate above the threshold (${MATCH_THRESHOLD}). They remain queryable as descriptive-reference annotations; a re-run after seeding more Party resources may resolve them.`,
  );
  if (skipped > 0) {
    lines.push(
      `- **Skipped references** (${skipped}) were declined interactively. They are unchanged from the input.`,
    );
  }
  lines.push(
    '',
    '## Methodology',
    '',
    'For each descriptive-reference annotation produced by `mark-named-entities` (with `includeDescriptiveReferences: true`): ' +
      '`gather.annotation` collected the surrounding paragraph as context; `match.search` returned the top 5 candidate ' +
      'resources scored against that context; if the top score met the threshold, `bind.body` linked the annotation to ' +
      'the candidate and a `mark.annotation` (motivation: commenting) recorded *why* — top candidate, score, and the ' +
      'three competing candidates considered. Below the threshold, the reference was left unresolved.',
    '',
    '*This investigation was synthesized by the `resolve-descriptive-references` skill.*',
  );

  const body = lines.join('\n') + '\n';
  const { resourceId: investigationId } = await semiont.yield.resource({
    name: INVESTIGATION_NAME,
    file: Buffer.from(body, 'utf-8'),
    format: 'text/markdown',
    entityTypes: ['Investigation', 'Aggregate'],
    storageUri: `file://generated/investigation-${Date.now()}.md`,
  });

  console.log(
    `\nDone. Bound ${bound}, unresolved ${unresolved}, skipped ${skipped}. ` +
      `Investigation resource: ${investigationId} (${body.length} bytes).`,
  );
  semiont.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
