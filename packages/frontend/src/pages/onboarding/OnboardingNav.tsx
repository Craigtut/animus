/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { Button } from '../../components/ui';

interface OnboardingNavProps {
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  onSkip?: () => void;
}

/**
 * Unified sticky navigation bar for onboarding steps.
 *
 * Rendered by each step as the last child of its content. Uses `position: fixed`
 * at the bottom of the viewport so it floats over scrollable content. A gradient
 * fade blends seamlessly into the warm canvas background.
 *
 * The inner content is constrained to the same max-width as the onboarding
 * content column (640px / 720px on lg) so Back and Continue align with form fields.
 */
export function OnboardingNav({
  onBack,
  onContinue,
  continueLabel = 'Continue',
  continueDisabled = false,
  continueLoading = false,
  onSkip,
}: OnboardingNavProps) {
  const theme = useTheme();

  // RGB base for gradient — must match the opaque canvas background.
  const gradientBase =
    theme.mode === 'light'
      ? '250, 249, 244' // #FAF9F4
      : '28, 26, 24'; // #1C1A18

  // Portal to document.body so the fixed nav isn't affected by
  // transform: translateX() on the page-transition motion.div.
  return createPortal(
    <div
      role="navigation"
      aria-label="Onboarding navigation"
      css={css`
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: ${theme.zIndex.sticky};
        pointer-events: none;
      `}
    >
      {/* Gradient fade from transparent to opaque canvas */}
      <div
        css={css`
          height: 48px;
          background: linear-gradient(
            to bottom,
            rgba(${gradientBase}, 0),
            rgba(${gradientBase}, 0.92)
          );

          @media (max-width: ${theme.breakpoints.md}) {
            height: 40px;
          }
        `}
      />

      {/* Solid bar with backdrop blur for depth */}
      <div
        css={css`
          background: rgba(${gradientBase}, 0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          pointer-events: auto;
          padding: ${theme.spacing[4]} ${theme.spacing[6]} ${theme.spacing[8]};
          padding-bottom: max(
            ${theme.spacing[8]},
            calc(env(safe-area-inset-bottom, 0px) + ${theme.spacing[6]})
          );

          @media (max-width: ${theme.breakpoints.md}) {
            padding: ${theme.spacing[3]} ${theme.spacing[4]} ${theme.spacing[6]};
            padding-bottom: max(
              ${theme.spacing[6]},
              calc(env(safe-area-inset-bottom, 0px) + ${theme.spacing[5]})
            );
          }
        `}
      >
        {/* Inner content constrained to match the content column */}
        <div
          css={css`
            max-width: 640px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            justify-content: space-between;

            @media (min-width: ${theme.breakpoints.lg}) {
              max-width: 720px;
            }
          `}
        >
          {/* Left side: Back button */}
          <div css={css`min-width: 40px;`}>
            {onBack && (
              <motion.button
                onClick={onBack}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.94 }}
                transition={{ duration: 0.1 }}
                aria-label="Go back"
                css={css`
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  width: 40px;
                  height: 40px;
                  border-radius: ${theme.borderRadius.full};
                  border: none;
                  background: transparent;
                  color: ${theme.colors.text.secondary};
                  cursor: pointer;
                  font-family: inherit;
                  transition: all ${theme.transitions.fast};

                  &:hover {
                    background: ${theme.colors.background.elevated};
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    color: ${theme.colors.text.primary};
                  }

                  &:focus-visible {
                    outline: 2px solid ${theme.colors.border.focus};
                    outline-offset: 2px;
                  }
                `}
              >
                <ArrowLeft size={20} />
              </motion.button>
            )}
          </div>

          {/* Right side: Skip + Continue */}
          <div
            css={css`
              display: flex;
              align-items: center;
              gap: ${theme.spacing[3]};
            `}
          >
            {onSkip && (
              <button
                onClick={onSkip}
                css={css`
                  font-size: ${theme.typography.fontSize.sm};
                  color: ${theme.colors.text.hint};
                  cursor: pointer;
                  border: none;
                  background: none;
                  padding: ${theme.spacing[1]} ${theme.spacing[2]};
                  font-family: inherit;
                  transition: color ${theme.transitions.fast};

                  &:hover {
                    color: ${theme.colors.text.secondary};
                  }

                  &:focus-visible {
                    outline: 2px solid ${theme.colors.border.focus};
                    outline-offset: 2px;
                    border-radius: ${theme.borderRadius.sm};
                  }
                `}
              >
                Skip
              </button>
            )}
            <Button
              onClick={onContinue}
              disabled={continueDisabled}
              loading={continueLoading}
              css={css`
                min-width: 120px;
              `}
            >
              {continueLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
