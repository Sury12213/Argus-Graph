import axios from 'axios';
import { useAuthStore } from '../stores';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('argus_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 - clear auth state
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  },
);

//  Auth 

export const authApi = {
  requestNonce: (walletAddress: string) =>
    api.post('/auth/nonce', { walletAddress }),

  verifySignature: (walletAddress: string, signature: string, nonce: string) =>
    api.post('/auth/verify', { walletAddress, signature, nonce }),

  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),
};

//  User 

export const userApi = {
  getProfile: () => api.get('/users/me'),
  updateSettings: (data: Record<string, unknown>) => api.patch('/users/settings', data),
  createTelegramLinkCode: () => api.get('/users/telegram/link-code'),
  linkTelegram: (code: string, chatId: string) => api.patch('/users/telegram/link', { code, chatId }),
};

//  Scan 

export const scanApi = {
  create: (input: string, requestId?: string) => api.post('/scans', { input, requestId }),
  getHistory: (take = 20) => api.get(`/scans/history?take=${take}`),
  getById: (id: string) => api.get(`/scans/${id}`),
};

//  Token 

export const tokenApi = {
  getInfo: (address: string) => api.get(`/tokens/${address}`),
  resolve: (query: string) => api.get(`/tokens/resolve/${encodeURIComponent(query)}`),
};

//  Watchlist 

export const watchlistApi = {
  add: (tokenAddress: string, tokenSymbol?: string) =>
    api.post('/watchlist', { tokenAddress, tokenSymbol }),
  list: () => api.get('/watchlist'),
  remove: (id: string) => api.delete(`/watchlist/${id}`),
  toggleAlert: (id: string) => api.patch(`/watchlist/${id}/toggle`),
};

export const guardianApi = {
  quote: (data: {
    scanId?: string;
    inputMint: string;
    outputMint: string;
    amountRaw: string;
    tokenAddress?: string;
  }) => api.post('/guardian/quote', data),
  buildSwap: (executionId: string) => api.post('/guardian/swap/build', { executionId }),
  markSubmitted: (executionId: string, transactionSignature: string) =>
    api.post('/guardian/swap/submitted', { executionId, transactionSignature }),
  getExecution: (executionId: string) => api.get(`/guardian/executions/${executionId}`),
  getTokenBalance: (mint: string) => api.get(`/guardian/token-balance?mint=${encodeURIComponent(mint)}`),
  listExecutions: (scanId?: string) => api.get(`/guardian/executions${scanId ? `?scanId=${encodeURIComponent(scanId)}` : ''}`),
};

export default api;

