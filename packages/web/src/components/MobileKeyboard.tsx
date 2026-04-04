import { useState, useCallback } from 'react';

interface MobileKeyboardProps {
  onKey: (data: string) => void;
}

export default function MobileKeyboard({ onKey }: MobileKeyboardProps) {
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);

  const sendKey = useCallback(
    (key: string) => {
      let data = key;
      if (ctrlActive) {
        // Ctrl+letter = char code 1-26
        if (key.length === 1 && key >= 'a' && key <= 'z') {
          data = String.fromCharCode(key.charCodeAt(0) - 96);
        } else if (key.length === 1 && key >= 'A' && key <= 'Z') {
          data = String.fromCharCode(key.charCodeAt(0) - 64);
        } else if (key === 'c') {
          data = '\x03';
        }
        setCtrlActive(false);
      }
      if (altActive) {
        data = '\x1b' + data;
        setAltActive(false);
      }
      onKey(data);
    },
    [ctrlActive, altActive, onKey]
  );

  const keys = [
    { label: 'ESC', action: () => sendKey('\x1b') },
    { label: 'TAB', action: () => sendKey('\t') },
    {
      label: 'CTRL',
      action: () => setCtrlActive((p) => !p),
      active: ctrlActive,
      toggle: true,
    },
    {
      label: 'ALT',
      action: () => setAltActive((p) => !p),
      active: altActive,
      toggle: true,
    },
    { label: '↑', action: () => sendKey('\x1b[A') },
    { label: '↓', action: () => sendKey('\x1b[B') },
    { label: '←', action: () => sendKey('\x1b[D') },
    { label: '→', action: () => sendKey('\x1b[C') },
  ];

  return (
    <div className="flex gap-1 px-2 py-1.5 bg-slate-800 border-t border-slate-700">
      {keys.map((k) => (
        <button
          key={k.label}
          onPointerDown={(e) => {
            e.preventDefault();
            k.action();
          }}
          className={`flex-1 py-2 text-xs font-medium rounded transition-colors select-none ${
            k.toggle && k.active
              ? 'bg-blue-600 text-white'
              : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
          }`}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
