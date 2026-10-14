/**
 * mark-named-entities — detect entity spans across the markdown corpus.
 *
 * mark.delegate with motivation 'linking'. Default behavior surfaces both
 * formally-named entities (people, organizations, dates, …) AND
 * descriptive references that point at those entity types ("the Vendor",
 * "the landlord", "the owner of the property"). Tier-2 skills resolve
 * them.
 *
 * Set INCLUDE_DESCRIPTIVE_REFERENCES=0 to restrict the pass to named
 * entities only.
 *
 * **PDF caveat.** `mark.delegate` does not extract text from binary
 * resources. If invoked against a PDF (or any non-text resource), the
 * worker feeds the raw bytes to the LLM, which then "finds" entities in
 * PDF syntax tokens (e.g. tagging the `/Producer` field "ReportLab" as
 * an Organization). The annotations have bogus position selectors and
 * the entities are meaningless. This script therefore filters to
 * `text/markdown` and `text/plain` resources only — including when an
 * explicit resourceId is passed. PDFs are skipped with a warning.
 * (See the Semiont-side note: `mark.delegate` should reject non-text
 * resources or run them through the smelter first.)
 *
 * Usage: tsx skills/mark-named-entities/script.ts [<resourceId>] [--interactive]
 */

import { SemiontSession, InMemorySessionStorage, httpKb, entityType, type ResourceDescriptor, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { getMediaType } from '../../src/media-type.js';

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


async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const explicitResourceId = args[0];

  const gateway = new URL(process.env.SEMIONT_API_URL ?? 'http://localhost:4000');
  const session = await SemiontSession.signInDevice({
    kb: httpKb({
      id: 'legal-mark-named-entities',
      label: 'legal mark-named-entities',
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
  const semiont = session.client;

  try {
    // Always fetch the resource list to enforce the text-only mediaType
    // filter — even when an explicit resourceId is passed. mark.delegate on
    // a binary PDF produces garbage entity annotations on PDF syntax tokens
    // (see PDF caveat in the docstring).
    const all = (await semiont.browse.resources({ limit: 1000 }).fresh()).resources;
    const isText = (r: ResourceDescriptor) => {
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
            `mark.delegate cannot extract entities from binary content (would tag PDF syntax tokens).`,
        );
        closeInteractive();
        return;
      }
      targets = [r['@id']];
    } else {
      targets = all.filter(isText).map((r) => r['@id']);
    }

    if (targets.length === 0) {
      console.log('No text resources found. Run skills/ingest-corpus/script.ts first.');
      closeInteractive();
      return;
    }

    console.log(
      `Will run mark.delegate (motivation: linking, ${ENTITY_TYPES.length} entity types, ` +
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
      const done = await semiont.mark.delegate(rId, {
        motivation: 'linking',
        entityTypes: ENTITY_TYPES,
        includeDescriptiveReferences: INCLUDE_DESCRIPTIVE_REFERENCES,
      });
      const n = done.result && 'persisted' in done.result ? done.result.persisted : 0;
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
