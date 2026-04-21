import * as pty from 'node-pty';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SESSION_BUFFER_SIZE } from '@crc/shared';
import { detectShell } from './shell.js';

// ── Shell integration for command-completion notifications ──────────
// Injects a precmd/PROMPT_COMMAND hook that sends BEL (\a) when a
// command takes >= THRESHOLD seconds.  The web client's bell detection
// picks it up and fires a browser notification.

const THRESHOLD = 3; // seconds
const INIT_DIR = join(tmpdir(), 'crc-shell-init');
const BASH_INIT = join(INIT_DIR, 'bashrc');
const ZSH_DIR = join(INIT_DIR, 'zsh');
const ZSH_RC = join(ZSH_DIR, '.zshrc');
const ZSH_ENV = join(ZSH_DIR, '.zshenv');

function ensureInitFiles(): void {
  if (existsSync(BASH_INIT) && existsSync(ZSH_RC)) return;
  mkdirSync(ZSH_DIR, { recursive: true });

  writeFileSync(BASH_INIT, [
    '# Source user config',
    '[ -f ~/.bash_profile ] && source ~/.bash_profile',
    '[ -f ~/.bashrc ] && source ~/.bashrc',
    '# CRC: bell after commands that take >= ' + THRESHOLD + 's',
    '__crc_s=$SECONDS',
    "trap '__crc_s=$SECONDS' DEBUG",
    'PROMPT_COMMAND=\'[ $((SECONDS-${__crc_s:-$SECONDS})) -ge ' + THRESHOLD + ' ] && printf "\\a";\'${PROMPT_COMMAND:+ $PROMPT_COMMAND}',
    '',
  ].join('\n'), 'utf-8');

  writeFileSync(ZSH_ENV, [
    '[ -f "${ZDOTDIR_ORIG:-$HOME}/.zshenv" ] && source "${ZDOTDIR_ORIG:-$HOME}/.zshenv"',
    '',
  ].join('\n'), 'utf-8');

  writeFileSync(ZSH_RC, [
    '[ -f "${ZDOTDIR_ORIG:-$HOME}/.zshrc" ] && source "${ZDOTDIR_ORIG:-$HOME}/.zshrc"',
    '# CRC: bell after commands that take >= ' + THRESHOLD + 's',
    '__crc_s=$SECONDS',
    '__crc_preexec() { __crc_s=$SECONDS; }',
    `__crc_precmd() { (( SECONDS - __crc_s >= ${THRESHOLD} )) && printf '\\a'; }`,
    'autoload -Uz add-zsh-hook 2>/dev/null',
    'if type add-zsh-hook &>/dev/null; then',
    '  add-zsh-hook preexec __crc_preexec',
    '  add-zsh-hook precmd __crc_precmd',
    'fi',
    '',
  ].join('\n'), 'utf-8');
}

export class PtySession {
  id: string;
  private pty: pty.IPty;
  private buffer: string = '';
  private maxBufferSize = SESSION_BUFFER_SIZE;
  private _attached = true;

  constructor(id: string, cols: number, rows: number, shellPreference: string, cwd?: string) {
    this.id = id;
    const shell = detectShell(shellPreference);
    const isBash = /bash(\.exe)?$/.test(shell);
    const isZsh = /zsh(\.exe)?$/.test(shell);

    ensureInitFiles();

    const args: string[] = [];
    const env: Record<string, string> = { ...process.env, TERM: 'xterm-256color' } as Record<string, string>;

    if (isBash) {
      args.push('--rcfile', BASH_INIT);
    } else if (isZsh) {
      env.ZDOTDIR_ORIG = process.env.ZDOTDIR || process.env.HOME || '';
      env.ZDOTDIR = ZSH_DIR;
    }

    this.pty = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || process.env.HOME || process.env.USERPROFILE || undefined,
      env,
    });
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  kill(): void {
    this.pty.kill();
  }

  onData(callback: (data: string) => void): void {
    this.pty.onData(callback);
  }

  onExit(callback: (exit: { exitCode: number; signal?: number }) => void): void {
    this.pty.onExit(callback);
  }

  appendToBuffer(data: string): void {
    this.buffer += data;
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(this.buffer.length - this.maxBufferSize);
    }
  }

  getAndClearBuffer(): string {
    const data = this.buffer;
    this.buffer = '';
    return data;
  }

  setAttached(v: boolean): void {
    this._attached = v;
  }

  isAttached(): boolean {
    return this._attached;
  }
}
