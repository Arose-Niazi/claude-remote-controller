import { useState } from 'react';

interface DownloadItem {
  id: number;
  fileName: string;
  downloadUrl: string;
  size: number;
}

interface FileNotificationsProps {
  downloads: DownloadItem[];
  onDismiss: (id: number) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileNotifications({ downloads, onDismiss }: FileNotificationsProps) {
  if (downloads.length === 0) return null;

  return (
    <div className="fixed bottom-16 right-3 z-50 flex flex-col gap-2 max-w-xs">
      {downloads.map((dl) => (
        <div
          key={dl.id}
          className="bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-slate-200 truncate">{dl.fileName}</span>
            <button
              onClick={() => onDismiss(dl.id)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              x
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">{formatSize(dl.size)}</span>
            <a
              href={dl.downloadUrl}
              download={dl.fileName}
              onClick={() => setTimeout(() => onDismiss(dl.id), 500)}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded font-medium"
            >
              Save
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
