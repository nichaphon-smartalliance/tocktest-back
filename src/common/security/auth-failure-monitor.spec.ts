import { recordAuthFailure, __resetAuthFailureMonitor } from './auth-failure-monitor';

describe('recordAuthFailure', () => {
  beforeEach(() => __resetAuthFailureMonitor());

  it('does not alert below the threshold', () => {
    const emit = jest.fn();
    for (let i = 0; i < 9; i++) recordAuthFailure('1.2.3.4', emit);
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits exactly one alert when the threshold is crossed', () => {
    const emit = jest.fn();
    let alerts = 0;
    for (let i = 0; i < 25; i++) {
      if (recordAuthFailure('1.2.3.4', emit)) alerts++;
    }
    expect(alerts).toBe(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'security_alert', alert: 'repeated_auth_failures', ip: '1.2.3.4' }),
    );
  });

  it('tracks each IP independently', () => {
    const emit = jest.fn();
    for (let i = 0; i < 10; i++) recordAuthFailure('10.0.0.1', emit);
    for (let i = 0; i < 5; i++) recordAuthFailure('10.0.0.2', emit);
    // Only the first IP crossed the threshold.
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ ip: '10.0.0.1' }));
  });
});
