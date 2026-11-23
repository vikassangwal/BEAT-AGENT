import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { authApi } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import {
  Activity, Monitor, Smartphone, Tablet, MapPin, Clock,
  LogOut, X, Search, Filter, RefreshCw, MapPinCheck
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

export function SessionsPage() {
  const { workspace } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [showRevokeAllDialog, setShowRevokeAllDialog] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'revoked'>('all');

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const response = await authApi.getSessions();
      const data = response.data.data;
      // Find current session
      const current = data.find((s: any) => s.current);
      if (current) setCurrentSessionId(current.id);
      setSessions(data);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [workspace?.id]);

  const handleRevoke = async (sessionId: string) => {
    setRevokingId(sessionId);
    try {
      await authApi.revokeSession(sessionId);
      fetchSessions();
    } catch (error) {
      console.error('Failed to revoke session:', error);
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeAll = async () => {
    try {
      // Revoke all except current
      const toRevoke = sessions.filter(s => s.id !== currentSessionId && s.status === 'ACTIVE');
      for (const session of toRevoke) {
        await authApi.revokeSession(session.id);
      }
      setShowRevokeAllDialog(false);
      fetchSessions();
    } catch (error) {
      console.error('Failed to revoke all sessions:', error);
    }
  };

  const getDeviceIcon = (userAgent: string) => {
    if (userAgent.includes('Mobile')) return <Smartphone className="w-5 h-5" />;
    if (userAgent.includes('Tablet')) return <Tablet className="w-5 h-5" />;
    return <Monitor className="w-5 h-5" />;
  };

  const getDeviceType = (userAgent: string) => {
    if (userAgent.includes('Mobile')) return 'Mobile';
    if (userAgent.includes('Tablet')) return 'Tablet';
    return 'Desktop';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'badge-success';
      case 'REVOKED': return 'badge-danger';
      case 'EXPIRED': return 'badge-secondary';
      default: return 'badge-secondary';
    }
  };

  const filteredSessions = sessions.filter(s => {
    if (filter === 'all') return true;
    if (filter === 'active') return s.status === 'ACTIVE';
    if (filter === 'expired') return s.status === 'EXPIRED';
    if (filter === 'revoked') return s.status === 'REVOKED';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">Active Sessions</h1>
          <p className="mt-1 text-secondary-600 dark:text-secondary-400">
            Monitor and manage active sessions across your workspace
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchSessions} loading={loading}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          {sessions.some(s => s.status === 'ACTIVE' && s.id !== currentSessionId) && (
            <Button variant="outline" onClick={() => setShowRevokeAllDialog(true)}>
              <LogOut className="w-4 h-4" />
              Revoke All Others
            </Button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="card">
        <CardContent className="pt-0 pb-4">
          <div className="flex gap-2 overflow-x-auto">
            {[
              { id: 'all', label: 'All', count: sessions.length },
              { id: 'active', label: 'Active', count: sessions.filter(s => s.status === 'ACTIVE').length },
              { id: 'expired', label: 'Expired', count: sessions.filter(s => s.status === 'EXPIRED').length },
              { id: 'revoked', label: 'Revoked', count: sessions.filter(s => s.status === 'REVOKED').length },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  filter === tab.id
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                    : 'text-secondary-600 hover:bg-secondary-100 dark:text-secondary-400 dark:hover:bg-secondary-800'
                }`}
              >
                {tab.label}
                <span className="badge badge-secondary">{tab.count}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </div>

      {/* Sessions Table */}
      <div className="card">
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex justify-center py-12"><LoadingSpinner /></div>
          ) : filteredSessions.length === 0 ? (
            <div className="text-center py-12">
              <Activity className="w-12 h-12 text-secondary-300 dark:text-secondary-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-2">No sessions found</h3>
              <p className="text-secondary-600 dark:text-secondary-400">No sessions match the current filter</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Location</th>
                    <th>IP Address</th>
                    <th>Status</th>
                    <th>Last Activity</th>
                    <th>Expires</th>
                    <th className="w-10">Current</th>
                    <th className="w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          {getDeviceIcon(session.userAgent)}
                          <div>
                            <p className="font-medium text-secondary-900 dark:text-white">
                              {getDeviceType(session.userAgent)}
                            </p>
                            <p className="text-xs text-secondary-500 dark:text-secondary-400 truncate max-w-xs">
                              {session.userAgent}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        {session.location ? (
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-secondary-400" />
                            <span className="text-sm text-secondary-600 dark:text-secondary-400">
                              {session.location.city}, {session.location.country}
                            </span>
                          </div>
                        ) : (
                          <span className="text-secondary-400">Unknown</span>
                        )}
                      </td>
                      <td className="font-mono text-sm text-secondary-600 dark:text-secondary-400">
                        {session.ipAddress}
                      </td>
                      <td>
                        <span className={`badge ${getStatusBadge(session.status)}`}>
                          {session.status}
                        </span>
                      </td>
                      <td className="text-secondary-500 dark:text-secondary-500 whitespace-nowrap">
                        {session.lastActivityAt ? formatDistanceToNow(new Date(session.lastActivityAt), { addSuffix: true }) : 'Never'}
                      </td>
                      <td className="text-secondary-500 dark:text-secondary-500 whitespace-nowrap">
                        {session.expiresAt ? format(new Date(session.expiresAt), 'MMM d, yyyy HH:mm') : 'Never'}
                      </td>
                      <td className="text-center">
                        {session.current && (
                          <MapPinCheck className="w-5 h-5 text-primary-500 mx-auto" title="Current session" />
                        )}
                      </td>
                      <td>
                        {session.status === 'ACTIVE' && session.id !== currentSessionId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRevoke(session.id)}
                            loading={revokingId === session.id}
                            aria-label={`Revoke session ${session.id}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                        {session.status !== 'ACTIVE' && (
                          <span className="text-secondary-400 text-sm">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </div>

      {/* Session Security Tips */}
      <div className="card">
        <CardHeader>
          <CardTitle>Session Security Best Practices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex gap-3">
              <div className="p-3 rounded-lg bg-primary-100 dark:bg-primary-900/30">
                <Activity className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h4 className="font-medium text-secondary-900 dark:text-white mb-1">Monitor Regularly</h4>
                <p className="text-sm text-secondary-600 dark:text-secondary-400">
                  Review active sessions weekly and revoke any unfamiliar devices or locations
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="p-3 rounded-lg bg-success-100 dark:bg-success-900/30">
                <Clock className="w-6 h-6 text-success-600" />
              </div>
              <div>
                <h4 className="font-medium text-secondary-900 dark:text-white mb-1">Set Short Expiry</h4>
                <p className="text-sm text-secondary-600 dark:text-secondary-400">
                  Configure session timeouts (default 8 hours) and require re-authentication for sensitive actions
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="p-3 rounded-lg bg-warning-100 dark:bg-warning-900/30">
                <LogOut className="w-6 h-6 text-warning-600" />
              </div>
              <div>
                <h4 className="font-medium text-secondary-900 dark:text-white mb-1">Revoke on Change</h4>
                <p className="text-sm text-secondary-600 dark:text-secondary-400">
                  Sessions are automatically revoked on password change, MFA disable, or role changes
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </div>

      {/* Revoke All Dialog */}
      <ConfirmDialog
        isOpen={showRevokeAllDialog}
        onClose={() => setShowRevokeAllDialog(false)}
        onConfirm={handleRevokeAll}
        title="Revoke All Other Sessions"
        message="This will sign you out of all other devices and browsers. Your current session will remain active. Are you sure?"
        confirmText="Revoke All"
        variant="danger"
      />
    </div>
  );
}