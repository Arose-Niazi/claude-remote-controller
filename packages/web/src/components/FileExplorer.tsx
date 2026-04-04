import { useEffect, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import {
  FILES_LIST,
  FILES_LIST_RESULT,
  FILES_DOWNLOAD,
  FILES_DOWNLOAD_READY,
} from '@crc/shared';
import type { FileEntry, FilesListResultPayload, FilesDownloadReadyPayload } from '@crc/shared';

interface FileExplorerProps {
  socket: Socket | null;
  agentId: string;
  initialPath: string;
  onClose: () => void;
  onDownloadReady: (info: { fileName: string; downloadUrl: string; size: number }) => void;
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
  onDownloadReady,
}: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [hasNavigated, setHasNavigated] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedName, setCopiedName] = useState<string | null>(null);

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

    const handleDownloadReady = (payload: FilesDownloadReadyPayload) => {
      onDownloadReady({
        fileName: payload.fileName,
        downloadUrl: payload.downloadUrl,
        size: payload.size,
      });
    };

    socket.on(FILES_LIST_RESULT, handleResult);
    socket.on(FILES_DOWNLOAD_READY, handleDownloadReady);
    return () => {
      socket.off(FILES_LIST_RESULT, handleResult);
      socket.off(FILES_DOWNLOAD_READY, handleDownloadReady);
    };
  }, [socket, onDownloadReady]);

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
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700">
        <span className="text-xs text-slate-400 truncate flex-1">
          {currentPath}
        </span>
        <button
          onClick={onClose}
          className="ml-2 px-2 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 rounded"
        >
          x
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 text-xs text-slate-400 overflow-x-auto border-b border-slate-800 flex-shrink-0">
        <button
          onClick={() =>
            setCurrentPath(currentPath.startsWith('/') ? '/' : pathParts[0] + '\\')
          }
          className="hover:text-slate-200"
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
              <span className="text-slate-600">{sep}</span>
              <button
                onClick={() => setCurrentPath(target)}
                className={`hover:text-slate-200 ${
                  i === arr.length - 1 ? 'text-slate-200' : ''
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
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 border-b border-slate-800/50"
        >
          <span className="text-base">&#8592;</span>
          <span>..</span>
        </button>

        {loading && (
          <div className="text-center text-slate-500 text-sm py-8">Loading...</div>
        )}

        {error && (
          <div className="text-center text-red-400 text-sm py-4 px-3">{error}</div>
        )}

        {!loading &&
          entries.map((entry) => (
            <div
              key={entry.name}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800/70 border-b border-slate-800/30 group"
            >
              {entry.isDirectory ? (
                <>
                  <button
                    onClick={() => navigateTo(entry.name)}
                    className="flex-1 flex items-center gap-2 text-sm text-left min-w-0"
                  >
                    <span className="text-yellow-400 flex-shrink-0">&#128193;</span>
                    <span className="truncate text-slate-200">
                      {copiedName === entry.name ? 'Copied!' : entry.name}
                    </span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); copyPath(entry.name); }}
                    className="text-xs px-1.5 py-0.5 bg-slate-700 hover:bg-blue-600 rounded opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0"
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
                  <span className="text-slate-500 flex-shrink-0">&#128196;</span>
                  <span className="truncate text-slate-300">
                    {copiedName === entry.name ? 'Copied!' : entry.name}
                  </span>
                </button>
              )}

              <span className="text-xs text-slate-500 flex-shrink-0 w-16 text-right">
                {formatSize(entry.size)}
              </span>

              {!entry.isDirectory && (
                <button
                  onClick={() => downloadFile(entry.name)}
                  className="text-xs px-1.5 py-0.5 bg-slate-700 hover:bg-blue-600 rounded opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0"
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
