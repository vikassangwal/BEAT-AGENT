import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { secretsApi } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Modal, ConfirmDialog, AlertDialog } from '../../components/ui/Modal';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import {
  Plus, Edit, Trash2, Key, Eye, EyeOff, Copy, Check,
  RotateCcw, AlertTriangle, Tag, Calendar, Search
} from 'lucide-react';

const secretTypes = [
  { value: 'API_KEY', label: 'API Key' },
  { value: 'DATABASE_URL', label: 'Database URL' },
  { value: 'ENCRYPTION_KEY', label: 'Encryption Key' },
  { value: 'JWT_SECRET', label: 'JWT Secret' },
  { value: 'WEBHOOK_SECRET', label: 'Webhook Secret' },
  { value: 'OAUTH_SECRET', label: 'OAuth Secret' },
  { value: 'SAML_CERTIFICATE', label: 'SAML Certificate' },
  { value: 'CUSTOM', label: 'Custom' },
];

export function SecretsPage() {
  const { workspace } = useAuth();
  const [secrets, setSecrets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSecret, setEditingSecret] = useState<any | null>(null);
  const [viewingSecret, setViewingSecret] = useState<any | null>(null);
  const [deletingSecret, setDeletingSecret] = useState<any | null>(null);
  const [rotatingSecret, setRotatingSecret] = useState<any | null>(null);
  const [showRotateDialog, setShowRotateDialog] = useState(false);
  const [showAccessLogs, setShowAccessLogs] = useState<any | null>(null);
  const [accessLogs, setAccessLogs] = useState<any[]>([]);
  const [accessLogsLoading, setAccessLogsLoading] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    type: 'CUSTOM' as any,
    value: '',
    description: '',
    tags: '' as string,
    rotationEnabled: false,
    rotationIntervalDays: 90,
    expiresAt: '',
  });
  const [showValue, setShowValue] = useState(false);
  const [rotateValue, setRotateValue] = useState('');

  const fetchSecrets = async () => {
    setLoading(true);
    try {
      const response = await secretsApi.list();
      setSecrets(response.data.data);
    } catch (error) {
      console.error('Failed to fetch secrets:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSecrets();
  }, [workspace?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        ...formData,
        tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
        rotationIntervalDays: formData.rotationIntervalDays || undefined,
        expiresAt: formData.expiresAt || undefined,
      };

      if (editingSecret) {
        await secretsApi.update(editingSecret.id, data);
      } else {
        await secretsApi.create(data);
      }
      setShowCreateModal(false);
      setEditingSecret(null);
      resetForm();
      fetchSecrets();
    } catch (error) {
      console.error('Failed to save secret:', error);
    }
  };

  const handleDelete = async () => {
    if (!deletingSecret) return;
    try {
      await secretsApi.delete(deletingSecret.id);
      setDeletingSecret(null);
      fetchSecrets();
    } catch (error) {
      console.error('Failed to delete secret:', error);
    }
  };

  const handleRotate = async () => {
    if (!rotatingSecret) return;
    try {
      await secretsApi.rotate(rotatingSecret.id, rotateValue || undefined);
      setShowRotateDialog(false);
      setRotatingSecret(null);
      setRotateValue('');
      fetchSecrets();
    } catch (error) {
      console.error('Failed to rotate secret:', error);
    }
  };

  const handleViewSecret = async (secret: any) => {
    try {
      const response = await secretsApi.get(secret.id);
      setViewingSecret(response.data.data);
    } catch (error) {
      console.error('Failed to fetch secret:', error);
    }
  };

  const handleViewAccessLogs = async (secret: any) => {
    setAccessLogsLoading(true);
    try {
      const response = await secretsApi.getAccessLogs(secret.id);
      setAccessLogs(response.data.data);
      setShowAccessLogs(secret);
    } catch (error) {
      console.error('Failed to fetch access logs:', error);
    } finally {
      setAccessLogsLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    // Could show toast notification
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'CUSTOM',
      value: '',
      description: '',
      tags: '',
      rotationEnabled: false,
      rotationIntervalDays: 90,
      expiresAt: '',
    });
    setShowValue(false);
  };

  const openCreateModal = () => {
    setEditingSecret(null);
    resetForm();
    setShowCreateModal(true);
  };

  const openEditModal = (secret: any) => {
    setEditingSecret(secret);
    setFormData({
      name: secret.name,
      type: secret.type,
      value: '',
      description: secret.description || '',
      tags: secret.tags.join(', '),
      rotationEnabled: secret.rotationEnabled,
      rotationIntervalDays: secret.rotationIntervalDays || 90,
      expiresAt: secret.expiresAt ? new Date(secret.expiresAt).toISOString().split('T')[0] : '',
    });
    setShowValue(false);
    setShowCreateModal(true);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'API_KEY': return <Key className="w-4 h-4" />;
      case 'DATABASE_URL': return <AlertTriangle className="w-4 h-4" />;
      case 'ENCRYPTION_KEY': return <Key className="w-4 h-4" />;
      case 'JWT_SECRET': return <Key className="w-4 h-4" />;
      case 'WEBHOOK_SECRET': return <AlertTriangle className="w-4 h-4" />;
      case 'OAUTH_SECRET': return <Key className="w-4 h-4" />;
      case 'SAML_CERTIFICATE': return <AlertTriangle className="w-4 h-4" />;
      default: return <Key className="w-4 h-4" />;
    }
  };

  const getRotationStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING': return 'badge-warning';
      case 'IN_PROGRESS': return 'badge-primary';
      case 'COMPLETED': return 'badge-success';
      case 'FAILED': return 'badge-danger';
      default: return 'badge-secondary';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">Secrets Management</h1>
          <p className="mt-1 text-secondary-600 dark:text-secondary-400">
            Securely store and manage sensitive configuration values
          </p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="w-4 h-4" />
          Add Secret
        </Button>
      </div>

      {/* Secrets Table */}
      <div className="card">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Secrets</CardTitle>
              <CardDescription>{secrets.length} secrets stored</CardDescription>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Search secrets..."
                className="w-64"
                leftIcon={<Search className="w-4 h-4" />}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : secrets.length === 0 ? (
            <div className="text-center py-12">
              <Key className="w-12 h-12 text-secondary-300 dark:text-secondary-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-2">No secrets yet</h3>
              <p className="text-secondary-600 dark:text-secondary-400 mb-4">
                Add your first secret to securely store API keys, database URLs, and other sensitive values
              </p>
              <Button onClick={openCreateModal}>
                <Plus className="w-4 h-4" />
                Add Your First Secret
              </Button>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Version</th>
                    <th>Rotation</th>
                    <th>Access Count</th>
                    <th>Last Accessed</th>
                    <th>Expires</th>
                    <th className="w-48">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {secrets.map((secret) => (
                    <tr key={secret.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          {getTypeIcon(secret.type)}
                          <span className="font-medium text-secondary-900 dark:text-white">{secret.name}</span>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-secondary">{secret.type}</span>
                      </td>
                      <td className="font-mono text-sm text-secondary-600 dark:text-secondary-400">v{secret.version}</td>
                      <td>
                        {secret.rotationEnabled ? (
                          <span className={`badge ${getRotationStatusBadge(secret.rotationStatus)}`}>
                            {secret.rotationStatus}
                          </span>
                        ) : (
                          <span className="text-secondary-400">Disabled</span>
                        )}
                      </td>
                      <td className="text-secondary-600 dark:text-secondary-400">{secret.accessCount}</td>
                      <td className="text-secondary-500 dark:text-secondary-500">
                        {secret.lastAccessedAt ? new Date(secret.lastAccessedAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="text-secondary-500 dark:text-secondary-500">
                        {secret.expiresAt ? new Date(secret.expiresAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewSecret(secret)}
                            aria-label={`View ${secret.name}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewAccessLogs(secret)}
                            aria-label={`Access logs for ${secret.name}`}
                          >
                            <Tag className="w-4 h-4" />
                          </Button>
                          {secret.rotationEnabled && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRotatingSecret(secret);
                                setRotateValue('');
                                setShowRotateDialog(true);
                              }}
                              aria-label={`Rotate ${secret.name}`}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditModal(secret)}
                            aria-label={`Edit ${secret.name}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeletingSecret(secret)}
                            aria-label={`Delete ${secret.name}`}
                          >
                            <Trash2 className="w-4 h-4 text-danger-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </div>

      {/* Create/Edit Secret Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setEditingSecret(null);
          resetForm();
        }}
        title={editingSecret ? 'Edit Secret' : 'Add Secret'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., STRIPE_API_KEY"
              required
            />
            <Select
              label="Type"
              value={formData.type}
              onValueChange={(v) => setFormData({ ...formData, type: v })}
              options={secretTypes}
            />
          </div>

          <div>
            <label className="label">Value</label>
            <div className="relative">
              <Input
                type={showValue ? 'text' : 'password'}
                value={formData.value}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                placeholder={editingSecret ? 'Leave empty to keep current value' : 'Enter secret value'}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowValue(!showValue)}
                    className="text-secondary-400 hover:text-secondary-600"
                  >
                    {showValue ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                }
              />
              {editingSecret && !formData.value && (
                <p className="mt-1 text-xs text-secondary-500">Leave empty to keep current value</p>
              )}
            </div>
          </div>

          <Input
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Optional description"
          />

          <Input
            label="Tags (comma-separated)"
            value={formData.tags}
            onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
            placeholder="production, api, stripe"
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                checked={formData.rotationEnabled}
                onChange={(e) => setFormData({ ...formData, rotationEnabled: e.target.checked })}
              />
              <span className="text-sm text-secondary-700 dark:text-secondary-300">Enable automatic rotation</span>
            </label>
            {formData.rotationEnabled && (
              <>
                <Input
                  type="number"
                  label="Rotation interval (days)"
                  value={formData.rotationIntervalDays}
                  onChange={(e) => setFormData({ ...formData, rotationIntervalDays: parseInt(e.target.value) || 90 })}
                  min="1"
                  max="365"
                />
                <Input
                  type="date"
                  label="Expires at (optional)"
                  value={formData.expiresAt}
                  onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                />
              </>
            }
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-secondary-200 dark:border-secondary-700">
            <Button type="button" variant="outline" onClick={() => {
              setShowCreateModal(false);
              setEditingSecret(null);
              resetForm();
            }}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              {editingSecret ? 'Update Secret' : 'Create Secret'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* View Secret Modal */}
      {viewingSecret && (
        <Modal
          isOpen={!!viewingSecret}
          onClose={() => setViewingSecret(null)}
          title={`Secret: ${viewingSecret.name}`}
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Type</p>
                <p className="font-medium">{viewingSecret.type}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Version</p>
                <p className="font-medium">v{viewingSecret.version}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Rotation</p>
                <p className="font-medium">{viewingSecret.rotationEnabled ? 'Enabled' : 'Disabled'}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Rotation Status</p>
                <span className={`badge ${getRotationStatusBadge(viewingSecret.rotationStatus)}`}>
                  {viewingSecret.rotationStatus}
                </span>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Access Count</p>
                <p className="font-medium">{viewingSecret.accessCount}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Last Accessed</p>
                <p className="font-medium">{viewingSecret.lastAccessedAt ? new Date(viewingSecret.lastAccessedAt).toLocaleString() : 'Never'}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Created</p>
                <p className="font-medium">{new Date(viewingSecret.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Expires</p>
                <p className="font-medium">{viewingSecret.expiresAt ? new Date(viewingSecret.expiresAt).toLocaleDateString() : 'Never'}</p>
              </div>
            </div>

            <div>
              <p className="text-sm text-secondary-500 dark:text-secondary-400">Secret Value</p>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 bg-secondary-100 dark:bg-secondary-800 p-3 rounded-lg font-mono text-sm break-all">
                  {viewingSecret.value}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(viewingSecret.value)}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {viewingSecret.description && (
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Description</p>
                <p className="mt-1">{viewingSecret.description}</p>
              </div>
            )}

            {viewingSecret.tags.length > 0 && (
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Tags</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {viewingSecret.tags.map((tag: string) => (
                    <span key={tag} className="badge badge-secondary">{tag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Access Logs Modal */}
      {showAccessLogs && (
        <Modal
          isOpen={!!showAccessLogs}
          onClose={() => setShowAccessLogs(null)}
          title={`Access Logs: ${showAccessLogs.name}`}
          size="xl"
        >
          <div className="table-container max-h-96 overflow-y-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Action</th>
                  <th>IP Address</th>
                  <th>Time</th>
                  <th>Success</th>
                </tr>
              </thead>
              <tbody>
                {accessLogsLoading ? (
                  <tr><td colSpan={5} className="text-center py-8"><LoadingSpinner /></td></tr>
                ) : accessLogs.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-secondary-500">No access logs</td></tr>
                ) : (
                  accessLogs.map((log: any, index: number) => (
                    <tr key={index}>
                      <td>{log.user?.email || 'Unknown'}</td>
                      <td><span className="badge badge-secondary">{log.action}</span></td>
                      <td className="font-mono text-sm">{log.ipAddress || '-'}</td>
                      <td>{new Date(log.createdAt).toLocaleString()}</td>
                      <td>{log.success ? <Check className="w-4 h-4 text-success-500" /> : <X className="w-4 h-4 text-danger-500" />}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {/* Rotate Secret Dialog */}
      <AlertDialog
        isOpen={showRotateDialog}
        onClose={() => {
          setShowRotateDialog(false);
          setRotatingSecret(null);
          setRotateValue('');
        }}
        title="Rotate Secret"
        message={`Generate a new value for "${rotatingSecret?.name}"? The old value will be saved in version history.`}
        confirmText="Rotate"
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingSecret}
        onClose={() => setDeletingSecret(null)}
        onConfirm={handleDelete}
        title="Delete Secret"
        message={`Are you sure you want to delete "${deletingSecret?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}