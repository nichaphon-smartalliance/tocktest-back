import { getErrorMessage } from './error.util';

describe('getErrorMessage', () => {
  it('extracts the message from an Error instance', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a plain string as-is', () => {
    expect(getErrorMessage('boom')).toBe('boom');
  });

  it('extracts message from an object with a string message property', () => {
    expect(getErrorMessage({ message: 'boom' })).toBe('boom');
  });

  it('falls back to String() for values without a usable message', () => {
    expect(getErrorMessage({ code: 42 })).toBe('[object Object]');
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });

  it('ignores a non-string message property', () => {
    expect(getErrorMessage({ message: 42 })).toBe('[object Object]');
  });
});
