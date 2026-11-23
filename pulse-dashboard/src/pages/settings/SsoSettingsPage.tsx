import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Globe, Key, ExternalLink, Copy, Check, AlertTriangle } from 'lucide-react';

const providers = [
  { value: 'SAML', label: 'SAML 2.0' },
  { value: 'OIDC', label: 'OIDC / OpenID Connect' },
  { value: 'GOOGLE', label: 'Google Workspace' },
  { value: 'MICROSOFT', label: 'Microsoft Entra ID' },
  { value: 'OKTA', label: 'Okta' },
  { value: 'AUTH0', label: 'Auth0' },
  { value: 'KEYCLOAK', label: 'Keycloak' },
];

export function SsoSettingsPage() {
  const { workspace } = useAuth();
  const [provider, setProvider] = useState('SAML');
  const [configured, setConfigured] = useState(false);
  const [config, setConfig] = useState({
    // SAML
    samlEntryPoint: '',
    samlIssuer: '',
    samlCert: '',
    samlPrivateKey: '',
    samlCallbackUrl: '',
    samlAttributeMapping: '',
    // OIDC
    oidcClientId: '',
    oidcClientSecret: '',
    oidcIssuer: '',
    oidcDiscoveryUrl: '',
    oidcScopes: 'openid profile email',
    // General
    autoProvision: true,
    defaultRole: 'MEMBER',
    domainWhitelist: '',
    attributeMapping: '',
  });
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Submit to API
    console.log('Saving SSO config:', config);
    setConfigured(true);
  };

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const getCallbackUrl = () => {
    const base = window.location.origin;
    return `${base}/api/v1/auth/sso/callback`;
  };

  const getMetadataUrl = () => {
    const base = window.location.origin;
    return `${base}/api/v1/sso/metadata`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">SSO Configuration</h1>
        <p className="mt-1 text-secondary-600 dark:text-secondary-400">
          Configure Single Sign-On for your workspace
        </p>
      </div>

      <div className="card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>SSO Settings</CardTitle>
              <CardDescription>Configure your identity provider integration</CardDescription>
            </div>
            {!configured && (
              <Button onClick={() => setConfigured(true)}>
                <Globe className="w-4 h-4" />
                Configure SSO
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!configured ? (
            <div className="text-center py-12">
              <Globe className="w-16 h-16 text-secondary-300 dark:text-secondary-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-secondary-900 dark:text-white mb-2">SSO not configured</h3>
              <p className="text-secondary-600 dark:text-secondary-400 mb-6 max-w-md mx-auto">
                Configure Single Sign-On to allow users to authenticate with your identity provider (Okta, Azure AD, Google, etc.)
              </p>
              <Button onClick={() => setConfigured(true)} size="lg">
                <Globe className="w-4 h-4" />
                Get Started
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Provider Selection */}
              <div>
                <label className="label">Identity Provider</label>
                <Select
                  value={provider}
                  onValueChange={setProvider}
                  options={providers}
                  placeholder="Select provider"
                />
              </div>

              {/* SAML Configuration */}
              {(provider === 'SAML' || provider === 'OKTA' || provider === 'AUTH0' || provider === 'KEYCLOAK') && (
                <div className="space-y-4 border-t border-secondary-200 dark:border-secondary-700 pt-6">
                  <h3 className="text-lg font-medium text-secondary-900 dark:text-white">SAML 2.0 Configuration</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Entry Point (SSO URL)"
                      value={config.samlEntryPoint}
                      onChange={(e) => setConfig({ ...config, samlEntryPoint: e.target.value })}
                      placeholder="https://idp.example.com/sso/saml"
                    />
                    <Input
                      label="Issuer (Entity ID)"
                      value={config.samlIssuer}
                      onChange={(e) => setConfig({ ...config, samlIssuer: e.target.value })}
                      placeholder="https://pulse.example.com"
                    />
                    <div className="md:col-span-2">
                      <label className="label">X.509 Certificate</label>
                      <textarea
                        className="input min-h-[120px] font-mono text-sm"
                        value={config.samlCert}
                        onChange={(e) => setConfig({ ...config, samlCert: e.target.value })}
                        placeholder="-----BEGIN CERTIFICATE-----..."
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="label">Private Key (for signing requests)</label>
                      <div className="relative">
                        <textarea
                          className="input min-h-[120px] font-mono text-sm pr-12"
                          type={showPrivateKey ? 'text' : 'password'}
                          value={config.samlPrivateKey}
                          onChange={(e) => setConfig({ ...config, samlPrivateKey: e.target.value })}
                          placeholder="-----BEGIN PRIVATE KEY-----..."
                        />
                        <button
                          type="button"
                          onClick={() => setShowPrivateKey(!showPrivateKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary-400 hover:text-secondary-600"
                        >
                          {showPrivateKey ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* OIDC Configuration */}
              {(provider === 'OIDC' || provider === 'GOOGLE' || provider === 'MICROSOFT' || provider === 'OKTA' || provider === 'AUTH0' || provider === 'KEYCLOAK') && (
                <div className="space-y-4 border-t border-secondary-200 dark:border-secondary-700 pt-6">
                  <h3 className="text-lg font-medium text-secondary-900 dark:text-white">OIDC Configuration</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Client ID"
                      value={config.oidcClientId}
                      onChange={(e) => setConfig({ ...config, oidcClientId: e.target.value })}
                      placeholder="your-client-id"
                    />
                    <Input
                      label="Client Secret"
                      type="password"
                      value={config.oidcClientSecret}
                      onChange={(e) => setConfig({ ...config, oidcClientSecret: e.target.value })}
                      placeholder="••••••••"
                    />
                    <Input
                      label="Issuer URL"
                      value={config.oidcIssuer}
                      onChange={(e) => setConfig({ ...config, oidcIssuer: e.target.value })}
                      placeholder="https://accounts.google.com"
                    />
                    <Input
                      label="Discovery URL (optional)"
                      value={config.oidcDiscoveryUrl}
                      onChange={(e) => setConfig({ ...config, oidcDiscoveryUrl: e.target.value })}
                      placeholder="https://accounts.google.com/.well-known/openid-configuration"
                    />
                    <div className="md:col-span-2">
                      <label className="label">Scopes</label>
                      <Input
                        value={config.oidcScopes}
                        onChange={(e) => setConfig({ ...config, oidcScopes: e.target.value })}
                        placeholder="openid profile email"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* General Settings */}
              <div className="space-y-4 border-t border-secondary-200 dark:border-secondary-700 pt-6">
                <h3 className="text-lg font-medium text-secondary-900 dark:text-white">General Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                      checked={config.autoProvision}
                      onChange={(e) => setConfig({ ...config, autoProvision: e.target.checked })}
                    />
                    <span className="text-sm text-secondary-700 dark:text-secondary-300">Auto-provision users from IdP</span>
                  </label>
                  <Select
                    label="Default role for new users"
                    value={config.defaultRole}
                    onValueChange={(v) => setConfig({ ...config, defaultRole: v })}
                    options={[
                      { value: 'MEMBER', label: 'Member' },
                      { value: 'VIEWER', label: 'Viewer' },
                      { value: 'GUEST', label: 'Guest' },
                    ]}
                  />
                  <Input
                    label="Allowed email domains (comma-separated)"
                    value={config.domainWhitelist}
                    onChange={(e) => setConfig({ ...config, domainWhitelist: e.target.value })}
                    placeholder="example.com, company.org"
                  />
                </div>
              </div>

              {/* Service Provider Info */}
              <div className="space-y-4 border-t border-secondary-200 dark:border-secondary-700 pt-6 bg-secondary-50 dark:bg-secondary-800/50 rounded-lg p-6">
                <h3 className="text-lg font-medium text-secondary-900 dark:text-white">Service Provider Information</h3>
                <p className="text-sm text-secondary-600 dark:text-secondary-400">
                  Provide these details to your identity provider administrator
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Assertion Consumer Service (ACS) URL</label>
                    <div className="flex gap-2">
                      <Input value={getCallbackUrl()} readOnly />
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(getCallbackUrl(), 'acs')}>
                        {copiedField === 'acs' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="label">SP Entity ID / Audience</label>
                    <div className="flex gap-2">
                      <Input value={window.location.origin} readOnly />
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(window.location.origin, 'entity')}>
                        {copiedField === 'entity' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="label">SAML Metadata URL</label>
                    <div className="flex gap-2">
                      <Input value={getMetadataUrl()} readOnly />
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(getMetadataUrl(), 'metadata')}>
                        {copiedField === 'metadata' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="label">OIDC Redirect URI</label>
                    <div className="flex gap-2">
                      <Input value={`${window.location.origin}/api/v1/auth/oidc/callback`} readOnly />
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(`${window.location.origin}/api/v1/auth/oidc/callback`, 'oidc')}>
                        {copiedField === 'oidc' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 border-t border-secondary-200 dark:border-secondary-700 pt-6">
                <Button type="button" variant="outline" onClick={() => setConfigured(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  {configured ? 'Save Configuration' : 'Configure SSO'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </div>
    </div>
  );
}