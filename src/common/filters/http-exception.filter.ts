import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message =
        typeof res === 'string'
          ? res
          : (res as any).message ?? exception.message;
    }

    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      message = 'Too many requests';
    } else if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      message = 'Internal server error';
    }

    response
      .status(status)
      .setHeader('Content-Type', 'application/json; charset=utf-8')
      .json({
        success: false,
        message: Array.isArray(message) ? message[0] : message,
        statusCode: status,
      });
  }
}
