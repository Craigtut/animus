/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui';

export function NotFoundPage() {
  const theme = useTheme();
  const navigate = useNavigate();

  return (
    <div css={css`
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: ${theme.spacing[6]};
      text-align: center;
    `}>
      <h1 css={css`font-size: ${theme.typography.fontSize['2xl']}; font-weight: ${theme.typography.fontWeight.light}; margin-bottom: ${theme.spacing[2]};`}>
        Nothing here
      </h1>
      <p css={css`color: ${theme.colors.text.secondary}; margin-bottom: ${theme.spacing[6]};`}>
        This page doesn't exist.
      </p>
      <Button onClick={() => navigate('/')}>Go home</Button>
    </div>
  );
}
