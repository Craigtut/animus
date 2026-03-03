/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Eye, EyeSlash, LockKey } from '@phosphor-icons/react';
import { Button, Input, Typography } from '../components/ui';
import { TauriDragRegion } from '../components/layout/TauriDragRegion';
import { useAuthStore } from '../store';
import { trpc } from '../utils/trpc';

export function UnlockPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { setUser } = useAuthStore();
  const utils = trpc.useUtils();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect away if vault is not actually sealed
  const { data: sealStatus } = trpc.seal.status.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const unlockMutation = trpc.seal.unlock.useMutation({
    onSuccess: async (data) => {
      if (data.user) {
        setUser(data.user);
      }
      // Invalidate cached seal status so AuthGuard sees 'unsealed'
      await utils.seal.status.invalidate();
      navigate('/');
    },
    onError: (err) => {
      setError(err.message || 'Wrong password');
    },
  });

  // All hooks above — safe to return early now
  if (sealStatus && sealStatus.sealState !== 'sealed') {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    unlockMutation.mutate({ password });
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
          max-width: 400px;
        `}
      >
        <div
          css={css`
            display: flex;
            justify-content: center;
            margin-bottom: ${theme.spacing[5]};
          `}
        >
          <LockKey size={48} weight="duotone" color={theme.colors.text.hint} />
        </div>
        <Typography.Title serif css={css`text-align: center; margin-bottom: ${theme.spacing[1]};`}>
          Unlock Animus
        </Typography.Title>
        <Typography.Body color="secondary" css={css`text-align: center;`}>
          Enter your password to unlock the encryption vault.
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
              placeholder="Enter your password"
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

            <Button
              type="submit"
              loading={unlockMutation.isPending}
              css={css`width: 100%; margin-top: ${theme.spacing[2]};`}
            >
              Unlock
            </Button>
          </div>
        </form>

        <Typography.Caption
          as="p"
          color="hint"
          style={{ textAlign: 'center', marginTop: theme.spacing[3] }}
        >
          Your encryption key is derived from this password. It exists only in memory while the server is running.
        </Typography.Caption>
      </motion.div>
    </div>
  );
}
