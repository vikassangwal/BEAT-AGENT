import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuth } from '../hooks/useAuth';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { accessToken } = useAuth.getState();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }

    // Add correlation ID for tracing
    config.headers['X-Correlation-ID'] = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshed = await useAuth.getState().refreshAccessToken();

      if (refreshed) {
        const { accessToken } = useAuth.getState();
        if (accessToken && originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }
        return api(originalRequest);
      }
    }

    return Promise.reject(error);
  }
);

// API helper functions
export const authApi = {
  login: (data: { email: string; password: string; workspaceId?: string; mfaCode?: string; rememberMe?: boolean }) =>
    api.post('/auth/login', data),

  register: (data: { email: string; password: string; name?: string; workspaceId?: string }) =>
    api.post('/auth/register', data),

  logout: (revokeAllSessions?: boolean) =>
    api.post('/auth/logout', { revokeAllSessions }),

  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),

  me: () =>
    api.get('/auth/me'),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post('/auth/change-password', data),

  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }),

  enableMfa: () =>
    api.post('/auth/mfa/enable'),

  disableMfa: (password: string, mfaCode: string) =>
    api.post('/auth/mfa/disable', { password, mfaCode }),

  verifyMfa: (code: string) =>
    api.post('/auth/mfa/verify', { code }),

  getSessions: () =>
    api.get('/auth/sessions'),

  revokeSession: (sessionId: string) =>
    api.delete(`/auth/sessions/${sessionId}`),

  getDevices: () =>
    api.get('/auth/devices'),

  revokeDevice: (deviceId: string) =>
    api.delete(`/auth/devices/${deviceId}`),
};

export const ssoApi = {
  getConfig: () =>
    api.get('/sso/config'),

  configure: (data: any) =>
    api.post('/sso/config', data),

  setEnabled: (enabled: boolean) =>
    api.put('/sso/enable', { enabled }),

  test: () =>
    api.post('/sso/test'),

  getMetadata: () =>
    api.get('/sso/metadata', { responseType: 'text' }),

  initiateLogin: (workspaceId: string, returnUrl?: string) =>
    api.get('/sso/login', { params: { workspaceId, returnUrl } }),
};

export const scimApi = {
  getConfig: () =>
    api.get('/scim/config'),

  configure: (data: any) =>
    api.post('/scim/config', data),

  sync: () =>
    api.post('/scim/sync'),
};

export const auditApi = {
  query: (params: any) =>
    api.get('/audit', { params }),

  getStats: (params?: { dateFrom?: string; dateTo?: string }) =>
    api.get('/audit/stats', { params }),

  getById: (id: string) =>
    api.get(`/audit/${id}`),

  export: (data: any) =>
    api.post('/audit/export', data),

  getExports: (params?: any) =>
    api.get('/audit/exports', { params }),

  getExport: (id: string) =>
    api.get(`/audit/exports/${id}`),

  downloadExport: (id: string) =>
    api.get(`/audit/exports/${id}/download`, { responseType: 'blob' }),
};

export const rbacApi = {
  getRoles: () =>
    api.get('/rbac/roles'),

  getRole: (id: string) =>
    api.get(`/rbac/roles/${id}`),

  createRole: (data: any) =>
    api.post('/rbac/roles', data),

  updateRole: (id: string, data: any) =>
    api.put(`/rbac/roles/${id}`, data),

  deleteRole: (id: string) =>
    api.delete(`/rbac/roles/${id}`),

  assignRole: (data: { userId: string; roleId: string }) =>
    api.post('/rbac/assign', data),

  revokeRole: (userId: string) =>
    api.post('/rbac/revoke', { userId }),

  checkPermission: (data: any) =>
    api.post('/rbac/check-permission', data),

  getPermissions: () =>
    api.get('/rbac/permissions'),

  getMyPermissions: () =>
    api.get('/rbac/my-permissions'),
};

export const secretsApi = {
  list: (params?: { type?: string; tag?: string }) =>
    api.get('/secrets', { params }),

  get: (id: string) =>
    api.get(`/secrets/${id}`),

  getByName: (name: string) =>
    api.get(`/secrets/name/${name}`),

  create: (data: any) =>
    api.post('/secrets', data),

  update: (id: string, data: any) =>
    api.put(`/secrets/${id}`, data),

  delete: (id: string) =>
    api.delete(`/secrets/${id}`),

  getVersions: (id: string) =>
    api.get(`/secrets/${id}/versions`),

  rotate: (id: string, newValue?: string) =>
    api.post(`/secrets/${id}/rotate`, { newValue }),

  getAccessLogs: (id: string, limit?: number) =>
    api.get(`/secrets/${id}/access-logs`, { params: { limit } }),

  syncVault: (vaultType: 'VAULT' | 'AWS_SECRETS_MANAGER') =>
    api.post('/secrets/sync-vault', { vaultType }),
};

export const complianceApi = {
  generateReport: (data: any) =>
    api.post('/compliance/reports', data),

  getReports: (params?: any) =>
    api.get('/compliance/reports', { params }),

  getReport: (id: string) =>
    api.get(`/compliance/reports/${id}`),

  downloadReport: (id: string) =>
    api.get(`/compliance/reports/${id}/download`, { responseType: 'blob' }),

  createRetentionPolicy: (data: any) =>
    api.post('/compliance/retention-policies', data),

  getRetentionPolicies: () =>
    api.get('/compliance/retention-policies'),

  deleteRetentionPolicy: (id: string) =>
    api.delete(`/compliance/retention-policies/${id}`),

  getDataResidency: () =>
    api.get('/compliance/data-residency'),

  configureDataResidency: (data: any) =>
    api.put('/compliance/data-residency', data),

  gdprExport: (userId: string) =>
    api.post('/compliance/gdpr/export', { userId }),

  gdprDeletion: (userId: string) =>
    api.post('/compliance/gdpr/deletion', { userId }),
};

export const ipAllowlistApi = {
  list: () =>
    api.get('/ip-allowlist'),

  create: (data: any) =>
    api.post('/ip-allowlist', data),

  update: (id: string, data: any) =>
    api.put(`/ip-allowlist/${id}`, data),

  delete: (id: string) =>
    api.delete(`/ip-allowlist/${id}`),

  bulkImport: (entries: any[]) =>
    api.post('/ip-allowlist/bulk', { entries }),

  export: () =>
    api.get('/ip-allowlist/export', { responseType: 'blob' }),

  check: (ip: string) =>
    api.post('/ip-allowlist/check', { ip }),
};