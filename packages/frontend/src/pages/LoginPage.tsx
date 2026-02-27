/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

  const [email, setEmail] = useState('');
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
      setError('Invalid email or password');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    loginMutation.mutate({ email, password });
  };

  // If no user exists yet, redirect to register
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
          Welcome back
        </Typography.Title>
        <Typography.Body color="secondary" css={css`text-align: center; margin-bottom: ${theme.spacing[8]};`}>
          Sign in to your Animus instance.
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
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
              placeholder="you@example.com"
              required
              autoFocus
            />

            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
              placeholder="Enter your password"
              required
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
              Sign in
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
              Since Animus is self-hosted, you can reset your password from the
              server terminal. Run{' '}
              <code css={css`
                font-family: ${theme.typography.fontFamily.mono};
                background: ${theme.colors.background.elevated};
                padding: 0.15em 0.4em;
                border-radius: ${theme.borderRadius.sm};
                font-size: 0.9em;
              `}>
                npm run reset-password
              </code>{' '}
              in the project directory.
            </Typography.Caption>
          )}
        </div>
      </motion.div>
    </div>
  );
}
