import { create } from 'zustand';

interface AuthState {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('crc-token'),
  login: (token: string) => {
    localStorage.setItem('crc-token', token);
    set({ token });
  },
  logout: () => {
    localStorage.removeItem('crc-token');
    set({ token: null });
  },
}));
