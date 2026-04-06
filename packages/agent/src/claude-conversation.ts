import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { logger } from './logger.js';

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

function findLatestSessionFile(projectPath: string): { filePath: string; sessionId: string } | null {
  // Encode project path to directory name
  const encoded = projectPath.replace(/^\//, '-').replace(/\//g, '-');
  const dirPath = path.join(CLAUDE_PROJECTS_DIR, encoded);

  if (!fs.existsSync(dirPath)) return null;

  const files = fs.readdirSync(dirPath)
    .filter((f) => f.endsWith('.jsonl') && !f.includes('/'))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(dirPath, f)).mtimeMs,
    }))
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
    const encoded = projectPath.replace(/^\//, '-').replace(/\//g, '-');
    filePath = path.join(CLAUDE_PROJECTS_DIR, encoded, `${specificSessionId}.jsonl`);
    sessionId = specificSessionId;
    if (!fs.existsSync(filePath)) return null;
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
