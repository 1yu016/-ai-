import { ScreenHandoffService } from './screen-handoff.service';
import type { JwtTeacherPayload } from '../auth/auth.types';
describe('short screen handoff leases', () => {
  const actor = { sub: 1 } as JwtTeacherPayload;
  it('reuses active run lease; explicit revocation cannot resurrect', () => {
    const service = new ScreenHandoffService();
    const first = service.issueActive(actor, 1, 2, 3);
    expect(service.issueActive(actor, 1, 2, 3).id).toBe(first.id);
    service.revokeDevice(2);
    expect(service.resolve(actor, first.id, 2, 3)).toBeNull();
    expect(service.issueActive(actor, 2, 2, 3).id).not.toBe(first.id);
  });
  it('rejects cross-principal/device and invalidates binding changes', () => {
    const service = new ScreenHandoffService();
    const first = service.issueActive(actor, 1, 2, 3);
    expect(() =>
      service.resolve({ sub: 2 } as JwtTeacherPayload, first.id, 2, 3),
    ).toThrow();
    expect(() => service.resolve(actor, first.id, 3, 3)).toThrow();
    expect(service.resolve(actor, first.id, 2, 4)).toBeNull();
    expect(service.resolve(actor, first.id, 2, 3)).toBeNull();
  });
  it('a restarted service and a tampered id have no eligibility', () => {
    const first = new ScreenHandoffService().issueActive(actor, 1, 2, 3);
    expect(
      new ScreenHandoffService().resolve(actor, first.id, 2, 3),
    ).toBeNull();
    expect(
      new ScreenHandoffService().resolve(actor, 'forged', 2, 3),
    ).toBeNull();
  });
  it('expires and rejects cross-day leases permanently', () => {
    const service = new ScreenHandoffService();
    const start = Date.now();
    const first = service.issueActive(actor, 1, 2, 3);
    const original = Date.now;
    Date.now = () => start + 86400000;
    try {
      expect(service.resolve(actor, first.id, 2, 3)).toBeNull();
    } finally {
      Date.now = original;
    }
    expect(service.resolve(actor, first.id, 2, 3)).toBeNull();
  });
});
