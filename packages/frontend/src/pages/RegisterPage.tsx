/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import { Button, Input, Typography } from '../components/ui';
import { useAuthStore } from '../store';
import { trpc } from '../utils/trpc';

export function RegisterPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { setUser } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});

  const { data: status } = trpc.auth.status.useQuery(undefined, {
    retry: false,
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: (data) => {
      setUser(data);
      navigate('/onboarding/welcome');
    },
    onError: (err) => {
      setError(err.message || 'Registration failed');
    },
  });

  // If a user already exists, registration is closed
  if (status?.hasUser) {
    navigate('/login', { replace: true });
    return null;
  }

  const validate = (): boolean => {
    const errors: { email?: string; password?: string; confirmPassword?: string } = {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Enter a valid email address';
    }
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
    registerMutation.mutate({ email, password, confirmPassword });
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
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        css={css`width: 100%; max-width: 400px;`}
      >
        <Typography.Title serif css={css`text-align: center; margin-bottom: ${theme.spacing[1]};`}>
          Create your account
        </Typography.Title>
        <Typography.Body color="secondary" css={css`text-align: center; margin-bottom: ${theme.spacing[8]};`}>
          You'll be the only one who can access this Animus instance.
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
              error={fieldErrors.email}
              required
              autoFocus
            />

            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
              placeholder="Minimum 8 characters"
              error={fieldErrors.password}
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

            <Input
              label="Confirm password"
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
              Create Account
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
