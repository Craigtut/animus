/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CircleNotch,
  MagnifyingGlass,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import type { PackageSettingsSurface, PackageType, ConfigField } from '@animus-labs/shared';
import { Button, Input, Select, Typography, Badge } from '../components/ui';
import { ConfigForm } from '../components/configuration/ConfigForm';
import { useConfigForm } from '../components/configuration/useConfigForm';
import { trpc } from '../utils/trpc';

interface PackageSettingsPageProps {
  packageType: PackageType;
}

type EntityMode = 'always' | 'changed' | 'condition';

interface EntitySearchResult {
  entityId: string;
  name: string;
  domain: string | undefined;
  area: string | undefined;
  deviceClass: string | undefined;
  state: string | undefined;
  unit: string | undefined;
  lastUpdated: string | undefined;
}

interface MonitoredEntity extends EntitySearchResult {
  mode: EntityMode;
  condition?: {
    operator: string;
    value?: string;
  };
}

interface PreviewResult {
  text: string | undefined;
  tokenEstimate: number | undefined;
  lines: string[] | undefined;
}

const modeOptions = [
  { value: 'always', label: 'Always' },
  { value: 'changed', label: 'When changed' },
  { value: 'condition', label: 'When condition matches' },
];

const conditionOptions = [
  { value: 'lt', label: 'Below' },
  { value: 'lte', label: 'At or below' },
  { value: 'gt', label: 'Above' },
  { value: 'gte', label: 'At or above' },
  { value: 'eq', label: 'Equals' },
  { value: 'neq', label: 'Does not equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'unavailable', label: 'Unavailable' },
];

const domainOptions = [
  { value: '', label: 'All domains' },
  { value: 'sensor', label: 'Sensors' },
  { value: 'binary_sensor', label: 'Binary sensors' },
  { value: 'light', label: 'Lights' },
  { value: 'climate', label: 'Climate' },
  { value: 'switch', label: 'Switches' },
  { value: 'plant', label: 'Plants' },
];

function settingsKey(surface: PackageSettingsSurface): string {
  return surface.settingsKey ?? surface.id;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeEntities(value: unknown): MonitoredEntity[] {
  if (!Array.isArray(value)) return [];
  return value
	    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
	    .map((item) => {
	      const entityId = String(item['entityId'] ?? item['entity_id'] ?? '');
	      const name = String(item['name'] ?? item['friendlyName'] ?? entityId);
	      const mode: EntityMode = item['mode'] === 'changed' || item['mode'] === 'condition' ? item['mode'] : 'always';
	      const condition = asRecord(item['condition']);
	      return {
	        entityId,
	        name,
	        domain: typeof item['domain'] === 'string' ? item['domain'] : entityId.split('.')[0],
	        area: typeof item['area'] === 'string' ? item['area'] : undefined,
	        deviceClass: typeof item['deviceClass'] === 'string' ? item['deviceClass'] : undefined,
	        state: item['state'] != null ? String(item['state']) : undefined,
	        unit: typeof item['unit'] === 'string' ? item['unit'] : undefined,
	        lastUpdated: typeof item['lastUpdated'] === 'string' ? item['lastUpdated'] : undefined,
	        mode,
	        condition: {
	          operator: typeof condition['operator'] === 'string' ? condition['operator'] : 'lt',
	          value: condition['value'] != null ? String(condition['value']) : '',
	        },
	      };
    })
    .filter((item) => item.entityId);
}

function parseSearchResult(value: unknown): EntitySearchResult[] {
  const raw = Array.isArray(value)
    ? value
    : Array.isArray((value as Record<string, unknown> | null)?.['entities'])
      ? (value as Record<string, unknown>)['entities']
      : [];

  return (raw as unknown[])
	    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
	    .map((item) => {
	      const entityId = String(item['entityId'] ?? item['entity_id'] ?? '');
	      return {
	        entityId,
	        name: String(item['name'] ?? item['friendlyName'] ?? entityId),
	        domain: typeof item['domain'] === 'string' ? item['domain'] : entityId.split('.')[0],
	        area: typeof item['area'] === 'string' ? item['area'] : undefined,
	        deviceClass: typeof item['deviceClass'] === 'string' ? item['deviceClass'] : undefined,
	        state: item['state'] != null ? String(item['state']) : undefined,
	        unit: typeof item['unit'] === 'string' ? item['unit'] : undefined,
	        lastUpdated: typeof item['lastUpdated'] === 'string' ? item['lastUpdated'] : undefined,
	      };
    })
    .filter((item) => item.entityId);
}

function parsePreview(value: unknown): PreviewResult {
  if (!value || typeof value !== 'object') {
    return { text: undefined, tokenEstimate: undefined, lines: undefined };
  }
	  const record = value as Record<string, unknown>;
	  return {
	    text: typeof record['text'] === 'string' ? record['text'] : undefined,
	    tokenEstimate: typeof record['tokenEstimate'] === 'number' ? record['tokenEstimate'] : undefined,
	    lines: Array.isArray(record['lines']) ? record['lines'].map(String) : undefined,
	  };
}

export function PackageSettingsPage({ packageType }: PackageSettingsPageProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const { name } = useParams<{ name: string }>();
  const packageName = name ?? '';

  const surfacesQuery = trpc.packageSettings.getSurfaces.useQuery(
    { packageType, name: packageName },
    { enabled: !!packageName }
  );
  const settingsQuery = trpc.packageSettings.getSettings.useQuery(
    { packageType, name: packageName },
    { enabled: !!packageName }
  );
  const pluginsQuery = trpc.plugins.list.useQuery(undefined, { enabled: packageType === 'plugin' });
  const channelsQuery = trpc.channels.listPackages.useQuery(undefined, { enabled: packageType === 'channel' });

  const surfaces = surfacesQuery.data ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId && surfaces.length > 0) {
      setActiveId(surfaces[0]!.id);
    }
  }, [activeId, surfaces]);

  const activeSurface = surfaces.find(s => s.id === activeId) ?? surfaces[0] ?? null;
  const displayName = useMemo(() => {
    if (packageType === 'plugin') {
      return pluginsQuery.data?.find(p => p.name === packageName)?.displayName ?? packageName;
    }
    return channelsQuery.data?.find(c => c.name === packageName)?.displayName ?? packageName;
  }, [channelsQuery.data, packageName, packageType, pluginsQuery.data]);

  const isLoading = surfacesQuery.isLoading || settingsQuery.isLoading;

  return (
    <div css={css`
      max-width: 1180px;
      margin: 0 auto;
      padding: ${theme.spacing[6]};
      min-height: 100%;
    `}>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[3]};
        margin-bottom: ${theme.spacing[6]};
      `}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          css={css`padding: ${theme.spacing[1.5]};`}
        >
          <ArrowLeft size={18} />
        </Button>
        <div css={css`min-width: 0; flex: 1;`}>
          <Typography.Subtitle as="h2" css={css`
            font-weight: ${theme.typography.fontWeight.semibold};
          `}>
            Manage: {displayName}
          </Typography.Subtitle>
        </div>
      </div>

      {isLoading ? (
        <div css={css`display: flex; justify-content: center; padding: ${theme.spacing[12]};`}>
          <CircleNotch size={24} css={css`
            color: ${theme.colors.text.hint};
            animation: spin 1s linear infinite;
            @keyframes spin { to { transform: rotate(360deg); } }
          `} />
        </div>
      ) : surfaces.length === 0 ? (
        <Typography.SmallBody color="secondary">
          There are no settings to manage for this package.
        </Typography.SmallBody>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[5]};`}>
          {surfaces.length > 1 && (
            <div css={css`
              display: flex;
              flex-wrap: wrap;
              gap: ${theme.spacing[2]};
              border-bottom: 1px solid ${theme.colors.border.light};
              padding-bottom: ${theme.spacing[2]};
            `}>
              {surfaces.map((surface) => (
                <button
                  key={surface.id}
                  type="button"
                  onClick={() => setActiveId(surface.id)}
                  css={css`
                    border: 1px solid ${surface.id === activeSurface?.id ? theme.colors.accent : theme.colors.border.default};
                    background: ${surface.id === activeSurface?.id ? theme.colors.accent : 'transparent'};
                    color: ${surface.id === activeSurface?.id ? theme.colors.accentForeground : theme.colors.text.secondary};
                    border-radius: ${theme.borderRadius.default};
                    padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
                    cursor: pointer;
                    font-size: ${theme.typography.fontSize.sm};
                  `}
                >
                  {surface.label}
                </button>
              ))}
            </div>
          )}

          {activeSurface?.type === 'entity-picker' ? (
            <EntityPickerSurface
              packageType={packageType}
              packageName={packageName}
              surface={activeSurface}
              currentValue={settingsQuery.data?.[settingsKey(activeSurface)]}
              onSaved={() => settingsQuery.refetch()}
            />
          ) : activeSurface?.type === 'form' ? (
            <FormSurface
              packageType={packageType}
              packageName={packageName}
              surface={activeSurface}
              currentValue={settingsQuery.data?.[settingsKey(activeSurface)]}
              onSaved={() => settingsQuery.refetch()}
            />
          ) : (
            <Typography.SmallBody color="secondary">
              This settings surface is not available here yet.
            </Typography.SmallBody>
          )}
        </div>
      )}
    </div>
  );
}

function FormSurface({
  packageType,
  packageName,
  surface,
  currentValue,
  onSaved,
}: {
  packageType: PackageType;
  packageName: string;
  surface: PackageSettingsSurface;
  currentValue: unknown;
  onSaved: () => void;
}) {
  const fields = (surface.configSchema?.fields ?? []) as ConfigField[];
  const currentConfig = asRecord(currentValue);
  const setSetting = trpc.packageSettings.setSetting.useMutation({ onSuccess: onSaved });
  const {
    configValues,
    showSecrets,
    toggleSecret,
    validationErrors,
    validateConfig,
    setConfigValues,
  } = useConfigForm({ fields, currentConfig, isLoading: false });

  useEffect(() => {
    setConfigValues({ ...currentConfig });
  }, [currentValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveError = setSetting.isError ? setSetting.error?.message : undefined;

  return (
    <ConfigForm
      fields={fields}
      configValues={configValues}
      validationErrors={validationErrors}
      showSecrets={showSecrets}
      onChange={(key, value) => setConfigValues(prev => ({ ...prev, [key]: value }))}
      onToggleSecret={toggleSecret}
      onSave={() => {
        if (!validateConfig()) return;
        setSetting.mutate({
          packageType,
          name: packageName,
          key: settingsKey(surface),
          value: configValues,
        });
      }}
      onCancel={() => setConfigValues({ ...currentConfig })}
      isSaving={setSetting.isPending}
      saveError={saveError}
      saveLabel="Save settings"
    />
  );
}

function EntityPickerSurface({
  packageType,
  packageName,
  surface,
  currentValue,
  onSaved,
}: {
  packageType: PackageType;
  packageName: string;
  surface: PackageSettingsSurface;
  currentValue: unknown;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [selected, setSelected] = useState<MonitoredEntity[]>([]);
  const [results, setResults] = useState<EntitySearchResult[]>([]);
  const [preview, setPreview] = useState<PreviewResult>({
    text: undefined,
    tokenEstimate: undefined,
    lines: undefined,
  });

  const callAction = trpc.packageSettings.callAction.useMutation();
  const saveSetting = trpc.packageSettings.setSetting.useMutation({ onSuccess: onSaved });

  useEffect(() => {
    setSelected(normalizeEntities(currentValue));
  }, [currentValue]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      callAction.mutate({
        packageType,
        name: packageName,
        surfaceId: surface.id,
        actionId: 'search',
        params: { query, domain, selected: selected.map(item => item.entityId) },
      }, {
        onSuccess: (data) => setResults(parseSearchResult(data)),
      });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [domain, packageName, packageType, query, surface.id]); // eslint-disable-line react-hooks/exhaustive-deps

	  useEffect(() => {
	    if (!surface.actions['preview']) return;
    const timer = window.setTimeout(() => {
      callAction.mutate({
        packageType,
        name: packageName,
        surfaceId: surface.id,
        actionId: 'preview',
        params: { entities: selected },
      }, {
        onSuccess: (data) => setPreview(parsePreview(data)),
      });
    }, 350);

    return () => window.clearTimeout(timer);
	  }, [packageName, packageType, selected, surface.actions, surface.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedIds = useMemo(() => new Set(selected.map(item => item.entityId)), [selected]);

  const addEntity = (entity: EntitySearchResult) => {
    if (selectedIds.has(entity.entityId)) return;
    setSelected(prev => [...prev, { ...entity, mode: 'always', condition: { operator: 'lt', value: '' } }]);
  };

  const updateEntity = (entityId: string, update: Partial<MonitoredEntity>) => {
    setSelected(prev => prev.map(item => item.entityId === entityId ? { ...item, ...update } : item));
  };

  const updateCondition = (entityId: string, condition: Partial<NonNullable<MonitoredEntity['condition']>>) => {
    setSelected(prev => prev.map(item => {
      if (item.entityId !== entityId) return item;
      return {
        ...item,
        condition: {
          operator: item.condition?.operator ?? 'lt',
          value: item.condition?.value ?? '',
          ...condition,
        },
      };
    }));
  };

  const removeEntity = (entityId: string) => {
    setSelected(prev => prev.filter(item => item.entityId !== entityId));
  };

  const saveError = saveSetting.isError ? saveSetting.error?.message : undefined;
  const actionError = callAction.isError ? callAction.error?.message : undefined;

  return (
    <div css={css`
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
      gap: ${theme.spacing[6]};
      align-items: start;

      @media (max-width: 960px) {
        grid-template-columns: 1fr;
      }
    `}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <div css={css`
          display: grid;
          grid-template-columns: minmax(0, 1fr) 190px;
          gap: ${theme.spacing[3]};

          @media (max-width: 700px) {
            grid-template-columns: 1fr;
          }
        `}>
          <Input
            label="Search entities"
            value={query}
            onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
            placeholder="Plant moisture, office temperature"
            rightElement={<MagnifyingGlass size={16} css={css`color: ${theme.colors.text.hint};`} />}
          />
          <Select
            label="Domain"
            value={domain}
            onChange={setDomain}
            options={domainOptions}
          />
        </div>

        {actionError && (
          <Typography.SmallBody css={css`color: ${theme.colors.error.main};`}>
            {actionError}
          </Typography.SmallBody>
        )}

        <div css={css`
          border: 1px solid ${theme.colors.border.light};
          border-radius: ${theme.borderRadius.default};
          overflow: hidden;
          background: ${theme.colors.background.paper};
        `}>
          {results.length === 0 ? (
            <div css={css`padding: ${theme.spacing[4]};`}>
              <Typography.SmallBody color="secondary">
                No matching entities yet.
              </Typography.SmallBody>
            </div>
          ) : results.map((entity) => {
            const isSelected = selectedIds.has(entity.entityId);
            return (
              <div
                key={entity.entityId}
                css={css`
                  display: grid;
                  grid-template-columns: minmax(0, 1fr) auto;
                  gap: ${theme.spacing[3]};
                  align-items: center;
                  padding: ${theme.spacing[3]} ${theme.spacing[4]};
                  border-bottom: 1px solid ${theme.colors.border.light};
                  &:last-of-type { border-bottom: none; }
                `}
              >
                <EntitySummary entity={entity} />
                <Button
                  variant={isSelected ? 'ghost' : 'secondary'}
                  size="sm"
                  onClick={() => addEntity(entity)}
                  disabled={isSelected}
                >
                  {!isSelected && <Plus size={14} css={css`margin-right: ${theme.spacing[1]};`} />}
                  {isSelected ? 'Added' : 'Add'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <div css={css`
          display: flex;
          justify-content: space-between;
          gap: ${theme.spacing[3]};
          align-items: center;
        `}>
          <Typography.BodyAlt as="h3">Selected context</Typography.BodyAlt>
          <Badge variant={selected.length > 0 ? 'info' : 'default'}>
            {selected.length} selected
          </Badge>
        </div>

        <div css={css`
          border: 1px solid ${theme.colors.border.light};
          border-radius: ${theme.borderRadius.default};
          background: ${theme.colors.background.paper};
          overflow: hidden;
        `}>
          {selected.length === 0 ? (
            <div css={css`padding: ${theme.spacing[4]};`}>
              <Typography.SmallBody color="secondary">
                Search Home Assistant and add the live values that matter.
              </Typography.SmallBody>
            </div>
          ) : selected.map((entity) => (
            <div
              key={entity.entityId}
              css={css`
                display: flex;
                flex-direction: column;
                gap: ${theme.spacing[3]};
                padding: ${theme.spacing[4]};
                border-bottom: 1px solid ${theme.colors.border.light};
                &:last-of-type { border-bottom: none; }
              `}
            >
              <div css={css`
                display: flex;
                justify-content: space-between;
                gap: ${theme.spacing[3]};
                align-items: flex-start;
              `}>
                <EntitySummary entity={entity} />
                <button
                  type="button"
                  onClick={() => removeEntity(entity.entityId)}
                  css={css`
                    border: none;
                    background: transparent;
                    color: ${theme.colors.text.hint};
                    cursor: pointer;
                    padding: ${theme.spacing[1]};
                    &:hover { color: ${theme.colors.error.main}; }
                  `}
                  aria-label={`Remove ${entity.name}`}
                >
                  <Trash size={16} />
                </button>
              </div>

              <Select
                label="Include"
                value={entity.mode}
                onChange={(value) => updateEntity(entity.entityId, { mode: value as EntityMode })}
                options={modeOptions}
              />

              {entity.mode === 'condition' && (
                <div css={css`
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: ${theme.spacing[3]};

                  @media (max-width: 520px) {
                    grid-template-columns: 1fr;
                  }
                `}>
                  <Select
                    label="Condition"
                    value={entity.condition?.operator ?? 'lt'}
                    onChange={(value) => updateCondition(entity.entityId, { operator: value })}
                    options={conditionOptions}
                  />
                  {entity.condition?.operator !== 'unavailable' && (
                    <Input
                      label="Value"
                      value={entity.condition?.value ?? ''}
                      onChange={(e) => updateCondition(entity.entityId, {
                        value: (e.target as HTMLInputElement).value,
                      })}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {(preview.text || preview.lines?.length || preview.tokenEstimate !== undefined) && (
          <div css={css`
            border: 1px solid ${theme.colors.border.light};
            border-radius: ${theme.borderRadius.default};
            padding: ${theme.spacing[4]};
            background: ${theme.colors.background.elevated};
            display: flex;
            flex-direction: column;
            gap: ${theme.spacing[2]};
          `}>
            <div css={css`display: flex; justify-content: space-between; gap: ${theme.spacing[3]};`}>
              <Typography.BodyAlt as="h3">Preview</Typography.BodyAlt>
              {preview.tokenEstimate !== undefined && (
                <Typography.Caption color="hint">{preview.tokenEstimate} tokens</Typography.Caption>
              )}
            </div>
            <pre css={css`
              margin: 0;
              white-space: pre-wrap;
              color: ${theme.colors.text.secondary};
              font: inherit;
              font-size: ${theme.typography.fontSize.sm};
              line-height: 1.55;
            `}>
              {preview.text ?? preview.lines?.join('\n') ?? ''}
            </pre>
          </div>
        )}

        {saveError && (
          <Typography.SmallBody css={css`color: ${theme.colors.error.main};`}>
            {saveError}
          </Typography.SmallBody>
        )}

        <div css={css`display: flex; justify-content: flex-end;`}>
          <Button
            size="sm"
            loading={saveSetting.isPending}
            onClick={() => saveSetting.mutate({
              packageType,
              name: packageName,
              key: settingsKey(surface),
              value: selected,
            })}
          >
            Save settings
          </Button>
        </div>
      </div>
    </div>
  );
}

function EntitySummary({ entity }: { entity: EntitySearchResult }) {
  const theme = useTheme();
  const stateText = entity.state != null
    ? `${entity.state}${entity.unit ?? ''}`
    : null;

  return (
    <div css={css`min-width: 0; display: flex; flex-direction: column; gap: 2px;`}>
      <div css={css`
        display: flex;
        gap: ${theme.spacing[2]};
        align-items: center;
        min-width: 0;
      `}>
        <Typography.SmallBody as="span" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        `}>
          {entity.name}
        </Typography.SmallBody>
        {stateText && (
          <Typography.Caption as="span" color="hint" css={css`flex-shrink: 0;`}>
            {stateText}
          </Typography.Caption>
        )}
      </div>
      <Typography.Caption color="hint" css={css`
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `}>
        {entity.entityId}
        {entity.area ? ` · ${entity.area}` : ''}
      </Typography.Caption>
    </div>
  );
}
