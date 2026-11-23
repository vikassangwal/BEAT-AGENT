import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { authApi } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import {
  Monitor, Smartphone, Tablet, Shield, Check, X,
  MapPin, Clock, RefreshCw, Trash2, Key, AlertTriangle
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

export function DevicesPage() {
  const { workspace } = useAuth();
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [showRevokeAllDialog, setShowRevokeAllDialog] = useState(false);
  const [filter, setFilter] = useState<'all' | 'trusted' | 'untrusted'>('all');

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const response = await authApi.getDevices();
      setDevices(response.data.data);
    } catch (error) {
      console.error('Failed to fetch devices:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, [workspace?.id]);

  const handleRevoke = async (deviceId: string) => {
    setRevokingId(deviceId);
    try {
      await authApi.revokeDevice(deviceId);
      fetchDevices();
    } catch (error) {
      console.error('Failed to revoke device:', error);
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeAll = async () => {
    try {
      const untrusted = devices.filter(d => !d.isTrusted && !d.revokedAt);
      for (const device of untrusted) {
        await authApi.revokeDevice(device.deviceId);
      }
      setShowRevokeAllDialog(false);
      fetchDevices();
    } catch (error) {
      console.error('Failed to revoke all devices:', error);
    }
  };

  const handleTrust = async (deviceId: string) => {
    // Would need an API endpoint to trust a device
    console.log('Trust device:', deviceId);
  };

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'MOBILE': return <Smartphone className="w-6 h-6" />;
      case 'TABLET': return <Tablet className="w-6 h-6" />;
      default: return <Monitor className="w-6 h-6" />;
    }
  };

  const getDeviceLabel = (type: string) => {
    switch (type) {
      case 'MOBILE': return 'Mobile';
      case 'TABLET': return 'Tablet';
      default: return 'Desktop';
    }
  };

  const getOS = (userAgent: string) => {
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Mac')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS';
    return 'Unknown';
  };

  const getBrowser = (userAgent: string) => {
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) return 'Safari';
    if (userAgent.includes('Edg')) return 'Edge';
    if (userAgent.includes('Opera')) return 'Opera';
    return 'Unknown';
  };

  const filteredDevices = devices.filter(d => {
    if (filter === 'all') return true;
    if (filter === 'trusted') return d.isTrusted && !d.revokedAt;
    if (filter === 'untrusted') return !d.isTrusted && !d.revokedAt;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">Trusted Devices</h1>
          <p className="mt-1 text-secondary-600 dark:text-secondary-400">
            Manage and monitor devices with access to your workspace
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchDevices} loading={loading}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          {devices.some(d => !d.isTrusted && !d.revokedAt) && (
            <Button variant="outline" onClick={() => setShowRevokeAllDialog(true)}>
              <Trash2 className="w-4 h-4" />
              Revoke Untrusted
            </Button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="card">
        <CardContent className="pt-0 pb-4">
          <div className="flex gap-2 overflow-x-auto">
            {[
              { id: 'all', label: 'All', count: devices.length },
              { id: 'trusted', label: 'Trusted', count: devices.filter(d => d.isTrusted && !d.revokedAt).length },
              { id: 'untrusted', label: 'Untrusted', count: devices.filter(d => !d.isTrusted && !d.revokedAt).length },
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

      {/* Devices Grid */}
      <div className="card">
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex justify-center py-12"><LoadingSpinner /></div>
          ) : filteredDevices.length === 0 ? (
            <div className="text-center py-12">
              <Monitor className="w-12 h-12 text-secondary-300 dark:text-secondary-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-2">No devices found</h3>
              <p className="text-secondary-600 dark:text-secondary-400">No devices match the current filter</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              {filteredDevices.map((device) => (
                <div
                  key={device.id}
                  className={`relative border rounded-xl p-4 transition-all ${
                    device.revokedAt
                      ? 'bg-secondary-50 dark:bg-secondary-800/50 opacity-60'
                      : device.isTrusted
                        ? 'bg-white dark:bg-secondary-900 border-secondary-200 dark:border-secondary-700'
                        : 'bg-warning-50 dark:bg-warning-900/20 border-warning-200 dark:border-warning-800'
                  }`}
                >
                  {device.revokedAt && (
                    <div className="absolute top-2 right-2">
                      <span className="badge badge-danger text-xs">Revoked</span>
                    </div>
                  )}

                  <div className="flex items-start gap-3">
                    <div className="p-3 rounded-xl bg-secondary-100 dark:bg-secondary-800 flex-shrink-0">
                      {getDeviceIcon(device.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-medium text-secondary-900 dark:text-white truncate">
                          {getDeviceLabel(device.type)}
                        </h4>
                        {device.isTrusted && !device.revokedAt && (
                          <Shield className="w-4 h-4 text-success-500" title="Trusted device" />
                        )}
                      </div>
                      <p className="text-sm text-secondary-500 dark:text-secondary-400 font-mono truncate">
                        {device.name}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs text-secondary-500 dark:text-secondary-400">
                        <span>{getOS(device.os || device.userAgent)}</span>
                        <span>{getBrowser(device.userAgent)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-secondary-200 dark:border-secondary-700 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-secondary-600 dark:text-secondary-400">
                      <MapPin className="w-4 h-4" />
                      <span>{device.location?.city}, {device.location?.country}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-secondary-600 dark:text-secondary-400">
                      <Clock className="w-4 h-4" />
                      <span>Last seen: {formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true })}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-secondary-600 dark:text-secondary-400">
                      <Key className="w-4 h-4" />
                      <span className="font-mono">{device.ipAddress}</span>
                    </div>
                    {device.pushToken && (
                      <div className="flex items-center gap-2 text-sm text-secondary-600 dark:text-secondary-400">
                        <Key className="w-4 h-4" />
                        <span className="badge badge-secondary">Push Enabled</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-2">
                      {!device.isTrusted && !device.revokedAt && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleTrust(device.deviceId)}
                        >
                          <Shield className="w-4 h-4" />
                          Trust Device
                        </Button>
                      )}
                      {device.isTrusted && !device.revokedAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRevokingId(device.deviceId)}
                          loading={revokingId === device.deviceId}
                        >
                          <Trash2 className="w-4 h-4 text-danger-500" />
                          Revoke
                        </Button>
                      )}
                      {device.revokedAt && (
                        <span className="text-xs text-secondary-400">
                          Revoked: {format(new Date(device.revokedAt), 'MMM d, yyyy HH:mm')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </div>

      {/* Device Security Info */}
      <div className="card">
        <CardHeader>
          <CardTitle>Device Trust & Security</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex gap-3">
              <div className="p-3 rounded-lg bg-success-100 dark:bg-success-900/30">
                <Shield className="w-6 h-6 text-success-600" />
              </div>
              <div>
                <h4 className="font-medium text-secondary-900 dark:text-white mb-1">Trusted Devices</h4>
                <p className="text-sm text-secondary-600 dark:text-secondary-400">
                  Trusted devices bypass additional verification for 30 days. Mark personal devices as trusted for convenience.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="p-3 rounded-lg bg-warning-100 dark:bg-warning-900/30">
                <AlertTriangle className="w-6 h-6 text-warning-600" />
              </div>
              <div>
                <h4 className="font-medium text-secondary-900 dark:text-white mb-1">Untrusted Devices</h4>
                <p className="text-sm text-secondary-600 dark:text-secondary-400">
                  New devices require MFA verification. Review untrusted devices regularly and revoke any you don't recognize.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="p-3 rounded-lg bg-danger-100 dark:bg-danger-900/30">
                <X className="w-6 h-6 text-danger-600" />
              </div>
              <div>
                <h4 className="font-medium text-secondary-900 dark:text-white mb-1">Revoked Devices</h4>
                <p className="text-sm text-secondary-600 dark:text-secondary-400">
                  Revoked devices immediately lose access and all active sessions are terminated. Users must re-authenticate from scratch.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </div>

      {/* Revoke All Untrusted Dialog */}
      <ConfirmDialog
        isOpen={showRevokeAllDialog}
        onClose={() => setShowRevokeAllDialog(false)}
        onConfirm={handleRevokeAll}
        title="Revoke All Untrusted Devices"
        message="This will revoke access for all untrusted devices and terminate their active sessions. Trusted devices will not be affected. Are you sure?"
        confirmText="Revoke Untrusted"
        variant="danger"
      />
    </div>
  );
}