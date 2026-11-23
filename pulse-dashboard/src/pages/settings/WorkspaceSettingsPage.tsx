import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Settings, Users, Globe, Bell, Shield, Key, FileText, Server } from 'lucide-react';

const generalSettings = [
  { name: 'General', href: '/settings/general', icon: Settings },
  { name: 'SSO', href: '/settings/sso', icon: Globe },
  { name: 'SCIM', href: '/settings/scim', icon: Users },
];

export function WorkspaceSettingsPage() {
  const { workspace, user } = useAuth();
  const [activeTab, setActiveTab] = useState('general');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">Workspace Settings</h1>
        <p className="mt-1 text-secondary-600 dark:text-secondary-400">
          Manage your workspace configuration and security settings
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1">
          <div className="card">
            <nav className="space-y-1 p-2" aria-label="Settings navigation">
              {generalSettings.map((item) => (
                <a
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === item.name.toLowerCase()
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                      : 'text-secondary-600 hover:bg-secondary-100 dark:text-secondary-400 dark:hover:bg-secondary-800'
                  }`}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <span>{item.name}</span>
                </a>
              ))}
              <div className="border-t border-secondary-200 dark:border-secondary-700 my-2" />
              <a
                href="/security/audit-logs"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-secondary-600 hover:bg-secondary-100 dark:text-secondary-400 dark:hover:bg-secondary-800 transition-colors"
              >
                <Shield className="w-5 h-5 flex-shrink-0" />
                <span>Security</span>
              </a>
            </nav>
          </div>
        </div>

        {/* Content */}
        <div className="lg:col-span-3 space-y-6">
          {activeTab === 'general' && (
            <>
              <div className="card">
                <CardHeader>
                  <CardTitle>Workspace Information</CardTitle>
                  <CardDescription>Basic information about your workspace</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Input label="Workspace name" defaultValue={workspace?.name} placeholder="My Workspace" />
                    <Input label="Workspace slug" defaultValue={workspace?.slug} placeholder="my-workspace" />
                    <Input label="Owner" defaultValue={user?.email} disabled />
                    <Input label="Plan" defaultValue={workspace?.plan || 'FREE'} disabled />
                  </div>
                </CardContent>
              </div>

              <div className="card">
                <CardHeader>
                  <CardTitle>Appearance</CardTitle>
                  <CardDescription>Customize the look and feel of your workspace</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="label">Logo</label>
                      <div className="border-2 border-dashed border-secondary-300 dark:border-secondary-600 rounded-lg p-8 text-center">
                        <p className="text-secondary-500 dark:text-secondary-400">Drag & drop or click to upload</p>
                        <p className="text-xs text-secondary-400 dark:text-secondary-500 mt-1">PNG, JPG up to 2MB</p>
                      </div>
                    </div>
                    <div>
                      <label className="label">Theme</label>
                      <select className="input">
                        <option>System</option>
                        <option>Light</option>
                        <option>Dark</option>
                      </select>
                    </div>
                  </div>
                </CardContent>
              </div>

              <div className="card">
                <CardHeader>
                  <CardTitle>Danger Zone</CardTitle>
                  <CardDescription>Irreversible actions</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between p-4 bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 rounded-lg">
                    <div>
                      <p className="font-medium text-danger-800 dark:text-danger-300">Delete workspace</p>
                      <p className="text-sm text-danger-700 dark:text-danger-400">Permanently delete this workspace and all its data</p>
                    </div>
                    <Button variant="danger">Delete workspace</Button>
                  </div>
                </CardContent>
              </div>
            </>
          )}

          {activeTab === 'sso' && (
            <div className="card">
              <CardHeader>
                <CardTitle>Single Sign-On (SSO)</CardTitle>
                <CardDescription>Configure SAML 2.0 or OIDC authentication for your workspace</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-secondary-900 dark:text-white">SSO Status</p>
                      <p className="text-sm text-secondary-500 dark:text-secondary-400">Not configured</p>
                    </div>
                    <Button variant="outline">Configure SSO</Button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-4 border border-secondary-200 dark:border-secondary-700 rounded-lg">
                      <h4 className="font-medium text-secondary-900 dark:text-white mb-2">SAML 2.0</h4>
                      <p className="text-sm text-secondary-600 dark:text-secondary-400">
                        Configure SAML with Okta, Azure AD, Auth0, Keycloak, or any SAML 2.0 IdP
                      </p>
                    </div>
                    <div className="p-4 border border-secondary-200 dark:border-secondary-700 rounded-lg">
                      <h4 className="font-medium text-secondary-900 dark:text-white mb-2">OIDC / OpenID Connect</h4>
                      <p className="text-sm text-secondary-600 dark:text-secondary-400">
                        Configure OIDC with Google, Microsoft, Okta, Auth0, Keycloak, or any OIDC provider
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </div>
          )}

          {activeTab === 'scim' && (
            <div className="card">
              <CardHeader>
                <CardTitle>SCIM 2.0 Provisioning</CardTitle>
                <CardDescription>Automate user and group provisioning from your identity provider</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-secondary-900 dark:text-white">SCIM Status</p>
                      <p className="text-sm text-secondary-500 dark:text-secondary-400">Not configured</p>
                    </div>
                    <Button variant="outline">Configure SCIM</Button>
                  </div>
                  <div className="p-4 border border-secondary-200 dark:border-secondary-700 rounded-lg">
                    <h4 className="font-medium text-secondary-900 dark:text-white mb-2">Supported Features</h4>
                    <ul className="space-y-1 text-sm text-secondary-600 dark:text-secondary-400">
                      <li>• User provisioning (create, read, update, delete)</li>
                      <li>• Group provisioning</li>
                      <li>• Attribute mapping</li>
                      <li>• Filtering and pagination</li>
                      <li>• Bulk operations</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}