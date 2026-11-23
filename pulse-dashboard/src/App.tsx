import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { MfaPage } from './pages/auth/MfaPage';
import { DashboardPage } from './pages/DashboardPage';
import { WorkspaceSettingsPage } from './pages/settings/WorkspaceSettingsPage';
import { SsoSettingsPage } from './pages/settings/SsoSettingsPage';
import { ScimSettingsPage } from './pages/settings/ScimSettingsPage';
import { AuditLogsPage } from './pages/security/AuditLogsPage';
import { RbacPage } from './pages/security/RbacPage';
import { SecretsPage } from './pages/security/SecretsPage';
import { CompliancePage } from './pages/security/CompliancePage';
import { IpAllowlistPage } from './pages/security/IpAllowlistPage';
import { SessionsPage } from './pages/security/SessionsPage';
import { DevicesPage } from './pages/security/DevicesPage';
import { Layout } from './components/Layout';
import { LoadingSpinner } from './components/ui/LoadingSpinner';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
      <Route path="/mfa" element={<ProtectedRoute><MfaPage /></ProtectedRoute>} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />

        <Route path="/settings" element={<WorkspaceSettingsPage />}>
          <Route index element={<Navigate to="general" replace />} />
          <Route path="general" element={<WorkspaceSettingsPage />} />
          <Route path="sso" element={<SsoSettingsPage />} />
          <Route path="scim" element={<ScimSettingsPage />} />
        </Route>

        <Route path="/security" element={<AuditLogsPage />}>
          <Route index element={<Navigate to="audit-logs" replace />} />
          <Route path="audit-logs" element={<AuditLogsPage />} />
          <Route path="rbac" element={<RbacPage />} />
          <Route path="secrets" element={<SecretsPage />} />
          <Route path="compliance" element={<CompliancePage />} />
          <Route path="ip-allowlist" element={<IpAllowlistPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="devices" element={<DevicesPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}