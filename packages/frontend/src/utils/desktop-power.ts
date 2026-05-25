import { isTauri } from './tauri';

export interface DesktopPowerStatus {
  supported: boolean;
  keepAwake: boolean;
  keepDisplayAwake: boolean;
}

export async function getDesktopPowerStatus(): Promise<DesktopPowerStatus | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<DesktopPowerStatus>('desktop_power_status');
}

export async function setDesktopPowerSettings(
  keepAwake: boolean,
  keepDisplayAwake: boolean,
): Promise<DesktopPowerStatus | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<DesktopPowerStatus>('set_desktop_power_settings', {
    keepAwake,
    keepDisplayAwake,
  });
}
