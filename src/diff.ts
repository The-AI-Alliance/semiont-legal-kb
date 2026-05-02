/**
 * Section-aware text diff for legal documents.
 *
 * Used by `redline-tracker` (skill 11) to compare two contract versions
 * and produce a structured change record per section. Falls back to
 * whole-document comparison if no section headings are detected.
 */

import { splitMarkdownSections } from './sections.js';

export interface SectionChange {
  /** Anchor pulled from the heading (e.g., "4.2", "Exhibit C", "Section 4.2"). */
  sectionAnchor: string;
  /** The full heading text as it appeared. */
  heading: string;
  changeKind: 'added' | 'removed' | 'modified';
  /** One-line summary suitable for a checklist row. */
  summary: string;
  /** Prior text (excerpt, capped to keep summaries readable). */
  before?: string;
  /** New text (excerpt, capped). */
  after?: string;
}

function excerpt(text: string, max = 160): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

/**
 * Compare two contract markdown bodies and return the per-section changes.
 *
 * Strategy: split each side into sections by markdown heading. For each
 * heading present in both, compare the bodies as whitespace-normalized
 * strings. Headings only in `next` are 'added'; headings only in `prior`
 * are 'removed'; headings in both with differing bodies are 'modified'.
 *
 * If neither side has any markdown headings, returns a single
 * 'modified' / 'added' / 'removed' change covering the whole document
 * (so callers always get a useful record back).
 */
export function diffContracts(prior: string, next: string): SectionChange[] {
  const priorSections = splitMarkdownSections(prior);
  const nextSections = splitMarkdownSections(next);

  if (priorSections.length === 0 && nextSections.length === 0) {
    if (prior.trim() === next.trim()) return [];
    return [
      {
        sectionAnchor: 'document',
        heading: 'Whole document',
        changeKind: prior.trim() ? 'modified' : 'added',
        summary: prior.trim()
          ? `Document body changed (no sections detected).`
          : `Document body added (no sections detected).`,
        before: prior.trim() ? excerpt(prior) : undefined,
        after: next.trim() ? excerpt(next) : undefined,
      },
    ];
  }

  const priorByAnchor = new Map(priorSections.map((s) => [s.anchor, s] as const));
  const nextByAnchor = new Map(nextSections.map((s) => [s.anchor, s] as const));
  const allAnchors = new Set<string>([...priorByAnchor.keys(), ...nextByAnchor.keys()]);

  const changes: SectionChange[] = [];
  for (const anchor of allAnchors) {
    const p = priorByAnchor.get(anchor);
    const n = nextByAnchor.get(anchor);
    if (p && !n) {
      changes.push({
        sectionAnchor: anchor,
        heading: p.heading,
        changeKind: 'removed',
        summary: `Section "${p.heading}" was removed.`,
        before: excerpt(p.body),
      });
      continue;
    }
    if (!p && n) {
      changes.push({
        sectionAnchor: anchor,
        heading: n.heading,
        changeKind: 'added',
        summary: `Section "${n.heading}" was added.`,
        after: excerpt(n.body),
      });
      continue;
    }
    if (p && n) {
      const pNorm = p.body.replace(/\s+/g, ' ').trim();
      const nNorm = n.body.replace(/\s+/g, ' ').trim();
      if (pNorm !== nNorm) {
        changes.push({
          sectionAnchor: anchor,
          heading: n.heading,
          changeKind: 'modified',
          summary: `Section "${n.heading}" was modified.`,
          before: excerpt(p.body),
          after: excerpt(n.body),
        });
      }
    }
  }

  changes.sort((a, b) => a.sectionAnchor.localeCompare(b.sectionAnchor, undefined, { numeric: true }));
  return changes;
}
