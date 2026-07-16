import { of, firstValueFrom } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

function buildContext(contentType?: string) {
  const getHeader = jest.fn().mockReturnValue(contentType);
  const setHeader = jest.fn();
  return {
    getHeader,
    setHeader,
    switchToHttp: () => ({
      getResponse: () => ({ getHeader, setHeader }),
    }),
  } as any;
}

function buildHandler(data: unknown) {
  return { handle: () => of(data) } as any;
}

describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor<unknown>;

  beforeEach(() => {
    interceptor = new ResponseInterceptor();
  });

  it('wraps data in { success: true, data }', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(buildContext(), buildHandler({ id: 1 })),
    );
    expect(result).toEqual({ success: true, data: { id: 1 } });
  });

  it('wraps null data correctly', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(buildContext(), buildHandler(null)),
    );
    expect(result).toEqual({ success: true, data: null });
  });

  it('wraps a primitive string', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(buildContext(), buildHandler('ok')),
    );
    expect(result).toEqual({ success: true, data: 'ok' });
  });

  it('sets Content-Type header when not already set', () => {
    const ctx = buildContext(undefined);
    firstValueFrom(interceptor.intercept(ctx, buildHandler(null)));
    expect(ctx.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8');
  });

  it('does not set Content-Type when already set', () => {
    const ctx = buildContext('application/json');
    firstValueFrom(interceptor.intercept(ctx, buildHandler(null)));
    expect(ctx.setHeader).not.toHaveBeenCalled();
  });
});
