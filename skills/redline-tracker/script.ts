/**
 * redline-tracker — ingest a new contract version, link it to the prior
 * version, diff the two, and synthesize VersionDelta resources per
 * detected change.
 *
 * Usage: tsx skills/redline-tracker/script.ts <priorVersionResourceId> <newVersionPath> [--interactive]
 */

import { readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { SemiontClient, resourceId as ridBrand } from '@semiont/sdk';
import { diffContracts } from '../../src/diff.js';
import { confirm, close as closeInteractive } from '../../src/interactive.js';

function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  return base.replace(/^\d+[_-]/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const priorIdArg = args[0];
  const newPath = args[1];
  if (!priorIdArg || !newPath) {
    console.error(
      'Usage: tsx skills/redline-tracker/script.ts <priorVersionResourceId> <newVersionPath>',
    );
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const absPath = newPath.startsWith('/') ? newPath : join(repoRoot, newPath);
  const stat = statSync(absPath);
  if (!stat.isFile()) {
    console.error(`Not a file: ${absPath}`);
    process.exit(1);
  }
  const ext = extname(absPath).toLowerCase();
  if (ext !== '.md' && ext !== '.txt') {
    console.error(`redline-tracker operates on markdown / plain-text. Got: ${ext}`);
    process.exit(1);
  }

  const priorId = ridBrand(priorIdArg);
  const filename = basename(absPath);
  const newVersionName = process.env.NEW_VERSION_NAME ?? nameFromFilename(filename);

  const semiont = await SemiontClient.signInHttp({
    baseUrl: process.env.SEMIONT_API_URL ?? 'http://localhost:4000',
    email: process.env.SEMIONT_USER_EMAIL!,
    password: process.env.SEMIONT_USER_PASSWORD!,
  });

  // Step 1: fetch prior body, read new body.
  console.log(`Fetching prior version ${priorId}...`);
  const priorBody = await semiont.browse.resourceContent(priorId);
  const newBody = readFileSync(absPath, 'utf-8');

  // Step 2: yield the new version as a Contract+Amendment resource.
  console.log(`Uploading new version "${newVersionName}"...`);
  const { resourceId: newResourceIdRaw } = await semiont.yield.resource({
    name: newVersionName,
    file: Buffer.from(newBody, 'utf-8'),
    format: 'text/markdown',
    entityTypes: ['Contract', 'Amendment'],
    storageUri: `file://${newPath}`,
  });
  const newId = ridBrand(newResourceIdRaw);
  console.log(`  + new version → ${newId}`);

  // Step 3: encode the supersedes link.
  // The new version annotation anchors at the very start of the document and tags
  // 'supersedes' + binds a SpecificResource pointing at the prior version.
  const headerExcerpt = newBody.split('\n').find((l) => l.trim().startsWith('#'))?.trim() ?? newVersionName;
  const headerExact = headerExcerpt.length > 0 ? headerExcerpt : newVersionName;
  await semiont.mark.annotation({
    target: {
      source: newId,
      selector: { type: 'TextQuoteSelector', exact: headerExact },
    },
    motivation: 'linking',
    body: [
      { type: 'TextualBody', purpose: 'tagging', value: 'supersedes' },
      { type: 'SpecificResource', source: priorId, purpose: 'linking' },
    ],
  });
  console.log(`  + linked to prior version (${priorId}) via 'supersedes' annotation`);

  // Step 4: section-aware diff.
  console.log('Computing section-aware diff...');
  const changes = diffContracts(priorBody, newBody);

  if (changes.length === 0) {
    console.log('No section-level changes detected. Done.');
    semiont.dispose();
    closeInteractive();
    return;
  }

  console.log(`Detected ${changes.length} change(s):`);
  for (const c of changes.slice(0, 10)) {
    console.log(`  - [${c.changeKind}] ${c.heading}`);
  }
  if (changes.length > 10) console.log(`  ... and ${changes.length - 10} more.`);

  const proceed = await confirm(`Synthesize ${changes.length} VersionDelta resource(s)?`, true);
  if (!proceed) {
    console.log('Aborted (prior + new versions and supersedes link are still recorded).');
    semiont.dispose();
    closeInteractive();
    return;
  }

  let synthesized = 0;
  for (const c of changes) {
    const lines: string[] = [
      `# Change: ${c.heading} (${c.changeKind})`,
      '',
      c.summary,
      '',
      `- **Section anchor:** ${c.sectionAnchor}`,
      `- **Change kind:** ${c.changeKind}`,
      `- **Prior version:** ${priorId}`,
      `- **New version:** ${newId}`,
      '',
    ];
    if (c.before) {
      lines.push('## Before');
      lines.push('');
      lines.push(`> ${c.before}`);
      lines.push('');
    }
    if (c.after) {
      lines.push('## After');
      lines.push('');
      lines.push(`> ${c.after}`);
      lines.push('');
    }

    const body = lines.join('\n') + '\n';
    const { resourceId: deltaId } = await semiont.yield.resource({
      name: `Δ ${c.sectionAnchor} (${c.changeKind}): ${c.heading}`,
      file: Buffer.from(body, 'utf-8'),
      format: 'text/markdown',
      entityTypes: ['VersionDelta'],
      storageUri: `file://generated/version-delta-${slugify(c.sectionAnchor)}-${Date.now()}.md`,
    });
    synthesized++;
    console.log(`  + Δ [${c.changeKind}] ${c.heading} → ${deltaId}`);
  }

  console.log(
    `\nDone. New version: ${newId}; ${synthesized} VersionDelta resource(s) synthesized.`,
  );
  semiont.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
