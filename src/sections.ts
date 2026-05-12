/**
 * Markdown-section splitter for legal documents.
 *
 * Recognizes contract section conventions in markdown headings:
 *   - `## 4.2 Title…` / `### 4.2 Title…`
 *   - `## Section 4.2 — Title…`
 *   - `## Exhibit C — Title…`
 *   - `## Article III — Title…`
 *
 * The `anchor` field is the bare reference token ("4.2", "C", "III"),
 * suitable for matching cross-document mentions like "Section 4.2" or
 * "Exhibit C". The `heading` field is the full heading text. Used by
 * `build-section-graph` (skill 7) for decomposing contracts into
 * per-section resources, and by `redline-tracker` (skill 11) for
 * comparing two versions section-by-section.
 *
 * If no markdown headings are detected, callers get an empty array and
 * fall back to whole-document handling.
 */

const HEADING_RE = /^(?:#{1,6}\s+)(?<full>(?<prefix>Section\s+|Exhibit\s+|Schedule\s+|Article\s+|Annex\s+|Appendix\s+)?(?<anchor>[A-Z0-9](?:[\w.()-]{0,32})?)(?:\s+[-–—:]\s+|\s+)(?<title>.+))$/im;
const HEADING_LINE_RE = /^#{1,6}\s+/;

export interface Section {
  /** The bare reference token, e.g. "4.2", "C", "III". */
  anchor: string;
  /** The full heading text, e.g. "4.2 Scope of License" or "Exhibit C — Information Security". */
  heading: string;
  /** The section's content (everything until the next heading), trimmed. */
  body: string;
}

/**
 * Split a markdown document into sections, one entry per heading line.
 *
 * Returns an empty array if no markdown headings are detected — callers
 * should treat that as "the document isn't structured".
 */
export function splitMarkdownSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) {
      current.body = buffer.join('\n').trim();
      sections.push(current);
    }
  };

  for (const line of lines) {
    if (HEADING_LINE_RE.test(line)) {
      const m = line.match(HEADING_RE);
      flush();
      buffer = [];
      if (m && m.groups && m.groups.anchor && m.groups.full) {
        current = {
          anchor: m.groups.anchor.trim(),
          heading: m.groups.full.trim(),
          body: '',
        };
      } else {
        const stripped = line.replace(HEADING_LINE_RE, '').trim();
        current = { anchor: stripped, heading: stripped, body: '' };
      }
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections;
}
