import { create } from 'zustand';

type UserProfile = Record<string, unknown>;
type ScanRecord = Record<string, unknown>;

interface AuthState {
  token: string | null;
  user: UserProfile | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  setAuth: (token: string, user: UserProfile) => void;
  setBootstrapping: (isBootstrapping: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('argus_token'),
  user: null,
  isAuthenticated: !!localStorage.getItem('argus_token'),
  isBootstrapping: !!localStorage.getItem('argus_token'),

  setAuth: (token, user) => {
    localStorage.setItem('argus_token', token);
    set({ token, user, isAuthenticated: true, isBootstrapping: false });
  },

  setBootstrapping: (isBootstrapping) => set({ isBootstrapping }),

  logout: () => {
    localStorage.removeItem('argus_token');
    localStorage.removeItem('argus_refresh_token');
    set({ token: null, user: null, isAuthenticated: false, isBootstrapping: false });
  },
}));

interface ScanState {
  currentScan: ScanRecord | null;
  scanHistory: ScanRecord[];
  isScanning: boolean;
  setCurrentScan: (scan: ScanRecord) => void;
  setScanHistory: (history: ScanRecord[]) => void;
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

