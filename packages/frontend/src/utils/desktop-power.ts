import { isTauri } from './tauri';

export interface DesktopPowerStatus {
  supported: boolean;
  keepAwake: boolean;
  keepDisplayAwake: boolean;
}

export function isDesktopPowerPlatform(): boolean {
  if (!isTauri()) return false;
  if (typeof navigator === 'undefined') return false;

  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  return platform.includes('mac') ||
    platform.includes('win') ||
    userAgent.includes('mac os') ||
    userAgent.includes('windows');
}

export async function getDesktopPowerStatus(): Promise<DesktopPowerStatus | null> {
  if (!isDesktopPowerPlatform()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<DesktopPowerStatus>('desktop_power_status');
}

export async function setDesktopPowerSettings(
  keepAwake: boolean,
  keepDisplayAwake: boolean,
): Promise<DesktopPowerStatus | null> {
  if (!isDesktopPowerPlatform()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<DesktopPowerStatus>('set_desktop_power_settings', {
    keepAwake,
    keepDisplayAwake,
  });
}
