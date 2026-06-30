import { create } from 'zustand';

interface AuthState {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
}

// Decode a base64url string (browser atob expects standard base64).
function base64UrlDecode(input: string): string {
  let s = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  return atob(s);
}

// Tokens are HMAC-signed JSON: "<base64url(payload)>.<signature>" where the
// payload carries an `exp` (ms since epoch). Return the cached token only if it
// has no decodable exp or its exp is still in the future; otherwise clear it.
function loadValidToken(): string | null {
  const token = localStorage.getItem('crc-token');
  if (!token) return null;
  try {
    const payloadPart = token.split('.')[0];
    const payload = JSON.parse(base64UrlDecode(payloadPart));
    if (typeof payload.exp === 'number' && payload.exp < Date.now()) {
      localStorage.removeItem('crc-token');
      return null;
    }
  } catch {
    // Unparseable token: treat as logged out and clear it.
    localStorage.removeItem('crc-token');
    return null;
  }
  return token;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: loadValidToken(),
  login: (token: string) => {
    localStorage.setItem('crc-token', token);
    set({ token });
  },
  logout: () => {
    localStorage.removeItem('crc-token');
    set({ token: null });
  },
}));
