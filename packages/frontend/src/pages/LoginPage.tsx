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

export function LoginPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { setUser } = useAuthStore();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgotHelp, setShowForgotHelp] = useState(false);

  const { data: status } = trpc.auth.status.useQuery(undefined, {
    retry: 3,
    retryDelay: 1000,
  });

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      setUser(data);
      navigate('/');
    },
    onError: () => {
      setError('Wrong password');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    loginMutation.mutate({ password });
  };

  // If local access has not been configured yet, redirect to first-time setup.
  if (status && !status.hasUser) {
    navigate('/register', { replace: true });
    return null;
  }

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
          Enter local password
        </Typography.Title>
        <Typography.Body color="secondary" css={css`text-align: center; margin-bottom: ${theme.spacing[8]};`}>
          This opens the running Animus instance. It is not an Animus Store sign-in.
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
              loading={loginMutation.isPending}
              css={css`width: 100%; margin-top: ${theme.spacing[2]};`}
            >
              Continue
            </Button>
          </div>
        </form>

        <div css={css`text-align: center; margin-top: ${theme.spacing[6]};`}>
          <Typography.SmallBody
            as="button"
            type="button"
            color="hint"
            onClick={() => setShowForgotHelp(!showForgotHelp)}
            css={css`
              cursor: pointer;
              &:hover { color: ${theme.colors.text.secondary}; }
            `}
          >
            Forgot your password?
          </Typography.SmallBody>
          {showForgotHelp && (
            <Typography.Caption
              as={motion.p}
              color="hint"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              css={css`margin-top: ${theme.spacing[2]};`}
            >
              There is no recovery email. If this password is lost, the vault cannot be opened.
              Restore from a save or reset the application data to start again.
            </Typography.Caption>
          )}
        </div>
      </motion.div>
    </div>
  );
}
