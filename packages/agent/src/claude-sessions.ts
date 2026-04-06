import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import type { ClaudeSessionInfo } from '@crc/shared';
import { logger } from './logger.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

interface ParsedSession {
  firstMessage: string;
  lastTimestamp: string;
  messageCount: number;
  model?: string;
  slug?: string;
  gitBranch?: string;
  cwd?: string;              // actual project path from message metadata
}

async function parseSessionFile(filePath: string): Promise<ParsedSession | null> {
  try {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let firstMessage = '';
    let lastTimestamp = '';
    let messageCount = 0;
    let model: string | undefined;
    let slug: string | undefined;
    let gitBranch: string | undefined;
    let cwd: string | undefined;

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);

        if (obj.timestamp) lastTimestamp = obj.timestamp;
        if (obj.cwd && !cwd) cwd = obj.cwd;

        if (obj.type === 'user' && !firstMessage) {
          const content = obj.message?.content;
          if (typeof content === 'string') {
            firstMessage = content.slice(0, 200);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === 'text' && block.text) {
                firstMessage = block.text.slice(0, 200);
                break;
              }
            }
          }
          messageCount++;
        } else if (obj.type === 'user' || obj.type === 'assistant') {
          messageCount++;
          if (obj.type === 'assistant') {
            if (obj.message?.model) model = obj.message.model;
            if (obj.slug) slug = obj.slug;
          }
          if (obj.gitBranch) gitBranch = obj.gitBranch;
        }
      } catch {
        // skip unparseable lines
      }
    }

    if (!firstMessage && messageCount === 0) return null;

    return { firstMessage: firstMessage || '(no message)', lastTimestamp, messageCount, model, slug, gitBranch, cwd };
  } catch (err: any) {
    logger.error({ filePath, error: err.message }, 'Failed to parse session file');
    return null;
  }
}

export async function listClaudeSessions(filterProjectPath?: string): Promise<ClaudeSessionInfo[]> {
  const sessions: ClaudeSessionInfo[] = [];

  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return sessions;

  let projectDirs: string[];
  if (filterProjectPath) {
    // Find dirs that could match this project path
    // Since dir names use '-' for '/', we match by checking if the cwd in sessions matches
    const allDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR).filter((d) => {
      const full = path.join(CLAUDE_PROJECTS_DIR, d);
      return fs.statSync(full).isDirectory();
    });
    // Try exact encoding match first
    const encoded = filterProjectPath.replace(/^\//, '-').replace(/\//g, '-');
    if (allDirs.includes(encoded)) {
      projectDirs = [encoded];
    } else {
      // Partial match: check all dirs
      projectDirs = allDirs.filter((d) => d.includes(encoded.split('-').slice(-2).join('-')));
      if (projectDirs.length === 0) return sessions;
    }
  } else {
    projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR).filter((d) => {
      const full = path.join(CLAUDE_PROJECTS_DIR, d);
      return fs.statSync(full).isDirectory() && !d.startsWith('-private-');
    });
  }

  for (const dirName of projectDirs) {
    const dirPath = path.join(CLAUDE_PROJECTS_DIR, dirName);

    let files: string[];
    try {
      files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      const parsed = await parseSessionFile(path.join(dirPath, file));
      if (!parsed) continue;

      // Use cwd from session metadata (accurate), fall back to dir name decode
      const projectPath = parsed.cwd || dirName.replace(/^-/, '/').replace(/-/g, '/');

      sessions.push({
        sessionId,
        projectPath,
        firstMessage: parsed.firstMessage,
        lastTimestamp: parsed.lastTimestamp,
        messageCount: parsed.messageCount,
        model: parsed.model,
        slug: parsed.slug,
        gitBranch: parsed.gitBranch,
      });
    }
  }

  // Sort by most recent first
  sessions.sort((a, b) => (b.lastTimestamp > a.lastTimestamp ? 1 : -1));

  return sessions;
}
