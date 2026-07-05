import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { logger } from './logger.js';
import { encodeProjectPath, findProjectDirs } from './claude-path.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

export interface ConversationMessage {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  toolName?: string;
  toolId?: string;
  timestamp?: string;
  model?: string;
}

export interface ConversationData {
  sessionId: string;
  messages: ConversationMessage[];
  totalLines: number;
}

/**
 * Resolve the on-disk project directory for a given project path.
 * Tries exact encoding, then a case-insensitive match, then a cwd-based
 * scanning fallback (via findProjectDirs) so a project still resolves when
 * the exact encoded name doesn't match.
 */
function findProjectDir(projectPath: string): string | null {
  const encoded = encodeProjectPath(projectPath);

  const dirPath = path.join(CLAUDE_PROJECTS_DIR, encoded);
  if (fs.existsSync(dirPath)) return dirPath;

  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return null;

  // List dirs safely — a single bad entry (broken symlink / EACCES / ENOENT
  // race while Claude rotates files) must not reject the whole resolution.
  let allDirs: string[];
  try {
    allDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR).filter((d) => {
      try {
        return fs.statSync(path.join(CLAUDE_PROJECTS_DIR, d)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return null;
  }

  // Case-insensitive + anchored scanning fallback.
  const matches = findProjectDirs(allDirs, projectPath);
  if (matches.length > 0) {
    return path.join(CLAUDE_PROJECTS_DIR, matches[0]);
  }
  return null;
}

/**
 * Locate a session transcript by its (globally unique) session id, scanning every
 * project dir. Claude stores a session's transcript under the dir where the session
 * STARTED — which differs from the hook-reported cwd when the user `cd`s mid-session
 * (a completion notification then deep-links with the current cwd, whose encoded dir
 * may not exist). The session id disambiguates reliably, so we fall back to it.
 */
function findSessionFileById(sessionId: string): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) return null; // guard against path traversal
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return null;

  let dirs: string[];
  try {
    dirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);
  } catch {
    return null;
  }

  for (const dir of dirs) {
    const candidate = path.join(CLAUDE_PROJECTS_DIR, dir, `${sessionId}.jsonl`);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not here (or rotated away mid-scan) — keep looking
    }
  }
  return null;
}

function findLatestSessionFile(projectPath: string): { filePath: string; sessionId: string } | null {
  const dirPath = findProjectDir(projectPath);

  if (!dirPath) return null;

  let entries: string[];
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return null;
  }

  const files = entries
    .filter((f) => f.endsWith('.jsonl') && !f.includes('/'))
    .map((f) => {
      // A per-entry stat can throw (file rotated away mid-scan); skip on error.
      try {
        return { name: f, mtime: fs.statSync(path.join(dirPath, f)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((f): f is { name: string; mtime: number } => f !== null)
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) return null;

  return {
    filePath: path.join(dirPath, files[0].name),
    sessionId: files[0].name.replace('.jsonl', ''),
  };
}

export async function readConversation(
  projectPath: string,
  afterLine: number = 0,
  specificSessionId?: string
): Promise<ConversationData | null> {
  let filePath: string;
  let sessionId: string;

  if (specificSessionId) {
    sessionId = specificSessionId;
    // Fast path: the transcript sits under the encoded cwd (normal case).
    const dirPath = findProjectDir(projectPath);
    const direct = dirPath ? path.join(dirPath, `${specificSessionId}.jsonl`) : null;
    if (direct && fs.existsSync(direct)) {
      filePath = direct;
    } else {
      // Fallback: the session id is unique — find it wherever it actually lives
      // (handles cwd drift during a session, subagent cwds, case/format skew).
      const byId = findSessionFileById(specificSessionId);
      if (!byId) return null;
      filePath = byId;
    }
  } else {
    const found = findLatestSessionFile(projectPath);
    if (!found) return null;
    filePath = found.filePath;
    sessionId = found.sessionId;
  }

  try {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const messages: ConversationMessage[] = [];
    let lineNum = 0;

    for await (const line of rl) {
      lineNum++;
      if (lineNum <= afterLine) continue;
      if (!line.trim()) continue;

      try {
        const obj = JSON.parse(line);

        if (obj.type === 'user') {
          const content = obj.message?.content;
          let text = '';
          if (typeof content === 'string') {
            text = content;
          } else if (Array.isArray(content)) {
            text = content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join('\n');
          }
          if (text) {
            messages.push({
              type: 'user',
              content: text,
              timestamp: obj.timestamp,
            });
          }
        } else if (obj.type === 'assistant') {
          const content = obj.message?.content;
          if (!Array.isArray(content)) continue;

          for (const block of content) {
            if (block.type === 'text' && block.text?.trim()) {
              messages.push({
                type: 'assistant',
                content: block.text,
                timestamp: obj.timestamp,
                model: obj.message?.model,
              });
            } else if (block.type === 'tool_use') {
              // Summarize tool input
              let inputSummary = '';
              const input = block.input || {};
              if (input.command) inputSummary = input.command;
              else if (input.file_path) inputSummary = input.file_path;
              else if (input.pattern) inputSummary = input.pattern;
              else if (input.prompt) inputSummary = input.prompt.slice(0, 100);
              else {
                const keys = Object.keys(input);
                if (keys.length > 0) inputSummary = keys.join(', ');
              }

              messages.push({
                type: 'tool_use',
                content: inputSummary,
                toolName: block.name,
                toolId: block.id,
                timestamp: obj.timestamp,
              });
            } else if (block.type === 'tool_result') {
              let resultText = '';
              if (typeof block.content === 'string') {
                resultText = block.content;
              } else if (Array.isArray(block.content)) {
                resultText = block.content
                  .filter((b: any) => b.type === 'text')
                  .map((b: any) => b.text)
                  .join('\n');
              }
              if (resultText) {
                messages.push({
                  type: 'tool_result',
                  content: resultText.length > 500 ? resultText.slice(0, 500) + '...' : resultText,
                  toolId: block.tool_use_id,
                  timestamp: obj.timestamp,
                });
              }
            }
          }
        }
      } catch {
        // skip unparseable lines
      }
    }

    return { sessionId, messages, totalLines: lineNum };
  } catch (err: any) {
    logger.error({ filePath, error: err.message }, 'Failed to read conversation');
    return null;
  }
}
