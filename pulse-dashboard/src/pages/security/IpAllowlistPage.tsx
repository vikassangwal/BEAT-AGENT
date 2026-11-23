import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ipAllowlistApi } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import {
  Plus, Edit, Trash2, Download, Upload, Shield, Globe,
  Search, Check, X, AlertTriangle, Wifi, WifiOff
} from 'lucide-react';

const entryTypes = [
  { value: 'ALLOW', label: 'Allow IP/CIDR' },
  { value: 'DENY', label: 'Deny IP/CIDR' },
  { value: 'GEO_ALLOW', label: 'Allow Country' },
  { value: 'GEO_DENY', label: 'Deny Country' },
];

export function IpAllowlistPage() {
  const { workspace } = useAuth();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<any | null>(null);
  const [showCheckModal, setShowCheckModal] = useState(false);
  const [checkIp, setCheckIp] = useState('');
  const [checkResult, setCheckResult] = useState<{ allowed: boolean; reason?: string } | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    type: 'ALLOW' as any,
    value: '',
    description: '',
    expiresAt: '',
    enabled: true,
  });

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const response = await ipAllowlistApi.list();
      setEntries(response.data.data);
    } catch (error) {
      console.error('Failed to fetch IP allowlist:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, [workspace?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        ...formData,
        expiresAt: formData.expiresAt || undefined,
      };

      if (editingEntry) {
        await ipAllowlistApi.update(editingEntry.id, data);
      } else {
        await ipAllowlistApi.create(data);
      }
      setShowCreateModal(false);
      setEditingEntry(null);
      resetForm();
      fetchEntries();
    } catch (error) {
      console.error('Failed to save entry:', error);
    }
  };

  const handleDelete = async () => {
    if (!deletingEntry) return;
    try {
      await ipAllowlistApi.delete(deletingEntry.id);
      setDeletingEntry(null);
      fetchEntries();
    } catch (error) {
      console.error('Failed to delete entry:', error);
    }
  };

  const handleExport = async () => {
    try {
      const response = await ipAllowlistApi.export();
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ip-allowlist-${workspace?.id}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export:', error);
    }
  };

  const handleBulkImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    try {
      const entries = JSON.parse(text);
      await ipAllowlistApi.bulkImport(entries);
      fetchEntries();
      alert(`Imported ${entries.length} entries`);
    } catch (error) {
      console.error('Failed to import:', error);
      alert('Failed to import. Check file format.');
    }
    e.target.value = '';
  };

  const handleCheckIp = async () => {
    if (!checkIp.trim()) return;
    try {
      const response = await ipAllowlistApi.check(checkIp);
      setCheckResult(response.data.data);
    } catch (error) {
      console.error('Failed to check IP:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      type: 'ALLOW',
      value: '',
      description: '',
      expiresAt: '',
      enabled: true,
    });
  };

  const openCreateModal = () => {
    setEditingEntry(null);
    resetForm();
    setShowCreateModal(true);
  };

  const openEditModal = (entry: any) => {
    setEditingEntry(entry);
    setFormData({
      type: entry.type,
      value: entry.value,
      description: entry.description || '',
      expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString().split('T')[0] : '',
      enabled: entry.enabled,
    });
    setShowCreateModal(true);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'ALLOW': return <Shield className="w-4 h-4 text-success-500" />;
      case 'DENY': return <Shield className="w-4 h-4 text-danger-500" />;
      case 'GEO_ALLOW': return <Globe className="w-4 h-4 text-success-500" />;
      case 'GEO_DENY': return <Globe className="w-4 h-4 text-danger-500" />;
      default: return <Shield className="w-4 h-4" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'ALLOW': return 'Allow IP';
      case 'DENY': return 'Deny IP';
      case 'GEO_ALLOW': return 'Allow Country';
      case 'GEO_DENY': return 'Deny Country';
      default: return type;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">IP Allowlist & Geo-blocking</h1>
          <p className="mt-1 text-secondary-600 dark:text-secondary-400">
            Control network access to your workspace with IP and country-based rules
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Button variant="outline" onClick={() => document.getElementById('import-file')?.click()}>
            <Upload className="w-4 h-4" />
            Import
          </Button>
          <input
            id="import-file"
            type="file"
            accept=".json"
            onChange={handleBulkImport}
            className="hidden"
          />
          <Button onClick={openCreateModal}>
            <Plus className="w-4 h-4" />
            Add Rule
          </Button>
        </div>
      </div>

      {/* Check IP Tool */}
      <div className="card">
        <CardHeader>
          <CardTitle>Test IP Access</CardTitle>
          <CardDescription>Check if an IP address would be allowed or blocked</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <Input
              placeholder="Enter IP address (e.g., 192.168.1.1 or 203.0.113.0/24)"
              value={checkIp}
              onChange={(e) => setCheckIp(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleCheckIp} disabled={!checkIp.trim()}>
              <Wifi className="w-4 h-4" />
              Check
            </Button>
          </div>
          {checkResult && (
            <div className="mt-4 p-4 rounded-lg flex items-center gap-3
              ${checkResult.allowed ? 'bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800' : 'bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800'}">
              {checkResult.allowed ? (
                <Wifi className="w-5 h-5 text-success-500" />
              ) : (
                <WifiOff className="w-5 h-5 text-danger-500" />
              )}
              <div>
                <p className="font-medium ${checkResult.allowed ? 'text-success-700 dark:text-success-300' : 'text-danger-700 dark:text-danger-300'}">
                  {checkResult.allowed ? 'ALLOWED' : 'BLOCKED'}
                </p>
                {checkResult.reason && (
                  <p className="text-sm ${checkResult.allowed ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}">
                    {checkResult.reason}
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </div>

      {/* Entries Table */}
      <div className="card">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>IP Allowlist Rules</CardTitle>
              <CardDescription>
                {entries.length} rules configured • Rules are evaluated in order: Deny → Allow
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><LoadingSpinner /></div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="w-12 h-12 text-secondary-300 dark:text-secondary-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-2">No rules configured</h3>
              <p className="text-secondary-600 dark:text-secondary-400 mb-4">
                Add IP allowlist rules to control network access to your workspace
              </p>
              <Button onClick={openCreateModal}>
                <Plus className="w-4 h-4" />
                Add Your First Rule
              </Button>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Value</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Expires</th>
                    <th className="w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          {getTypeIcon(entry.type)}
                          <span className="font-medium capitalize">{getTypeLabel(entry.type)}</span>
                        </div>
                      </td>
                      <td className="font-mono text-sm text-secondary-900 dark:text-white">{entry.value}</td>
                      <td className="text-secondary-600 dark:text-secondary-400 max-w-xs truncate">{entry.description || '-'}</td>
                      <td>
                        <span className={`badge ${entry.enabled ? 'badge-success' : 'badge-secondary'}`}>
                          {entry.enabled ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="text-secondary-500 dark:text-secondary-500">
                        {entry.expiresAt ? new Date(entry.expiresAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditModal(entry)}
                            aria-label={`Edit ${entry.value}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeletingEntry(entry)}
                            aria-label={`Delete ${entry.value}`}
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

      {/* Help Section */}
      <div className="card">
        <CardHeader>
          <CardTitle>How IP Allowlisting Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm text-secondary-600 dark:text-secondary-400">
            <div className="flex gap-3">
              <Shield className="w-5 h-5 text-success-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-secondary-900 dark:text-white">Allow Rules (ALLOW)</p>
                <p>Explicitly permit access from specific IPs or CIDR ranges. If any allow rules exist, only matching IPs are allowed.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Shield className="w-5 h-5 text-danger-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-secondary-900 dark:text-white">Deny Rules (DENY)</p>
                <p>Explicitly block access from specific IPs or CIDR ranges. Evaluated before allow rules.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Globe className="w-5 h-5 text-success-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-secondary-900 dark:text-white">Geo Allow (GEO_ALLOW)</p>
                <p>Permit access from entire countries using ISO 3166-1 alpha-2 codes (e.g., US, GB, DE).</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Globe className="w-5 h-5 text-danger-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-secondary-900 dark:text-white">Geo Deny (GEO_DENY)</p>
                <p>Block access from entire countries using ISO 3166-1 alpha-2 codes.</p>
              </div>
            </div>
            <div className="p-3 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg">
              <p className="font-medium text-secondary-900 dark:text-white mb-1">Evaluation Order:</p>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                <li>Check all DENY rules (IP and Geo) - block if matched</li>
                <li>If any ALLOW/GEO_ALLOW rules exist, check them - allow only if matched</li>
                <li>If no ALLOW rules exist, allow by default (unless denied)</li>
              </ol>
            </div>
            <div className="p-3 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded-lg">
              <p className="font-medium text-warning-800 dark:text-warning-300 mb-1">CIDR Notation Examples:</p>
              <ul className="list-disc list-inside space-y-1 text-sm font-mono">
                <li>192.168.1.0/24 - Matches 192.168.1.0 to 192.168.1.255</li>
                <li>10.0.0.0/8 - Matches 10.0.0.0 to 10.255.255.255</li>
                <li>203.0.113.0/24 - TEST-NET-3 documentation range</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setEditingEntry(null);
          resetForm();
        }}
        title={editingEntry ? 'Edit Rule' : 'Add IP Allowlist Rule'}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select
            label="Rule Type"
            value={formData.type}
            onValueChange={(v) => setFormData({ ...formData, type: v })}
            options={entryTypes}
          />
          <Input
            label={formData.type.includes('GEO') ? 'Country Code (ISO 3166-1 alpha-2)' : 'IP Address or CIDR'}
            value={formData.value}
            onChange={(e) => setFormData({ ...formData, value: e.target.value.toUpperCase() })}
            placeholder={formData.type.includes('GEO') ? 'US, GB, DE' : '192.168.1.0/24 or 203.0.113.1'}
            required
          />
          <Input
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Optional description"
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="date"
              label="Expires At (optional)"
              value={formData.expiresAt}
              onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
            />
            <label className="flex items-center gap-2 self-end">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
              />
              <span className="text-sm">Enabled</span>
            </label>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => {
              setShowCreateModal(false);
              setEditingEntry(null);
              resetForm();
            }}>Cancel</Button>
            <Button type="submit">{editingEntry ? 'Update Rule' : 'Add Rule'}</Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingEntry}
        onClose={() => setDeletingEntry(null)}
        onConfirm={handleDelete}
        title="Delete Rule"
        message={`Are you sure you want to delete the rule "${deletingEntry?.value}"?`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}