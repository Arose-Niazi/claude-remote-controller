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
 * Detect whether Claude Code is actively working (vs. idle / waiting for input).
 *
 * While Claude works it renders a live status line that always contains the
 * phrase "esc to interrupt" (e.g. "✻ Cogitating… (12s · ↑ 1.2k tokens · esc to
 * interrupt)"). When the turn finishes that line disappears and the input box
 * returns. Scanning the recent buffer for that phrase is a reliable,
 * cross-platform, version-stable signal that needs no shell hook — so it works
 * on Windows agents where the bash notify plugin can't run.
 */
export function detectClaudeWorking(term: Terminal): boolean {
  const buffer = term.buffer.active;
  const cursorAbsY = buffer.baseY + buffer.cursorY;
  const startY = Math.max(0, cursorAbsY - 24);
  const endY = Math.min(buffer.length - 1, cursorAbsY + 2);
  for (let y = startY; y <= endY; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (WORKING_PATTERNS.some((p) => p.test(text))) return true;
  }
  return false;
}

// Signals that Claude is mid-turn. Narrow (phone-width) panes truncate the
// status-bar hint, so "esc to interrupt" never appears in full there — e.g.
// "⏵⏵ bypass permissions on (shift+tab to cycle) · esc …" (Claude Code 2.1.x).
const WORKING_PATTERNS = [
  /esc to interrupt/i,
  /\)\s*·\s*esc\b/, // truncated status suffix on narrow panes
  /^\s*[✻✽✶✳✢·*+]\s+[A-Z][a-z]+ing(…|\.{3})/, // live spinner verb ("✻ Baking…")
];

// Idle-visible Claude Code chrome, for telling a Claude terminal apart from a
// plain shell even when Claude isn't working (e.g. right after attaching).
const CHROME_PATTERN =
  /shift\+tab to cycle|bypass permissions|\? for shortcuts|@ for file paths|plan mode/i;

/**
 * True if the terminal near the cursor shows Claude Code UI chrome — works
 * while Claude is idle, unlike detectClaudeWorking.
 */
export function detectClaudeChrome(term: Terminal): boolean {
  const buffer = term.buffer.active;
  const cursorAbsY = buffer.baseY + buffer.cursorY;
  const startY = Math.max(0, cursorAbsY - 24);
  const endY = Math.min(buffer.length - 1, cursorAbsY + 2);
  for (let y = startY; y <= endY; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    if (CHROME_PATTERN.test(line.translateToString(true))) return true;
  }
  return false;
}

// The Claude Code composer line: "❯ <typed text>" (older builds render "> ").
// Distinct from the "❯ 1. …" selection marker inside numbered option menus.
const INPUT_PREFIX = /^[❯>]\s?/;
const OPTION_MARKER = /^[❯>]?\s*\d{1,2}\.\s/;

/**
 * Read the text currently sitting in Claude Code's own input line — e.g. a
 * message restored by ESC-interrupt, or one cycled in with ↑/↓ history.
 *
 * The caret sits at the end of the typed text, so we take the "❯" row down to
 * the cursor row (a soft-wrapped input keeps the caret on its last row, with
 * continuation rows in between) and cut the cursor row at the caret column —
 * which also excludes placeholder/ghost text rendered after the caret.
 * Returns '' when the input is empty or no composer line is near the cursor.
 */
export function detectClaudeInputText(term: Terminal): string {
  const buffer = term.buffer.active;
  const cursorAbsY = buffer.baseY + buffer.cursorY;

  // Find the composer row at the caret or up to 20 rows above it (a wrapped
  // input keeps the caret on its last row, with continuation rows between).
  // The prefix must sit at column 0 (or just inside a box border): the
  // continuation rows are space-indented, and stripping that indent before
  // testing would let a quoted "> …" line inside the message masquerade as
  // the composer row and truncate everything above it.
  let promptY = -1;
  for (let y = cursorAbsY; y >= Math.max(0, cursorAbsY - 20); y--) {
    const line = buffer.getLine(y);
    if (!line) break;
    const raw = line.translateToString(true);
    let anchored: string | null = null;
    if (INPUT_PREFIX.test(raw)) {
      anchored = raw;
    } else if (/^[│┃]/.test(raw)) {
      const stripped = stripBoxChars(raw);
      if (INPUT_PREFIX.test(stripped)) anchored = stripped;
    }
    if (anchored !== null) {
      if (OPTION_MARKER.test(anchored)) return ''; // menu marker, not the composer
      promptY = y;
      break;
    }
    // A blank row above the caret means we've left the input block.
    if (stripBoxChars(raw) === '' && y !== cursorAbsY) break;
  }
  if (promptY < 0) return '';

  // Reassemble the rows. The caret row is cut at the caret column, which
  // drops placeholder/ghost text rendered after it. A row that ran the full
  // terminal width hard-broke mid-token (e.g. a long URL), so the next row
  // joins with '' — otherwise with ' ' (word wrap swallowed the space).
  // Hard newlines inside the message are flattened to spaces; the grid can't
  // distinguish them from word wrap.
  let result = '';
  let prevFull = false;
  for (let y = promptY; y <= cursorAbsY; y++) {
    const line = buffer.getLine(y);
    if (!line) break;
    const rawFull = line.translateToString(true);
    const raw =
      y === cursorAbsY ? line.translateToString(false, 0, buffer.cursorX) : rawFull;
    let text = stripBoxChars(raw);
    if (y === promptY) text = text.replace(INPUT_PREFIX, '');
    text = text.trim();
    if (text) {
      result = result === '' ? text : prevFull ? result + text : result + ' ' + text;
    }
    // Boxed rows always end at the border, so full-width says nothing there.
    prevFull = !/^[│┃]/.test(rawFull) && rawFull.length >= term.cols - 1;
  }
  return result.trim();
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
