import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '../lib/api';
import type { UserProfile, WorkspaceContext, TokenPair } from '@shared/types';

interface AuthState {
  user: UserProfile | null;
  workspace: WorkspaceContext | null;
  accessToken: string | null;
  refreshToken: string | null;
  loading: boolean;
  error: string | null;

  // Actions
  login: (email: string, password: string, workspaceId?: string, mfaCode?: string, rememberMe?: boolean) => Promise<void>;
  register: (email: string, password: string, name?: string, workspaceId?: string) => Promise<void>;
  logout: (revokeAllSessions?: boolean) => Promise<void>;
  refreshAccessToken: () => Promise<boolean>;
  fetchProfile: () => Promise<void>;
  setWorkspace: (workspaceId: string) => Promise<void>;
  clearError: () => void;
  initialize: () => Promise<void>;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      workspace: null,
      accessToken: null,
      refreshToken: null,
      loading: true,
      error: null,

      initialize: async () => {
        const refreshToken = get().refreshToken;
        if (!refreshToken) {
          set({ loading: false });
          return;
        }

        try {
          const response = await api.post('/auth/refresh', { refreshToken });
          const { accessToken, refreshToken: newRefreshToken } = response.data.data;

          set({
            accessToken,
            refreshToken: newRefreshToken,
          });

          await get().fetchProfile();
        } catch {
          // Refresh failed, clear auth
          set({
            user: null,
            workspace: null,
            accessToken: null,
            refreshToken: null,
            loading: false,
          });
        }
      },

      login: async (email, password, workspaceId, mfaCode, rememberMe) => {
        set({ loading: true, error: null });

        try {
          const response = await api.post('/auth/login', {
            email,
            password,
            workspaceId,
            mfaCode,
            rememberMe,
          });

          const { accessToken, refreshToken, user, workspace } = response.data.data;

          set({
            user,
            workspace,
            accessToken,
            refreshToken,
            loading: false,
          });

          // Set default workspace header
          if (workspace) {
            api.defaults.headers['X-Workspace-ID'] = workspace.id;
          }
        } catch (error: any) {
          const message = error.response?.data?.message || error.message || 'Login failed';
          set({ error: message, loading: false });
          throw error;
        }
      },

      register: async (email, password, name, workspaceId) => {
        set({ loading: true, error: null });

        try {
          const response = await api.post('/auth/register', {
            email,
            password,
            name,
            workspaceId,
          });

          const { accessToken, refreshToken, user, workspace } = response.data.data;

          set({
            user,
            workspace,
            accessToken,
            refreshToken,
            loading: false,
          });

          if (workspace) {
            api.defaults.headers['X-Workspace-ID'] = workspace.id;
          }
        } catch (error: any) {
          const message = error.response?.data?.message || error.message || 'Registration failed';
          set({ error: message, loading: false });
          throw error;
        }
      },

      logout: async (revokeAllSessions = false) => {
        try {
          await api.post('/auth/logout', { revokeAllSessions });
        } catch {
          // Ignore logout errors
        } finally {
          set({
            user: null,
            workspace: null,
            accessToken: null,
            refreshToken: null,
            loading: false,
          });
          delete api.defaults.headers['X-Workspace-ID'];
        }
      },

      refreshAccessToken: async () => {
        const refreshToken = get().refreshToken;
        if (!refreshToken) return false;

        try {
          const response = await api.post('/auth/refresh', { refreshToken });
          const { accessToken, refreshToken: newRefreshToken } = response.data.data;

          set({ accessToken, refreshToken: newRefreshToken });
          return true;
        } catch {
          // Refresh failed, logout
          get().logout();
          return false;
        }
      },

      fetchProfile: async () => {
        try {
          const response = await api.get('/auth/me');
          const { user, workspace, membership, permissions } = response.data.data;

          set({
            user,
            workspace: workspace ? { ...workspace, role: membership?.role, permissions } : null,
            loading: false,
          });
        } catch {
          set({ loading: false });
        }
      },

      setWorkspace: async (workspaceId) => {
        try {
          const response = await api.get('/auth/me', {
            headers: { 'X-Workspace-ID': workspaceId },
          });

          const { workspace, membership, permissions } = response.data.data;

          set({
            workspace: workspace ? { ...workspace, role: membership?.role, permissions } : null,
          });

          api.defaults.headers['X-Workspace-ID'] = workspaceId;
        } catch (error) {
          console.error('Failed to switch workspace:', error);
          throw error;
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'pulse-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    }
  )
);

// Initialize on app start
if (typeof window !== 'undefined') {
  useAuth.getState().initialize();
}