/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import { Button, Input, Typography } from '../components/ui';
import { TauriDragRegion } from '../components/layout/TauriDragRegion';
import { useAuthStore } from '../store';
import { trpc } from '../utils/trpc';

export function RegisterPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { setUser } = useAuthStore();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirmPassword?: string }>({});

  const { data: status } = trpc.auth.status.useQuery(undefined, {
    retry: 3,
    retryDelay: 1000,
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: (data) => {
      setUser(data);
      navigate('/onboarding/welcome');
    },
    onError: (err) => {
      setError(err.message || 'Could not create local password');
    },
  });

  // If local access already exists, setup is closed.
  if (status?.hasUser) {
    navigate('/login', { replace: true });
    return null;
  }

  const validate = (): boolean => {
    const errors: { password?: string; confirmPassword?: string } = {};
    if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters';
    }
    if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    registerMutation.mutate({ password, confirmPassword });
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
        css={css`width: 100%; max-width: 400px;`}
      >
        <img
          src="/favicon.svg"
          alt="Animus"
          css={css`
            display: block;
            margin: 0 auto ${theme.spacing[5]};
            width: 48px;
            height: 48px;
          `}
        />
        <Typography.Title serif css={css`text-align: center; margin-bottom: ${theme.spacing[1]};`}>
          Secure this Animus
        </Typography.Title>
        <Typography.Body color="secondary" css={css`text-align: center; margin-bottom: ${theme.spacing[8]};`}>
          Create a local password for this instance. It protects the credentials and memories Animus may hold.
        </Typography.Body>

        <form onSubmit={handleSubmit}>
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
              label="Local password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
              placeholder="Minimum 8 characters"
              error={fieldErrors.password}
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
              label="Confirm local password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
              placeholder="Re-enter your password"
              error={fieldErrors.confirmPassword}
              required
            />

            <Button
              type="submit"
              loading={registerMutation.isPending}
              css={css`width: 100%; margin-top: ${theme.spacing[2]};`}
            >
              Create local password
            </Button>

            <Typography.Caption as="p" color="hint" css={css`text-align: center;`}>
              No Animus account is created here. Store sign-in is separate.
            </Typography.Caption>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
