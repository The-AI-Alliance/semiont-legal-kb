/**
 * Interactive-prompt helpers for skill scripts.
 *
 * Reads `SEMIONT_INTERACTIVE=1` (env var) or `--interactive` (process.argv).
 * Also requires stdin.isTTY — pipes / non-terminal stdin auto-disable interactive mode
 * even if the flag is set, so batch invocations behave predictably.
 *
 * In non-interactive mode, all prompts auto-resolve to defaults and informational
 * messages still print (so logs preserve "what was about to happen" visibility
 * without blocking on input).
 */

import * as readline from 'node:readline/promises';

const INTERACTIVE = (
  process.env.SEMIONT_INTERACTIVE === '1' ||
  process.argv.includes('--interactive')
) && process.stdin.isTTY === true;

let rl: readline.Interface | undefined;

function getReadline(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return rl;
}

export function isInteractive(): boolean {
  return INTERACTIVE;
}

/** Close the shared readline if one was opened. Call before process.exit / dispose. */
export function close(): void {
  if (rl) {
    rl.close();
    rl = undefined;
  }
}

/** Yes/no prompt. Returns `default_` in non-interactive mode. */
export async function confirm(prompt: string, default_ = true): Promise<boolean> {
  if (!INTERACTIVE) {
    console.log(`${prompt} [auto-${default_ ? 'yes' : 'no'}]`);
    return default_;
  }
  const suffix = default_ ? 'Y/n' : 'y/N';
  const answer = (await getReadline().question(`${prompt} [${suffix}] `))
    .trim()
    .toLowerCase();
  if (!answer) return default_;
  return answer === 'y' || answer === 'yes';
}

/**
 * Pick one of N options. Returns the first option in non-interactive mode
 * (or `null` if `options` is empty). Returns `null` when the user blanks out
 * to skip.
 */
export async function pick<T>(
  prompt: string,
  options: T[],
  render: (t: T) => string,
): Promise<T | null> {
  const first = options[0];
  if (first === undefined) return null;
  if (!INTERACTIVE) {
    console.log(`${prompt} [auto-pick: ${render(first)}]`);
    return first;
  }
  console.log(prompt);
  options.forEach((opt, i) => {
    console.log(`  ${i + 1}. ${render(opt)}`);
  });
  const answer = (await getReadline().question('Pick (number, or blank to skip): '))
    .trim();
  if (!answer) return null;
  const idx = Number(answer) - 1;
  if (Number.isFinite(idx) && idx >= 0 && idx < options.length) {
    const chosen = options[idx];
    if (chosen !== undefined) return chosen;
  }
  console.log('Skipping.');
  return null;
}

/**
 * Preview a list of items, then ask whether to proceed with all, none, or a
 * selection. In non-interactive mode renders the preview and returns 'all'.
 */
export async function preview<T>(
  prompt: string,
  items: T[],
  render: (t: T) => string,
): Promise<'all' | 'none' | T[]> {
  console.log(prompt);
  items.forEach((item, i) => {
    console.log(`  ${i + 1}. ${render(item)}`);
  });
  if (!INTERACTIVE) {
    console.log(`[auto-proceed: all ${items.length} items]`);
    return 'all';
  }
  const answer = (await getReadline().question(
    'Proceed with: [a]ll / [n]one / [s]elect (e.g. "1,3,7") / Enter for all? ',
  ))
    .trim()
    .toLowerCase();
  if (!answer || answer === 'a' || answer === 'all') return 'all';
  if (answer === 'n' || answer === 'none') return 'none';
  const indices = answer
    .split(',')
    .map((s) => Number(s.trim()) - 1)
    .filter((i) => Number.isFinite(i) && i >= 0 && i < items.length);
  const selected: T[] = [];
  for (const i of indices) {
    const item = items[i];
    if (item !== undefined) selected.push(item);
  }
  return selected;
}
