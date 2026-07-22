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
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object' && 'message' in res) {
        message = (res as { message: string | string[] }).message ?? exception.message;
      } else {
        message = exception.message;
      }
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
