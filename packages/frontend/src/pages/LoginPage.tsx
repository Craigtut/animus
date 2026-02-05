/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Eye, EyeSlash } from '@phosphor-icons/react';

export function LoginPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // TODO: Implement actual login via tRPC
      console.log('Login attempt:', { email, password });

      // Simulate login delay
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Navigate to dashboard on success
      navigate('/dashboard');
    } catch (err) {
      setError('Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      css={css`
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: ${theme.spacing[6]};
      `}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        css={css`
          width: 100%;
          max-width: 400px;
          padding: ${theme.spacing[8]};
          background: ${theme.colors.background.paper};
          border: 1px solid ${theme.colors.border.default};
          border-radius: ${theme.borderRadius.lg};
        `}
      >
        <h1
          css={css`
            font-size: ${theme.typography.fontSize['2xl']};
            font-weight: ${theme.typography.fontWeight.semibold};
            text-align: center;
            margin-bottom: ${theme.spacing[6]};
          `}
        >
          Sign in to Animus
        </h1>

        <form onSubmit={handleSubmit}>
          {error && (
            <div
              css={css`
                padding: ${theme.spacing[3]} ${theme.spacing[4]};
                background: ${theme.colors.error.dark}33;
                border: 1px solid ${theme.colors.error.main};
                border-radius: ${theme.borderRadius.default};
                color: ${theme.colors.error.light};
                font-size: ${theme.typography.fontSize.sm};
                margin-bottom: ${theme.spacing[4]};
              `}
            >
              {error}
            </div>
          )}

          <div
            css={css`
              margin-bottom: ${theme.spacing[4]};
            `}
          >
            <label
              htmlFor="email"
              css={css`
                display: block;
                font-size: ${theme.typography.fontSize.sm};
                font-weight: ${theme.typography.fontWeight.medium};
                color: ${theme.colors.text.secondary};
                margin-bottom: ${theme.spacing[2]};
              `}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              css={css`
                width: 100%;
                padding: ${theme.spacing[3]};
                background: ${theme.colors.background.default};
                border: 1px solid ${theme.colors.border.light};
                border-radius: ${theme.borderRadius.default};
                color: ${theme.colors.text.primary};
                transition: border-color ${theme.transitions.fast};

                &:focus {
                  outline: none;
                  border-color: ${theme.colors.primary[500]};
                }

                &::placeholder {
                  color: ${theme.colors.text.disabled};
                }
              `}
              placeholder="you@example.com"
            />
          </div>

          <div
            css={css`
              margin-bottom: ${theme.spacing[6]};
            `}
          >
            <label
              htmlFor="password"
              css={css`
                display: block;
                font-size: ${theme.typography.fontSize.sm};
                font-weight: ${theme.typography.fontWeight.medium};
                color: ${theme.colors.text.secondary};
                margin-bottom: ${theme.spacing[2]};
              `}
            >
              Password
            </label>
            <div
              css={css`
                position: relative;
              `}
            >
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                css={css`
                  width: 100%;
                  padding: ${theme.spacing[3]};
                  padding-right: ${theme.spacing[10]};
                  background: ${theme.colors.background.default};
                  border: 1px solid ${theme.colors.border.light};
                  border-radius: ${theme.borderRadius.default};
                  color: ${theme.colors.text.primary};
                  transition: border-color ${theme.transitions.fast};

                  &:focus {
                    outline: none;
                    border-color: ${theme.colors.primary[500]};
                  }
                `}
                placeholder="Enter your password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                css={css`
                  position: absolute;
                  right: ${theme.spacing[3]};
                  top: 50%;
                  transform: translateY(-50%);
                  color: ${theme.colors.text.secondary};
                  transition: color ${theme.transitions.fast};

                  &:hover {
                    color: ${theme.colors.text.primary};
                  }
                `}
              >
                {showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            css={css`
              width: 100%;
              padding: ${theme.spacing[3]};
              background: ${theme.colors.primary[600]};
              color: white;
              font-weight: ${theme.typography.fontWeight.medium};
              border-radius: ${theme.borderRadius.default};
              transition: background ${theme.transitions.fast};

              &:hover:not(:disabled) {
                background: ${theme.colors.primary[500]};
              }

              &:disabled {
                opacity: 0.7;
                cursor: not-allowed;
              }
            `}
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p
          css={css`
            text-align: center;
            margin-top: ${theme.spacing[6]};
            font-size: ${theme.typography.fontSize.sm};
            color: ${theme.colors.text.secondary};
          `}
        >
          Don't have an account?{' '}
          <Link
            to="/register"
            css={css`
              color: ${theme.colors.primary[400]};
            `}
          >
            Sign up
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
