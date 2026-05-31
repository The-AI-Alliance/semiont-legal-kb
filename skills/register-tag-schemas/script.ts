/**
 * register-tag-schemas — register every tag schema this KB owns with the
 * runtime registry.
 *
 * Tag schemas live with the KB that uses them (see semiont's
 * .plans/TAG-SCHEMAS-GAP.md). They're persisted on the KB's `__system__`
 * event stream and materialized into the `tagschemas.json` projection.
 * Re-registering identical content is silent at the projection layer.
 *
 * Run this once after standing up a fresh KB (or after wiping the KB's
 * state directory). Skills that use a specific schema can also self-
 * register the schemas they need — this skill exists for the bootstrap
 * case where the user wants the full schema set available to the
 * TaggingPanel UI before running any specific skill.
 *
 * Usage: tsx skills/register-tag-schemas/script.ts
 */

import { SemiontSession, InMemorySessionStorage, type KnowledgeBase } from '@semiont/sdk';
import { ALL_SCHEMAS } from '../../src/tag-schemas.js';

async function main(): Promise<void> {
  const baseUrl = process.env.SEMIONT_API_URL ?? 'http://localhost:4000';
  const email = process.env.SEMIONT_USER_EMAIL!;
  const password = process.env.SEMIONT_USER_PASSWORD!;
  const u = new URL(baseUrl);
  const kb: KnowledgeBase = {
    id: 'legal-register-tag-schemas',
    label: 'legal register-tag-schemas',
    email,
    endpoint: { kind: 'http', host: u.hostname, port: Number(u.port) || 4000, protocol: u.protocol.replace(':', '') as 'http' | 'https' },
  };
  const session = await SemiontSession.signInHttp({ kb, storage: new InMemorySessionStorage(), baseUrl, email, password });
  const semiont = session.client;

  try {
    for (const schema of ALL_SCHEMAS) {
      await semiont.frame.addTagSchema(schema);
      console.log(`  registered: ${schema.id} (${schema.tags.length} categories)`);
    }

    console.log(`\nDone. ${ALL_SCHEMAS.length} schema(s) registered.`);
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
