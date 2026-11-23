import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import {
  LayoutDashboard,
  Users,
  Shield,
  Key,
  FileText,
  Globe,
  Server,
  Activity,
  Plus,
  Clock,
  TrendingUp,
} from 'lucide-react';

const stats = [
  { name: 'Active Sessions', value: '3', icon: Activity, color: 'text-primary-600', bg: 'bg-primary-100 dark:bg-primary-900/30' },
  { name: 'Team Members', value: '12', icon: Users, color: 'text-success-600', bg: 'bg-success-100 dark:bg-success-900/30' },
  { name: 'Audit Events (24h)', value: '247', icon: FileText, color: 'text-warning-600', bg: 'bg-warning-100 dark:bg-warning-900/30' },
  { name: 'Security Score', value: '94%', icon: Shield, color: 'text-success-600', bg: 'bg-success-100 dark:bg-success-900/30' },
];

const quickActions = [
  { name: 'Configure SSO', href: '/settings/sso', icon: Globe, description: 'Set up SAML/OIDC authentication' },
  { name: 'Manage RBAC', href: '/security/rbac', icon: Shield, description: 'Custom roles and permissions' },
  { name: 'Secrets Vault', href: '/security/secrets', icon: Key, description: 'Manage encrypted secrets' },
  { name: 'IP Allowlist', href: '/security/ip-allowlist', icon: Globe, description: 'Network access control' },
  { name: 'Compliance Reports', href: '/security/compliance', icon: FileText, description: 'SOC 2, GDPR, HIPAA' },
  { name: 'Audit Logs', href: '/security/audit-logs', icon: Activity, description: 'View security events' },
];

const recentActivity = [
  { action: 'SSO configured', resource: 'Okta SAML', time: '2 hours ago', user: 'admin@company.com', type: 'success' },
  { action: 'New member added', resource: 'Engineering team', time: '4 hours ago', user: 'manager@company.com', type: 'info' },
  { action: 'Secret rotated', resource: 'API_KEY_PROD', time: '6 hours ago', user: 'system', type: 'warning' },
  { action: 'IP allowlist updated', resource: 'Office network', time: '1 day ago', user: 'security@company.com', type: 'info' },
  { action: 'Compliance report generated', resource: 'SOC 2 Type II', time: '2 days ago', user: 'admin@company.com', type: 'success' },
];

export function DashboardPage() {
  const { user, workspace } = useAuth();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">
            Welcome back, {user?.name?.split(' ')[0] || 'User'}
          </h1>
          <p className="mt-1 text-secondary-600 dark:text-secondary-400">
            {workspace?.name} • Security & Compliance Dashboard
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline">
            <Plus className="w-4 h-4" />
            New Project
          </Button>
          <Button>
            <LayoutDashboard className="w-4 h-4" />
            View All
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.name} className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-secondary-600 dark:text-secondary-400">{stat.name}</p>
                <p className="mt-1 text-3xl font-bold text-secondary-900 dark:text-white">{stat.value}</p>
              </div>
              <div className={`p-3 rounded-xl ${stat.bg}`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <div className="lg:col-span-1 space-y-6">
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-secondary-900 dark:text-white mb-4">Quick Actions</h2>
            <nav className="space-y-2" aria-label="Quick actions">
              {quickActions.map((action) => (
                <a
                  key={action.name}
                  href={action.href}
                  className="flex items-center gap-3 p-3 rounded-lg text-secondary-600 dark:text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors"
                >
                  <div className={`p-2 rounded-lg bg-secondary-100 dark:bg-secondary-800`}>
                    <action.icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-secondary-900 dark:text-white truncate">{action.name}</p>
                    <p className="text-xs text-secondary-500 dark:text-secondary-400 truncate">{action.description}</p>
                  </div>
                </a>
              ))}
            </nav>
          </div>

          {/* Security Status */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-secondary-900 dark:text-white mb-4">Security Status</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-success-100 dark:bg-success-900/30">
                    <Shield className="w-5 h-5 text-success-600" />
                  </div>
                  <div>
                    <p className="font-medium text-secondary-900 dark:text-white">MFA Enforcement</p>
                    <p className="text-sm text-secondary-500 dark:text-secondary-400">Enabled for all admins</p>
                  </div>
                </div>
                <span className="badge badge-success">Active</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
                    <Globe className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <p className="font-medium text-secondary-900 dark:text-white">SSO Integration</p>
                    <p className="text-sm text-secondary-500 dark:text-secondary-400">Okta SAML configured</p>
                  </div>
                </div>
                <span className="badge badge-primary">Connected</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-warning-100 dark:bg-warning-900/30">
                    <Key className="w-5 h-5 text-warning-600" />
                  </div>
                  <div>
                    <p className="font-medium text-secondary-900 dark:text-white">Secrets Rotation</p>
                    <p className="text-sm text-secondary-500 dark:text-secondary-400">3 secrets due for rotation</p>
                  </div>
                </div>
                <span className="badge badge-warning">Attention</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <div className="card">
            <div className="p-6 border-b border-secondary-200 dark:border-secondary-700">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-secondary-900 dark:text-white">Recent Activity</h2>
                <Button variant="ghost" size="sm">
                  <Clock className="w-4 h-4" />
                  View All
                </Button>
              </div>
            </div>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Resource</th>
                    <th>User</th>
                    <th>Time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((activity, index) => (
                    <tr key={index}>
                      <td className="font-medium text-secondary-900 dark:text-white">{activity.action}</td>
                      <td className="text-secondary-600 dark:text-secondary-400">{activity.resource}</td>
                      <td className="text-secondary-600 dark:text-secondary-400">{activity.user}</td>
                      <td className="text-secondary-500 dark:text-secondary-500">{activity.time}</td>
                      <td>
                        <span className={`badge ${
                          activity.type === 'success' ? 'badge-success' :
                          activity.type === 'warning' ? 'badge-warning' :
                          'badge-secondary'
                        }`}>
                          {activity.type}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Compliance Overview */}
          <div className="card mt-6">
            <div className="p-6 border-b border-secondary-200 dark:border-secondary-700">
              <h2 className="text-lg font-semibold text-secondary-900 dark:text-white">Compliance Overview</h2>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[
                { framework: 'SOC 2', status: 'Compliant', score: 94, lastAudit: '2024-01-15', color: 'success' },
                { framework: 'GDPR', status: 'Compliant', score: 89, lastAudit: '2024-02-20', color: 'primary' },
                { framework: 'HIPAA', status: 'In Progress', score: 72, lastAudit: '2024-03-10', color: 'warning' },
              ].map((item) => (
                <div key={item.framework} className="p-4 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-secondary-900 dark:text-white">{item.framework}</span>
                    <span className={`badge ${item.color === 'success' ? 'badge-success' : item.color === 'warning' ? 'badge-warning' : 'badge-primary'}`}>
                      {item.status}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-secondary-600 dark:text-secondary-400">Score</span>
                      <span className="font-semibold text-secondary-900 dark:text-white">{item.score}%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-secondary-600 dark:text-secondary-400">Last Audit</span>
                      <span className="text-secondary-900 dark:text-white">{item.lastAudit}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}