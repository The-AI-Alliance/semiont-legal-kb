/**
 * mark-descriptive-references — detect anaphoric mentions in the markdown
 * corpus.
 *
 * mark.assist with motivation 'linking' and includeDescriptiveReferences:
 * true. Tags phrases like "the Client", "the landlord", "the holder of the
 * senior lien". Skill 6 (resolve-descriptive-references) walks these
 * annotations and binds them to Party resources where evidence supports it.
 *
 * Usage: tsx skills/mark-descriptive-references/script.ts [<resourceId>] [--interactive]
 */

import { SemiontClient, resourceId as ridBrand, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';

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
    console.log('No markdown corpus resources found.');
    semiont.dispose();
    closeInteractive();
    return;
  }

  console.log(
    `Will run mark.assist (motivation: linking, descriptive references on) ` +
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
      includeDescriptiveReferences: true,
    });
    const n = progress.progress?.createdCount ?? 0;
    totalCreated += n;
    console.log(`  ${rId}: ${n} new annotations`);
  }

  console.log(`\nDone. Created ${totalCreated} descriptive-reference annotations.`);
  semiont.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
