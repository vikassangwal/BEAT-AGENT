import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { AlertDialog } from '../../components/ui/Modal';
import { Check, Copy, AlertTriangle } from 'lucide-react';

const mfaVerifySchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code'),
});

type MfaVerifyForm = z.infer<typeof mfaVerifySchema>;

const mfaDisableSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  mfaCode: z.string().length(6, 'Enter the 6-digit code'),
});

type MfaDisableForm = z.infer<typeof mfaDisableSchema>;

export function MfaPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<'setup' | 'verify' | 'disable'>('setup');
  const [secret, setSecret] = useState<string>('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showCodes, setShowCodes] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [disableLoading, setDisableLoading] = useState(false);

  const {
    register: registerVerify,
    handleSubmit: handleSubmitVerify,
    formState: { errors: errorsVerify, isSubmitting: isSubmittingVerify },
  } = useForm<MfaVerifyForm>({
    resolver: zodResolver(mfaVerifySchema),
  });

  const {
    register: registerDisable,
    handleSubmit: handleSubmitDisable,
    formState: { errors: errorsDisable, isSubmitting: isSubmittingDisable },
  } = useForm<MfaDisableForm>({
    resolver: zodResolver(mfaDisableSchema),
  });

  const handleSetup = async () => {
    try {
      const response = await fetch('/api/v1/auth/mfa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await response.json();
      if (data.success) {
        setSecret(data.data.secret);
        setBackupCodes(data.data.backupCodes);
        setTab('verify');
      }
    } catch (error) {
      console.error('Failed to enable MFA:', error);
    }
  };

  const handleVerify = async (data: MfaVerifyForm) => {
    try {
      const response = await fetch('/api/v1/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: data.code }),
      });
      const result = await response.json();
      if (result.success) {
        setTab('setup');
        navigate('/dashboard');
      }
    } catch (error) {
      console.error('Failed to verify MFA:', error);
    }
  };

  const handleDisable = async (data: MfaDisableForm) => {
    setDisableLoading(true);
    try {
      const response = await fetch('/api/v1/auth/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (result.success) {
        setShowDisableDialog(false);
        setTab('setup');
      }
    } catch (error) {
      console.error('Failed to disable MFA:', error);
    } finally {
      setDisableLoading(false);
    }
  };

  const copyCode = async (index: number) => {
    await navigator.clipboard.writeText(backupCodes[index]);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const copySecret = async () => {
    await navigator.clipboard.writeText(secret);
    setCopiedIndex(-1);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (user?.mfaEnabled && tab === 'setup') {
    setTab('disable');
  }

  return (
    <div className="min-h-screen bg-secondary-50 dark:bg-secondary-950 px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-secondary-900 dark:text-white">Two-Factor Authentication</h1>
          <p className="mt-2 text-secondary-600 dark:text-secondary-400">
            Add an extra layer of security to your account
          </p>
        </div>

        <div className="card">
          <div className="border-b border-secondary-200 dark:border-secondary-700">
            <nav className="flex gap-4 p-4" aria-label="MFA tabs">
              <button
                onClick={() => setTab('setup')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  tab === 'setup'
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                    : 'text-secondary-600 hover:bg-secondary-100 dark:text-secondary-400 dark:hover:bg-secondary-800'
                }`}
              >
                {user?.mfaEnabled ? 'Manage' : 'Set up'}
              </button>
              {user?.mfaEnabled && (
                <button
                  onClick={() => setTab('disable')}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    tab === 'disable'
                      ? 'bg-danger-50 text-danger-700 dark:bg-danger-900/20 dark:text-danger-300'
                      : 'text-secondary-600 hover:bg-secondary-100 dark:text-secondary-400 dark:hover:bg-secondary-800'
                  }`}
                >
                  Disable
                </button>
              )}
            </nav>
          </div>

          <div className="p-6">
            {tab === 'setup' && !user?.mfaEnabled && (
              <div className="space-y-6">
                <div className="text-center">
                  <AlertTriangle className="w-12 h-12 text-warning-500 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-secondary-900 dark:text-white">
                    Enable Two-Factor Authentication
                  </h3>
                  <p className="mt-2 text-secondary-600 dark:text-secondary-400">
                    Use an authenticator app like Google Authenticator, Authy, or 1Password to generate codes.
                  </p>
                </div>

                <Button onClick={handleSetup} size="lg" className="w-full">
                  Enable 2FA
                </Button>
              </div>
            )}

            {tab === 'setup' && secret && (
              <div className="space-y-6 animate-in">
                <div>
                  <h3 className="text-lg font-semibold text-secondary-900 dark:text-white mb-4">
                    Scan QR code or enter setup key
                  </h3>
                  <div className="bg-secondary-100 dark:bg-secondary-800 rounded-lg p-6 text-center">
                    <div className="w-48 h-48 mx-auto mb-4 bg-white dark:bg-secondary-900 rounded-lg flex items-center justify-center">
                      {/* QR code would go here */}
                      <div className="text-secondary-400">QR Code Placeholder</div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <p className="text-secondary-600 dark:text-secondary-400">
                        Can't scan? Enter this key manually:
                      </p>
                      <div className="flex items-center gap-2 justify-center">
                        <code className="bg-white dark:bg-secondary-900 px-3 py-1.5 rounded font-mono text-sm break-all flex-1 text-left">
                          {secret.match(/.{1,4}/g)?.join(' ') || secret}
                        </code>
                        <Button variant="ghost" size="sm" onClick={copySecret}>
                          {copiedIndex === -1 ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-secondary-900 dark:text-white mb-4">
                    Backup codes
                  </h3>
                  <p className="text-sm text-secondary-600 dark:text-secondary-400 mb-4">
                    Save these codes in a safe place. Each code can be used once if you lose access to your authenticator app.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {backupCodes.map((code, index) => (
                      <button
                        key={index}
                        onClick={() => copyCode(index)}
                        className="bg-secondary-100 dark:bg-secondary-800 rounded-lg p-3 text-center hover:bg-secondary-200 dark:hover:bg-secondary-700 transition-colors"
                      >
                        <code className="font-mono text-lg tracking-widest text-secondary-900 dark:text-white">
                          {code.match(/.{1,4}/g)?.join(' ') || code}
                        </code>
                        {copiedIndex === index && (
                          <Check className="w-4 h-4 text-success-500 mx-auto mt-1" />
                        )}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 mt-4">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                      required
                    />
                    <span className="text-sm text-secondary-600 dark:text-secondary-400">
                      I've saved my backup codes
                    </span>
                  </label>
                </div>

                <Button onClick={handleVerify} size="lg" className="w-full" disabled={!showCodes}>
                  I've saved my backup codes, verify MFA
                </Button>
              </div>
            )}

            {tab === 'verify' && (
              <div className="space-y-6 animate-in">
                <form onSubmit={handleSubmitVerify(handleVerify)} className="space-y-6">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-secondary-900 dark:text-white">
                      Verify your authenticator app
                    </h3>
                    <p className="mt-2 text-secondary-600 dark:text-secondary-400">
                      Enter the 6-digit code from your authenticator app
                    </p>
                  </div>

                  <Input
                    {...registerVerify('code')}
                    type="text"
                    label="MFA Code"
                    placeholder="123456"
                    error={errorsVerify.code?.message}
                    autoComplete="one-time-code"
                    maxLength={6}
                    inputMode="numeric"
                    autoFocus
                  />

                  <Button type="submit" fullWidth loading={isSubmittingVerify} size="lg">
                    Verify
                  </Button>
                </form>
              </div>
            )}

            {tab === 'disable' && (
              <div className="space-y-6 animate-in">
                <div className="bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 rounded-lg p-4">
                  <div className="flex gap-3">
                    <AlertTriangle className="w-6 h-6 text-danger-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-danger-800 dark:text-danger-300">
                        Disable Two-Factor Authentication
                      </h3>
                      <p className="mt-1 text-sm text-danger-700 dark:text-danger-400">
                        Disabling 2FA will make your account less secure. You'll need to enter your password and a current MFA code to confirm.
                      </p>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSubmitDisable(handleDisable)} className="space-y-5">
                  <Input
                    {...registerDisable('password')}
                    type="password"
                    label="Current password"
                    placeholder="••••••••"
                    error={errorsDisable.password?.message}
                    autoComplete="current-password"
                  />

                  <Input
                    {...registerDisable('mfaCode')}
                    type="text"
                    label="Current MFA code"
                    placeholder="123456"
                    error={errorsDisable.mfaCode?.message}
                    autoComplete="one-time-code"
                    maxLength={6}
                    inputMode="numeric"
                  />

                  <Button type="submit" variant="danger" fullWidth loading={disableLoading || isSubmittingDisable} size="lg">
                    Disable 2FA
                  </Button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      <AlertDialog
        isOpen={showDisableDialog}
        onClose={() => setShowDisableDialog(false)}
        title="Disable 2FA?"
        message="This will remove two-factor authentication from your account. Are you sure?"
        confirmText="Disable"
      />
    </div>
  );
}