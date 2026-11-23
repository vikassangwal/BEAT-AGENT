import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { complianceApi } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Modal, ConfirmDialog, AlertDialog } from '../../components/ui/Modal';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import {
  Plus, Download, FileText, Shield, AlertTriangle, CheckCircle,
  XCircle, Clock, RotateCcw, Trash2, Search, Filter
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const frameworks = [
  { value: 'SOC2', label: 'SOC 2' },
  { value: 'GDPR', label: 'GDPR' },
  { value: 'HIPAA', label: 'HIPAA' },
  { value: 'ISO27001', label: 'ISO 27001' },
  { value: 'CCPA', label: 'CCPA' },
  { value: 'PCI_DSS', label: 'PCI DSS' },
  { value: 'FEDRAMP', label: 'FedRAMP' },
];

const reportTypes = [
  { value: 'FULL', label: 'Full Report' },
  { value: 'GAP_ANALYSIS', label: 'Gap Analysis' },
  { value: 'EVIDENCE_PACKAGE', label: 'Evidence Package' },
];

const resourceTypes = [
  { value: 'AUDIT_LOG', label: 'Audit Logs' },
  { value: 'SESSION', label: 'Sessions' },
  { value: 'WEBHOOK_DELIVERY', label: 'Webhook Deliveries' },
  { value: 'AUTOMATION_RUN', label: 'Automation Runs' },
];

const actions = [
  { value: 'DELETE', label: 'Delete' },
  { value: 'ARCHIVE', label: 'Archive' },
  { value: 'ANONYMIZE', label: 'Anonymize' },
];

export function CompliancePage() {
  const { workspace } = useAuth();
  const [reports, setReports] = useState<any[]>([]);
  const [retentionPolicies, setRetentionPolicies] = useState<any[]>([]);
  const [dataResidency, setDataResidency] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'reports' | 'retention' | 'residency' | 'gdpr'>('reports');

  // Generate Report Modal
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateForm, setGenerateForm] = useState({
    framework: 'SOC2',
    reportType: 'FULL',
    dateFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    dateTo: new Date().toISOString().split('T')[0],
  });
  const [generating, setGenerating] = useState(false);

  // Retention Policy Modal
  const [showRetentionModal, setShowRetentionModal] = useState(false);
  const [editingRetention, setEditingRetention] = useState<any | null>(null);
  const [deletingRetention, setDeletingRetention] = useState<any | null>(null);
  const [retentionForm, setRetentionForm] = useState({
    name: '',
    resourceType: 'AUDIT_LOG',
    conditions: '',
    retentionDays: 2555,
    action: 'DELETE',
  });

  // Data Residency
  const [residencyForm, setResidencyForm] = useState({
    primaryRegion: 'US_EAST',
    allowedRegions: ['US_EAST'],
    replicationEnabled: false,
    encryptionAtRest: true,
    encryptionInTransit: true,
    keyManagement: 'MANAGED',
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [reportsRes, policiesRes, residencyRes] = await Promise.all([
        complianceApi.getReports(),
        complianceApi.getRetentionPolicies(),
        complianceApi.getDataResidency().catch(() => ({ data: { data: null } })),
      ]);
      setReports(reportsRes.data.data);
      setRetentionPolicies(policiesRes.data.data);
      setDataResidency(residencyRes.data.data);
    } catch (error) {
      console.error('Failed to fetch compliance data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [workspace?.id]);

  const handleGenerateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    try {
      await complianceApi.generateReport({
        ...generateForm,
        dateFrom: new Date(generateForm.dateFrom).toISOString(),
        dateTo: new Date(generateForm.dateTo).toISOString(),
      });
      setShowGenerateModal(false);
      fetchData();
    } catch (error) {
      console.error('Failed to generate report:', error);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadReport = async (reportId: string) => {
    try {
      const response = await complianceApi.downloadReport(reportId);
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `compliance-report-${reportId}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download report:', error);
    }
  };

  const handleRetentionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        ...retentionForm,
        conditions: retentionForm.conditions ? JSON.parse(retentionForm.conditions) : {},
      };
      if (editingRetention) {
        // Update would need an API endpoint
      } else {
        await complianceApi.createRetentionPolicy(data);
      }
      setShowRetentionModal(false);
      setEditingRetention(null);
      resetRetentionForm();
      fetchData();
    } catch (error) {
      console.error('Failed to save retention policy:', error);
    }
  };

  const handleDeleteRetention = async () => {
    if (!deletingRetention) return;
    try {
      await complianceApi.deleteRetentionPolicy(deletingRetention.id);
      setDeletingRetention(null);
      fetchData();
    } catch (error) {
      console.error('Failed to delete retention policy:', error);
    }
  };

  const handleResidencySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await complianceApi.configureDataResidency({
        ...residencyForm,
        allowedRegions: residencyForm.allowedRegions,
      });
      fetchData();
    } catch (error) {
      console.error('Failed to configure data residency:', error);
    }
  };

  const handleGdprExport = async (userId: string) => {
    try {
      await complianceApi.gdprExport(userId);
      alert('GDPR export requested. Check audit logs for status.');
    } catch (error) {
      console.error('Failed to request GDPR export:', error);
    }
  };

  const handleGdprDeletion = async (userId: string) => {
    if (!confirm('This will permanently delete the user and all their data. Are you sure?')) return;
    try {
      await complianceApi.gdprDeletion(userId);
      alert('GDPR deletion completed.');
    } catch (error) {
      console.error('Failed to process GDPR deletion:', error);
    }
  };

  const resetRetentionForm = () => {
    setRetentionForm({
      name: '',
      resourceType: 'AUDIT_LOG',
      conditions: '',
      retentionDays: 2555,
      action: 'DELETE',
    });
  };

  const openRetentionModal = (policy?: any) => {
    if (policy) {
      setEditingRetention(policy);
      setRetentionForm({
        name: policy.name,
        resourceType: policy.resourceType,
        conditions: JSON.stringify(policy.conditions, null, 2),
        retentionDays: policy.retentionDays,
        action: policy.action,
      });
    } else {
      setEditingRetention(null);
      resetRetentionForm();
    }
    setShowRetentionModal(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'badge-success';
      case 'GENERATING': return 'badge-primary';
      case 'FAILED': return 'badge-danger';
      default: return 'badge-secondary';
    }
  };

  const getFrameworkIcon = (framework: string) => {
    switch (framework) {
      case 'SOC2': return <Shield className="w-4 h-4" />;
      case 'GDPR': return <AlertTriangle className="w-4 h-4" />;
      case 'HIPAA': return <AlertTriangle className="w-4 h-4" />;
      case 'ISO27001': return <Shield className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">Compliance</h1>
          <p className="mt-1 text-secondary-600 dark:text-secondary-400">
            Generate reports, configure retention, and manage data residency
          </p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'reports' && (
            <Button onClick={() => setShowGenerateModal(true)}>
              <Plus className="w-4 h-4" />
              Generate Report
            </Button>
          )}
          {activeTab === 'retention' && (
            <Button onClick={() => openRetentionModal()}>
              <Plus className="w-4 h-4" />
              Add Policy
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="card">
        <CardHeader className="pb-0">
          <nav className="flex gap-4" aria-label="Compliance tabs">
            {[
              { id: 'reports', label: 'Reports', icon: FileText },
              { id: 'retention', label: 'Retention Policies', icon: Clock },
              { id: 'residency', label: 'Data Residency', icon: Shield },
              { id: 'gdpr', label: 'GDPR Tools', icon: AlertTriangle },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                    : 'text-secondary-600 hover:bg-secondary-100 dark:text-secondary-400 dark:hover:bg-secondary-800'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </CardHeader>
        <CardContent className="pt-0">
          {activeTab === 'reports' && (
            <div className="space-y-6">
              {/* Reports List */}
              <div>
                <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-4">Compliance Reports</h3>
                {loading ? (
                  <div className="flex justify-center py-12"><LoadingSpinner /></div>
                ) : reports.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="w-12 h-12 text-secondary-300 dark:text-secondary-600 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-2">No reports generated</h3>
                    <p className="text-secondary-600 dark:text-secondary-400 mb-4">
                      Generate compliance reports for SOC 2, GDPR, HIPAA, and other frameworks
                    </p>
                    <Button onClick={() => setShowGenerateModal(true)}>
                      <Plus className="w-4 h-4" />
                      Generate Your First Report
                    </Button>
                  </div>
                ) : (
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Framework</th>
                          <th>Type</th>
                          <th>Period</th>
                          <th>Status</th>
                          <th>Generated By</th>
                          <th>Date</th>
                          <th className="w-32">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map((report) => (
                          <tr key={report.id}>
                            <td>
                              <div className="flex items-center gap-2">
                                {getFrameworkIcon(report.framework)}
                                <span className="font-medium">{report.framework}</span>
                              </div>
                            </td>
                            <td><span className="badge badge-secondary">{report.reportType}</span></td>
                            <td className="text-secondary-600 dark:text-secondary-400 text-sm">
                              {new Date(report.dateFrom).toLocaleDateString()} - {new Date(report.dateTo).toLocaleDateString()}
                            </td>
                            <td><span className={`badge ${getStatusBadge(report.status)}`}>{report.status}</span></td>
                            <td className="text-secondary-600 dark:text-secondary-400">{report.generatedBy}</td>
                            <td className="text-secondary-500 dark:text-secondary-500">{formatDistanceToNow(new Date(report.createdAt), { addSuffix: true })}</td>
                            <td>
                              <div className="flex items-center gap-1">
                                {report.status === 'COMPLETED' && (
                                  <Button variant="ghost" size="sm" onClick={() => handleDownloadReport(report.id)}>
                                    <Download className="w-4 h-4" />
                                  </Button>
                                )}
                                <Button variant="ghost" size="sm" onClick={() => {}}>
                                  <FileText className="w-4 h-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'retention' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-4">Retention Policies</h3>
                {retentionPolicies.length === 0 ? (
                  <div className="text-center py-12">
                    <Clock className="w-12 h-12 text-secondary-300 dark:text-secondary-600 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-2">No retention policies</h3>
                    <p className="text-secondary-600 dark:text-secondary-400 mb-4">
                      Configure automated data retention and deletion policies
                    </p>
                    <Button onClick={() => openRetentionModal()}>
                      <Plus className="w-4 h-4" />
                      Create Policy
                    </Button>
                  </div>
                ) : (
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Resource</th>
                          <th>Retention</th>
                          <th>Action</th>
                          <th>Status</th>
                          <th>Last Run</th>
                          <th>Next Run</th>
                          <th className="w-32">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {retentionPolicies.map((policy) => (
                          <tr key={policy.id}>
                            <td className="font-medium">{policy.name}</td>
                            <td><span className="badge badge-secondary">{policy.resourceType}</span></td>
                            <td>{policy.retentionDays} days</td>
                            <td><span className="badge badge-secondary">{policy.action}</span></td>
                            <td><span className={`badge ${policy.isActive ? 'badge-success' : 'badge-secondary'}`}>{policy.isActive ? 'Active' : 'Inactive'}</span></td>
                            <td>{policy.lastRunAt ? formatDistanceToNow(new Date(policy.lastRunAt), { addSuffix: true }) : 'Never'}</td>
                            <td>{policy.nextRunAt ? formatDistanceToNow(new Date(policy.nextRunAt), { addSuffix: true }) : 'Not scheduled'}</td>
                            <td>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => openRetentionModal(policy)}>
                                  <FileText className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setDeletingRetention(policy)}>
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
              </div>
            </div>
          )}

          {activeTab === 'residency' && (
            <div className="space-y-6">
              <form onSubmit={handleResidencySubmit} className="space-y-6 max-w-2xl">
                <div>
                  <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-4">Data Residency Configuration</h3>
                  <p className="text-secondary-600 dark:text-secondary-400">
                    Configure where your data is stored and replicated
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select
                    label="Primary Region"
                    value={residencyForm.primaryRegion}
                    onValueChange={(v) => setResidencyForm({ ...residencyForm, primaryRegion: v })}
                    options={[
                      { value: 'US_EAST', label: 'US East (N. Virginia)' },
                      { value: 'US_WEST', label: 'US West (Oregon)' },
                      { value: 'EU_WEST', label: 'EU West (Ireland)' },
                      { value: 'EU_CENTRAL', label: 'EU Central (Frankfurt)' },
                      { value: 'AP_SOUTHEAST', label: 'Asia Pacific (Singapore)' },
                      { value: 'AP_NORTHEAST', label: 'Asia Pacific (Tokyo)' },
                      { value: 'CA_CENTRAL', label: 'Canada Central (Toronto)' },
                      { value: 'SA_EAST', label: 'South America (São Paulo)' },
                    ]}
                  />
                  <div>
                    <label className="label">Allowed Regions</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        'US_EAST', 'US_WEST', 'EU_WEST', 'EU_CENTRAL',
                        'AP_SOUTHEAST', 'AP_NORTHEAST', 'CA_CENTRAL', 'SA_EAST'
                      ].map(region => (
                        <label key={region} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                            checked={residencyForm.allowedRegions.includes(region)}
                            onChange={(e) => setResidencyForm(prev => ({
                              ...prev,
                              allowedRegions: e.target.checked
                                ? [...prev.allowedRegions, region]
                                : prev.allowedRegions.filter(r => r !== region)
                            }))}
                          />
                          <span className="text-sm">{region}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                      checked={residencyForm.replicationEnabled}
                      onChange={(e) => setResidencyForm({ ...residencyForm, replicationEnabled: e.target.checked })}
                    />
                    <span className="text-sm">Enable cross-region replication</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                      checked={residencyForm.encryptionAtRest}
                      onChange={(e) => setResidencyForm({ ...residencyForm, encryptionAtRest: e.target.checked })}
                    />
                    <span className="text-sm">Encryption at rest</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                      checked={residencyForm.encryptionInTransit}
                      onChange={(e) => setResidencyForm({ ...residencyForm, encryptionInTransit: e.target.checked })}
                    />
                    <span className="text-sm">Encryption in transit</span>
                  </label>
                  <Select
                    label="Key Management"
                    value={residencyForm.keyManagement}
                    onValueChange={(v) => setResidencyForm({ ...residencyForm, keyManagement: v })}
                    options={[
                      { value: 'MANAGED', label: 'Managed by Pulse' },
                      { value: 'CUSTOMER', label: 'Customer Managed Keys' },
                      { value: 'HSM', label: 'Hardware Security Module' },
                    ]}
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-secondary-200 dark:border-secondary-700">
                  <Button type="submit" variant="primary">
                    Save Configuration
                  </Button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'gdpr' && (
            <div className="space-y-6">
              <div className="bg-secondary-50 dark:bg-secondary-800/50 rounded-lg p-6">
                <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-2">GDPR Data Subject Rights</h3>
                <p className="text-secondary-600 dark:text-secondary-400 mb-4">
                  Handle Data Subject Access Requests (DSAR) and Right to Erasure requests
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-secondary-200 dark:border-secondary-700 rounded-lg p-4">
                    <h4 className="font-medium text-secondary-900 dark:text-white mb-2 flex items-center gap-2">
                      <Download className="w-5 h-5" />
                      Data Export (Article 20)
                    </h4>
                    <p className="text-sm text-secondary-600 dark:text-secondary-400 mb-4">
                      Export all personal data for a user in machine-readable format
                    </p>
                    <Input
                      placeholder="User ID"
                      onChange={(e) => {}}
                    />
                    <Button className="mt-2 w-full" onClick={() => handleGdprExport('')}>
                      Request Export
                    </Button>
                  </div>
                  <div className="border border-danger-200 dark:border-danger-800 rounded-lg p-4 bg-danger-50 dark:bg-danger-900/20">
                    <h4 className="font-medium text-danger-800 dark:text-danger-300 mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5" />
                      Data Deletion (Article 17)
                    </h4>
                    <p className="text-sm text-danger-700 dark:text-danger-400 mb-4">
                      Permanently delete all personal data for a user (Right to be Forgotten)
                    </p>
                    <Input
                      placeholder="User ID"
                      onChange={(e) => {}}
                    />
                    <Button variant="danger" className="mt-2 w-full" onClick={() => handleGdprDeletion('')}>
                      Delete User Data
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </div>

      {/* Generate Report Modal */}
      <Modal
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        title="Generate Compliance Report"
        size="md"
      >
        <form onSubmit={handleGenerateReport} className="space-y-4">
          <Select
            label="Framework"
            value={generateForm.framework}
            onValueChange={(v) => setGenerateForm({ ...generateForm, framework: v })}
            options={frameworks}
          />
          <Select
            label="Report Type"
            value={generateForm.reportType}
            onValueChange={(v) => setGenerateForm({ ...generateForm, reportType: v })}
            options={reportTypes}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              type="date"
              label="From Date"
              value={generateForm.dateFrom}
              onChange={(e) => setGenerateForm({ ...generateForm, dateFrom: e.target.value })}
            />
            <Input
              type="date"
              label="To Date"
              value={generateForm.dateTo}
              onChange={(e) => setGenerateForm({ ...generateForm, dateTo: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setShowGenerateModal(false)}>Cancel</Button>
            <Button type="submit" loading={generating}>Generate Report</Button>
          </div>
        </form>
      </Modal>

      {/* Retention Policy Modal */}
      <Modal
        isOpen={showRetentionModal}
        onClose={() => {
          setShowRetentionModal(false);
          setEditingRetention(null);
          resetRetentionForm();
        }}
        title={editingRetention ? 'Edit Retention Policy' : 'Create Retention Policy'}
        size="lg"
      >
        <form onSubmit={handleRetentionSubmit} className="space-y-4">
          <Input
            label="Policy Name"
            value={retentionForm.name}
            onChange={(e) => setRetentionForm({ ...retentionForm, name: e.target.value })}
            required
          />
          <Select
            label="Resource Type"
            value={retentionForm.resourceType}
            onValueChange={(v) => setRetentionForm({ ...retentionForm, resourceType: v })}
            options={resourceTypes}
          />
          <div>
            <label className="label">Conditions (JSON)</label>
            <textarea
              className="input min-h-[100px] font-mono text-sm"
              value={retentionForm.conditions}
              onChange={(e) => setRetentionForm({ ...retentionForm, conditions: e.target.value })}
              placeholder='{"workspaceId": "abc123"}'
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              type="number"
              label="Retention Days"
              value={retentionForm.retentionDays}
              onChange={(e) => setRetentionForm({ ...retentionForm, retentionDays: parseInt(e.target.value) || 2555 })}
              min="1"
              max="3650"
            />
            <Select
              label="Action"
              value={retentionForm.action}
              onValueChange={(v) => setRetentionForm({ ...retentionForm, action: v })}
              options={actions}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => {
              setShowRetentionModal(false);
              setEditingRetention(null);
              resetRetentionForm();
            }}>Cancel</Button>
            <Button type="submit">{editingRetention ? 'Update Policy' : 'Create Policy'}</Button>
          </div>
        </form>
      </Modal>

      {/* Delete Retention Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingRetention}
        onClose={() => setDeletingRetention(null)}
        onConfirm={handleDeleteRetention}
        title="Delete Retention Policy"
        message={`Are you sure you want to delete "${deletingRetention?.name}"?`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}