import * as pty from 'node-pty';
import { SESSION_BUFFER_SIZE } from '@crc/shared';
import { detectShell } from './shell.js';

export class PtySession {
  id: string;
  private pty: pty.IPty;
  private buffer: string = '';
  private maxBufferSize = SESSION_BUFFER_SIZE;
  private _attached = true;

  constructor(id: string, cols: number, rows: number, shellPreference: string, cwd?: string) {
    this.id = id;
    const shell = detectShell(shellPreference);
    this.pty = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || process.env.HOME || process.env.USERPROFILE || undefined,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
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
