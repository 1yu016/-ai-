import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthenticatedRequest, JwtTeacherPayload } from './auth.types';
import { AuthService } from './auth.service';

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;
    if (!authorization) {
      return true;
    }

    const [type, token] = authorization.split(' ');
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Authorization 格式错误');
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<JwtTeacherPayload>(token);
      (request as AuthenticatedRequest).user =
        await this.authService.validateAccessPayload(payload);
      return true;
    } catch {
      throw new UnauthorizedException('Token 无效或已过期');
    }
  }
}
