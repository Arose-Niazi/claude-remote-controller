/**
 * Encode a project path to the directory name Claude uses in ~/.claude/projects/
 *
 * Claude Code replaces EVERY non-alphanumeric character with '-'. This handles
 * ':', '\\', '/', '.', and spaces uniformly, so both backslash and forward-slash
 * Windows cwds encode the same way.
 *
 * Unix:    /Users/arose/Projects        → -Users-arose-Projects
 * Windows: D:\Projects\others\myapp     → D--Projects-others-myapp
 * Windows: D:/Projects/others/myapp     → D--Projects-others-myapp
 *          D:\Projects\site.com         → D--Projects-site-com
 */
export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * Find the matching project directory for a given path.
 * Tries exact encoding first, then falls back to an anchored prefix match
 * (so we never bleed into a sibling project's sessions).
 */
export function findProjectDirs(allDirs: string[], filterProjectPath: string): string[] {
  const encoded = encodeProjectPath(filterProjectPath);

  // Exact match
  if (allDirs.includes(encoded)) {
    return [encoded];
  }

  // Case-insensitive exact match (Windows drive letters can vary in case)
  const lowerEncoded = encoded.toLowerCase();
  const caseMatch = allDirs.filter((d) => d.toLowerCase() === lowerEncoded);
  if (caseMatch.length > 0) {
    return caseMatch;
  }

  // Anchored prefix match: the requested encoded name must be a directory-segment
  // prefix of the candidate (or vice-versa), so we don't over-match a different
  // project that merely shares a tail segment. A candidate qualifies only when one
  // encoded name is a prefix of the other at a '-' boundary (or equal).
  const isAnchoredMatch = (a: string, b: string): boolean => {
    if (a === b) return true;
    if (a.startsWith(b) && a[b.length] === '-') return true;
    if (b.startsWith(a) && b[a.length] === '-') return true;
    return false;
  };
  return allDirs.filter((d) => isAnchoredMatch(d.toLowerCase(), lowerEncoded));
}
