import type { Terminal } from '@xterm/xterm';

export interface DetectedPromptOption {
  number: number;
  text: string;
  selected: boolean;
}

export interface DetectedPrompt {
  question: string;
  options: DetectedPromptOption[];
}

// Chars used by Claude Code's box-drawn prompt frames — stripped before parsing.
const BOX_CHARS_LEADING = /^[│┃╭╮╰╯╭╯┌┐└┘─━\s]*/;
const BOX_CHARS_TRAILING = /[│┃─━\s]*$/;

function stripBoxChars(line: string): string {
  return line.replace(BOX_CHARS_LEADING, '').replace(BOX_CHARS_TRAILING, '');
}

/**
 * Scan the xterm buffer for an active Claude Code interactive prompt.
 *
 * Claude Code prompts look like one of:
 *
 *   Do you want to proceed?
 *   ❯ 1. Yes
 *     2. Yes, and don't ask again this session (shift+tab)
 *     3. No, and tell Claude what to do differently (esc)
 *
 * or (wrapped in a box):
 *
 *   ╭────────────────────────────────╮
 *   │ Do you want to make this edit? │
 *   │                                │
 *   │ ❯ 1. Yes                       │
 *   │   2. Yes, allow all edits      │
 *   │   3. No, keep reading          │
 *   ╰────────────────────────────────╯
 *
 * Signals we require before we return a prompt:
 *   - At least 2 consecutive numbered options (1., 2., …)
 *   - At least one option is marked as selected with "❯"
 *   - The options are within a few lines of the cursor (so old prompts
 *     that have scrolled into history don't trigger)
 */
export function detectClaudePrompt(term: Terminal): DetectedPrompt | null {
  const buffer = term.buffer.active;
  const cursorAbsY = buffer.baseY + buffer.cursorY;
  const startY = Math.max(0, cursorAbsY - 30);
  const endY = Math.min(buffer.length - 1, cursorAbsY + 2);

  const lines: string[] = [];
  for (let y = startY; y <= endY; y++) {
    const line = buffer.getLine(y);
    lines.push(line ? line.translateToString(true) : '');
  }
  const cursorLineIdx = cursorAbsY - startY;

  interface OptHit {
    number: number;
    text: string;
    selected: boolean;
    lineIndex: number;
  }
  const hits: OptHit[] = [];

  for (let i = 0; i < lines.length; i++) {
    const stripped = stripBoxChars(lines[i]);
    // Match "❯ 1. Text" or "1. Text"
    const m = stripped.match(/^(❯\s*)?(\d{1,2})\.\s+(.+?)\s*$/);
    if (!m) continue;
    const selected = Boolean(m[1]);
    const number = parseInt(m[2], 10);
    const text = m[3].trim();
    if (number < 1 || number > 20) continue;
    hits.push({ number, text, selected, lineIndex: i });
  }

  if (hits.length < 2) return null;

  // Sort by line index; keep only groups of consecutive numbered options that
  // form 1, 2, 3, … starting from the last such group near the cursor.
  hits.sort((a, b) => a.lineIndex - b.lineIndex);

  // Walk backwards from the hit closest to the cursor, collecting a contiguous
  // group where numbers are 1..N.
  const groups: OptHit[][] = [];
  let current: OptHit[] = [];
  for (const hit of hits) {
    if (current.length === 0) {
      current.push(hit);
    } else {
      const last = current[current.length - 1];
      const nearby = hit.lineIndex - last.lineIndex <= 2; // allow blank line between options
      const nextNumber = last.number + 1;
      if (nearby && hit.number === nextNumber) {
        current.push(hit);
      } else {
        groups.push(current);
        current = [hit];
      }
    }
  }
  if (current.length > 0) groups.push(current);

  // Consider only groups that start at 1, have >=2 options, have a selection,
  // and land close to the cursor.
  const valid = groups.filter((g) => {
    if (g.length < 2) return false;
    if (g[0].number !== 1) return false;
    if (!g.some((o) => o.selected)) return false;
    const lastLine = g[g.length - 1].lineIndex;
    if (cursorLineIdx - lastLine > 8) return false; // prompt has scrolled away
    return true;
  });

  if (valid.length === 0) return null;

  // Pick the group closest to the cursor (most recent)
  const prompt = valid[valid.length - 1];

  // Walk up from the first option to find the question line
  let question = '';
  for (let i = prompt[0].lineIndex - 1; i >= 0; i--) {
    const stripped = stripBoxChars(lines[i]).trim();
    if (!stripped) continue;
    // Skip dividers
    if (/^[─━]+$/.test(stripped)) continue;
    if (/^\d+\.\s/.test(stripped)) break;
    question = stripped;
    break;
  }

  return {
    question: question || 'Claude is waiting for your input',
    options: prompt.map((o) => ({
      number: o.number,
      text: o.text,
      selected: o.selected,
    })),
  };
}

/**
 * Build the keystrokes needed to select a specific option from the prompt.
 *
 * Claude Code prompts are navigated with arrow keys + Enter. Given the current
 * selection (from the detected prompt) and the desired option, this computes
 * the sequence of up/down arrows plus Enter to land on and confirm the target.
 */
export function buildPromptSelectionKeys(
  prompt: DetectedPrompt,
  desiredNumber: number
): string {
  const current = prompt.options.find((o) => o.selected)?.number ?? 1;
  const delta = desiredNumber - current;
  let keys = '';
  if (delta > 0) {
    keys = '\x1b[B'.repeat(delta); // down arrow
  } else if (delta < 0) {
    keys = '\x1b[A'.repeat(-delta); // up arrow
  }
  keys += '\r';
  return keys;
}

/**
 * Compare two prompts for structural equality — useful for avoiding React
 * re-renders when the live detection runs but nothing has changed.
 */
export function promptsEqual(
  a: DetectedPrompt | null,
  b: DetectedPrompt | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.question !== b.question) return false;
  if (a.options.length !== b.options.length) return false;
  for (let i = 0; i < a.options.length; i++) {
    const oa = a.options[i];
    const ob = b.options[i];
    if (oa.number !== ob.number || oa.text !== ob.text || oa.selected !== ob.selected) {
      return false;
    }
  }
  return true;
}
