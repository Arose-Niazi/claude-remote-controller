import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(token: string): Socket {
  // Reuse the cached instance whenever it exists (even mid-handshake) so a call
  // during connect doesn't orphan a live socket. Only recreate if there's none.
  if (socket) return socket;

  socket = io('/client', {
    auth: { token },
    transports: ['websocket', 'polling'],
  });

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
