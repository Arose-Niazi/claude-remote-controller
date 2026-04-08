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
    <div className="flex gap-1 px-2 py-1.5 bg-surface border-t border-border">
      {keys.map((k) => (
        <button
          key={k.label}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            if (k.charCode !== undefined) {
              onKey(String.fromCharCode(k.charCode));
            } else if (k.action) {
              k.action();
            }
          }}
          className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors select-none touch-manipulation ${
            k.toggle && k.active
              ? 'bg-claude text-white'
              : 'bg-surface-raised hover:bg-surface-overlay text-text-secondary'
          }`}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
