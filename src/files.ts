/**
 * Corpus file discovery and ingest input preparation.
 *
 * Walks the repo's top-level subdirectories looking for legal documents
 * (markdown and PDF), classifies each by filename heuristic, and produces
 * CorpusFile records ready for `yield.resource`.
 *
 * Used by skill 1 (`ingest-corpus`).
 *
 * Generic across any legal-document corpus that follows a flat
 * `<subdirectory>/<file>` layout. The classification rules look at filename
 * patterns common to legal correspondence and contracts (e.g., the substring
 * "agreement" → Contract, "addendum" → Exhibit, "policy" → Policy, "email" →
 * Email, "letter" → Letter). They never reference any specific party,
 * matter, or seeded document name.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export type CorpusFileSource = 'document' | 'curated-context' | 'other';

export interface CorpusFile {
  /** Repo-relative path. */
  path: string;
  /** Display name for the resource. */
  name: string;
  /** MIME type. */
  format: string;
  /** Entity types to attach to the resource. */
  entityTypes: string[];
  /** Stable storage identifier; we use file:// URIs. */
  storageUri: string;
  /** Coarse classification, useful for downstream filtering. */
  source: CorpusFileSource;
  /** Top-level subdirectory the file was found under. */
  subdir: string;
}

const FORMAT_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
};

const SKIP_FILENAMES = new Set([
  'README.md',
  'readme.md',
  'README',
  '.DS_Store',
  'LICENSE',
  'AGENTS.md',
]);

/** Top-level directories that are never part of the legal corpus. */
const SKIP_DIRS = new Set([
  '.git',
  '.github',
  '.devcontainer',
  '.semiont',
  '.plans',
  '.cache',
  'src',
  'skills',
  'node_modules',
  'tests',
  'docs',
]);

/** Curated-context subdirectories — anything under these is treated as a pre-curated LegalContext article. */
const CURATED_SUBDIRS = new Set(['context', 'curated', 'generated']);

function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  return base.replace(/^\d+[_-]/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Pick entity types based on filename substrings common to legal documents.
 * Conservative: every file gets at least one entity type. Skill 2 will run
 * mark.assist over the markdown documents to detect parties / dates /
 * sections / etc., regardless of these coarse labels.
 */
function entityTypesForFilename(filename: string): string[] {
  const lc = filename.toLowerCase();

  // Contract-family documents
  if (/agreement|msa|contract|sow|order[\s_-]?form/.test(lc)) return ['Contract'];
  if (/addendum|exhibit|schedule|annex/.test(lc)) return ['Exhibit'];
  if (/amendment|redline/.test(lc)) return ['Contract', 'Amendment'];
  if (/side[\s_-]?letter/.test(lc)) return ['Letter', 'SideLetter'];

  // Correspondence
  if (/email|e-?mail|message/.test(lc)) return ['Email'];
  if (/letter|memo/.test(lc)) return ['Letter'];

  // Internal / governance
  if (/policy/.test(lc)) return ['Policy'];
  if (/minutes|resolution|consent/.test(lc)) return ['CorporateRecord'];
  if (/opinion/.test(lc)) return ['LegalOpinion'];

  // Default for anything else
  return ['LegalDocument'];
}

/**
 * Walk the repo and produce one CorpusFile per ingestable file.
 * @param repoRoot Absolute path to the repo root. Defaults to the current working directory.
 */
export function discoverCorpus(repoRoot: string = process.cwd()): CorpusFile[] {
  const out: CorpusFile[] = [];

  for (const subdir of readdirSync(repoRoot)) {
    if (subdir.startsWith('.') && !CURATED_SUBDIRS.has(subdir)) continue;
    if (SKIP_DIRS.has(subdir)) continue;
    const subdirPath = join(repoRoot, subdir);
    if (!statSync(subdirPath).isDirectory()) continue;

    walkSubdir(subdir, subdirPath, repoRoot, out);
  }

  return out;
}

function walkSubdir(subdir: string, dirPath: string, repoRoot: string, out: CorpusFile[]): void {
  const isCurated = CURATED_SUBDIRS.has(subdir);

  for (const entry of readdirSync(dirPath)) {
    if (SKIP_FILENAMES.has(entry)) continue;
    const entryPath = join(dirPath, entry);
    const stat = statSync(entryPath);

    if (stat.isDirectory()) {
      walkSubdir(subdir, entryPath, repoRoot, out);
      continue;
    }
    if (!stat.isFile()) continue;

    const ext = extname(entry).toLowerCase();
    const format = FORMAT_BY_EXT[ext];
    if (!format) continue;

    const relPath = relative(repoRoot, entryPath);
    const baseTypes = entityTypesForFilename(entry);
    const entityTypes = isCurated ? ['LegalContext', 'Curated', ...baseTypes] : baseTypes;

    out.push({
      path: relPath,
      name: nameFromFilename(entry),
      format,
      entityTypes,
      storageUri: `file://${relPath}`,
      source: isCurated ? 'curated-context' : 'document',
      subdir,
    });
  }
}

/** Read file contents into a Buffer for upload via yield.resource. */
export function readForUpload(file: CorpusFile, repoRoot: string = process.cwd()): Buffer {
  return readFileSync(join(repoRoot, file.path));
}
