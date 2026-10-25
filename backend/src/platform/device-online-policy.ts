import { DeviceStatus } from './platform.types';

export function deviceHeartbeatTimeoutMs(value: unknown): number {
  const seconds = Number(value ?? 90);
  return (Number.isFinite(seconds) && seconds >= 15 ? seconds : 90) * 1000;
}

/** Online is derived from a fresh heartbeat; status caches it, except administrative blocks. */
export function deviceOnlineStatus(
  device: { status: DeviceStatus; lastOnlineAt: Date | null },
  timeoutMs: number,
  now = Date.now(),
): DeviceStatus {
  if ([DeviceStatus.Disabled, DeviceStatus.Fault].includes(device.status)) return device.status;
  const timestamp = device.lastOnlineAt?.getTime();
  return timestamp != null && Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= timeoutMs
    ? DeviceStatus.Online : DeviceStatus.Offline;
}
