/**
 * mark-named-entities — detect formally-named entity spans across the
 * markdown corpus.
 *
 * mark.assist with motivation 'linking', no descriptive-reference detection
 * (skill 3 handles those separately). Targets markdown resources only;
 * PDFs are silently skipped because mark.assist requires text input.
 *
 * Usage: tsx skills/mark-named-entities/script.ts [<resourceId>] [--interactive]
 */

import { SemiontClient, entityType, resourceId as ridBrand, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';

const ENTITY_TYPES = (
  process.env.ENTITY_TYPES ??
  'Person,Organization,Address,Date,MonetaryValue,LegalSection,LegalDocument,LegalTerm'
)
  .split(',')
  .map((t) => entityType(t.trim()));

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
    `Will run mark.assist (motivation: linking, ${ENTITY_TYPES.length} entity types) ` +
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
    });
    const n = progress.progress?.createdCount ?? 0;
    totalCreated += n;
    console.log(`  ${rId}: ${n} new annotations`);
  }

  console.log(`\nDone. Created ${totalCreated} named-entity annotations.`);
  semiont.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
