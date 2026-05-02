/**
 * ingest-corpus — walk the repo, create one resource per file.
 *
 * Discovers files under top-level subdirectories (each holding documents
 * for one matter) plus optional `context/` / `curated/` / `generated/`
 * directories of pre-curated context articles. Classifies each file by
 * filename heuristic and uploads via yield.resource. Pre-curated context
 * articles become canonical LegalContext resources on day 1; downstream
 * synthesis skills match against them rather than overwriting.
 *
 * Usage: tsx skills/ingest-corpus/script.ts [--interactive]
 */

import { SemiontClient } from '@semiont/sdk';
import { discoverCorpus, readForUpload } from '../../src/files.js';
import { confirm, close as closeInteractive } from '../../src/interactive.js';

/**
 * The full entity-type vocabulary this KB uses across all eleven skills.
 * Declared via `frame.addEntityTypes` once on each ingest run — idempotent,
 * so re-runs are harmless. This is what makes `browse.entityTypes()` return
 * a coherent published vocabulary.
 */
const KB_ENTITY_TYPES = [
  // Document types from src/files.ts filename heuristics
  'Contract',
  'Amendment',
  'Exhibit',
  'Letter',
  'SideLetter',
  'Email',
  'Memo',
  'Policy',
  'CorporateRecord',
  'LegalOpinion',
  'LegalDocument',
  // Curated-context markers
  'LegalContext',
  'Curated',
  // mark-named-entities entity types
  'Person',
  'Organization',
  'Address',
  'Date',
  'MonetaryValue',
  'LegalSection',
  'LegalTerm',
  // Synthesized aggregates
  'Party',
  'Obligation',
  'Investigation',
  'Checklist',
  'VersionDelta',
  'Relationship',
  'Aggregate',
];

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const files = discoverCorpus(repoRoot);

  console.log(`Discovered ${files.length} corpus files:`);
  const bySubdir: Record<string, number> = {};
  const byFormat: Record<string, number> = {};
  for (const f of files) {
    bySubdir[f.subdir] = (bySubdir[f.subdir] ?? 0) + 1;
    byFormat[f.format] = (byFormat[f.format] ?? 0) + 1;
  }
  console.log('  by subdirectory:');
  for (const [subdir, n] of Object.entries(bySubdir).sort()) {
    console.log(`    ${subdir}: ${n}`);
  }
  console.log('  by format:');
  for (const [fmt, n] of Object.entries(byFormat).sort()) {
    console.log(`    ${fmt}: ${n}`);
  }
  console.log();

  if (files.length === 0) {
    console.log('No ingestable files found. Exiting.');
    closeInteractive();
    return;
  }

  const proceed = await confirm(
    `About to create ${files.length} resources via yield.resource. Proceed?`,
    true,
  );
  if (!proceed) {
    console.log('Aborted before upload.');
    closeInteractive();
    return;
  }

  const semiont = await SemiontClient.signInHttp({
    baseUrl: process.env.SEMIONT_API_URL ?? 'http://localhost:4000',
    email: process.env.SEMIONT_USER_EMAIL!,
    password: process.env.SEMIONT_USER_PASSWORD!,
  });

  // Declare this KB's entity-type vocabulary via frame. Idempotent.
  console.log(`Declaring ${KB_ENTITY_TYPES.length} entity types via frame...`);
  await semiont.frame.addEntityTypes(KB_ENTITY_TYPES);

  let created = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const buffer = readForUpload(file, repoRoot);
      const { resourceId } = await semiont.yield.resource({
        name: file.name,
        file: buffer,
        format: file.format,
        entityTypes: file.entityTypes,
        storageUri: file.storageUri,
      });
      created++;
      console.log(`  + ${file.path} → ${resourceId} [${file.entityTypes.join(', ')}]`);
    } catch (e) {
      failed++;
      console.warn(`  ! ${file.path} failed: ${(e as Error).message}`);
    }
  }

  console.log(`\nDone. ${created} resources created, ${failed} failed.`);
  semiont.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
