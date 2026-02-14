/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useNavigate } from 'react-router-dom';
import { Button, Typography } from '../components/ui';

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
      gap: ${theme.spacing[2]};
      text-align: center;
    `}>
      <Typography.Title3 css={css`font-weight: ${theme.typography.fontWeight.light};`}>
        Nothing here
      </Typography.Title3>
      <Typography.Body color="secondary" css={css`margin-bottom: ${theme.spacing[4]};`}>
        This page doesn't exist.
      </Typography.Body>
      <Button onClick={() => navigate('/')}>Go home</Button>
    </div>
  );
}
