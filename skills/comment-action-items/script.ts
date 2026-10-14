/**
 * comment-action-items — surface pending work across the markdown corpus.
 *
 * Single mark.delegate with motivation 'commenting'. Captures action items,
 * deadlines, and required follow-ups. Skill 10
 * (build-due-diligence-checklist) aggregates these annotations into a
 * Checklist resource.
 *
 * Usage: tsx skills/comment-action-items/script.ts [<resourceId>] [--interactive]
 */

import { SemiontSession, InMemorySessionStorage, httpKb, resourceId as ridBrand, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { getMediaType } from '../../src/media-type.js';

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


async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const explicitResourceId = args[0];

  const gateway = new URL(process.env.SEMIONT_API_URL ?? 'http://localhost:4000');
  const session = await SemiontSession.signInDevice({
    kb: httpKb({
      id: 'legal-comment-action-items',
      label: 'legal comment-action-items',
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
    let targets: ResourceId[];
    if (explicitResourceId) {
      targets = [ridBrand(explicitResourceId)];
    } else {
      const all = (await semiont.browse.resources({ limit: 1000 }).fresh()).resources;
      targets = all
        .filter((r) => {
          const mt = getMediaType(r);
          return mt === 'text/markdown' || mt === 'text/plain';
        })
        .map((r) => r['@id']);
    }

    if (targets.length === 0) {
      console.log('No markdown corpus resources found.');
      closeInteractive();
      return;
    }

    const firstLine = INSTRUCTIONS.split('\n').find((l) => l.trim().length > 0) ?? '';
    console.log(`Will run mark.delegate (motivation: commenting) against ${targets.length} resource(s).`);
    console.log(`  Focus: ${firstLine}`);
    const proceed = await confirm('Proceed?', true);
    if (!proceed) {
      console.log('Aborted.');
      closeInteractive();
      return;
    }

    let totalCreated = 0;
    for (const rId of targets) {
      const done = await semiont.mark.delegate(rId, { motivation: 'commenting', instructions: INSTRUCTIONS });
      const n = done.result && 'persisted' in done.result ? done.result.persisted : 0;
      totalCreated += n;
      console.log(`  ${rId}: ${n} action items`);
    }

    console.log(`\nDone. Captured ${totalCreated} action items / deadlines / follow-ups.`);
    closeInteractive();
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
