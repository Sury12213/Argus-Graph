import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from './index';

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ token: null, user: null, isAuthenticated: false, isBootstrapping: false });
});

describe('useAuthStore', () => {
  it('stores access token and authenticated user', () => {
    useAuthStore.getState().setAuth('access-token', { walletAddress: 'wallet-1' });

    expect(localStorage.getItem('argus_token')).toBe('access-token');
    expect(useAuthStore.getState()).toMatchObject({
      token: 'access-token',
      user: { walletAddress: 'wallet-1' },
      isAuthenticated: true,
      isBootstrapping: false,
    });
  });

  it('logout clears access and refresh tokens', () => {
    localStorage.setItem('argus_token', 'access-token');
    localStorage.setItem('argus_refresh_token', 'refresh-token');
    useAuthStore.setState({ token: 'access-token', user: { id: 'user-1' }, isAuthenticated: true, isBootstrapping: true });

    useAuthStore.getState().logout();

    expect(localStorage.getItem('argus_token')).toBeNull();
    expect(localStorage.getItem('argus_refresh_token')).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({
      token: null,
      user: null,
      isAuthenticated: false,
      isBootstrapping: false,
    });
  });
});

