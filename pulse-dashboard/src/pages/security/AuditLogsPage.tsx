import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { auditApi } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import {
  Search, Filter, Download, ChevronDown, ChevronUp,
  AlertTriangle, Info, CheckCircle, XCircle, AlertCircle,
  Clock, User, Globe, Shield, Key, FileText
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const eventTypeOptions = [
  { value: '', label: 'All event types' },
  { value: 'LOGIN_SUCCESS', label: 'Login Success' },
  { value: 'LOGIN_FAILED', label: 'Login Failed' },
  { value: 'LOGOUT', label: 'Logout' },
  { value: 'PASSWORD_CHANGED', label: 'Password Changed' },
  { value: 'MFA_ENABLED', label: 'MFA Enabled' },
  { value: 'MFA_DISABLED', label: 'MFA Disabled' },
  { value: 'SSO_LOGIN_SUCCESS', label: 'SSO Login Success' },
  { value: 'WORKSPACE_MEMBER_ADDED', label: 'Member Added' },
  { value: 'WORKSPACE_MEMBER_REMOVED', label: 'Member Removed' },
  { value: 'ROLE_ASSIGNED', label: 'Role Assigned' },
  { value: 'PERMISSION_GRANTED', label: 'Permission Granted' },
  { value: 'SECRET_CREATED', label: 'Secret Created' },
  { value: 'SECRET_ACCESSED', label: 'Secret Accessed' },
  { value: 'SECRET_ROTATED', label: 'Secret Rotated' },
  { value: 'IP_ALLOWLISTED', label: 'IP Allowlisted' },
  { value: 'IP_BLOCKED', label: 'IP Blocked' },
  { value: 'BRUTE_FORCE_DETECTED', label: 'Brute Force Detected' },
  { value: 'SUSPICIOUS_ACTIVITY_DETECTED', label: 'Suspicious Activity' },
  { value: 'GDPR_EXPORT_REQUESTED', label: 'GDPR Export' },
  { value: 'GDPR_DELETION_REQUESTED', label: 'GDPR Deletion' },
];

const severityOptions = [
  { value: '', label: 'All severities' },
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
  { value: 'INFO', label: 'Info' },
];

const resourceTypeOptions = [
  { value: '', label: 'All resources' },
  { value: 'WORKSPACE', label: 'Workspace' },
  { value: 'PROJECT', label: 'Project' },
  { value: 'PAGE', label: 'Page' },
  { value: 'BLOCK', label: 'Block' },
  { value: 'DATABASE', label: 'Database' },
  { value: 'AUTOMATION', label: 'Automation' },
  { value: 'USER', label: 'User' },
  { value: 'ROLE', label: 'Role' },
  { value: 'SESSION', label: 'Session' },
  { value: 'DEVICE', label: 'Device' },
  { value: 'SECRET', label: 'Secret' },
  { value: 'AUDIT_LOG', label: 'Audit Log' },
];

export function AuditLogsPage() {
  const { workspace } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState({
    eventType: '',
    severity: '',
    resourceType: '',
    resourceId: '',
    userId: '',
    dateFrom: '',
    dateTo: '',
    ipAddress: '',
    correlationId: '',
    sessionId: '',
    sortBy: 'createdAt' as 'createdAt' | 'severity',
    sortOrder: 'desc' as 'asc' | 'desc',
  });
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'JSON' | 'CSV' | 'CEF' | 'LEEF'>('JSON');
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = {
        ...filters,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        workspaceId: workspace?.id,
      };
      // Remove empty filters
      Object.keys(params).forEach(key => {
        if (params[key as keyof typeof params] === '') {
          delete params[key as keyof typeof params];
        }
      });

      const response = await auditApi.query(params);
      setLogs(response.data.data);
      setTotal(response.data.pagination.total);
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, filters, workspace?.id]);

  const handleExport = async () => {
    setExportLoading(true);
    try {
      await auditApi.export({
        format: exportFormat,
        filters,
        dateFrom: exportDateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        dateTo: exportDateTo || new Date().toISOString(),
      });
      setShowExportModal(false);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setExportLoading(false);
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return <XCircle className="w-4 h-4 text-danger-500" />;
      case 'HIGH': return <AlertTriangle className="w-4 h-4 text-danger-500" />;
      case 'MEDIUM': return <AlertCircle className="w-4 h-4 text-warning-500" />;
      case 'LOW': return <Info className="w-4 h-4 text-primary-500" />;
      default: return <CheckCircle className="w-4 h-4 text-success-500" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    const badges: Record<string, string> = {
      CRITICAL: 'badge-danger',
      HIGH: 'badge-danger',
      MEDIUM: 'badge-warning',
      LOW: 'badge-primary',
      INFO: 'badge-secondary',
    };
    return badges[severity] || 'badge-secondary';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">Audit Logs</h1>
          <p className="mt-1 text-secondary-600 dark:text-secondary-400">
            Monitor and analyze security events across your workspace
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setShowExportModal(true)}>
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 p-4">
            <Input
              placeholder="Search..."
              value={filters.resourceId || filters.ipAddress || filters.correlationId || filters.sessionId || ''}
              onChange={(e) => setFilters({ ...filters, resourceId: e.target.value })}
              leftIcon={<Search className="w-4 h-4" />}
            />
            <Select
              value={filters.eventType}
              onValueChange={(v) => setFilters({ ...filters, eventType: v })}
              options={eventTypeOptions}
            />
            <Select
              value={filters.severity}
              onValueChange={(v) => setFilters({ ...filters, severity: v })}
              options={severityOptions}
            />
            <Select
              value={filters.resourceType}
              onValueChange={(v) => setFilters({ ...filters, resourceType: v })}
              options={resourceTypeOptions}
            />
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              placeholder="From"
            />
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              placeholder="To"
            />
          </div>
        </CardContent>
      </div>

      {/* Logs Table */}
      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th className="w-10">Severity</th>
                <th>Event</th>
                <th>Resource</th>
                <th>User</th>
                <th>IP Address</th>
                <th>Time</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <LoadingSpinner />
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-secondary-500">
                    No audit logs found
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="cursor-pointer hover:bg-secondary-50 dark:hover:bg-secondary-800/50" onClick={() => setSelectedLog(log)}>
                    <td>
                      {getSeverityIcon(log.severity)}
                    </td>
                    <td>
                      <div>
                        <p className="font-medium text-secondary-900 dark:text-white">{log.eventType.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-secondary-500 dark:text-secondary-400">{log.description}</p>
                      </div>
                    </td>
                    <td>
                      {log.resourceType && (
                        <span className="badge badge-secondary">
                          {log.resourceType}
                          {log.resourceId && (
                            <span className="ml-1 font-mono text-xs">{log.resourceId.slice(0, 8)}</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td>
                      {log.user ? (
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-secondary-400" />
                          <span className="text-sm text-secondary-700 dark:text-secondary-300">
                            {log.user.email}
                          </span>
                        </div>
                      ) : (
                        <span className="text-secondary-400">System</span>
                      )}
                    </td>
                    <td className="font-mono text-sm text-secondary-600 dark:text-secondary-400">
                      {log.ipAddress || '-'}
                    </td>
                    <td className="text-secondary-500 dark:text-secondary-500 whitespace-nowrap">
                      {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                    </td>
                    <td className="text-right">
                      <span className={`badge ${getSeverityBadge(log.severity)}`}>
                        {log.severity}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex items-center justify-between p-4 border-t border-secondary-200 dark:border-secondary-700">
            <p className="text-sm text-secondary-600 dark:text-secondary-400">
              Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, total)} of {total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(Math.ceil(total / pageSize), p + 1))}
                disabled={page >= Math.ceil(total / pageSize)}
              >
                <ChevronUp className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Export Modal */}
      <Modal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Audit Logs"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="label">Format</label>
            <Select
              value={exportFormat}
              onValueChange={(v) => setExportFormat(v as any)}
              options={[
                { value: 'JSON', label: 'JSON' },
                { value: 'CSV', label: 'CSV' },
                { value: 'CEF', label: 'CEF (Common Event Format)' },
                { value: 'LEEF', label: 'LEEF (Log Event Extended Format)' },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="date"
              label="From Date"
              value={exportDateFrom}
              onChange={(e) => setExportDateFrom(e.target.value)}
            />
            <Input
              type="date"
              label="To Date"
              value={exportDateTo}
              onChange={(e) => setExportDateTo(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowExportModal(false)}>Cancel</Button>
            <Button onClick={handleExport} loading={exportLoading}>Export</Button>
          </div>
        </div>
      </Modal>

      {/* Log Detail Modal */}
      {selectedLog && (
        <Modal
          isOpen={!!selectedLog}
          onClose={() => setSelectedLog(null)}
          title="Audit Log Details"
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Event Type</p>
                <p className="font-medium">{selectedLog.eventType}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Severity</p>
                <span className={`badge ${getSeverityBadge(selectedLog.severity)}`}>{selectedLog.severity}</span>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Resource</p>
                <p className="font-medium">{selectedLog.resourceType || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Resource ID</p>
                <p className="font-mono text-sm">{selectedLog.resourceId || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">User</p>
                <p>{selectedLog.user?.email || 'System'}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Performed By</p>
                <p>{selectedLog.performer?.email || 'System'}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">IP Address</p>
                <p className="font-mono text-sm">{selectedLog.ipAddress || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Time</p>
                <p>{new Date(selectedLog.createdAt).toLocaleString()}</p>
              </div>
            </div>
            {selectedLog.description && (
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Description</p>
                <p className="mt-1">{selectedLog.description}</p>
              </div>
            )}
            {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Metadata</p>
                <pre className="mt-1 p-3 bg-secondary-100 dark:bg-secondary-800 rounded-lg text-sm overflow-auto max-h-64">
                  {JSON.stringify(selectedLog.metadata, null, 2)}
                </pre>
              </div>
            )}
            {selectedLog.beforeState && (
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">Before State</p>
                <pre className="mt-1 p-3 bg-secondary-100 dark:bg-secondary-800 rounded-lg text-sm overflow-auto max-h-64">
                  {JSON.stringify(selectedLog.beforeState, null, 2)}
                </pre>
              </div>
            )}
            {selectedLog.afterState && (
              <div>
                <p className="text-sm text-secondary-500 dark:text-secondary-400">After State</p>
                <pre className="mt-1 p-3 bg-secondary-100 dark:bg-secondary-800 rounded-lg text-sm overflow-auto max-h-64">
                  {JSON.stringify(selectedLog.afterState, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}