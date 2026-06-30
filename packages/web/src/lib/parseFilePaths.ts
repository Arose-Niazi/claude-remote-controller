/**
 * Find file-looking paths inside a chat message. Returns non-overlapping
 * matches in source order.
 *
 * We deliberately require either a path separator or a leading relative prefix
 * (./, ../) so that a bare word like "version 3.14" or "example.com" doesn't
 * get turned into a download button. Allowed forms:
 *
 *   /absolute/path/file.ext
 *   ./relative/file.ext
 *   ../sibling/file.ext
 *   src/file.ext
 *   packages/web/src/components/ChatView.tsx
 *   C:\Users\foo\bar.txt
 *   C:/Users/foo/bar.txt
 *
 * URLs (http://…, https://…) and email-like strings are excluded.
 */
const EXCLUDED_EXTENSIONS = new Set(['com', 'org', 'net', 'io', 'co']); // common TLDs

// Matches a path-looking string that contains at least one path separator and
// ends with a dotted extension.
//
// NOTE: we deliberately AVOID a negative lookbehind here — a top-level regex
// literal beginning with `(?<!…)` throws a SyntaxError at module-parse time on
// iOS Safari < 16.4, which blanks the whole app. The old leading boundary was
// the lookbehind `(?<![A-Za-z0-9/\\:@.])`; we now reproduce it by inspecting
// the character immediately before the match in code (see PATH_BOUNDARY_BEFORE
// and the loop below) instead of in the pattern.
//
// Optional leading prefix on the path body:
//   - [A-Za-z]:[\\/]  Windows drive letter, e.g. "C:\"
//   - \.{1,2}[\\/]    Relative "./" or "../"
//   - [\\/]           Bare leading "/" or "\"
const PATH_REGEX = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.\-]+[\\/])+[\w.\-]+\.[A-Za-z][A-Za-z0-9]{0,7}(?![A-Za-z0-9])/g;

// The character preceding a path match must NOT be one of these (matches the
// old negative-lookbehind class). If it is, the match started mid-token (inside
// a URL, email, longer word, etc.) and is rejected.
const PATH_BOUNDARY_BEFORE = /[A-Za-z0-9/\\:@.]/;

export interface ParsedFragment {
  type: 'text' | 'path';
  value: string;
}

export function parseFilePathsInText(text: string): ParsedFragment[] {
  if (!text) return [{ type: 'text', value: '' }];

  const fragments: ParsedFragment[] = [];
  let last = 0;

  const matches: { start: number; end: number; path: string }[] = [];
  PATH_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_REGEX.exec(text)) !== null) {
    const path = m[0];
    const start = m.index;
    const end = start + path.length;

    // Emulate the old negative lookbehind: reject a match whose preceding
    // character is a word/path char (so we don't match mid-URL, mid-email, or
    // mid-word). Re-scan from just after the start so a valid path beginning
    // one char later can still be found.
    if (start > 0 && PATH_BOUNDARY_BEFORE.test(text[start - 1])) {
      PATH_REGEX.lastIndex = start + 1;
      continue;
    }

    // Skip URLs
    if (start >= 3 && text.slice(start - 3, start) === '://') continue;
    if (start >= 7 && /https?:\/\//.test(text.slice(Math.max(0, start - 10), start))) continue;

    // Skip email-ish strings (preceded by @)
    if (start >= 1 && text[start - 1] === '@') continue;

    // Extension check: skip common TLDs unless there's a path separator
    const extMatch = path.match(/\.([A-Za-z][A-Za-z0-9]{0,7})$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    const hasSeparator = /[\\/]/.test(path);
    if (!hasSeparator && EXCLUDED_EXTENSIONS.has(ext)) continue;

    matches.push({ start, end, path });
  }

  for (const { start, end, path } of matches) {
    if (start > last) {
      fragments.push({ type: 'text', value: text.slice(last, start) });
    }
    fragments.push({ type: 'path', value: path });
    last = end;
  }
  if (last < text.length) {
    fragments.push({ type: 'text', value: text.slice(last) });
  }
  if (fragments.length === 0) fragments.push({ type: 'text', value: text });
  return fragments;
}

/**
 * Resolve a path that may be absolute or relative against a project directory.
 * Handles both POSIX and Windows conventions.
 */
export function resolveFilePath(rawPath: string, projectPath: string | null): string {
  const path = rawPath.trim();
  if (!path) return path;
  if (isAbsolutePath(path)) return path;
  if (!projectPath) return path;

  const useBackslash = projectPath.includes('\\');
  const sep = useBackslash ? '\\' : '/';

  // Strip ./ prefix
  let rel = path.replace(/^\.[\\/]/, '');

  // Normalize separators to match project style
  if (useBackslash) {
    rel = rel.replace(/\//g, '\\');
  } else {
    rel = rel.replace(/\\/g, '/');
  }

  const base = projectPath.endsWith(sep) ? projectPath : projectPath + sep;
  return base + rel;
}

export function isAbsolutePath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith('/')) return true; // POSIX
  if (/^[A-Za-z]:[\\/]/.test(path)) return true; // Windows drive
  if (path.startsWith('\\\\')) return true; // UNC
  return false;
}
