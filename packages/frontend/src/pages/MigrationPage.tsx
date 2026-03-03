/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Eye, EyeSlash, ShieldCheck } from '@phosphor-icons/react';
import { Button, Input, Typography } from '../components/ui';
import { TauriDragRegion } from '../components/layout/TauriDragRegion';
import { useAuthStore } from '../store';
import { trpc } from '../utils/trpc';

export function MigrationPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { setUser } = useAuthStore();
  const utils = trpc.useUtils();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect away if migration is no longer needed
  const { data: sealStatus } = trpc.seal.status.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const migrateMutation = trpc.seal.migrate.useMutation({
    onSuccess: async (data) => {
      if (data.user) {
        setUser(data.user);
      }
      // Invalidate cached seal status so AuthGuard sees 'unsealed'
      await utils.seal.status.invalidate();
      navigate('/');
    },
    onError: (err) => {
      setError(err.message || 'Migration failed');
    },
  });

  // All hooks above — safe to return early now
  if (sealStatus && sealStatus.sealState !== 'needs-migration') {
    if (sealStatus.sealState === 'sealed') {
      return <Navigate to="/unlock" replace />;
    }
    return <Navigate to="/" replace />;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    migrateMutation.mutate({ password });
  };

  return (
    <div
      css={css`
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: ${theme.spacing[6]};
        background: ${theme.colors.background.default};
      `}
    >
      <TauriDragRegion />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        css={css`
          width: 100%;
          max-width: 440px;
        `}
      >
        <div
          css={css`
            display: flex;
            justify-content: center;
            margin-bottom: ${theme.spacing[5]};
          `}
        >
          <ShieldCheck size={48} weight="duotone" color={theme.colors.text.hint} />
        </div>
        <Typography.Title serif css={css`text-align: center; margin-bottom: ${theme.spacing[1]};`}>
          Encryption Upgrade
        </Typography.Title>
        <Typography.Body color="secondary" css={css`text-align: center;`}>
          Animus has upgraded its encryption system. Choose a password to protect your stored
          credentials. This password will be required to unlock the server on each start.
        </Typography.Body>

        <form onSubmit={handleSubmit} css={css`margin-top: ${theme.spacing[8]};`}>
          {error && (
            <Typography.SmallBody
              as="div"
              color={theme.colors.error.main}
              css={css`
                padding: ${theme.spacing[3]} ${theme.spacing[4]};
                background: ${theme.colors.error.main}12;
                border: 1px solid ${theme.colors.error.main}40;
                border-radius: ${theme.borderRadius.default};
                margin-bottom: ${theme.spacing[4]};
              `}
            >
              {error}
            </Typography.SmallBody>
          )}

          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
              placeholder="At least 8 characters"
              required
              autoFocus
              rightElement={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  css={css`
                    color: ${theme.colors.text.hint};
                    transition: color ${theme.transitions.fast};
                    display: flex;
                    padding: 0;
                    &:hover { color: ${theme.colors.text.primary}; }
                  `}
                >
                  {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              }
            />

            <Input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
              placeholder="Enter password again"
              required
            />

            <Button
              type="submit"
              loading={migrateMutation.isPending}
              css={css`width: 100%; margin-top: ${theme.spacing[2]};`}
            >
              {migrateMutation.isPending ? 'Migrating...' : 'Upgrade Encryption'}
            </Button>
          </div>
        </form>

        <Typography.Caption
          as="p"
          color="hint"
          style={{ textAlign: 'center', marginTop: theme.spacing[3] }}
        >
          Your existing credentials will be re-encrypted with a key derived from this password.
          For automated environments, set ANIMUS_UNLOCK_PASSWORD in your .env file.
        </Typography.Caption>
      </motion.div>
    </div>
  );
}
