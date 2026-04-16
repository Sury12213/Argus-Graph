import axios from 'axios';

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

// Handle 401 — clear token
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('argus_token');
      window.location.href = '/';
    }
    return Promise.reject(err);
  },
);

// ── Auth ──

export const authApi = {
  requestNonce: (walletAddress: string) =>
    api.post('/auth/nonce', { walletAddress }),

  verifySignature: (walletAddress: string, signature: string, nonce: string) =>
    api.post('/auth/verify', { walletAddress, signature, nonce }),

  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),
};

// ── User ──

export const userApi = {
  getProfile: () => api.get('/users/me'),
  updateSettings: (data: any) => api.patch('/users/settings', data),
};

// ── Scan ──

export const scanApi = {
  create: (input: string) => api.post('/scans', { input }),
  getHistory: (take = 20) => api.get(`/scans/history?take=${take}`),
  getById: (id: string) => api.get(`/scans/${id}`),
};

// ── Token ──

export const tokenApi = {
  getInfo: (address: string) => api.get(`/tokens/${address}`),
};

export default api;
