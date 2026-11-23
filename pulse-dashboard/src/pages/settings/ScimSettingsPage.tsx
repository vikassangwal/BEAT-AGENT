import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Users, Key, ExternalLink, Copy, Check, AlertTriangle, Sync } from 'lucide-react';

export function ScimSettingsPage() {
  const { workspace } = useAuth();
  const [configured, setConfigured] = useState(false);
  const [config, setConfig] = useState({
    baseUrl: '',
    bearerToken: '',
    userSchema: '',
    groupSchema: '',
    attributeMapping: '',
    filterConfig: '',
    provisioningRules: '',
    enabled: false,
  });
  const [showToken, setShowToken] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Saving SCIM config:', config);
    setConfigured(true);
  };

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus('idle');
    try {
      // Call sync API
      await new Promise(resolve => setTimeout(resolve, 2000));
      setLastSync(new Date().toISOString());
      setSyncStatus('success');
    } catch {
      setSyncStatus('error');
    } finally {
      setSyncing(false);
    }
  };

  const getScimBaseUrl = () => {
    return `${window.location.origin}/api/v1/scim`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">SCIM 2.0 Provisioning</h1>
        <p className="mt-1 text-secondary-600 dark:text-secondary-400">
          Automate user and group provisioning from your identity provider
        </p>
      </div>

      <div className="card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>SCIM Configuration</CardTitle>
              <CardDescription>Configure SCIM 2.0 endpoint for automated provisioning</CardDescription>
            </div>
            {!configured && (
              <Button onClick={() => setConfigured(true)}>
                <Users className="w-4 h-4" />
                Configure SCIM
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!configured ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 text-secondary-300 dark:text-secondary-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-2">SCIM not configured</h3>
              <p className="text-secondary-600 dark:text-secondary-400 mb-6 max-w-md mx-auto">
                Configure SCIM 2.0 to automatically provision and deprovision users and groups from your identity provider (Okta, Azure AD, etc.)
              </p>
              <Button onClick={() => setConfigured(true)} size="lg">
                <Users className="w-4 h-4" />
                Get Started
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Connection Settings */}
              <div>
                <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-4">Connection Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="SCIM Base URL"
                    value={config.baseUrl}
                    onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                    placeholder="https://idp.example.com/scim/v2"
                  />
                  <div className="relative">
                    <label className="label">Bearer Token</label>
                    <div className="flex gap-2">
                      <Input
                        type={showToken ? 'text' : 'password'}
                        value={config.bearerToken}
                        onChange={(e) => setConfig({ ...config, bearerToken: e.target.value })}
                        placeholder="••••••••"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowToken(!showToken)}
                      >
                        {showToken ? 'Hide' : 'Show'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Attribute Mapping */}
              <div className="space-y-4 border-t border-secondary-200 dark:border-secondary-700 pt-6">
                <h3 className="text-lg font-medium text-secondary-900 dark:text-white">Attribute Mapping</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="label">User Attribute Mapping (JSON)</label>
                    <textarea
                      className="input min-h-[150px] font-mono text-sm"
                      value={config.attributeMapping}
                      onChange={(e) => setConfig({ ...config, attributeMapping: e.target.value })}
                      placeholder='{"userName": "userName", "email": "emails[0].value", "firstName": "name.givenName", "lastName": "name.familyName", "displayName": "displayName", "active": "active"}'
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label">Group Attribute Mapping (JSON)</label>
                    <textarea
                      className="input min-h-[100px] font-mono text-sm"
                      value={config.groupSchema}
                      onChange={(e) => setConfig({ ...config, groupSchema: e.target.value })}
                      placeholder='{"displayName": "displayName", "members": "members"}'
                    />
                  </div>
                </div>
              </div>

              {/* Filter Configuration */}
              <div className="space-y-4 border-t border-secondary-200 dark:border-secondary-700 pt-6">
                <h3 className="text-lg font-medium text-secondary-900 dark:text-white">Filter Configuration</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <textarea
                    className="input min-h-[100px] font-mono text-sm"
                    label="Filter Config (JSON)"
                    value={config.filterConfig}
                    onChange={(e) => setConfig({ ...config, filterConfig: e.target.value })}
                    placeholder='{"userFilter": "active eq true", "groupFilter": "displayName co \"Engineering\""}'
                  />
                  <textarea
                    className="input min-h-[100px] font-mono text-sm"
                    label="Provisioning Rules (JSON)"
                    value={config.provisioningRules}
                    onChange={(e) => setConfig({ ...config, provisioningRules: e.target.value })}
                    placeholder='{"createUsers": true, "updateUsers": true, "deleteUsers": false, "createGroups": true}'
                  />
                </div>
              </div>

              {/* Endpoint Information */}
              <div className="space-y-4 border-t border-secondary-200 dark:border-secondary-700 pt-6 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg p-6">
                <h3 className="text-lg font-medium text-secondary-900 dark:text-white">SCIM Endpoint Information</h3>
                <p className="text-sm text-secondary-600 dark:text-secondary-400">
                  Provide these details to your identity provider administrator
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">SCIM Base URL</label>
                    <div className="flex gap-2">
                      <Input value={getScimBaseUrl()} readOnly />
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(getScimBaseUrl(), 'baseUrl')}>
                        {copiedField === 'baseUrl' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="label">Users Endpoint</label>
                    <div className="flex gap-2">
                      <Input value={`${getScimBaseUrl()}/Users`} readOnly />
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(`${getScimBaseUrl()}/Users`, 'users')}>
                        {copiedField === 'users' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="label">Groups Endpoint</label>
                    <div className="flex gap-2">
                      <Input value={`${getScimBaseUrl()}/Groups`} readOnly />
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(`${getScimBaseUrl()}/Groups`, 'groups')}>
                        {copiedField === 'groups' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="label">Service Provider Config</label>
                    <div className="flex gap-2">
                      <Input value={`${getScimBaseUrl()}/ServiceProviderConfig`} readOnly />
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(`${getScimBaseUrl()}/ServiceProviderConfig`, 'sp')}>
                        {copiedField === 'sp' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sync Controls */}
              <div className="space-y-4 border-t border-secondary-200 dark:border-secondary-700 pt-6">
                <h3 className="text-lg font-medium text-secondary-900 dark:text-white">Sync Controls</h3>
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                  <div className="flex items-center gap-4">
                    <Button
                      variant="outline"
                      onClick={handleSync}
                      disabled={syncing}
                      leftIcon={syncing ? <Sync className="w-4 h-4 animate-spin" /> : <Sync className="w-4 h-4" />}
                    >
                      {syncing ? 'Syncing...' : 'Sync Now'}
                    </Button>
                    {lastSync && (
                      <span className="text-sm text-secondary-600 dark:text-secondary-400">
                        Last sync: {new Date(lastSync).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {syncStatus === 'success' && (
                    <span className="badge badge-success flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Sync completed
                    </span>
                  )}
                  {syncStatus === 'error' && (
                    <span className="badge badge-danger flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Sync failed
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 border-t border-secondary-200 dark:border-secondary-700 pt-6">
                <Button type="button" variant="outline" onClick={() => setConfigured(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  {configured ? 'Save Configuration' : 'Configure SCIM'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </div>
    </div>
  );
}