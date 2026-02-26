/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Button, Typography } from '../ui';
import { ConfigField } from './ConfigField';
import type { ConfigField as ConfigFieldType } from '@animus-labs/shared';

export interface ConfigFormHandle {
  scrollToField: (fieldKey: string) => void;
}

interface ConfigFormProps {
  fields: ConfigFieldType[];
  configValues: Record<string, unknown>;
  validationErrors: Record<string, string>;
  showSecrets: Record<string, boolean>;
  onChange: (key: string, value: unknown) => void;
  onToggleSecret: (key: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  saveError?: string | undefined;
  /** When true, show raw JSON editor instead of schema form */
  rawJsonMode?: boolean | undefined;
  rawJson?: string | undefined;
  onRawJsonChange?: ((json: string) => void) | undefined;
  rawJsonError?: string | undefined;
  /** Plugin/extension name, passed to OAuth fields */
  pluginName?: string | undefined;
}

export const ConfigForm = forwardRef<ConfigFormHandle, ConfigFormProps>(
  ({
    fields,
    configValues,
    validationErrors,
    showSecrets,
    onChange,
    onToggleSecret,
    onSave,
    onCancel,
    isSaving,
    saveError,
    rawJsonMode,
    rawJson,
    onRawJsonChange,
    rawJsonError,
    pluginName,
  }, ref) => {
    const theme = useTheme();
    const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [highlightedField, setHighlightedField] = useState<string | null>(null);

    const scrollToField = useCallback((fieldKey: string) => {
      const el = fieldRefs.current[fieldKey];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedField(fieldKey);
        setTimeout(() => setHighlightedField(null), 1500);
      }
    }, []);

    useImperativeHandle(ref, () => ({ scrollToField }), [scrollToField]);

    // Group fields
    const groupOrder: string[] = [];
    const groups: Record<string, ConfigFieldType[]> = {};
    const ungrouped: ConfigFieldType[] = [];

    for (const field of fields) {
      if (field.group) {
        const g = field.group;
        if (!groups[g]) {
          groups[g] = [];
          groupOrder.push(g);
        }
        groups[g]!.push(field);
      } else {
        ungrouped.push(field);
      }
    }

    if (rawJsonMode) {
      return (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <Typography.SmallBody color="secondary">
            This extension does not define a config schema. Edit the raw JSON below.
          </Typography.SmallBody>
          <textarea
            value={rawJson}
            onChange={(e) => onRawJsonChange?.(e.target.value)}
            rows={12}
            css={css`
              font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
              font-size: ${theme.typography.fontSize.sm};
              padding: ${theme.spacing[3]};
              border-radius: ${theme.borderRadius.default};
              border: 1px solid ${rawJsonError ? theme.colors.error.main : theme.colors.border.default};
              background: ${theme.colors.background.paper};
              color: ${theme.colors.text.primary};
              resize: vertical;
              width: 100%;
              box-sizing: border-box;
              &:focus {
                outline: none;
                border-color: ${rawJsonError ? theme.colors.error.main : theme.colors.border.focus};
              }
            `}
          />
          {rawJsonError && (
            <Typography.Caption color={theme.colors.error.main}>{rawJsonError}</Typography.Caption>
          )}

          {saveError && (
            <div css={css`
              padding: ${theme.spacing[2]} ${theme.spacing[4]};
              background: ${theme.colors.error.main}1a;
              border-radius: ${theme.borderRadius.default};
            `}>
              <Typography.SmallBody color={theme.colors.error.main}>{saveError}</Typography.SmallBody>
            </div>
          )}

          <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
            <Button variant="ghost" size="sm" onClick={onCancel} type="button">Cancel</Button>
            <Button size="sm" onClick={onSave} loading={isSaving}>Save</Button>
          </div>
        </div>
      );
    }

    return (
      <form
        onSubmit={(e) => { e.preventDefault(); onSave(); }}
        css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}
      >
        {fields.length === 0 ? (
          <Typography.SmallBody color="secondary">
            This extension has no configurable settings.
          </Typography.SmallBody>
        ) : (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
            {/* Ungrouped fields first */}
            {ungrouped.length > 0 && (
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
                {ungrouped.map((field) => (
                  <ConfigField
                    key={field.key}
                    ref={(el) => { fieldRefs.current[field.key] = el; }}
                    field={field}
                    value={configValues[field.key]}
                    error={validationErrors[field.key] || undefined}
                    showSecret={showSecrets[field.key] ?? undefined}
                    highlighted={highlightedField === field.key}
                    onChange={onChange}
                    onToggleSecret={onToggleSecret}
                    pluginName={pluginName}
                    configValues={configValues}
                  />
                ))}
              </div>
            )}

            {/* Grouped fields */}
            {groupOrder.map((groupName, gi) => (
              <div key={groupName} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
                {/* Group header — subtle label with divider */}
                <div css={css`
                  display: flex;
                  align-items: center;
                  gap: ${theme.spacing[2]};
                  ${(ungrouped.length > 0 || gi > 0) ? css`
                    padding-top: ${theme.spacing[1]};
                    border-top: 1px solid ${theme.colors.border.light};
                  ` : ''}
                `}>
                  <Typography.Caption as="span" css={css`
                    font-weight: ${theme.typography.fontWeight.semibold};
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    color: ${theme.colors.text.hint};
                    white-space: nowrap;
                    padding-top: ${(ungrouped.length > 0 || gi > 0) ? theme.spacing[2] : '0'};
                  `}>
                    {groupName}
                  </Typography.Caption>
                </div>

                {groups[groupName]!.map((field) => (
                  <ConfigField
                    key={field.key}
                    ref={(el) => { fieldRefs.current[field.key] = el; }}
                    field={field}
                    value={configValues[field.key]}
                    error={validationErrors[field.key] || undefined}
                    showSecret={showSecrets[field.key] ?? undefined}
                    highlighted={highlightedField === field.key}
                    onChange={onChange}
                    onToggleSecret={onToggleSecret}
                    pluginName={pluginName}
                    configValues={configValues}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {saveError && (
          <div css={css`
            padding: ${theme.spacing[2]} ${theme.spacing[4]};
            background: ${theme.colors.error.main}1a;
            border-radius: ${theme.borderRadius.default};
          `}>
            <Typography.SmallBody color={theme.colors.error.main}>{saveError}</Typography.SmallBody>
          </div>
        )}

        <div css={css`
          display: flex;
          gap: ${theme.spacing[3]};
          justify-content: flex-end;
          padding-top: ${theme.spacing[4]};
          border-top: 1px solid ${theme.colors.border.light};
        `}>
          <Button variant="ghost" size="sm" onClick={onCancel} type="button">Cancel</Button>
          <Button size="sm" type="submit" loading={isSaving} disabled={fields.length === 0}>
            Save Configuration
          </Button>
        </div>
      </form>
    );
  }
);

ConfigForm.displayName = 'ConfigForm';
