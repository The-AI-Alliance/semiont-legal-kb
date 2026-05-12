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
 * Usage: tsx skills/mark-named-entities/script.ts [<resourceId>] [--interactive]
 */

import { SemiontClient, entityType, resourceId as ridBrand, type ResourceId } from '@semiont/sdk';
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

  const semiont = await SemiontClient.signInHttp({
    baseUrl: process.env.SEMIONT_API_URL ?? 'http://localhost:4000',
    email: process.env.SEMIONT_USER_EMAIL!,
    password: process.env.SEMIONT_USER_PASSWORD!,
  });

  let targets: ResourceId[];
  if (explicitResourceId) {
    targets = [ridBrand(explicitResourceId)];
  } else {
    const all = await semiont.browse.resources({ limit: 1000 });
    targets = all
      .filter((r) => {
        const mt = getMediaType(r);
        return mt === 'text/markdown' || mt === 'text/plain';
      })
      .map((r) => ridBrand(r['@id']));
  }

  if (targets.length === 0) {
    console.log('No markdown corpus resources found. Run skills/ingest-corpus/script.ts first.');
    semiont.dispose();
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
    semiont.dispose();
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
  semiont.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
