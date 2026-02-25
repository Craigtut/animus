/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowSquareOut, CaretDown, CaretRight, ArrowRight } from '@phosphor-icons/react';
import { Typography } from '../ui';
import { CopyableCodeBlock } from './CopyableCodeBlock';
import { trpc } from '../../utils/trpc';
import type { SetupGuide as SetupGuideType, ConfigField } from '@animus-labs/shared';

interface SetupGuideProps {
  guide: SetupGuideType;
  fields: ConfigField[];
  startCollapsed?: boolean;
  onFieldRef?: (fieldKey: string) => void;
}

/** Replace {{name}} template variables with the persona's configured name. */
function resolveTemplates(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export function SetupGuide({ guide, fields, startCollapsed = false, onFieldRef }: SetupGuideProps) {
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const { data: persona } = trpc.persona.get.useQuery();

  const templateVars = useMemo<Record<string, string>>(() => ({
    name: persona?.name ?? 'Animus',
  }), [persona?.name]);

  const fieldsByKey = Object.fromEntries(fields.map((f) => [f.key, f]));

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[2]};
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          color: ${theme.colors.text.primary};
        `}
      >
        {collapsed ? <CaretRight size={16} weight="bold" /> : <CaretDown size={16} weight="bold" />}
        <Typography.Subtitle as="span" css={css`
          font-size: ${theme.typography.fontSize.sm};
          font-weight: ${theme.typography.fontWeight.semibold};
          text-transform: uppercase;
          letter-spacing: 0.05em;
        `}>
          Setup Guide
        </Typography.Subtitle>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            css={css`overflow: hidden;`}
          >
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
              {/* Description */}
              {guide.description && (
                <Typography.SmallBody color="secondary">
                  {resolveTemplates(guide.description, templateVars)}
                </Typography.SmallBody>
              )}

              {/* Steps */}
              {guide.steps.map((step, index) => (
                <div
                  key={index}
                  css={css`
                    display: flex;
                    gap: ${theme.spacing[3]};
                  `}
                >
                  {/* Step number */}
                  <div css={css`
                    flex-shrink: 0;
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    background: ${theme.colors.accent};
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 13px;
                    font-weight: ${theme.typography.fontWeight.semibold};
                    margin-top: 1px;
                  `}>
                    {index + 1}
                  </div>

                  {/* Step content */}
                  <div css={css`
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    gap: ${theme.spacing[2]};
                  `}>
                    <Typography.SmallBody css={css`
                      font-weight: ${theme.typography.fontWeight.semibold};
                      color: ${theme.colors.text.primary};
                    `}>
                      {step.title}
                    </Typography.SmallBody>

                    <Typography.Caption as="p" color="secondary" css={css`line-height: 1.6;`}>
                      {resolveTemplates(step.body, templateVars)}
                    </Typography.Caption>

                    {/* Manifest code block */}
                    {step.manifest && (
                      <CopyableCodeBlock code={resolveTemplates(step.manifest, templateVars)} />
                    )}

                    {/* Actions row: link + field ref */}
                    <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[2]}; align-items: center;`}>
                      {step.link && (
                        <a
                          href={step.link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          css={css`
                            display: inline-flex;
                            align-items: center;
                            gap: 4px;
                            padding: 4px 10px;
                            border-radius: ${theme.borderRadius.sm};
                            border: 1px solid ${theme.colors.border.default};
                            background: ${theme.colors.background.paper};
                            color: ${theme.colors.accent};
                            font-size: 12px;
                            font-weight: ${theme.typography.fontWeight.medium};
                            text-decoration: none;
                            transition: all 150ms;
                            &:hover {
                              background: ${theme.colors.background.elevated};
                              border-color: ${theme.colors.accent};
                            }
                          `}
                        >
                          {step.link.label} <ArrowSquareOut size={12} />
                        </a>
                      )}

                      {step.fieldRef && fieldsByKey[step.fieldRef] && onFieldRef && (
                        <button
                          type="button"
                          onClick={() => onFieldRef(step.fieldRef!)}
                          css={css`
                            display: inline-flex;
                            align-items: center;
                            gap: 4px;
                            padding: 4px 10px;
                            border-radius: ${theme.borderRadius.sm};
                            border: 1px solid ${theme.colors.border.default};
                            background: ${theme.colors.background.paper};
                            color: ${theme.colors.text.secondary};
                            font-size: 12px;
                            font-weight: ${theme.typography.fontWeight.medium};
                            cursor: pointer;
                            transition: all 150ms;
                            &:hover {
                              background: ${theme.colors.background.elevated};
                              color: ${theme.colors.text.primary};
                            }
                          `}
                        >
                          Fill in <ArrowRight size={11} weight="bold" /> {fieldsByKey[step.fieldRef!]!.label}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
