/**
 * build-due-diligence-checklist — aggregate skill 5's commenting annotations
 * (action items, deadlines, follow-ups) into a single Checklist resource.
 *
 * Each row carries a quote (the source paragraph excerpt), a link to the
 * source resource, and any responsible-party / deadline metadata extracted
 * from the annotation's commentary body.
 *
 * Usage: tsx skills/build-due-diligence-checklist/script.ts [--interactive]
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
import { confirm, close as closeInteractive } from '../../src/interactive.js';

const CHECKLIST_NAME = process.env.CHECKLIST_NAME ?? 'Due-diligence checklist';
const INCLUDE_GATHER = process.env.INCLUDE_GATHER !== '0';

interface Item {
  rId: ResourceId;
  rName: string;
  annId: AnnotationId;
  /** The annotation's source quote (target.selector.exact). */
  sourceQuote: string;
  /** The model's commentary text (the "what's pending" paraphrase). */
  comment: string;
  /** Surrounding-paragraph excerpt from gather.annotation. */
  excerpt?: string;
}

function getMediaType(r: any): string | undefined {
  const reps = Array.isArray(r.representations)
    ? r.representations
    : r.representations
      ? [r.representations]
      : [];
  return reps[0]?.mediaType;
}

async function main(): Promise<void> {
  const baseUrl = process.env.SEMIONT_API_URL ?? 'http://localhost:4000';
  const email = process.env.SEMIONT_USER_EMAIL!;
  const password = process.env.SEMIONT_USER_PASSWORD!;
  const u = new URL(baseUrl);
  const kb: KnowledgeBase = {
    id: 'legal-build-due-diligence-checklist',
    label: 'legal build-due-diligence-checklist',
    email,
    endpoint: { kind: 'http', host: u.hostname, port: Number(u.port) || 4000, protocol: u.protocol.replace(':', '') as 'http' | 'https' },
  };
  const session = await SemiontSession.signInHttp({ kb, storage: new InMemorySessionStorage(), baseUrl, email, password });
  const semiont = session.client;

  const all = await semiont.browse.resources({ limit: 1000 });
  const markdownResources = all.filter((r) => {
    const mt = getMediaType(r);
    return mt === 'text/markdown' || mt === 'text/plain';
  });

  if (markdownResources.length === 0) {
    console.log('No markdown corpus resources found.');
    await session.dispose();
    closeInteractive();
    return;
  }

  const items: Item[] = [];
  for (const r of markdownResources) {
    const rId = ridBrand(r['@id']);
    const annotations = await semiont.browse.annotations(rId);
    for (const ann of annotations) {
      if (ann.motivation !== 'commenting') continue;
      const bodies = Array.isArray(ann.body) ? ann.body : ann.body ? [ann.body] : [];
      const commentText = bodies
        .filter((b: any) => b.type === 'TextualBody' && b.purpose === 'commenting')
        .map((b: any) => (Array.isArray(b.value) ? b.value.join(' ') : b.value))
        .join(' ');
      if (!commentText.trim()) continue;
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
      items.push({
        rId,
        rName: r.name ?? r['@id'],
        annId: ann.id,
        sourceQuote: quote,
        comment: commentText.trim(),
      });
    }
  }

  if (items.length === 0) {
    console.log(
      'No commenting annotations found. Run skills/comment-action-items/script.ts first.',
    );
    await session.dispose();
    closeInteractive();
    return;
  }

  console.log(`Found ${items.length} commenting annotation(s) across the corpus.`);
  const proceed = await confirm(`Synthesize a Checklist resource named "${CHECKLIST_NAME}"?`, true);
  if (!proceed) {
    console.log('Aborted.');
    await session.dispose();
    closeInteractive();
    return;
  }

  if (INCLUDE_GATHER) {
    console.log('Fetching surrounding-paragraph excerpts via gather.annotation...');
    for (const item of items) {
      try {
        const gather = await semiont.gather.annotation(item.rId, item.annId, {
          contextWindow: 600,
        });
        if (!('response' in gather)) continue;
        const ctx = gather.response as GatheredContext;
        const ctxText = (ctx as any).contextText ?? (ctx as any).text ?? '';
        if (typeof ctxText === 'string' && ctxText) {
          item.excerpt = ctxText.slice(0, 400).trim();
        }
      } catch (e) {
        console.warn(`  gather failed for ${item.annId}: ${(e as Error).message}`);
      }
    }
  }

  // Group items by source resource for a cleaner-reading checklist.
  const byResource = new Map<string, Item[]>();
  for (const item of items) {
    const key = item.rName;
    if (!byResource.has(key)) byResource.set(key, []);
    byResource.get(key)!.push(item);
  }

  const lines: string[] = [
    `# ${CHECKLIST_NAME}`,
    '',
    `Auto-generated due-diligence checklist aggregating ${items.length} action item(s) ` +
      `from ${byResource.size} document(s) in the corpus.`,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const [docName, docItems] of byResource) {
    lines.push(`## ${docName}`);
    lines.push('');
    docItems.forEach((item, i) => {
      lines.push(`${i + 1}. **${item.comment}**`);
      if (item.sourceQuote) {
        lines.push(`   > ${item.sourceQuote.replace(/\n+/g, ' ')}`);
      }
      if (item.excerpt && item.excerpt !== item.sourceQuote) {
        lines.push(`   *Context:* ${item.excerpt.replace(/\n+/g, ' ').slice(0, 200)}…`);
      }
      lines.push(`   *Source:* [${docName}](${item.rId})`);
      lines.push('');
    });
  }

  lines.push('---');
  lines.push('');
  lines.push(
    `*Synthesized by the \`build-due-diligence-checklist\` skill from ` +
      `${items.length} commenting annotations.*`,
  );

  const body = lines.join('\n') + '\n';
  const { resourceId: checklistId } = await semiont.yield.resource({
    name: CHECKLIST_NAME,
    file: Buffer.from(body, 'utf-8'),
    format: 'text/markdown',
    entityTypes: ['Checklist', 'Aggregate'],
    storageUri: `file://generated/checklist-${Date.now()}.md`,
  });

  console.log(`\nDone. Checklist resource: ${checklistId} (${items.length} items, ${body.length} bytes).`);
  await session.dispose();
  closeInteractive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
