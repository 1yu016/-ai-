import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest, JwtTeacherPayload } from './auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('请先登录并携带 Bearer Token');
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

  private extractBearerToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' && token ? token : undefined;
  }
}
