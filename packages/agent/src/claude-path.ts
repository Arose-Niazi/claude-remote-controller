/**
 * Encode a project path to the directory name Claude uses in ~/.claude/projects/
 *
 * Unix:    /Users/arose/Projects     → -Users-arose-Projects
 * Windows: D:\Projects\others\myapp  → D--Projects-others-myapp
 */
export function encodeProjectPath(projectPath: string): string {
  if (process.platform === 'win32') {
    // D:\Projects\foo → D--Projects-foo
    return projectPath
      .replace(/:\\/g, '--')   // :\ → --
      .replace(/\\/g, '-')     // remaining \ → -
      .replace(/\//g, '-');    // any forward slashes → -
  }
  // /Users/arose/Projects → -Users-arose-Projects
  return projectPath
    .replace(/^\//g, '-')
    .replace(/\//g, '-');
}

/**
 * Find the matching project directory for a given path.
 * Tries exact encoding first, then falls back to scanning all dirs
 * and matching against the cwd field in session files.
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

  // Partial match: last two segments
  const segments = encoded.split('-').filter(Boolean);
  const tail = segments.slice(-2).join('-');
  return allDirs.filter((d) => d.includes(tail));
}
