import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { CLAUDE_CONV_READ, CLAUDE_CONV_DATA } from '@crc/shared';
import type { ClaudeConvMessage, ClaudeConvDataPayload } from '@crc/shared';
import ChatView from './ChatView';

interface ConversationViewProps {
  socket: Socket | null;
}

/**
 * Read-only viewer for a Claude conversation transcript — used when a completion
 * notification is tapped. Reads the JSONL via the agent (no new claude process),
 * so you can see what Claude did even though it ran in Warp on the PC.
 */
export default function ConversationView({ socket }: ConversationViewProps) {
  const { agentId } = useParams<{ agentId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const project = searchParams.get('project') || '';
  const sessionParam = searchParams.get('session') || undefined;

  const [messages, setMessages] = useState<ClaudeConvMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const lineRef = useRef(0);
  const sessionRef = useRef<string | undefined>(sessionParam);
  const gotAnyRef = useRef(false);

  useEffect(() => {
    if (!socket || !agentId || !project) {
      setLoading(false);
      if (!project) setError('This link is missing the project path.');
      return;
    }

    const handle = (payload: ClaudeConvDataPayload) => {
      if (payload.agentId !== agentId) return;
      setLoading(false);
      if (payload.sessionId && !sessionRef.current) sessionRef.current = payload.sessionId;
      if (payload.messages && payload.messages.length > 0) {
        gotAnyRef.current = true;
        setError('');
        setMessages((prev) => [...prev, ...payload.messages]);
      } else if (payload.error && !gotAnyRef.current) {
        setError(payload.error);
      }
      lineRef.current = payload.totalLines;
    };
    socket.on(CLAUDE_CONV_DATA, handle);

    const read = () =>
      socket.emit(CLAUDE_CONV_READ, {
        agentId,
        projectPath: project,
        sessionId: sessionRef.current,
        afterLine: lineRef.current,
      });
    read();
    const interval = setInterval(read, 3000);
    return () => {
      socket.off(CLAUDE_CONV_DATA, handle);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, agentId, project]);

  const projectShort = project.split(/[\\/]/).filter(Boolean).slice(-2).join('/');

  return (
    <div className="flex flex-col h-[calc(100dvh-53px)]">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border flex-shrink-0">
        <button
          onClick={() => navigate(`/sessions/${agentId}`)}
          className="px-3 py-1 text-sm bg-surface-raised hover:bg-surface-overlay border border-border text-text-secondary rounded-lg transition-colors"
        >
          ← Back
        </button>
        <div className="min-w-0">
          <div className="text-sm text-text truncate">{projectShort || 'Conversation'}</div>
          <div className="text-[11px] text-text-muted truncate">{agentId}</div>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-text-muted text-sm py-10">Loading conversation…</div>
      ) : error ? (
        <div className="text-center text-text-muted text-sm py-10 px-4">
          {error}
          <div className="text-xs mt-2">The transcript may not exist yet, or the agent is offline.</div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <ChatView messages={messages} />
        </div>
      )}
    </div>
  );
}
