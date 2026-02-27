/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';

interface BaseInputProps {
  label?: string | undefined;
  error?: string | undefined;
  helperText?: string | undefined;
  rightElement?: ReactNode | undefined;
}

type TextInputProps = BaseInputProps & InputHTMLAttributes<HTMLInputElement> & {
  multiline?: false;
};

type TextareaProps = BaseInputProps & TextareaHTMLAttributes<HTMLTextAreaElement> & {
  multiline: true;
};

type InputProps = TextInputProps | TextareaProps;

export const Input = forwardRef<HTMLInputElement | HTMLTextAreaElement, InputProps>(
  (props, ref) => {
    const { label, error, helperText, rightElement, multiline, ...rest } = props;
    const theme = useTheme();

    const inputCss = css`
      width: 100%;
      padding: ${theme.spacing[3]};
      ${rightElement ? `padding-right: ${theme.spacing[10]};` : ''}
      background: ${theme.colors.background.paper};
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid ${error ? theme.colors.error.main : theme.colors.border.default};
      border-radius: ${theme.borderRadius.default};
      color: ${theme.colors.text.primary};
      font-size: ${theme.typography.fontSize.base};
      line-height: ${theme.typography.lineHeight.normal};
      transition: border-color ${theme.transitions.fast};
      outline: none;

      &:focus {
        border-color: ${error ? theme.colors.error.main : theme.colors.border.focus};
      }

      &::placeholder {
        color: ${theme.colors.text.hint};
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Strip native number input spinners (macOS WebKit, Chrome, Firefox) */
      &[type='number'] {
        -moz-appearance: textfield;
        appearance: textfield;
      }
      &[type='number']::-webkit-inner-spin-button,
      &[type='number']::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
    `;

    return (
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]};`}>
        {label && (
          <label
            css={css`
              font-size: ${theme.typography.fontSize.sm};
              font-weight: ${theme.typography.fontWeight.medium};
              color: ${theme.colors.text.secondary};
            `}
          >
            {label}
          </label>
        )}
        <div css={css`position: relative;`}>
          {multiline ? (
            <textarea
              ref={ref as React.Ref<HTMLTextAreaElement>}
              css={css`
                ${inputCss}
                resize: vertical;
                min-height: 100px;
              `}
              {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
          ) : (
            <input
              ref={ref as React.Ref<HTMLInputElement>}
              css={inputCss}
              {...(rest as InputHTMLAttributes<HTMLInputElement>)}
            />
          )}
          {rightElement && (
            <div
              css={css`
                position: absolute;
                right: ${theme.spacing[3]};
                top: 50%;
                transform: translateY(-50%);
                display: flex;
                align-items: center;
              `}
            >
              {rightElement}
            </div>
          )}
        </div>
        {error && (
          <span css={css`
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.error.main};
          `}>
            {error}
          </span>
        )}
        {helperText && !error && (
          <span css={css`
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.hint};
          `}>
            {helperText}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
