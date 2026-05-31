/**
 * mark-named-entities — detect entity spans across the markdown corpus.
 *
 * mark.assist with motivation 'linking'. Default behavior surfaces both
 * formally-named entities (people, organizations, dates, …) AND
 * descriptive references that point at those entity types ("the Vendor",
 * "the landlord", "the owner of the property"). Tier-2 skills resolve
 * them.
 *
 * Set INCLUDE_DESCRIPTIVE_REFERENCES=0 to restrict the pass to named
 * entities only.
 *
 * **PDF caveat.** `mark.assist` does not extract text from binary
 * resources. If invoked against a PDF (or any non-text resource), the
 * worker feeds the raw bytes to the LLM, which then "finds" entities in
 * PDF syntax tokens (e.g. tagging the `/Producer` field "ReportLab" as
 * an Organization). The annotations have bogus position selectors and
 * the entities are meaningless. This script therefore filters to
 * `text/markdown` and `text/plain` resources only — including when an
 * explicit resourceId is passed. PDFs are skipped with a warning.
 * (See the Semiont-side note: `mark.assist` should reject non-text
 * resources or run them through the smelter first.)
 *
 * Usage: tsx skills/mark-named-entities/script.ts [<resourceId>] [--interactive]
 */

import { SemiontSession, InMemorySessionStorage, type KnowledgeBase, entityType, resourceId as ridBrand, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { createdCount } from '../../src/mark-result.js';

const ENTITY_TYPES = (
  process.env.ENTITY_TYPES ??
  'Person,Organization,Address,Date,MonetaryValue,LegalSection,LegalDocument,LegalTerm'
)
  .split(',')
  .map((t) => entityType(t.trim()));

// Default true. The worker prompt under includeDescriptiveReferences:true
// asks for BOTH direct mentions and anaphora — strict superset of the
// named-entity-only pass. Off only when callers explicitly want the
// narrower set (e.g. a downstream skill that needs precise named-entity
// counts without anaphora noise).
const INCLUDE_DESCRIPTIVE_REFERENCES =
  (process.env.INCLUDE_DESCRIPTIVE_REFERENCES ?? '1') !== '0';

function getMediaType(r: any): string | undefined {
  const reps = Array.isArray(r.representations)
    ? r.representations
    : r.representations
      ? [r.representations]
      : [];
  return reps[0]?.mediaType;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const explicitResourceId = args[0];

  const baseUrl = process.env.SEMIONT_API_URL ?? 'http://localhost:4000';
  const email = process.env.SEMIONT_USER_EMAIL!;
  const password = process.env.SEMIONT_USER_PASSWORD!;
  const u = new URL(baseUrl);
  const kb: KnowledgeBase = {
    id: 'legal-mark-named-entities',
    label: 'legal mark-named-entities',
    email,
    endpoint: { kind: 'http', host: u.hostname, port: Number(u.port) || 4000, protocol: u.protocol.replace(':', '') as 'http' | 'https' },
  };
  const session = await SemiontSession.signInHttp({ kb, storage: new InMemorySessionStorage(), baseUrl, email, password });
  const semiont = session.client;

  try {
    // Always fetch the resource list to enforce the text-only mediaType
    // filter — even when an explicit resourceId is passed. mark.assist on
    // a binary PDF produces garbage entity annotations on PDF syntax tokens
    // (see PDF caveat in the docstring).
    const all = await semiont.browse.resources({ limit: 1000 });
    const isText = (r: any) => {
      const mt = getMediaType(r);
      return mt === 'text/markdown' || mt === 'text/plain';
    };

    let targets: ResourceId[];
    if (explicitResourceId) {
      const r = all.find((x) => x['@id'] === explicitResourceId);
      if (!r) {
        console.log(`Resource ${explicitResourceId} not found.`);
        closeInteractive();
        return;
      }
      if (!isText(r)) {
        console.log(
          `⚠ Skipping ${explicitResourceId}: mediaType '${getMediaType(r)}' is not text. ` +
            `mark.assist cannot extract entities from binary content (would tag PDF syntax tokens).`,
        );
        closeInteractive();
        return;
      }
      targets = [ridBrand(r['@id'])];
    } else {
      targets = all.filter(isText).map((r) => ridBrand(r['@id']));
    }

    if (targets.length === 0) {
      console.log('No text resources found. Run skills/ingest-corpus/script.ts first.');
      closeInteractive();
      return;
    }

    console.log(
      `Will run mark.assist (motivation: linking, ${ENTITY_TYPES.length} entity types, ` +
        `descriptive references ${INCLUDE_DESCRIPTIVE_REFERENCES ? 'on' : 'off'}) ` +
        `against ${targets.length} markdown resource(s).`,
    );

    const proceed = await confirm('Proceed?', true);
    if (!proceed) {
      console.log('Aborted.');
      closeInteractive();
      return;
    }

    let totalCreated = 0;
    for (const rId of targets) {
      const progress = await semiont.mark.assist(rId, 'linking', {
        entityTypes: ENTITY_TYPES,
        includeDescriptiveReferences: INCLUDE_DESCRIPTIVE_REFERENCES,
      });
      const n = createdCount(progress);
      totalCreated += n;
      console.log(`  ${rId}: ${n} new annotations`);
    }

    console.log(`\nDone. Created ${totalCreated} entity annotations.`);
    closeInteractive();
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
