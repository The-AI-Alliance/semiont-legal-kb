import type { ResourceDescriptor } from '@semiont/sdk';

/**
 * The media type a resource is stored as, or undefined when it declares none.
 *
 * `representations` is optional and may arrive as a single object or an array;
 * this normalizes both. Lived as a byte-identical copy in every skill until
 * 2026-08-23 — one definition now, typed against ResourceDescriptor rather than
 * `any`, so a shape change is a compile error instead of a silent undefined.
 */
export function getMediaType(r: ResourceDescriptor): string | undefined {
  const reps = Array.isArray(r.representations)
    ? r.representations
    : r.representations
      ? [r.representations]
      : [];
  return reps[0]?.mediaType;
}
