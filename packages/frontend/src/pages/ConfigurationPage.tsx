/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useRef, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, CircleNotch, Warning } from '@phosphor-icons/react';
import { Button, Typography, Badge } from '../components/ui';
import { trpc } from '../utils/trpc';
import { useConfigForm } from '../components/configuration/useConfigForm';
import { SetupGuide } from '../components/configuration/SetupGuide';
import { ConfigForm, type ConfigFormHandle } from '../components/configuration/ConfigForm';
import type { ConfigField } from '@animus-labs/shared';

interface ConfigurationPageProps {
  extensionType: 'channel' | 'plugin';
}

export function ConfigurationPage({ extensionType }: ConfigurationPageProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const { name } = useParams<{ name: string }>();
  const utils = trpc.useUtils();

  const formRef = useRef<ConfigFormHandle>(null);

  // ── Data fetching ──

  // Channel queries
  const channelSchema = trpc.channels.getConfigSchema.useQuery(
    { name: name! },
    { enabled: extensionType === 'channel' && !!name }
  );
  const channelConfig = trpc.channels.getConfig.useQuery(
    { name: name! },
    { enabled: extensionType === 'channel' && !!name }
  );
  const channelPackages = trpc.channels.listPackages.useQuery(
    undefined,
    { enabled: extensionType === 'channel' }
  );
  const channelConfigureMutation = trpc.channels.configure.useMutation({
    onSuccess: () => {
      utils.channels.getConfig.invalidate({ name: name! });
      utils.channels.listPackages.invalidate();
      navigate(-1);
    },
  });

  // Plugin queries
  const pluginConfigData = trpc.plugins.getConfig.useQuery(
    { name: name! },
    { enabled: extensionType === 'plugin' && !!name }
  );
  const pluginDetail = trpc.plugins.get.useQuery(
    { name: name! },
    { enabled: extensionType === 'plugin' && !!name }
  );
  const pluginSetConfigMutation = trpc.plugins.setConfig.useMutation({
    onSuccess: () => {
      utils.plugins.getConfig.invalidate({ name: name! });
      utils.plugins.list.invalidate();
      navigate(-1);
    },
  });

  // ── Derived state ──

  const isChannel = extensionType === 'channel';

  const fields: ConfigField[] = isChannel
    ? (channelSchema.data?.fields ?? [])
    : (pluginConfigData.data?.schema?.fields ?? []);

  const setupGuide = isChannel
    ? channelSchema.data?.setupGuide
    : pluginConfigData.data?.schema?.setupGuide;

  const currentConfig = isChannel
    ? channelConfig.data
    : (pluginConfigData.data?.values as Record<string, unknown> | undefined);

  const isLoading = isChannel
    ? (channelSchema.isLoading || channelConfig.isLoading)
    : pluginConfigData.isLoading;

  const hasSchema = fields.length > 0;
  const pluginHasNoSchema = !isChannel && pluginConfigData.data && !hasSchema;

  // Display name
  const displayName = useMemo(() => {
    if (isChannel) {
      const pkg = channelPackages.data?.find((c) => c.name === name);
      return pkg?.displayName ?? name ?? '';
    }
    return pluginDetail.data?.displayName ?? name ?? '';
  }, [isChannel, channelPackages.data, pluginDetail.data, name]);

  // Status badge
  const channelPkg = isChannel ? channelPackages.data?.find((c) => c.name === name) : null;
  const status = channelPkg?.status;

  // Check if already configured (all required fields have values)
  const isAlreadyConfigured = useMemo(() => {
    if (!currentConfig || isLoading) return false;
    const requiredFields = fields.filter((f) => f.required);
    if (requiredFields.length === 0) return false;
    return requiredFields.every((f) => {
      const val = currentConfig[f.key];
      return val !== undefined && val !== null && val !== '';
    });
  }, [currentConfig, fields, isLoading]);

  // ── Form state ──

  const {
    configValues,
    setConfigValues,
    showSecrets,
    toggleSecret,
    validationErrors,
    validateConfig,
  } = useConfigForm({
    fields,
    currentConfig,
    isLoading,
  });

  // Raw JSON state for plugins without schema
  const [rawJson, setRawJson] = useState('');
  const [rawJsonError, setRawJsonError] = useState('');
  const [rawJsonInitialized, setRawJsonInitialized] = useState(false);

  // Initialize raw JSON when plugin data arrives
  if (pluginHasNoSchema && pluginConfigData.data && !rawJsonInitialized) {
    setRawJson(JSON.stringify(pluginConfigData.data.values ?? {}, null, 2));
    setRawJsonInitialized(true);
  }

  // ── Handlers ──

  const handleSave = () => {
    if (pluginHasNoSchema) {
      try {
        const parsed = JSON.parse(rawJson || '{}');
        setRawJsonError('');
        pluginSetConfigMutation.mutate({ name: name!, config: parsed });
      } catch {
        setRawJsonError('Invalid JSON');
      }
      return;
    }

    if (!validateConfig()) return;

    if (isChannel) {
      channelConfigureMutation.mutate({ name: name!, config: configValues });
    } else {
      pluginSetConfigMutation.mutate({ name: name!, config: configValues });
    }
  };

  const handleCancel = () => navigate(-1);

  const handleFieldRef = (fieldKey: string) => {
    formRef.current?.scrollToField(fieldKey);
  };

  const handleFieldChange = (key: string, value: unknown) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  };

  const isSaving = isChannel
    ? channelConfigureMutation.isPending
    : pluginSetConfigMutation.isPending;

  const saveError = isChannel
    ? (channelConfigureMutation.isError ? (channelConfigureMutation.error?.message ?? 'Configuration failed') : undefined)
    : (pluginSetConfigMutation.isError ? (pluginSetConfigMutation.error?.message ?? 'Configuration failed') : undefined);

  // ── Status badge rendering ──

  const statusBadge = isChannel && status ? (() => {
    switch (status) {
      case 'connected':
        return <Badge variant="success"><CheckCircle size={12} weight="fill" css={css`margin-right: 4px;`} />Connected</Badge>;
      case 'error':
      case 'failed':
        return <Badge variant="error"><XCircle size={12} weight="fill" css={css`margin-right: 4px;`} />Error</Badge>;
      case 'starting':
        return <Badge variant="info"><CircleNotch size={12} css={css`margin-right: 4px; animation: spin 1s linear infinite; @keyframes spin { to { transform: rotate(360deg); } }`} />Starting</Badge>;
      case 'unconfigured':
        return <Badge variant="warning"><Warning size={12} weight="fill" css={css`margin-right: 4px;`} />Unconfigured</Badge>;
      default:
        return null;
    }
  })() : null;

  // ── Responsive: check for guide presence ──

  const hasGuide = !!setupGuide && setupGuide.steps.length > 0;

  return (
    <div css={css`
      max-width: 1200px;
      margin: 0 auto;
      padding: ${theme.spacing[6]};
      min-height: 100%;
    `}>
      {/* Header */}
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[3]};
        margin-bottom: ${theme.spacing[6]};
        flex-wrap: wrap;
      `}>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          css={css`padding: ${theme.spacing[1.5]};`}
        >
          <ArrowLeft size={18} />
        </Button>
        <Typography.Subtitle as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.semibold};
          flex: 1;
          min-width: 0;
        `}>
          Configure: {displayName}
        </Typography.Subtitle>
        {statusBadge}
      </div>

      {isLoading ? (
        <div css={css`
          display: flex;
          align-items: center;
          justify-content: center;
          padding: ${theme.spacing[12]};
        `}>
          <CircleNotch size={24} css={css`
            color: ${theme.colors.text.hint};
            animation: spin 1s linear infinite;
            @keyframes spin { to { transform: rotate(360deg); } }
          `} />
        </div>
      ) : (
        <div css={css`
          display: grid;
          gap: ${theme.spacing[8]};
          align-items: start;

          /* Two-column on wide, single on narrow */
          ${hasGuide ? css`
            @media (min-width: 1024px) {
              grid-template-columns: 5fr 7fr;
            }
          ` : css`
            max-width: 640px;
          `}
        `}>
          {/* Guide column */}
          {hasGuide && (
            <div css={css`
              padding: ${theme.spacing[5]};
              background: ${theme.colors.background.paper};
              border: 1px solid ${theme.colors.border.light};
              border-radius: ${theme.borderRadius.default};
            `}>
              <SetupGuide
                guide={setupGuide!}
                fields={fields}
                startCollapsed={isAlreadyConfigured}
                onFieldRef={handleFieldRef}
              />
            </div>
          )}

          {/* Form column — no card wrapper, sits directly on background */}
          <div>
            <ConfigForm
              ref={formRef}
              fields={fields}
              configValues={configValues}
              validationErrors={validationErrors}
              showSecrets={showSecrets}
              onChange={handleFieldChange}
              onToggleSecret={toggleSecret}
              onSave={handleSave}
              onCancel={handleCancel}
              isSaving={isSaving}
              saveError={saveError || undefined}
              rawJsonMode={pluginHasNoSchema ? true : undefined}
              rawJson={rawJson || undefined}
              onRawJsonChange={(json) => { setRawJson(json); setRawJsonError(''); }}
              rawJsonError={rawJsonError || undefined}
              pluginName={name}
            />
          </div>
        </div>
      )}
    </div>
  );
}
