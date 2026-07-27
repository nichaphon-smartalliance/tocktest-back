import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  sv?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      // Pin the signature algorithm so a token can never be accepted under an
      // algorithm we didn't intend to issue.
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload) {
    // JWT_SECRET also signs short-lived OAuth/App-install *state* tokens, which
    // carry `userId` instead of `sub`. Those must never authenticate a session:
    // without this guard `findById(undefined)` lets TypeORM drop the id from the
    // WHERE clause and match an arbitrary active user.
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedException();
    }
    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    if ((payload.sv ?? 0) !== user.sessionVersion) throw new UnauthorizedException();
    return user;
  }
}
