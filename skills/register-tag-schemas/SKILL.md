# register-tag-schemas

Register every tag schema this KB owns (`legal-irac`, `argument-toulmin`)
with the runtime registry. One-time bootstrap for a fresh KB; re-running
is harmless (identical re-registrations are silent at the projection layer).

## When to run

- After standing up a fresh KB (no existing `__system__` events for tag schemas).
- After wiping the KB's state directory.
- Before opening the TaggingPanel UI on a KB that hasn't run any tagging skill yet.

## Usage

```sh
tsx skills/register-tag-schemas/script.ts
```

Reads `SEMIONT_API_URL` from the environment and signs in as every other
skill in this KB does: it prints an address, and a person approves in a
browser. [Signing in](https://github.com/The-AI-Alliance/semiont/blob/main/docs/builder/SIGN-IN.md)
has the other ways a script can sign in.

## What gets registered

Schemas live in [`src/tag-schemas.ts`](../../src/tag-schemas.ts):

- **`legal-irac`** — Issue / Rule / Application / Conclusion (legal reasoning).
- **`argument-toulmin`** — Claim / Evidence / Warrant / Counterargument / Rebuttal (argumentation).
