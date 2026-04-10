import { useEffect, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import {
  FILES_LIST,
  FILES_LIST_RESULT,
  FILES_DOWNLOAD,
  AGENT_EXEC,
  AGENT_EXEC_RESULT,
} from '@crc/shared';
import type { FileEntry, FilesListResultPayload, AgentExecResultPayload } from '@crc/shared';

interface FileExplorerProps {
  socket: Socket | null;
  agentId: string;
  initialPath: string;
  onClose: () => void;
  onStartClaude?: (path: string, hasClaudeSettings: boolean) => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function FileExplorer({
  socket,
  agentId,
  initialPath,
  onClose,
  onStartClaude,
}: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [hasNavigated, setHasNavigated] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [gitPullStatus, setGitPullStatus] = useState<'idle' | 'pulling' | 'done' | 'error'>('idle');
  const [gitPullMsg, setGitPullMsg] = useState('');

  const isGitRepo = entries.some((e) => e.isDirectory && e.name === '.git');
  const hasClaudeDir = entries.some((e) => e.isDirectory && e.name === '.claude');

  const handleGitPull = () => {
    if (!socket) return;
    setGitPullStatus('pulling');
    setGitPullMsg('');
    socket.emit(AGENT_EXEC, { agentId, command: 'git pull', cwd: currentPath });
  };

  useEffect(() => {
    if (!socket) return;
    const handleExecResult = (payload: AgentExecResultPayload) => {
      const output = (payload.stdout + payload.stderr).trim();
      if (payload.error) {
        setGitPullStatus('error');
        setGitPullMsg(output || payload.error);
      } else {
        setGitPullStatus('done');
        setGitPullMsg(output.split('\n').slice(0, 3).join('\n'));
        // Refresh directory listing
        loadDirectory(currentPath);
      }
      setTimeout(() => setGitPullStatus('idle'), 4000);
    };
    socket.on(AGENT_EXEC_RESULT, handleExecResult);
    return () => { socket.off(AGENT_EXEC_RESULT, handleExecResult); };
  }, [socket, currentPath]);

  // Sync to initialPath when heartbeat arrives with the real homeDir
  // (only if user hasn't manually navigated yet)
  useEffect(() => {
    if (!hasNavigated && initialPath && initialPath !== '/' && initialPath !== currentPath) {
      setCurrentPath(initialPath);
    }
  }, [initialPath, hasNavigated, currentPath]);

  const loadDirectory = useCallback(
    (dirPath: string) => {
      if (!socket) return;
      setLoading(true);
      setError('');
      socket.emit(FILES_LIST, { agentId, path: dirPath });
    },
    [socket, agentId]
  );

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  useEffect(() => {
    if (!socket) return;

    const handleResult = (payload: FilesListResultPayload) => {
      setLoading(false);
      if (payload.error) {
        setError(payload.error);
        setEntries([]);
      } else {
        setEntries(payload.entries);
        setCurrentPath(payload.path);
      }
    };

    socket.on(FILES_LIST_RESULT, handleResult);
    return () => {
      socket.off(FILES_LIST_RESULT, handleResult);
    };
  }, [socket]);

  const navigateTo = (name: string) => {
    setHasNavigated(true);
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const newPath = currentPath.endsWith(sep)
      ? currentPath + name
      : currentPath + sep + name;
    setCurrentPath(newPath);
  };

  const navigateUp = () => {
    setHasNavigated(true);
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(sep).filter(Boolean);
    if (parts.length <= 1) {
      // At root
      const isWindows = currentPath.includes('\\');
      setCurrentPath(isWindows ? parts[0] + '\\' : '/');
      return;
    }
    parts.pop();
    const newPath =
      currentPath.startsWith('/') ? '/' + parts.join('/') : parts.join(sep) + sep;
    setCurrentPath(newPath);
  };

  const copyPath = (name: string) => {
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const fullPath = currentPath.endsWith(sep)
      ? currentPath + name
      : currentPath + sep + name;
    navigator.clipboard.writeText(fullPath);
    setCopiedName(name);
    setTimeout(() => setCopiedName(null), 1500);
  };

  const downloadFile = (name: string) => {
    if (!socket) return;
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const fullPath = currentPath.endsWith(sep)
      ? currentPath + name
      : currentPath + sep + name;
    socket.emit(FILES_DOWNLOAD, { agentId, path: fullPath });
  };

  // Build breadcrumb segments
  const sep = currentPath.includes('\\') ? '\\' : '/';
  const pathParts = currentPath.split(sep).filter(Boolean);

  return (
    <div className="flex flex-col h-full bg-surface-deep border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface border-b border-border">
        <span className="text-xs text-text-muted truncate flex-1">
          {currentPath}
        </span>
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          {onStartClaude && (
            <button
              onClick={() => onStartClaude(currentPath, hasClaudeDir)}
              className="px-2 py-0.5 text-xs bg-claude hover:bg-claude-hover text-white rounded-lg transition-colors"
              title="Start Claude here"
            >
              Claude
            </button>
          )}
          {isGitRepo && (
            <button
              onClick={handleGitPull}
              disabled={gitPullStatus === 'pulling'}
              className={`px-2 py-0.5 text-xs rounded-lg transition-colors ${
                gitPullStatus === 'done' ? 'bg-green-500/15 text-green-400' :
                gitPullStatus === 'error' ? 'bg-red-500/10 text-red-400' :
                'bg-accent hover:bg-accent-hover text-white'
              } disabled:opacity-40`}
              title="Git pull"
            >
              {gitPullStatus === 'pulling' ? '...' : gitPullStatus === 'done' ? 'Pulled' : gitPullStatus === 'error' ? 'Err' : 'Pull'}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-xs bg-surface-raised hover:bg-surface-overlay border border-border-subtle text-text-secondary rounded-lg transition-colors"
          >
            x
          </button>
        </div>
      </div>

      {/* Git pull feedback */}
      {gitPullMsg && (
        <div className={`px-3 py-1.5 text-xs border-b border-border ${
          gitPullStatus === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-green-500/15 text-green-400'
        }`}>
          <pre className="whitespace-pre-wrap font-mono">{gitPullMsg}</pre>
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 text-xs text-text-muted overflow-x-auto border-b border-border-subtle flex-shrink-0">
        <button
          onClick={() =>
            setCurrentPath(currentPath.startsWith('/') ? '/' : pathParts[0] + '\\')
          }
          className="hover:text-text"
        >
          {currentPath.startsWith('/') ? '/' : pathParts[0] + '\\'}
        </button>
        {pathParts.slice(currentPath.startsWith('/') ? 0 : 1).map((part, i, arr) => {
          const targetParts = currentPath.startsWith('/')
            ? pathParts.slice(0, i + 1)
            : pathParts.slice(0, i + 2);
          const target = currentPath.startsWith('/')
            ? '/' + targetParts.join('/')
            : targetParts.join('\\') + '\\';
          return (
            <span key={i} className="flex items-center gap-0.5">
              <span className="text-text-muted/50">{sep}</span>
              <button
                onClick={() => setCurrentPath(target)}
                className={`hover:text-text ${
                  i === arr.length - 1 ? 'text-text' : ''
                }`}
              >
                {part}
              </button>
            </span>
          );
        })}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {/* Parent directory */}
        <button
          onClick={navigateUp}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:bg-surface-raised/50 border-b border-border-subtle/50 transition-colors"
        >
          <span className="text-base">&#8592;</span>
          <span>..</span>
        </button>

        {loading && (
          <div className="text-center text-text-muted text-sm py-8">Loading...</div>
        )}

        {error && (
          <div className="text-center text-red-400 text-sm py-4 px-3">{error}</div>
        )}

        {!loading &&
          entries.map((entry) => (
            <div
              key={entry.name}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-raised/50 border-b border-border-subtle/30 group transition-colors"
            >
              {entry.isDirectory ? (
                <>
                  <button
                    onClick={() => navigateTo(entry.name)}
                    className="flex-1 flex items-center gap-2 text-sm text-left min-w-0"
                  >
                    <span className="text-amber-400 flex-shrink-0">&#128193;</span>
                    <span className="truncate text-text">
                      {copiedName === entry.name ? 'Copied!' : entry.name}
                    </span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); copyPath(entry.name); }}
                    className="text-xs px-1.5 py-0.5 bg-surface-overlay hover:bg-accent rounded-lg opacity-60 group-hover:opacity-100 transition-all flex-shrink-0"
                    title="Copy path"
                  >
                    &#128203;
                  </button>
                </>
              ) : (
                <button
                  onClick={() => copyPath(entry.name)}
                  className="flex-1 flex items-center gap-2 text-sm text-left min-w-0"
                  title="Tap to copy path"
                >
                  <span className="text-text-muted flex-shrink-0">&#128196;</span>
                  <span className="truncate text-text-secondary">
                    {copiedName === entry.name ? 'Copied!' : entry.name}
                  </span>
                </button>
              )}

              <span className="text-xs text-text-muted flex-shrink-0 w-16 text-right">
                {formatSize(entry.size)}
              </span>

              {!entry.isDirectory && (
                <button
                  onClick={() => downloadFile(entry.name)}
                  className="text-xs px-1.5 py-0.5 bg-surface-overlay hover:bg-accent rounded-lg opacity-60 group-hover:opacity-100 transition-all flex-shrink-0"
                  title="Download to phone"
                >
                  &#8595;
                </button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
