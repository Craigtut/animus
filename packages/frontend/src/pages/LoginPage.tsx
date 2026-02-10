/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import { Button, Input } from '../components/ui';
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
    retry: false,
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
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        css={css`
          width: 100%;
          max-width: 400px;
        `}
      >
        <h1
          css={css`
            font-size: ${theme.typography.fontSize['3xl']};
            font-weight: ${theme.typography.fontWeight.light};
            text-align: center;
            margin-bottom: ${theme.spacing[1]};
          `}
        >
          Welcome back
        </h1>
        <p
          css={css`
            text-align: center;
            color: ${theme.colors.text.secondary};
            font-size: ${theme.typography.fontSize.base};
            margin-bottom: ${theme.spacing[8]};
          `}
        >
          Sign in to your Animus instance.
        </p>

        <form onSubmit={handleSubmit}>
          {error && (
            <div
              css={css`
                padding: ${theme.spacing[3]} ${theme.spacing[4]};
                background: ${theme.colors.error.main}12;
                border: 1px solid ${theme.colors.error.main}40;
                border-radius: ${theme.borderRadius.default};
                color: ${theme.colors.error.main};
                font-size: ${theme.typography.fontSize.sm};
                margin-bottom: ${theme.spacing[4]};
              `}
            >
              {error}
            </div>
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
          <button
            type="button"
            onClick={() => setShowForgotHelp(!showForgotHelp)}
            css={css`
              font-size: ${theme.typography.fontSize.sm};
              color: ${theme.colors.text.hint};
              cursor: pointer;
              &:hover { color: ${theme.colors.text.secondary}; }
            `}
          >
            Forgot your password?
          </button>
          {showForgotHelp && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              css={css`
                font-size: ${theme.typography.fontSize.xs};
                color: ${theme.colors.text.hint};
                margin-top: ${theme.spacing[2]};
                line-height: ${theme.typography.lineHeight.relaxed};
              `}
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
            </motion.p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
