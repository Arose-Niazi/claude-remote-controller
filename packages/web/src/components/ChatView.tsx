import { useEffect, useRef, useMemo } from 'react';

export interface ChatMessage {
  id: number;
  type: 'sent' | 'received';
  text: string;
  timestamp: number;
}

// Comprehensive ANSI/terminal control stripping
function stripAnsi(str: string): string {
  return str
    // OSC sequences (title set, hyperlinks, etc)
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    // CSI sequences (colors, cursor, clear, etc)
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    // ESC sequences (charset, mode set)
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\x1b[=>NOM78]/g, '')
    // Remaining ESC + single char
    .replace(/\x1b./g, '')
    // Carriage return (cursor to start of line — used for progress bars)
    .replace(/\r/g, '')
    // Other C0 control chars (but keep \n and \t)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    // Collapse excessive blank lines
    .replace(/\n{4,}/g, '\n\n\n');
}

function isError(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('error:') ||
    lower.includes('error[') ||
    lower.includes('fatal:') ||
    lower.includes('exception') ||
    lower.includes('traceback') ||
    lower.includes('command not found') ||
    lower.includes('permission denied') ||
    lower.includes('no such file')
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render cleaned text with basic markdown + Claude Code awareness
function renderContent(raw: string): string {
  const text = stripAnsi(raw).trim();
  if (!text) return '';

  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];

  for (const line of lines) {
    // Code block fences
    const fenceMatch = line.match(/^```(\w*)$/);
    if (fenceMatch !== null) {
      if (inCodeBlock) {
        result.push(renderCodeBlock(codeBlockLines, codeBlockLang));
        codeBlockLines = [];
        inCodeBlock = false;
        codeBlockLang = '';
      } else {
        inCodeBlock = true;
        codeBlockLang = fenceMatch[1];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(escapeHtml(line));
      continue;
    }

    // Claude Code tool use: lines like "⏺ Bash(python3 -c "...")"  or "⏺ Read(file.ts)"
    const toolMatch = line.match(/^[⏺●◉○◐◑]\s*(.+)/);
    if (toolMatch) {
      const toolText = escapeHtml(toolMatch[1]);
      result.push(`<div class="flex items-start gap-2 my-1"><span class="text-claude flex-shrink-0 mt-0.5">&#9673;</span><span class="text-text font-medium text-xs">${toolText}</span></div>`);
      continue;
    }

    // Claude Code tree lines: "  ├─ " or "  └─ " or "  │ "
    if (/^\s*[├└│─┌┐┘┬┴┤┼╭╮╰╯]\s*/.test(line) || /^\s*[|L]\s/.test(line)) {
      result.push(`<div class="font-mono text-xs text-text-secondary pl-4">${escapeHtml(line)}</div>`);
      continue;
    }

    // Status/info lines: "... +9 lines (ctrl+o to expand)"
    if (/\.\.\.\+\d+ lines/.test(line) || /ctrl\+o to expand/i.test(line)) {
      result.push(`<div class="text-xs text-text-muted italic">${escapeHtml(line)}</div>`);
      continue;
    }

    let processed = escapeHtml(line);

    // Bold
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-text">$1</strong>');
    // Inline code
    processed = processed.replace(/`([^`]+)`/g, '<code class="bg-surface-deep px-1 py-0.5 rounded text-accent text-xs font-mono">$1</code>');
    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = processed.replace(/^#{1,3}\s+/, '');
      const sizes = ['text-sm font-semibold', 'text-xs font-semibold', 'text-xs font-medium'];
      result.push(`<div class="${sizes[level - 1] || sizes[2]} text-text mt-2 mb-1">${content}</div>`);
      continue;
    }
    // Bullet lists
    if (/^\s*[-*]\s/.test(line)) {
      const indent = (line.match(/^\s*/) as string[])[0].length;
      const content = processed.replace(/^\s*[-*]\s+/, '');
      result.push(`<div class="flex gap-1.5" style="margin-left:${Math.min(indent, 4) * 8 + 8}px"><span class="text-text-muted flex-shrink-0">&#8226;</span><span>${content}</span></div>`);
      continue;
    }
    // Numbered lists
    const numMatch = line.match(/^\s*(\d+)\.\s/);
    if (numMatch) {
      const content = processed.replace(/^\s*\d+\.\s+/, '');
      result.push(`<div class="flex gap-1.5 ml-2"><span class="text-text-muted flex-shrink-0">${numMatch[1]}.</span><span>${content}</span></div>`);
      continue;
    }
    // Horizontal rules
    if (/^[-_*]{3,}\s*$/.test(line)) {
      result.push('<hr class="border-border my-2" />');
      continue;
    }

    // Empty lines → small spacer (not huge gap)
    if (processed.trim() === '') {
      result.push('<div class="h-1"></div>');
      continue;
    }

    result.push(`<div>${processed}</div>`);
  }

  // Close unclosed code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    result.push(renderCodeBlock(codeBlockLines, codeBlockLang));
  }

  return result.join('');
}

function renderCodeBlock(lines: string[], lang: string): string {
  const langLabel = lang ? `<div class="text-[10px] text-text-muted mb-1">${escapeHtml(lang)}</div>` : '';
  return `<div class="my-1.5">${langLabel}<pre class="bg-surface-deep rounded-lg px-3 py-2 overflow-x-auto text-xs font-mono leading-relaxed text-text-secondary"><code>${lines.join('\n')}</code></pre></div>`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface ChatViewProps {
  messages: ChatMessage[];
}

export default function ChatView({ messages }: ChatViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Check if user has scrolled up
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    shouldAutoScroll.current = atBottom;
  };

  useEffect(() => {
    if (shouldAutoScroll.current) {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Memoize rendered messages to avoid re-rendering all on each update
  const rendered = useMemo(() => {
    return messages.map((msg) => {
      if (msg.type === 'sent') {
        return (
          <div key={msg.id} className="flex justify-end">
            <div className="max-w-[85%]">
              <div className="bg-accent/15 border border-accent/20 rounded-2xl rounded-br-md px-3 py-2">
                <pre className="text-xs text-text whitespace-pre-wrap font-mono break-all leading-relaxed">{msg.text}</pre>
              </div>
              <div className="text-[10px] text-text-muted text-right mt-0.5 mr-1">
                {formatTime(msg.timestamp)}
              </div>
            </div>
          </div>
        );
      }

      const cleaned = stripAnsi(msg.text).trim();
      if (!cleaned) return null;

      const hasError = isError(cleaned);
      const html = renderContent(msg.text);

      return (
        <div key={msg.id} className="flex justify-start">
          <div className="w-full">
            <div
              className={`rounded-2xl rounded-bl-md px-3 py-2 text-xs leading-relaxed break-words ${
                hasError
                  ? 'bg-red-500/10 border border-red-500/20 text-red-300'
                  : 'bg-surface-raised border border-border text-text-secondary'
              }`}
              dangerouslySetInnerHTML={{ __html: html }}
            />
            <div className="text-[10px] text-text-muted mt-0.5 ml-1">
              {formatTime(msg.timestamp)}
            </div>
          </div>
        </div>
      );
    });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        <div className="text-center">
          <div className="text-2xl mb-2 opacity-40">&gt;_</div>
          <p>Type a command below to get started</p>
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
      {rendered}
    </div>
  );
}
