interface MobileKeyboardProps {
  onKey: (data: string) => void;
  ctrlActive: boolean;
  altActive: boolean;
  onToggleCtrl: () => void;
  onToggleAlt: () => void;
}

interface KeyDef {
  label: string;
  action?: () => void;
  charCode?: number;
  active?: boolean;
  toggle?: boolean;
}

export default function MobileKeyboard({
  onKey,
  ctrlActive,
  altActive,
  onToggleCtrl,
  onToggleAlt,
}: MobileKeyboardProps) {
  const keys: KeyDef[] = [
    { label: 'ESC', action: () => onKey('\x1b') },
    { label: 'TAB', action: () => onKey('\t') },
    {
      label: 'CTRL',
      action: onToggleCtrl,
      active: ctrlActive,
      toggle: true,
    },
    {
      label: 'ALT',
      action: onToggleAlt,
      active: altActive,
      toggle: true,
    },
    { label: 'C-c', charCode: 3 },
    { label: 'C-z', charCode: 26 },
    { label: '\u2191', action: () => onKey('\x1b[A') },
    { label: '\u2193', action: () => onKey('\x1b[B') },
    { label: '\u2190', action: () => onKey('\x1b[D') },
    { label: '\u2192', action: () => onKey('\x1b[C') },
  ];

  return (
    <div className="flex gap-1 px-2 py-1.5 bg-slate-800 border-t border-slate-700">
      {keys.map((k) => (
        <button
          key={k.label}
          onPointerDown={(e) => {
            e.preventDefault();
            if (k.charCode !== undefined) {
              onKey(String.fromCharCode(k.charCode));
            } else if (k.action) {
              k.action();
            }
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
