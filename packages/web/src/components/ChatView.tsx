import { useEffect, useRef } from 'react';
import type { ClaudeConvMessage } from '@crc/shared';

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
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-text">$1</strong>');
  s = s.replace(/`([^`]+)`/g, '<code class="bg-surface-deep px-1 py-0.5 rounded text-accent text-xs font-mono">$1</code>');
  return s;
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

    let p = escapeHtml(line);
    p = p.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-text">$1</strong>');
    p = p.replace(/`([^`]+)`/g, '<code class="bg-surface-deep px-1 py-0.5 rounded text-accent text-xs font-mono">$1</code>');

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

function formatTime(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface ChatViewProps {
  messages: ClaudeConvMessage[];
  pendingSent?: string[];
  onQuickAction?: (key: string) => void;
}

export default function ChatView({ messages, pendingSent = [], onQuickAction }: ChatViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (autoScroll.current) {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, pendingSent]);

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
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
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
          return (
            <div key={`t-${i}`} className="flex justify-start">
              <div className="max-w-[90%]">
                <div className="bg-claude/10 border border-claude/20 rounded-xl px-3 py-1.5 flex items-start gap-2">
                  <span className="text-claude text-xs flex-shrink-0 mt-0.5">&#9673;</span>
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-claude">{msg.toolName}</span>
                    {msg.content && (
                      <pre className="text-[10px] text-text-muted font-mono mt-0.5 whitespace-pre-wrap break-all leading-relaxed">{msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content}</pre>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        }

        if (msg.type === 'tool_result') {
          return (
            <div key={`tr-${i}`} className="flex justify-start">
              <div className="max-w-[90%]">
                <div className="bg-surface-deep border border-border-subtle rounded-xl px-3 py-1.5">
                  <pre className="text-[10px] text-text-muted font-mono whitespace-pre-wrap break-all leading-relaxed max-h-32 overflow-y-auto">{msg.content}</pre>
                </div>
              </div>
            </div>
          );
        }

        return null;
      })}

      {/* Waiting for input banner — shows when Claude needs a response */}
      {onQuickAction && pendingSent.length === 0 && messages.length > 0 && (() => {
        const last = messages[messages.length - 1];
        const lastTwo = messages.length >= 2 ? messages[messages.length - 2] : null;
        const isToolWaiting = last.type === 'tool_use';
        const isAssistantWaiting = last.type === 'assistant' && (
          // Claude asked a question or presented options
          /\?\s*$/.test(last.content.trim()) ||
          /\(y\/n\)/i.test(last.content) ||
          /\[y\/n/i.test(last.content) ||
          /plan|proceed|confirm|approve|select|choose|option/i.test(last.content.slice(-200))
        );
        // Also detect: assistant message followed by tool_use that's waiting
        const isAskingAfterTool = last.type === 'assistant' && lastTwo?.type === 'tool_use';

        if (!isToolWaiting && !isAssistantWaiting && !isAskingAfterTool) return null;

        return (
          <div className="mx-1 my-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5">
            <div className="text-xs text-yellow-400 font-medium mb-2">
              {isToolWaiting ? 'Claude needs permission to proceed' : 'Claude is waiting for your response'}
            </div>
            <div className="flex gap-2 flex-wrap">
              {isToolWaiting && (
                <>
                  <button
                    onClick={() => onQuickAction('y\r')}
                    className="flex-1 py-2 text-xs font-medium bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 rounded-lg transition-colors"
                  >
                    Allow (y)
                  </button>
                  <button
                    onClick={() => onQuickAction('n\r')}
                    className="flex-1 py-2 text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg transition-colors"
                  >
                    Deny (n)
                  </button>
                  <button
                    onClick={() => onQuickAction('a\r')}
                    className="flex-1 py-2 text-xs font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 rounded-lg transition-colors"
                  >
                    Always (a)
                  </button>
                </>
              )}
              {!isToolWaiting && (
                <>
                  <button
                    onClick={() => onQuickAction('y\r')}
                    className="flex-1 py-2 text-xs font-medium bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 rounded-lg transition-colors"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => onQuickAction('n\r')}
                    className="flex-1 py-2 text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg transition-colors"
                  >
                    No
                  </button>
                  <button
                    onClick={() => onQuickAction('\r')}
                    className="flex-1 py-2 text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-text-secondary border border-border rounded-lg transition-colors"
                  >
                    Enter
                  </button>
                  <button
                    onClick={() => onQuickAction('\x1b')}
                    className="flex-1 py-2 text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-text-secondary border border-border rounded-lg transition-colors"
                  >
                    Esc
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}

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
  );
}
