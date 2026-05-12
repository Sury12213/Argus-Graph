import type { AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import api, { userApi } from './api';
import { useAuthStore } from '../stores';

const originalAdapter = api.defaults.adapter;

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ token: null, user: null, isAuthenticated: false, isBootstrapping: false });
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe('api auth interceptor', () => {
  it('clears auth state on 401', async () => {
    localStorage.setItem('argus_token', 'access-token');
    localStorage.setItem('argus_refresh_token', 'refresh-token');
    useAuthStore.setState({ token: 'access-token', user: { id: 'user-1' }, isAuthenticated: true, isBootstrapping: true });

    api.defaults.adapter = (() => Promise.reject({ response: { status: 401 } })) as AxiosAdapter;

    await expect(userApi.getProfile()).rejects.toMatchObject({ response: { status: 401 } });

    expect(localStorage.getItem('argus_token')).toBeNull();
    expect(localStorage.getItem('argus_refresh_token')).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

