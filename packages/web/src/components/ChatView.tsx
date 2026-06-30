import { useEffect, useRef, useState, Fragment } from 'react';
import type { ClaudeConvMessage } from '@crc/shared';
import type { DetectedPrompt } from '../lib/detectPrompt';
import { parseFilePathsInText } from '../lib/parseFilePaths';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Basic markdown rendering for assistant text
function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|');
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s:]*[-]+[\s:]*(\|[\s:]*[-]+[\s:]*)+\|?\s*$/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function inlineMarkdown(text: string): string {
  // Escape HTML exactly once, up front. Markdown syntax (backticks, **) is not
  // affected by escaping, so we layer the inline elements on the escaped string
  // and emit the already-escaped captured content as-is (no second escape).
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_, code: string) => {
    // `code` is already HTML-escaped. If it looks like a file path, turn it into
    // a download button (the attribute holds the same single-escaped value; the
    // browser decodes it back to the real path when read via dataset).
    const fragments = parseFilePathsInText(code);
    if (fragments.some((f) => f.type === 'path')) {
      return fragments
        .map((f) =>
          f.type === 'path'
            ? `<button type="button" class="chat-file-link bg-surface-deep px-1 py-0.5 rounded text-accent text-xs font-mono underline decoration-dotted hover:bg-accent/20 hover:text-accent-hover transition-colors" data-file-path="${f.value}">${f.value}</button>`
            : `<code class="bg-surface-deep px-1 py-0.5 rounded text-accent text-xs font-mono">${f.value}</code>`
        )
        .join('');
    }
    return `<code class="bg-surface-deep px-1 py-0.5 rounded text-accent text-xs font-mono">${code}</code>`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, (_, b: string) => `<strong class="font-semibold text-text">${b}</strong>`);
  return s;
}

function renderTextWithPaths(text: string): string {
  // For plain text (not inside code blocks), emit file paths as download buttons
  // and pass everything else through HTML-escaped.
  const fragments = parseFilePathsInText(text);
  return fragments
    .map((f) =>
      f.type === 'path'
        ? `<button type="button" class="chat-file-link text-accent underline decoration-dotted hover:text-accent-hover transition-colors font-mono text-[11px]" data-file-path="${escapeHtml(f.value)}">${escapeHtml(f.value)}</button>`
        : escapeHtml(f.value)
    )
    .join('');
}

function renderTable(tableLines: string[]): string {
  if (tableLines.length < 2) return tableLines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');

  const headerLine = tableLines[0];
  const sepIndex = tableLines.findIndex((l) => isTableSeparator(l));
  const headers = parseTableRow(headerLine);
  const bodyLines = sepIndex >= 0 ? tableLines.slice(sepIndex + 1) : tableLines.slice(1);

  let html = '<div class="my-2 overflow-x-auto"><table class="w-full text-xs border-collapse">';
  // Header
  html += '<thead><tr>';
  for (const h of headers) {
    html += `<th class="px-2 py-1.5 text-left font-medium text-text bg-surface-overlay border-b border-border whitespace-nowrap">${inlineMarkdown(h)}</th>`;
  }
  html += '</tr></thead>';
  // Body
  html += '<tbody>';
  for (const line of bodyLines) {
    if (!isTableRow(line) || isTableSeparator(line)) continue;
    const cells = parseTableRow(line);
    html += '<tr>';
    for (let i = 0; i < Math.max(cells.length, headers.length); i++) {
      const cell = cells[i] || '';
      const isMatch = cell.toUpperCase() === 'MATCH';
      const cellClass = isMatch ? 'text-green-400' : 'text-text-secondary';
      html += `<td class="px-2 py-1 border-b border-border-subtle ${cellClass} whitespace-nowrap">${inlineMarkdown(cell)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let tableBuffer: string[] = [];

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      result.push(renderTable(tableBuffer));
      tableBuffer = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)$/);
    if (fence) {
      flushTable();
      if (inCodeBlock) {
        const langTag = codeLang ? `<div class="text-[10px] text-text-muted mb-1">${escapeHtml(codeLang)}</div>` : '';
        result.push(`<div class="my-1.5">${langTag}<pre class="bg-surface-deep rounded-lg px-3 py-2 overflow-x-auto text-xs font-mono leading-relaxed text-text-secondary"><code>${codeLines.join('\n')}</code></pre></div>`);
        codeLines = [];
        inCodeBlock = false;
        codeLang = '';
      } else {
        inCodeBlock = true;
        codeLang = fence[1];
      }
      continue;
    }
    if (inCodeBlock) { codeLines.push(escapeHtml(line)); continue; }

    // Table accumulation
    if (isTableRow(line) || isTableSeparator(line)) {
      tableBuffer.push(line);
      continue;
    }
    flushTable();

    // Render inline: bold + backticked code (with file-link detection inside),
    // and then walk the plain-text segments outside of tags for standalone
    // file paths.
    let p = inlineMarkdown(line);
    // Replace plain-text file paths in the segments that are NOT inside tags.
    p = replaceOutsideTags(p, renderTextWithPaths);

    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) {
      const sizes = ['text-sm font-semibold', 'text-xs font-semibold', 'text-xs font-medium'];
      result.push(`<div class="${sizes[heading[1].length - 1] || sizes[2]} text-text mt-2 mb-1">${p.replace(/^#{1,3}\s+/, '')}</div>`);
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      const content = p.replace(/^\s*[-*]\s+/, '');
      result.push(`<div class="flex gap-1.5 ml-2"><span class="text-text-muted">&#8226;</span><span>${content}</span></div>`);
      continue;
    }
    if (/^[-_*]{3,}\s*$/.test(line)) { result.push('<hr class="border-border my-2" />'); continue; }
    if (p.trim() === '') { result.push('<div class="h-1.5"></div>'); continue; }
    result.push(`<div>${p}</div>`);
  }

  flushTable();

  if (inCodeBlock && codeLines.length > 0) {
    result.push(`<pre class="bg-surface-deep rounded-lg px-3 py-2 overflow-x-auto text-xs font-mono leading-relaxed text-text-secondary"><code>${codeLines.join('\n')}</code></pre>`);
  }

  return result.join('');
}

/**
 * Apply `transform` to plain-text segments of an HTML string, leaving the
 * contents of tags (and already-escaped entities within tags) untouched. Used
 * to inject file-path download buttons into the prose without disturbing the
 * already-rendered inline markdown (code, bold, etc.).
 */
function replaceOutsideTags(html: string, transform: (text: string) => string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) {
        parts.push(html.slice(i));
        break;
      }
      // For buttons/code elements, pass through the tag and its inner content
      // untouched. For simple inline tags like <strong>, we can still safely
      // pass them through: we just skip from '<' to the matching '>' and emit.
      parts.push(html.slice(i, end + 1));
      i = end + 1;
    } else {
      const next = html.indexOf('<', i);
      const text = next === -1 ? html.slice(i) : html.slice(i, next);
      parts.push(transform(unescapeForRetransform(text)));
      i = next === -1 ? html.length : next;
    }
  }
  return parts.join('');
}

/**
 * Our outer pipeline HTML-escapes text before we reach here, so for the plain
 * text segments we need to unescape before re-parsing as paths (otherwise `/`
 * is fine but `&amp;` would reach the path parser). The transform function
 * then re-escapes any leftover text.
 */
function unescapeForRetransform(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function formatTime(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface ChatViewProps {
  messages: ClaudeConvMessage[];
  pendingSent?: string[];
  terminalPrompt?: DetectedPrompt | null;
  onPromptAction?: (optionNumber: number) => void;
  onFileDownload?: (rawPath: string) => void;
}

export default function ChatView({
  messages,
  pendingSent = [],
  terminalPrompt,
  onPromptAction,
  onFileDownload,
}: ChatViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const [scrolledUp, setScrolledUp] = useState(false);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 80;
    autoScroll.current = atBottom;
    setScrolledUp(!atBottom);
  };

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    autoScroll.current = true;
    setScrolledUp(false);
  };

  useEffect(() => {
    if (autoScroll.current) {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, pendingSent, terminalPrompt]);

  // Click delegation for file-path download buttons.
  const handleContainerClick = (e: React.MouseEvent) => {
    if (!onFileDownload) return;
    let target: HTMLElement | null = e.target as HTMLElement;
    while (target && target !== e.currentTarget) {
      if (target.dataset && target.dataset.filePath) {
        e.preventDefault();
        e.stopPropagation();
        onFileDownload(target.dataset.filePath);
        return;
      }
      target = target.parentElement;
    }
  };

  if (messages.length === 0 && pendingSent.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        <div className="text-center">
          <div className="text-2xl mb-2 opacity-40">&gt;_</div>
          <p>Waiting for conversation data...</p>
          <p className="text-xs mt-1">Start Claude to see messages here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onClick={handleContainerClick}
        className="absolute inset-0 overflow-y-auto px-3 py-3 space-y-2"
      >
        {messages.map((msg, i) => {
          if (msg.type === 'user') {
            return (
              <div key={`u-${i}`} className="flex justify-end">
                <div className="max-w-[85%]">
                  <div className="bg-accent/15 border border-accent/20 rounded-2xl rounded-br-md px-3 py-2">
                    <pre className="text-xs text-text whitespace-pre-wrap font-mono break-words leading-relaxed">{msg.content}</pre>
                  </div>
                  <div className="text-[10px] text-text-muted text-right mt-0.5 mr-1">
                    {formatTime(msg.timestamp)}
                  </div>
                </div>
              </div>
            );
          }

          if (msg.type === 'assistant') {
            const html = renderMarkdown(msg.content);
            return (
              <div key={`a-${i}`} className="flex justify-start">
                <div className="w-full">
                  <div
                    className="bg-surface-raised border border-border rounded-2xl rounded-bl-md px-3 py-2 text-xs leading-relaxed text-text-secondary break-words"
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                  <div className="text-[10px] text-text-muted mt-0.5 ml-1">
                    {msg.model && <span className="mr-2">{msg.model.includes('opus') ? 'Opus' : msg.model.includes('sonnet') ? 'Sonnet' : ''}</span>}
                    {formatTime(msg.timestamp)}
                  </div>
                </div>
              </div>
            );
          }

          if (msg.type === 'tool_use') {
            const contentFragments = msg.content ? parseFilePathsInText(msg.content) : [];
            const hasPathInContent = contentFragments.some((f) => f.type === 'path');
            return (
              <div key={`t-${i}`} className="flex justify-start">
                <div className="max-w-[90%]">
                  <div className="bg-claude/10 border border-claude/20 rounded-xl px-3 py-1.5 flex items-start gap-2">
                    <span className="text-claude text-xs flex-shrink-0 mt-0.5">&#9673;</span>
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-claude">{msg.toolName}</span>
                      {msg.content && (
                        <pre className="text-[10px] text-text-muted font-mono mt-0.5 whitespace-pre-wrap break-all leading-relaxed">
                          {hasPathInContent
                            ? contentFragments.map((f, idx) =>
                                f.type === 'path' ? (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => onFileDownload?.(f.value)}
                                    className="text-accent underline decoration-dotted hover:text-accent-hover transition-colors"
                                  >
                                    {f.value.length > 200 ? f.value.slice(0, 200) + '…' : f.value}
                                  </button>
                                ) : (
                                  <Fragment key={idx}>
                                    {f.value.length > 200 ? f.value.slice(0, 200) + '…' : f.value}
                                  </Fragment>
                                )
                              )
                            : msg.content.length > 200
                              ? msg.content.slice(0, 200) + '...'
                              : msg.content}
                        </pre>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          if (msg.type === 'tool_result') {
            const truncated = msg.content.length > 500 ? msg.content.slice(0, 500) + '…' : msg.content;
            const fragments = parseFilePathsInText(truncated);
            const hasPath = fragments.some((f) => f.type === 'path');
            return (
              <div key={`tr-${i}`} className="flex justify-start">
                <div className="max-w-[90%]">
                  <div className="bg-surface-deep border border-border-subtle rounded-xl px-3 py-1.5">
                    <pre className="text-[10px] text-text-muted font-mono whitespace-pre-wrap break-all leading-relaxed max-h-32 overflow-y-auto">
                      {hasPath
                        ? fragments.map((f, idx) =>
                            f.type === 'path' ? (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => onFileDownload?.(f.value)}
                                className="text-accent underline decoration-dotted hover:text-accent-hover transition-colors"
                              >
                                {f.value}
                              </button>
                            ) : (
                              <Fragment key={idx}>{f.value}</Fragment>
                            )
                          )
                        : truncated}
                    </pre>
                  </div>
                </div>
              </div>
            );
          }

          return null;
        })}

        {/* Live Claude Code prompt banner — driven by the actual TTY buffer */}
        {terminalPrompt && onPromptAction && (
          <div className="mx-1 my-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5">
            <div className="text-xs text-yellow-400 font-medium mb-2 break-words">
              {terminalPrompt.question}
            </div>
            <div className="flex flex-col gap-2">
              {terminalPrompt.options.map((opt) => (
                <button
                  key={opt.number}
                  onClick={() => onPromptAction(opt.number)}
                  className={`w-full text-left px-3 py-2 text-xs rounded-lg border transition-colors ${
                    opt.selected
                      ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300'
                      : 'bg-surface-raised border-border-subtle text-text-secondary hover:bg-surface-overlay'
                  }`}
                >
                  <span className="font-mono text-text-muted mr-2">{opt.number}.</span>
                  {opt.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pending sent messages (not yet in JSONL) */}
        {pendingSent.map((text, i) => (
          <div key={`ps-${i}`} className="flex justify-end">
            <div className="max-w-[85%]">
              <div className="bg-accent/15 border border-accent/20 rounded-2xl rounded-br-md px-3 py-2 opacity-60">
                <pre className="text-xs text-text whitespace-pre-wrap font-mono break-words leading-relaxed">{text}</pre>
              </div>
              <div className="text-[10px] text-text-muted text-right mt-0.5 mr-1">sending...</div>
            </div>
          </div>
        ))}
      </div>

      {scrolledUp && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 right-3 z-20 w-10 h-10 rounded-full bg-surface-overlay/95 backdrop-blur border border-border text-text-secondary hover:text-accent hover:border-accent shadow-lg flex items-center justify-center transition-colors"
          title="Scroll to bottom"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
    </div>
  );
}
