/**
 * comment-action-items — surface pending work across the markdown corpus.
 *
 * Single mark.assist with motivation 'commenting'. Captures action items,
 * deadlines, and required follow-ups. Skill 10
 * (build-due-diligence-checklist) aggregates these annotations into a
 * Checklist resource.
 *
 * Usage: tsx skills/comment-action-items/script.ts [<resourceId>] [--interactive]
 */

import { SemiontClient, resourceId as ridBrand, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { createdCount } from '../../src/mark-result.js';

const DEFAULT_INSTRUCTIONS = `
For each substantive paragraph, where appropriate, add a commenting annotation that captures one of:
  - An action item ("we need to verify…", "please send…", "schedule a call…")
  - A deadline or due date ("by Thursday", "before December 15", "within 30 days")
  - A required follow-up ("confirm whether…", "request a certificate of…", "circulate the redline by…")
  - An outstanding signature, approval, or sign-off
  - A "we don't know yet" — an open question whose resolution affects the matter
Quote the source line and write the comment as the next-step a paralegal or attorney
would put on a checklist. Where a deadline or owner is stated explicitly, name it.
`.trim();

const INSTRUCTIONS = process.env.COMMENT_INSTRUCTIONS ?? DEFAULT_INSTRUCTIONS;

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

  const firstLine = INSTRUCTIONS.split('\n').find((l) => l.trim().length > 0) ?? '';
  console.log(`Will run mark.assist (motivation: commenting) against ${targets.length} resource(s).`);
  console.log(`  Focus: ${firstLine}`);
  const proceed = await confirm('Proceed?', true);
  if (!proceed) {
    console.log('Aborted.');
    semiont.dispose();
    closeInteractive();
    return;
  }

  let totalCreated = 0;
  for (const rId of targets) {
    const progress = await semiont.mark.assist(rId, 'commenting', { instructions: INSTRUCTIONS });
    const n = createdCount(progress);
    totalCreated += n;
    console.log(`  ${rId}: ${n} action items`);
  }

  console.log(`\nDone. Captured ${totalCreated} action items / deadlines / follow-ups.`);
  semiont.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
