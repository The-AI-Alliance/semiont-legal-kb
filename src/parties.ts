/**
 * Lightweight pattern-detection helpers for legal-text party hints.
 *
 * Used by `build-party-graph` (skill 9) as a *pre-filter* before invoking
 * mark.assist, and by other skills that benefit from a quick local scan
 * (rather than a full LLM pass) to find candidate spans.
 *
 * Scope: this module recognizes patterns common to legal-document
 * conventions — organization suffixes (LLC, Inc., LLP, GmbH, …),
 * professional titles (General Counsel, Partner, Esq., …) — and never
 * references any specific party, matter, or seeded document name. A
 * different legal corpus dropped into the same repo gets the same hints.
 */

export interface PartyHint {
  /** The matched surface form, as it appears in the text. */
  name: string;
  /** Coarse classification. */
  type: 'Person' | 'Organization';
  /** Surface-form variations of the same entity, if any are obvious from the match. */
  aliases: string[];
}

const ORG_SUFFIX_RE =
  /\b([A-Z][A-Za-z0-9&.,'\- ]{1,60}?)\s+(LLC|L\.L\.C\.|LLP|L\.L\.P\.|LP|L\.P\.|Inc\.?|Corp\.?|Corporation|Co\.|Company|PLLC|P\.L\.L\.C\.|PC|P\.C\.|Ltd\.?|Limited|GmbH|AG|SA|SAS|S\.A\.|N\.V\.|B\.V\.|PLC|Holdings|Trust)\b/g;

const PERSON_TITLE_RE =
  /\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(Esq\.?|Esquire|J\.D\.|Senior\s+Legal\s+Counsel|General\s+Counsel|Associate\s+General\s+Counsel|Deputy\s+General\s+Counsel|Of\s+Counsel|Partner|Senior\s+Partner|Managing\s+Partner|Counsel|Attorney(?:\s+at\s+Law)?|Paralegal)\b/g;

const ROLE_AT_ORG_RE =
  /\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*,?\s*(Senior\s+Legal\s+Counsel|General\s+Counsel|Partner|Of\s+Counsel|Counsel|Attorney|Esq\.?)\s*[\|@]\s*([A-Z][A-Za-z0-9&.,'\- ]{1,60}?(?:\s+(?:LLC|LLP|Inc\.?|Corp\.?|Corporation|PLLC|Ltd\.?|GmbH|PLC|Holdings))?)\b/g;

/**
 * Extract candidate party mentions from a block of legal text.
 *
 * This is a fast, cheap pre-filter — the model still does the canonical
 * detection via `mark.assist`. The output here is useful for "before
 * running an expensive pass, what does the text look like at a glance?"
 * UIs (the tier-3 interactive checkpoint in `build-party-graph`).
 *
 * Returns deduplicated entries (case-insensitive on `name`).
 */
export function extractKnownPartyHints(text: string): PartyHint[] {
  const seen = new Map<string, PartyHint>();

  const addHint = (name: string, type: 'Person' | 'Organization', aliases: string[] = []) => {
    const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key) return;
    const existing = seen.get(key);
    if (existing) {
      for (const alias of aliases) {
        if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
      }
      return;
    }
    seen.set(key, { name: name.trim(), type, aliases });
  };

  for (const m of text.matchAll(ORG_SUFFIX_RE)) {
    const head = m[1]?.trim();
    const suffix = m[2]?.trim();
    if (!head || !suffix) continue;
    addHint(`${head} ${suffix}`, 'Organization', [head]);
  }

  for (const m of text.matchAll(PERSON_TITLE_RE)) {
    const personName = m[1]?.trim();
    if (!personName) continue;
    addHint(personName, 'Person');
  }

  for (const m of text.matchAll(ROLE_AT_ORG_RE)) {
    const personName = m[1]?.trim();
    const orgName = m[3]?.trim();
    if (personName) addHint(personName, 'Person');
    if (orgName) addHint(orgName, 'Organization');
  }

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
