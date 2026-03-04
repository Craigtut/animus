import { useState, useEffect } from 'react';
import type { ConfigField } from '@animus-labs/shared';

interface UseConfigFormOptions {
  fields: ConfigField[];
  currentConfig: Record<string, unknown> | undefined;
  isLoading: boolean;
}

interface UseConfigFormReturn {
  configValues: Record<string, unknown>;
  setConfigValues: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  showSecrets: Record<string, boolean>;
  toggleSecret: (key: string) => void;
  validationErrors: Record<string, string>;
  validateConfig: () => boolean;
  initialized: boolean;
}

export function useConfigForm({ fields, currentConfig, isLoading }: UseConfigFormOptions): UseConfigFormReturn {
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);

  // Initialize form values from current config
  useEffect(() => {
    if (initialized || isLoading) return;
    if (currentConfig !== undefined) {
      const cfg = currentConfig ?? {};
      const values: Record<string, unknown> = { ...cfg };
      for (const field of fields) {
        if (values[field.key] === undefined && field.default !== undefined) {
          values[field.key] = field.default;
        }
        // Convert comma-separated strings to arrays for text-list fields
        if (field.type === 'text-list' && typeof values[field.key] === 'string') {
          values[field.key] = (values[field.key] as string).split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
      setConfigValues(values);
      setInitialized(true);
    }
  }, [currentConfig, isLoading, fields, initialized]);

  function toggleSecret(key: string) {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function validateConfig(): boolean {
    const errors: Record<string, string> = {};

    for (const field of fields) {
      // Skip OAuth fields — they are validated by the OAuth flow itself
      if (field.type === 'oauth') continue;

      const value = configValues[field.key];

      // Required check
      if (field.required) {
        const isEmpty = value === undefined || value === null || value === '' ||
          (Array.isArray(value) && value.length === 0);
        if (isEmpty) {
          errors[field.key] = `${field.label} is required`;
          continue;
        }
      }

      // Skip further validation if empty and not required
      if (value === undefined || value === null || value === '') continue;

      // Regex validation
      if (field.validation && typeof value === 'string') {
        try {
          if (!new RegExp(field.validation).test(value)) {
            errors[field.key] = `Invalid format for ${field.label}`;
          }
        } catch { /* invalid regex, skip */ }
      }

      // URL validation
      if (field.type === 'url' && typeof value === 'string') {
        try {
          new URL(value);
        } catch {
          errors[field.key] = 'Must be a valid URL';
        }
      }

      // Number validation with min/max
      if (field.type === 'number' && value !== undefined && value !== '') {
        const num = Number(value);
        if (isNaN(num)) {
          errors[field.key] = 'Must be a number';
        } else {
          if (field.min !== undefined && num < field.min) {
            errors[field.key] = `Must be at least ${field.min}`;
          }
          if (field.max !== undefined && num > field.max) {
            errors[field.key] = `Must be at most ${field.max}`;
          }
        }
      }

      // File secret size validation
      if (field.type === 'file_secret' && value && typeof value === 'object') {
        const fileVal = value as { data?: string };
        if (fileVal.data) {
          const sizeBytes = Math.ceil(fileVal.data.length * 3 / 4);
          const maxSize = field.maxFileSize ?? 102_400;
          if (sizeBytes > maxSize) {
            errors[field.key] = `File too large (max ${Math.round(maxSize / 1024)}KB)`;
          }
        }
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }

  return {
    configValues,
    setConfigValues,
    showSecrets,
    toggleSecret,
    validationErrors,
    validateConfig,
    initialized,
  };
}
