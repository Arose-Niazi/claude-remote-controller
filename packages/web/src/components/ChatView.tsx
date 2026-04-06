import { useEffect, useRef } from 'react';

export interface ChatMessage {
  id: number;
  type: 'sent' | 'received';
  text: string;
  timestamp: number;
}

// Strip ANSI escape codes + terminal control chars
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\([A-Z]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/[\x00-\x08\x0e-\x1f]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
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

// Very lightweight markdown-ish rendering
function renderContent(raw: string): string {
  const text = stripAnsi(raw).trim();
  if (!text) return '';

  // Split into lines for processing
  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        result.push(`<pre class="bg-surface-deep rounded-lg px-3 py-2 my-1 overflow-x-auto text-xs font-mono"><code>${codeBlockLines.join('\n')}</code></pre>`);
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(escapeHtml(line));
      continue;
    }

    let processed = escapeHtml(line);

    // Bold: **text**
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-text">$1</strong>');
    // Italic: *text*
    processed = processed.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Inline code: `text`
    processed = processed.replace(/`([^`]+)`/g, '<code class="bg-surface-deep px-1.5 py-0.5 rounded text-accent text-xs font-mono">$1</code>');
    // Headings: # text
    if (/^#{1,3}\s/.test(line)) {
      const level = (line.match(/^#+/) as string[])[0].length;
      const content = processed.replace(/^#{1,3}\s+/, '');
      const sizes = ['text-base font-semibold', 'text-sm font-semibold', 'text-sm font-medium'];
      result.push(`<div class="${sizes[level - 1] || sizes[2]} text-text mt-1">${content}</div>`);
      continue;
    }
    // Bullet lists: - text or * text
    if (/^\s*[-*]\s/.test(line)) {
      const content = processed.replace(/^\s*[-*]\s+/, '');
      result.push(`<div class="flex gap-1.5 ml-2"><span class="text-text-muted">&#8226;</span><span>${content}</span></div>`);
      continue;
    }
    // Numbered lists: 1. text
    if (/^\s*\d+\.\s/.test(line)) {
      const match = line.match(/^\s*(\d+)\.\s/);
      const num = match ? match[1] : '';
      const content = processed.replace(/^\s*\d+\.\s+/, '');
      result.push(`<div class="flex gap-1.5 ml-2"><span class="text-text-muted">${num}.</span><span>${content}</span></div>`);
      continue;
    }

    result.push(processed === '' ? '<div class="h-2"></div>' : `<div>${processed}</div>`);
  }

  // Close unclosed code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    result.push(`<pre class="bg-surface-deep rounded-lg px-3 py-2 my-1 overflow-x-auto text-xs font-mono"><code>${codeBlockLines.join('\n')}</code></pre>`);
  }

  return result.join('');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface ChatViewProps {
  messages: ChatMessage[];
}

export default function ChatView({ messages }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
      {messages.map((msg) => {
        if (msg.type === 'sent') {
          return (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[85%]">
                <div className="bg-accent/15 border border-accent/20 rounded-2xl rounded-br-md px-4 py-2">
                  <pre className="text-sm text-text whitespace-pre-wrap font-mono break-all">{msg.text}</pre>
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
        const rendered = renderContent(msg.text);

        return (
          <div key={msg.id} className="flex justify-start">
            <div className="max-w-[90%]">
              <div
                className={`rounded-2xl rounded-bl-md px-4 py-2 text-sm leading-relaxed ${
                  hasError
                    ? 'bg-red-500/10 border border-red-500/20 text-red-300'
                    : 'bg-surface-raised border border-border text-text-secondary'
                }`}
                dangerouslySetInnerHTML={{ __html: rendered }}
              />
              <div className="text-[10px] text-text-muted mt-0.5 ml-1">
                {formatTime(msg.timestamp)}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
