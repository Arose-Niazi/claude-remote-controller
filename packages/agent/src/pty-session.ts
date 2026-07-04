import * as pty from 'node-pty';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
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

const INIT_VERSION = '2'; // bump to force regeneration

function ensureInitFiles(): void {
  const versionFile = join(INIT_DIR, '.version');
  if (existsSync(versionFile)) {
    try {
      if (readFileSync(versionFile, 'utf-8').trim() === INIT_VERSION) return;
    } catch { /* regenerate */ }
  }
  mkdirSync(ZSH_DIR, { recursive: true });

  // Bash: The DEBUG trap fires before EVERY simple command, including
  // those inside PROMPT_COMMAND. So we compute the elapsed time IN the
  // trap (saved to __crc_elapsed) and check it in PROMPT_COMMAND.
  // The DEBUG trap before PROMPT_COMMAND's first command gives us the
  // duration of the LAST user command.  __crc_armed skips the first
  // prompt (shell init) so we don't get a false notification on startup.
  writeFileSync(BASH_INIT, [
    '[ -f ~/.bash_profile ] && source ~/.bash_profile',
    '[ -f ~/.bashrc ] && source ~/.bashrc',
    '__crc_s=$SECONDS',
    '__crc_elapsed=0',
    '__crc_armed=0',
    '__crc_orig_pc="$PROMPT_COMMAND"',
    `trap '__crc_elapsed=$((SECONDS - __crc_s)); __crc_s=$SECONDS' DEBUG`,
    `PROMPT_COMMAND='[ "$__crc_armed" = 1 ] && [ \${__crc_elapsed:-0} -ge ${THRESHOLD} ] && printf "\\a"; __crc_armed=1; eval "$__crc_orig_pc"'`,
    '',
  ].join('\n'), 'utf-8');

  // Zsh: preexec/precmd don't have the bash DEBUG trap issue —
  // preexec fires only for user commands, not for precmd itself.
  writeFileSync(ZSH_ENV, [
    '[ -f "${ZDOTDIR_ORIG:-$HOME}/.zshenv" ] && source "${ZDOTDIR_ORIG:-$HOME}/.zshenv"',
    '',
  ].join('\n'), 'utf-8');

  writeFileSync(ZSH_RC, [
    '[ -f "${ZDOTDIR_ORIG:-$HOME}/.zshrc" ] && source "${ZDOTDIR_ORIG:-$HOME}/.zshrc"',
    '__crc_s=$SECONDS',
    '__crc_armed=0',
    `__crc_preexec() { __crc_s=$SECONDS; }`,
    `__crc_precmd() { (( __crc_armed )) && (( SECONDS - __crc_s >= ${THRESHOLD} )) && printf '\\a'; __crc_armed=1; }`,
    'autoload -Uz add-zsh-hook 2>/dev/null',
    'if type add-zsh-hook &>/dev/null; then',
    '  add-zsh-hook preexec __crc_preexec',
    '  add-zsh-hook precmd __crc_precmd',
    'fi',
    '',
  ].join('\n'), 'utf-8');

  writeFileSync(versionFile, INIT_VERSION, 'utf-8');
}

// Resolve a working directory that actually exists on disk. node-pty throws
// synchronously if `cwd` doesn't exist, and on Windows HOME may point to a
// nonexistent POSIX path (Git-Bash/MSYS), so we validate each candidate and
// fall back to the first that exists. On Windows USERPROFILE is preferred
// over HOME.
function resolveCwd(cwd?: string): string {
  const candidates =
    process.platform === 'win32'
      ? [cwd, homedir(), process.env.USERPROFILE, process.env.HOME]
      : [cwd, homedir(), process.env.HOME, process.env.USERPROFILE];
  for (const c of candidates) {
    if (c) {
      try {
        if (existsSync(c)) return c;
      } catch {
        /* try next candidate */
      }
    }
  }
  return homedir();
}

export class PtySession {
  id: string;
  private pty: pty.IPty;
  private buffer: string = '';
  private maxBufferSize = SESSION_BUFFER_SIZE;
  private _attached = true;
  private _detachedAt = 0;

  constructor(
    id: string,
    cols: number,
    rows: number,
    shellPreference: string,
    cwd?: string,
    launch?: { file: string; args: string[] }
  ) {
    this.id = id;
    const shell = detectShell(shellPreference);
    const isBash = /bash(\.exe)?$/.test(shell);
    const isZsh = /zsh(\.exe)?$/.test(shell);

    const env: Record<string, string> = { ...process.env, TERM: 'xterm-256color' } as Record<string, string>;

    // A launch spec (e.g. attaching a tmux session) is spawned directly — no
    // shell-integration rcfile, it owns the session. Otherwise spawn the shell.
    let file = shell;
    const args: string[] = [];
    if (launch) {
      file = launch.file;
      args.push(...launch.args);
    } else {
      ensureInitFiles();
      if (isBash) {
        args.push('--rcfile', BASH_INIT);
      } else if (isZsh) {
        env.ZDOTDIR_ORIG = process.env.ZDOTDIR || process.env.HOME || '';
        env.ZDOTDIR = ZSH_DIR;
      }
    }

    const resolvedCwd = resolveCwd(cwd);

    try {
      this.pty = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: resolvedCwd,
        env,
      });
    } catch (err) {
      // A bad cwd (or spawn target) can make node-pty throw synchronously. Retry
      // once from the validated home directory before giving up.
      console.error(`[pty] spawn failed (file=${file}, cwd=${resolvedCwd}):`, err);
      this.pty = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: homedir(),
        env,
      });
    }
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
      let sliced = this.buffer.slice(this.buffer.length - this.maxBufferSize);
      // The naive slice can cut mid-ANSI-escape or split a surrogate pair,
      // corrupting replay. Advance the start to the next safe boundary: drop
      // everything up to and including the first '\n', or up to (but not
      // including) the first ESC, whichever comes first — so replay begins at
      // a fresh line or a clean escape start.
      const nl = sliced.indexOf('\n');
      const esc = sliced.indexOf('\x1b');
      if (nl !== -1 && (esc === -1 || nl < esc)) {
        sliced = sliced.slice(nl + 1);
      } else if (esc > 0) {
        sliced = sliced.slice(esc);
      }
      this.buffer = sliced;
    }
  }

  getAndClearBuffer(): string {
    const data = this.buffer;
    this.buffer = '';
    return data;
  }

  setAttached(v: boolean): void {
    this._attached = v;
    this._detachedAt = v ? 0 : Date.now();
  }

  isAttached(): boolean {
    return this._attached;
  }

  // Timestamp (ms) when this session was last detached, or 0 if attached.
  getDetachedAt(): number {
    return this._detachedAt;
  }
}
