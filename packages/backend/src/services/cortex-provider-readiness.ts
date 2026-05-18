export type ProviderConnectionMethod = 'oauth' | 'api_key' | 'custom' | 'env_var' | null;

export interface ProviderConnectionStatus {
  connected: boolean;
  method: ProviderConnectionMethod;
  meta: unknown | null;
}

export type ActiveProviderReadinessReason =
  | 'missing_provider'
  | 'missing_model'
  | 'missing_credentials'
  | null;

export interface ActiveProviderReadiness {
  ready: boolean;
  provider: string | null;
  model: string | null;
  reason: ActiveProviderReadinessReason;
  message: string | null;
  status: ProviderConnectionStatus;
}

const disconnectedStatus: ProviderConnectionStatus = {
  connected: false,
  method: null,
  meta: null,
};

export function evaluateActiveProviderReadiness(input: {
  provider: string | null | undefined;
  model: string | null | undefined;
  status: ProviderConnectionStatus | null | undefined;
}): ActiveProviderReadiness {
  const provider = input.provider ?? null;
  const model = input.model ?? null;
  const status = input.status ?? disconnectedStatus;

  if (!provider) {
    return {
      ready: false,
      provider,
      model,
      reason: 'missing_provider',
      message: 'No AI provider is configured.',
      status,
    };
  }

  if (!model) {
    return {
      ready: false,
      provider,
      model,
      reason: 'missing_model',
      message: 'No AI model is selected for the configured provider.',
      status,
    };
  }

  if (!status.connected) {
    return {
      ready: false,
      provider,
      model,
      reason: 'missing_credentials',
      message: `No credentials are configured for provider "${provider}".`,
      status,
    };
  }

  return {
    ready: true,
    provider,
    model,
    reason: null,
    message: null,
    status,
  };
}
