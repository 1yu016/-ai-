import { deviceHeartbeatTimeoutMs, deviceOnlineStatus } from './device-online-policy';
import { DeviceStatus } from './platform.types';

describe('single device online policy', () => {
  const now = Date.UTC(2026, 9, 12, 12);
  const status = (cached: DeviceStatus, age: number | null) => deviceOnlineStatus({ status: cached, lastOnlineAt: age == null ? null : new Date(now - age) }, 90_000, now);
  it('fresh heartbeat is online even if the persisted cache is offline', () => expect(status(DeviceStatus.Offline, 1000)).toBe(DeviceStatus.Online));
  it('expired heartbeat is offline even before cron updates its cache', () => expect(status(DeviceStatus.Online, 90_001)).toBe(DeviceStatus.Offline));
  it('missing heartbeat is offline', () => expect(status(DeviceStatus.Online, null)).toBe(DeviceStatus.Offline));
  it('disabled and fault remain unusable after a fresh heartbeat', () => {
    expect(status(DeviceStatus.Disabled, 0)).toBe(DeviceStatus.Disabled);
    expect(status(DeviceStatus.Fault, 0)).toBe(DeviceStatus.Fault);
  });
  it('uses the 90-second default and validates the configured timeout', () => {
    expect(deviceHeartbeatTimeoutMs(undefined)).toBe(90_000);
    expect(deviceHeartbeatTimeoutMs('bad')).toBe(90_000);
    expect(deviceHeartbeatTimeoutMs('15')).toBe(15_000);
  });
});
