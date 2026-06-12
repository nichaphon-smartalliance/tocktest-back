import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const res = context.switchToHttp().getResponse();
    if (res?.setHeader && !res.getHeader?.('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
      })),
    );
  }
}
