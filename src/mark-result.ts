/**
 * Helpers for reading the awaited result of `mark.assist`.
 *
 * Each motivation reports a different per-job-type result shape — linking
 * jobs return `{ totalFound, totalEmitted, errors }`, assessing jobs return
 * `{ assessmentsFound, assessmentsCreated }`, etc. The fields are typed in
 * `@semiont/core` as a discriminated union (`JobResult`) on
 * `JobCompleteCommand.result`. This helper picks the right "created" count
 * for whichever motivation ran, narrowed via `in` checks so the SDK's union
 * doesn't leak `any` into callers.
 */

import type { MarkAssistEvent } from '@semiont/sdk';

/** Number of annotations created by the job, regardless of motivation. */
export function createdCount(progress: MarkAssistEvent): number {
  if (progress.kind !== 'complete') return 0;
  const r = progress.data.result;
  if (!r) return 0;
  if ('totalEmitted' in r) return r.totalEmitted;             // reference (linking)
  if ('assessmentsCreated' in r) return r.assessmentsCreated;  // assessing
  if ('commentsCreated' in r) return r.commentsCreated;        // commenting
  if ('highlightsCreated' in r) return r.highlightsCreated;    // highlighting
  if ('tagsCreated' in r) return r.tagsCreated;                // tagging
  return 0;
}
