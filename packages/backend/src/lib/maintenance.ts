/**
 * Maintenance Mode — Simple module-level state for server maintenance.
 *
 * When active, the Fastify onRequest hook returns 503 for all routes
 * except health checks.
 */

let maintenanceActive = false;
let maintenanceReason = '';

export function isMaintenanceMode(): boolean {
  return maintenanceActive;
}

export function setMaintenanceMode(active: boolean, reason: string): void {
  maintenanceActive = active;
  maintenanceReason = reason;
}

export function getMaintenanceReason(): string {
  return maintenanceReason;
}
