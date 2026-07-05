import { create } from 'zustand';

export type UserRole = 'admin' | 'user';

export interface CurrentUser {
  id?: string;
  username?: string;
  role?: UserRole;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
}

interface AuthState {
  token: string | null;
  currentUser: CurrentUser | null;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => void;
}

const TOKEN_KEY = 'crc-token';
const USER_KEY = 'crc-user';

// Decode a base64url string (browser atob expects standard base64).
function base64UrlDecode(input: string): string {
  let s = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  return atob(s);
}

interface TokenPayload {
  sub?: string;
  role?: UserRole;
  ver?: number;
  exp?: number;
}

// Tokens are "<base64url(payload)>.<signature>" where the payload carries
// sub (userId), role, ver and exp (ms since epoch). Returns null if unparseable.
function decodeTokenPayload(token: string): TokenPayload | null {
  try {
    const payloadPart = token.split('.')[0];
    return JSON.parse(base64UrlDecode(payloadPart)) as TokenPayload;
  } catch {
    return null;
  }
}

// Return the cached token only if it has no decodable exp or its exp is still in
// the future; otherwise clear both token and user and return null.
function loadValidToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  const payload = decodeTokenPayload(token);
  if (!payload) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    return null;
  }
  if (typeof payload.exp === 'number' && payload.exp < Date.now()) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    return null;
  }
  return token;
}

// Recover the current user on hydration: prefer the persisted user object, but
// fall back to the token payload (sub -> id, role) if it isn't stored.
function loadCurrentUser(token: string | null): CurrentUser | null {
  if (!token) return null;
  const stored = localStorage.getItem(USER_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as CurrentUser;
    } catch {
      // fall through to token decode
    }
  }
  const payload = decodeTokenPayload(token);
  if (!payload) return null;
  return { id: payload.sub, role: payload.role };
}

const initialToken = loadValidToken();
const initialUser = loadCurrentUser(initialToken);

export const useAuthStore = create<AuthState>((set) => ({
  token: initialToken,
  currentUser: initialUser,
  isAdmin: initialUser?.role === 'admin',
  login: async (username: string, password: string): Promise<LoginResult> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        let error = 'Login failed';
        try {
          const data = await res.json();
          if (data && typeof data.error === 'string') error = data.error;
        } catch {
          // non-JSON error body; keep default message
        }
        return { ok: false, error };
      }

      const data = await res.json();
      const token: string = data.token;
      const user: CurrentUser | undefined = data.user;

      localStorage.setItem(TOKEN_KEY, token);
      if (user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(USER_KEY);
      }

      const resolvedUser = user ?? loadCurrentUser(token);
      set({
        token,
        currentUser: resolvedUser,
        isAdmin: resolvedUser?.role === 'admin',
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Connection failed' };
    }
  },
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, currentUser: null, isAdmin: false });
  },
}));
