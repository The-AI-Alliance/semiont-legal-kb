/**
 * build-section-graph — decompose a structured legal document into
 * per-section LegalSection resources, then walk every cross-document
 * section reference and bind it to the canonical section.
 *
 * Usage: tsx skills/build-section-graph/script.ts <contractResourceId> [--interactive]
 */

import {
  SemiontSession,
  InMemorySessionStorage,
  type KnowledgeBase,
  resourceId as ridBrand,
  type AnnotationId,
  type GatheredContext,
  type ResourceId,
} from '@semiont/sdk';
import { splitMarkdownSections } from '../../src/sections.js';
import { confirm, close as closeInteractive } from '../../src/interactive.js';

const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD ?? 30);

function getMediaType(r: any): string | undefined {
  const reps = Array.isArray(r.representations)
    ? r.representations
    : r.representations
      ? [r.representations]
      : [];
  return reps[0]?.mediaType;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

interface SectionAnno {
  rId: ResourceId;
  rName: string;
  annId: AnnotationId;
  text: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const contractIdArg = args[0];
  if (!contractIdArg) {
    console.error('Usage: tsx skills/build-section-graph/script.ts <contractResourceId>');
    process.exit(1);
  }
  const contractId = ridBrand(contractIdArg);

  const baseUrl = process.env.SEMIONT_API_URL ?? 'http://localhost:4000';
  const email = process.env.SEMIONT_USER_EMAIL!;
  const password = process.env.SEMIONT_USER_PASSWORD!;
  const u = new URL(baseUrl);
  const kb: KnowledgeBase = {
    id: 'legal-build-section-graph',
    label: 'legal build-section-graph',
    email,
    endpoint: { kind: 'http', host: u.hostname, port: Number(u.port) || 4000, protocol: u.protocol.replace(':', '') as 'http' | 'https' },
  };
  const session = await SemiontSession.signInHttp({ kb, storage: new InMemorySessionStorage(), baseUrl, email, password });
  const semiont = session.client;

  try {
    // Fetch the contract body and split into sections.
    const body = await semiont.browse.resourceContent(contractId);
    const sections = splitMarkdownSections(body);

    if (sections.length === 0) {
      console.log(
        'No markdown headings detected in this document. Nothing to decompose. ' +
          'Existing LegalSection annotations remain queryable as plain text references.',
      );
      closeInteractive();
      return;
    }

    console.log(`Detected ${sections.length} section(s) in the document.`);
    console.log('First few headings:');
    for (const s of sections.slice(0, 5)) {
      console.log(`  - [${s.anchor}] ${s.heading}`);
    }
    if (sections.length > 5) console.log(`  ... and ${sections.length - 5} more.`);

    const proceed = await confirm(`Synthesize ${sections.length} LegalSection resource(s)?`, true);
    if (!proceed) {
      console.log('Aborted.');
      closeInteractive();
      return;
    }

    // Pass 1: yield.resource for each detected section.
    const sectionResources: Array<{ anchor: string; heading: string; rId: string }> = [];
    for (const s of sections) {
      const sectionBody = `# ${s.heading}\n\n${s.body}\n`;
      const { resourceId: newId } = await semiont.yield.resource({
        name: s.heading,
        file: Buffer.from(sectionBody, 'utf-8'),
        format: 'text/markdown',
        entityTypes: ['LegalSection'],
        storageUri: `file://generated/legal-section-${slugify(s.heading)}.md`,
      });
      sectionResources.push({ anchor: s.anchor, heading: s.heading, rId: newId as unknown as string });
      console.log(`  + [${s.anchor}] "${s.heading}" → ${newId}`);
    }

    // Pass 2: walk every linking annotation tagged LegalSection and bind to a section resource.
    console.log(`\nResolving cross-document section references...`);
    const all = await semiont.browse.resources({ limit: 1000 });
    const markdownResources = all.filter((r) => {
      const mt = getMediaType(r);
      return mt === 'text/markdown' || mt === 'text/plain';
    });

    const sectionAnnotations: SectionAnno[] = [];
    for (const r of markdownResources) {
      const rId = ridBrand(r['@id']);
      const annotations = await semiont.browse.annotations(rId);
      for (const ann of annotations) {
        if (ann.motivation !== 'linking') continue;
        const bodies = Array.isArray(ann.body) ? ann.body : ann.body ? [ann.body] : [];
        const alreadyBound = bodies.some(
          (b: any) => b.type === 'SpecificResource' && b.purpose === 'linking',
        );
        if (alreadyBound) continue;
        const tags = bodies
          .filter((b: any) => b.type === 'TextualBody' && b.purpose === 'tagging')
          .flatMap((b: any) => (Array.isArray(b.value) ? b.value : [b.value]));
        if (!tags.includes('LegalSection')) continue;
        const target = ann.target;
        const selectors =
          typeof target === 'string' || !target.selector
            ? []
            : Array.isArray(target.selector)
              ? target.selector
              : [target.selector];
        let quote = '';
        for (const s of selectors) {
          if (s.type === 'TextQuoteSelector') { quote = s.exact; break; }
        }
        sectionAnnotations.push({
          rId,
          rName: r.name ?? r['@id'],
          annId: ann.id,
          text: quote,
        });
      }
    }

    if (sectionAnnotations.length === 0) {
      console.log('No unbound LegalSection annotations found across the corpus.');
      closeInteractive();
      return;
    }

    console.log(`Found ${sectionAnnotations.length} unbound LegalSection mention(s) to resolve.`);

    let bound = 0;
    let unmatched = 0;
    for (const a of sectionAnnotations) {
      const gather = await semiont.gather.annotation(a.rId, a.annId, { contextWindow: 1500 });
      if (!('response' in gather)) continue;
      const context = gather.response as GatheredContext;
      const matchResult = await semiont.match.search(a.rId, a.annId, context, {
        limit: 5,
        useSemanticScoring: true,
      });
      const top = matchResult.response[0];
      const isSectionResource =
        top && sectionResources.some((s) => s.rId === top['@id']);

      if (top && (top.score ?? 0) >= MATCH_THRESHOLD && isSectionResource) {
        await semiont.bind.body(a.rId, a.annId, [
          {
            op: 'add',
            item: { type: 'SpecificResource', source: top['@id'], purpose: 'linking' },
          },
        ]);
        bound++;
        console.log(`  bound       "${a.text}" → ${top.name} (score ${top.score})`);
      } else {
        unmatched++;
        console.log(`  unmatched   "${a.text}" (top: ${top?.name ?? 'none'} [${top?.score ?? 0}])`);
      }
    }

    console.log(
      `\nDone. Decomposed into ${sectionResources.length} LegalSection resource(s); ` +
        `bound ${bound} cross-document references; ${unmatched} unmatched.`,
    );
    closeInteractive();
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
