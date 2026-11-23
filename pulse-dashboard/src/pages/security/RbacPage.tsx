import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { rbacApi } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import {
  Plus, Edit, Trash2, Shield, Users, Key, Search,
  ChevronDown, ChevronUp, Check, X, Lock, Unlock
} from 'lucide-react';

const resourceOptions = [
  { value: 'WORKSPACE', label: 'Workspace' },
  { value: 'PROJECT', label: 'Project' },
  { value: 'PAGE', label: 'Page' },
  { value: 'BLOCK', label: 'Block' },
  { value: 'DATABASE', label: 'Database' },
  { value: 'AUTOMATION', label: 'Automation' },
  { value: 'TEMPLATE', label: 'Template' },
  { value: 'INTEGRATION', label: 'Integration' },
  { value: 'WEBHOOK', label: 'Webhook' },
  { value: 'API_KEY', label: 'API Key' },
  { value: 'SECRET', label: 'Secret' },
  { value: 'USER', label: 'User' },
  { value: 'ROLE', label: 'Role' },
  { value: 'AUDIT_LOG', label: 'Audit Log' },
  { value: 'SESSION', label: 'Session' },
  { value: 'DEVICE', label: 'Device' },
  { value: 'IP_ALLOWLIST', label: 'IP Allowlist' },
  { value: 'SSO_CONFIG', label: 'SSO Config' },
  { value: 'SCIM_CONFIG', label: 'SCIM Config' },
  { value: 'COMPLIANCE_REPORT', label: 'Compliance Report' },
  { value: 'RETENTION_POLICY', label: 'Retention Policy' },
];

const actionOptions = [
  { value: 'CREATE', label: 'Create' },
  { value: 'READ', label: 'Read' },
  { value: 'UPDATE', label: 'Update' },
  { value: 'DELETE', label: 'Delete' },
  { value: 'MANAGE', label: 'Manage (All)' },
  { value: 'EXECUTE', label: 'Execute' },
  { value: 'APPROVE', label: 'Approve' },
  { value: 'SHARE', label: 'Share' },
  { value: 'EXPORT', label: 'Export' },
  { value: 'IMPORT', label: 'Import' },
];

export function RbacPage() {
  const { workspace } = useAuth();
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRole, setEditingRole] = useState<any | null>(null);
  const [deletingRole, setDeletingRole] = useState<any | null>(null);
  const [selectedRole, setSelectedRole] = useState<any | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    permissions: [] as string[],
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        rbacApi.getRoles(),
        rbacApi.getPermissions(),
      ]);
      setRoles(rolesRes.data.data);
      setPermissions(permsRes.data.data);
    } catch (error) {
      console.error('Failed to fetch RBAC data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [workspace?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingRole) {
        await rbacApi.updateRole(editingRole.id, formData);
      } else {
        await rbacApi.createRole(formData);
      }
      setShowCreateModal(false);
      setEditingRole(null);
      setFormData({ name: '', description: '', permissions: [] });
      fetchData();
    } catch (error) {
      console.error('Failed to save role:', error);
    }
  };

  const handleDelete = async () => {
    if (!deletingRole) return;
    try {
      await rbacApi.deleteRole(deletingRole.id);
      setDeletingRole(null);
      fetchData();
    } catch (error) {
      console.error('Failed to delete role:', error);
    }
  };

  const openCreateModal = () => {
    setEditingRole(null);
    setFormData({ name: '', description: '', permissions: [] });
    setShowCreateModal(true);
  };

  const openEditModal = (role: any) => {
    setEditingRole(role);
    setFormData({
      name: role.name,
      description: role.description || '',
      permissions: role.permissions.map((p: any) => `${p.resource}:${p.action}`),
    });
    setShowCreateModal(true);
  };

  const togglePermission = (resource: string, action: string) => {
    const perm = `${resource}:${action}`;
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter(p => p !== perm)
        : [...prev.permissions, perm],
    }));
  };

  const hasPermission = (resource: string, action: string) => {
    return formData.permissions.includes(`${resource}:${action}`);
  };

  const getPermissionGroups = () => {
    const grouped: Record<string, string[]> = {};
    permissions.forEach(p => {
      if (!grouped[p.resource]) grouped[p.resource] = [];
      grouped[p.resource].push(p.action);
    });
    return grouped;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">Role-Based Access Control</h1>
          <p className="mt-1 text-secondary-600 dark:text-secondary-400">
            Manage custom roles and permissions for your workspace
          </p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="w-4 h-4" />
          Create Role
        </Button>
      </div>

      {/* Roles List */}
      <div className="card">
        <CardHeader>
          <CardTitle>Custom Roles</CardTitle>
          <CardDescription>
            {roles.filter(r => !r.isSystem).length} custom roles • System roles cannot be modified
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : roles.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="w-12 h-12 text-secondary-300 dark:text-secondary-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-2">No roles yet</h3>
              <p className="text-secondary-600 dark:text-secondary-400 mb-4">
                Create custom roles to define fine-grained permissions for your team
              </p>
              <Button onClick={openCreateModal}>
                <Plus className="w-4 h-4" />
                Create Your First Role
              </Button>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Permissions</th>
                    <th>Priority</th>
                    <th className="w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role.id}>
                      <td>
                        <div>
                          <p className="font-medium text-secondary-900 dark:text-white">{role.name}</p>
                          {role.isDefault && (
                            <span className="badge badge-primary text-xs">Default</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${role.isSystem ? 'badge-secondary' : 'badge-primary'}`}>
                          {role.isSystem ? 'System' : 'Custom'}
                        </span>
                      </td>
                      <td className="text-secondary-600 dark:text-secondary-400 max-w-xs truncate">
                        {role.description || '-'}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {role.permissions.slice(0, 3).map((p: any) => (
                            <span key={`${p.resource}:${p.action}`} className="badge badge-secondary text-xs">
                              {p.resource}:{p.action}
                            </span>
                          ))}
                          {role.permissions.length > 3 && (
                            <span className="badge badge-secondary text-xs">
                              +{role.permissions.length - 3} more
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-secondary-600 dark:text-secondary-400">{role.priority}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          {!role.isSystem && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditModal(role)}
                                aria-label={`Edit ${role.name}`}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeletingRole(role)}
                                aria-label={`Delete ${role.name}`}
                              >
                                <Trash2 className="w-4 h-4 text-danger-500" />
                              </Button>
                            </>
                          )}
                          {role.isSystem && (
                            <span className="text-xs text-secondary-400">System role</span>
                          )}
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

      {/* Permissions Reference */}
      <div className="card">
        <CardHeader>
          <CardTitle>Available Permissions</CardTitle>
          <CardDescription>Reference for all available permissions in the system</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.entries(getPermissionGroups()).map(([resource, actions]) => (
              <div key={resource} className="border border-secondary-200 dark:border-secondary-700 rounded-lg p-4">
                <h4 className="font-medium text-secondary-900 dark:text-white mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  {resource}
                </h4>
                <div className="flex flex-wrap gap-1">
                  {actions.map(action => (
                    <span key={action} className="badge badge-secondary text-xs">
                      {action}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </div>

      {/* Create/Edit Role Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setEditingRole(null);
          setFormData({ name: '', description: '', permissions: [] });
        }}
        title={editingRole ? 'Edit Role' : 'Create Role'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <Input
            label="Role Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Content Editor"
            required
          />
          <Input
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Optional description"
          />

          <div>
            <label className="label">Permissions</label>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {Object.entries(getPermissionGroups()).map(([resource, actions]) => (
                <div key={resource} className="border border-secondary-200 dark:border-secondary-700 rounded-lg p-3">
                  <h5 className="font-medium text-secondary-900 dark:text-white mb-2 capitalize">{resource.toLowerCase()}</h5>
                  <div className="flex flex-wrap gap-2">
                    {actions.map(action => {
                      const perm = `${resource}:${action}`;
                      const checked = hasPermission(resource, action);
                      return (
                        <label key={perm} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePermission(resource, action)}
                            className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="text-sm text-secondary-700 dark:text-secondary-300">{action}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-secondary-200 dark:border-secondary-700">
            <Button type="button" variant="outline" onClick={() => {
              setShowCreateModal(false);
              setEditingRole(null);
              setFormData({ name: '', description: '', permissions: [] });
            }}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              {editingRole ? 'Update Role' : 'Create Role'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingRole}
        onClose={() => setDeletingRole(null)}
        onConfirm={handleDelete}
        title="Delete Role"
        message={`Are you sure you want to delete the role "${deletingRole?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}