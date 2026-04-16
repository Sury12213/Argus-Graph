import { create } from 'zustand';

interface AuthState {
  token: string | null;
  user: any | null;
  isAuthenticated: boolean;
  setAuth: (token: string, user: any) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('argus_token'),
  user: null,
  isAuthenticated: !!localStorage.getItem('argus_token'),

  setAuth: (token, user) => {
    localStorage.setItem('argus_token', token);
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem('argus_token');
    localStorage.removeItem('argus_refresh_token');
    set({ token: null, user: null, isAuthenticated: false });
  },
}));

interface ScanState {
  currentScan: any | null;
  scanHistory: any[];
  isScanning: boolean;
  setCurrentScan: (scan: any) => void;
  setScanHistory: (history: any[]) => void;
  setIsScanning: (val: boolean) => void;
}

export const useScanStore = create<ScanState>((set) => ({
  currentScan: null,
  scanHistory: [],
  isScanning: false,
  setCurrentScan: (scan) => set({ currentScan: scan }),
  setScanHistory: (history) => set({ scanHistory: history }),
  setIsScanning: (val) => set({ isScanning: val }),
}));
