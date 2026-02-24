/**
 * Toast Store
 *
 * Global toast notification state. Toasts auto-dismiss after a timeout
 * and can be manually dismissed. Supports error, success, warning, and info variants.
 * Toasts can include action buttons and expandable detail text.
 */

import { create } from 'zustand';

export type ToastVariant = 'error' | 'success' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
  /** Optional technical detail shown on expand */
  detail?: string;
  /** Optional action buttons */
  actions?: ToastAction[];
  /** Auto-dismiss timeout in ms. 0 = persistent. Default: 6000 */
  duration: number;
}

export interface ToastOptions {
  /** Technical detail text, shown when user expands the toast */
  detail?: string;
  /** Action buttons rendered below the message */
  actions?: ToastAction[];
  /** Auto-dismiss timeout in ms. 0 = persistent. */
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (variant: ToastVariant, message: string, options?: ToastOptions) => string;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (variant, message, options) => {
    const id = `toast-${++nextId}`;
    const defaultDuration = variant === 'error' ? 8000 : variant === 'warning' ? 7000 : 6000;
    // Toasts with detail or actions stay longer / persist
    const hasDismissOverride = options?.detail || options?.actions?.length;
    const duration = options?.duration ?? (hasDismissOverride ? 0 : defaultDuration);
    const toast: Toast = {
      id, variant, message, duration,
      ...(options?.detail != null ? { detail: options.detail } : {}),
      ...(options?.actions != null ? { actions: options.actions } : {}),
    };

    set((s) => ({ toasts: [...s.toasts, toast] }));

    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }

    return id;
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Convenience helpers for common toast types */
export const toast = {
  error: (message: string, options?: ToastOptions) =>
    useToastStore.getState().addToast('error', message, options),
  success: (message: string, options?: ToastOptions) =>
    useToastStore.getState().addToast('success', message, options),
  warning: (message: string, options?: ToastOptions) =>
    useToastStore.getState().addToast('warning', message, options),
  info: (message: string, options?: ToastOptions) =>
    useToastStore.getState().addToast('info', message, options),
};
