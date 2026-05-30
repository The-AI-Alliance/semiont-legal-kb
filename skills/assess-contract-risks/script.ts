/**
 * assess-contract-risks — flag risk-prone clauses across the markdown
 * corpus.
 *
 * Single mark.assist with motivation 'assessing'. The default instruction
 * text targets the patterns that show up in transactional contract review:
 * asymmetric obligations, missing definitions, vague language,
 * survivability gaps. Override via ASSESS_INSTRUCTIONS for a per-matter
 * focus.
 *
 * Usage: tsx skills/assess-contract-risks/script.ts [<resourceId>] [--interactive]
 */

import { SemiontSession, InMemorySessionStorage, type KnowledgeBase, resourceId as ridBrand, type ResourceId } from '@semiont/sdk';
import { confirm, close as closeInteractive } from '../../src/interactive.js';
import { createdCount } from '../../src/mark-result.js';

const DEFAULT_INSTRUCTIONS = `
Identify and flag risk-prone clauses suitable for counsel review. For each, quote the
language that establishes the risk. Focus on:
  - Asymmetric or one-sided obligations (one party bears all risk; one-way indemnities)
  - Missing or undefined terms relied on later in the document
  - Vague or ambiguous language ("reasonable", "as needed", "when appropriate" used without bounds)
  - Survivability gaps (provisions that should outlast termination but lack a survival clause)
  - Open issues, placeholders, or "[TBD]" / "[Vendor Name Placeholder]" markers
  - Gaps in coverage (rights granted without corresponding obligations, or vice versa)
  - Sections referenced ("see Exhibit C", "Section 4.2") that aren't actually in the document
`.trim();

const INSTRUCTIONS = process.env.ASSESS_INSTRUCTIONS ?? DEFAULT_INSTRUCTIONS;

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
    id: 'legal-assess-contract-risks',
    label: 'legal assess-contract-risks',
    email,
    endpoint: { kind: 'http', host: u.hostname, port: Number(u.port) || 4000, protocol: u.protocol.replace(':', '') as 'http' | 'https' },
  };
  const session = await SemiontSession.signInHttp({ kb, storage: new InMemorySessionStorage(), baseUrl, email, password });
  const semiont = session.client;

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
    await session.dispose();
    closeInteractive();
    return;
  }

  const firstLine = INSTRUCTIONS.split('\n').find((l) => l.trim().length > 0) ?? '';
  console.log(`Will run mark.assist (motivation: assessing) against ${targets.length} resource(s).`);
  console.log(`  Focus: ${firstLine}`);
  const proceed = await confirm('Proceed?', true);
  if (!proceed) {
    console.log('Aborted.');
    await session.dispose();
    closeInteractive();
    return;
  }

  let totalCreated = 0;
  for (const rId of targets) {
    const progress = await semiont.mark.assist(rId, 'assessing', { instructions: INSTRUCTIONS });
    const n = createdCount(progress);
    totalCreated += n;
    console.log(`  ${rId}: ${n} risk flags`);
  }

  console.log(`\nDone. Flagged ${totalCreated} risk-prone clauses.`);
  await session.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
