import { HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function buildMockResponse() {
  const json = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnThis();
  const setHeader = jest.fn().mockReturnThis();
  return { json, status, setHeader };
}

function buildHost(res: ReturnType<typeof buildMockResponse>) {
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({}),
    }),
  } as any;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let res: ReturnType<typeof buildMockResponse>;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    res = buildMockResponse();
  });

  it('sets Content-Type header on every response', () => {
    filter.catch(new HttpException('Not Found', 404), buildHost(res));
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8');
  });

  it('always sets success: false', () => {
    filter.catch(new HttpException('Bad Request', 400), buildHost(res));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  it('handles a plain 404 HttpException', () => {
    filter.catch(new HttpException('Not Found', 404), buildHost(res));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, success: false }),
    );
  });

  it('extracts the message from an object response (string message)', () => {
    filter.catch(new HttpException({ message: 'Validation failed' }, 400), buildHost(res));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation failed' }),
    );
  });

  it('takes the first element when message is an array', () => {
    filter.catch(new HttpException({ message: ['field required', 'other'] }, 400), buildHost(res));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'field required' }),
    );
  });

  it('uses a string exception response directly as the message', () => {
    filter.catch(new HttpException('Forbidden resource', 403), buildHost(res));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Forbidden resource' }),
    );
  });

  it('overrides 429 message with "Too many requests"', () => {
    filter.catch(new HttpException('rate limited', HttpStatus.TOO_MANY_REQUESTS), buildHost(res));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Too many requests' }),
    );
  });

  it('overrides 500 message with "Internal server error"', () => {
    filter.catch(new HttpException('Something broke', 500), buildHost(res));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Internal server error' }),
    );
  });

  it('overrides any 5xx message with "Internal server error"', () => {
    filter.catch(new HttpException('unavailable', 503), buildHost(res));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503, message: 'Internal server error' }),
    );
  });

  it('handles a generic Error as a 500', () => {
    filter.catch(new Error('unexpected'), buildHost(res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, message: 'Internal server error', success: false }),
    );
  });
});
