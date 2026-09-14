import { Controller, UnauthorizedException, UseFilters } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GrpcMethod } from '@nestjs/microservices';
import { JwtPayload, JwtStrategy } from '../auth/jwt.strategy';
import { GrpcExceptionFilter } from './grpc-exception.filter';
import type { TokenClaims, VerifyTokenRequest } from './grpc.interface';

/**
 * Token introspection for internal callers.
 *
 * Deliberately NOT behind `GrpcInternalGuard`: the token is the credential
 * here, so a caller holding a valid one has already proved something, and
 * requiring the shared key as well would mean an expired-token check could not
 * be made from anywhere the key is not deployed. Every other service on this
 * port answers with customer data and does need the guard.
 */
@UseFilters(GrpcExceptionFilter)
@Controller()
export class AuthGrpcController {
  constructor(
    private readonly jwt: JwtService,
    private readonly strategy: JwtStrategy,
  ) {}

  /**
   * Verifies a JWT and answers who it belongs to.
   *
   * Signature and expiry are checked by `JwtService`; everything after that —
   * the user still exists, is not deactivated, is verified — is
   * `JwtStrategy.validate`, reused rather than reimplemented. A second copy of
   * those checks is a second place to forget one when the rules change.
   *
   * @param request - The raw access token.
   * @returns Who the token belongs to and what roles they hold.
   * @throws {UnauthorizedException} When the token is invalid or expired.
   */
  @GrpcMethod('AuthService', 'VerifyToken')
  async verifyToken(request: VerifyTokenRequest): Promise<TokenClaims> {
    let payload: JwtPayload;

    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(request.accessToken);
    } catch {
      // The reason is not passed on: "expired" and "bad signature" are
      // different facts, and only one of them is safe to tell a caller.
      throw new UnauthorizedException('invalid token');
    }

    const user = await this.strategy.validate(payload);

    return {
      userId: user.id,
      email: user.email,
      roles: user.roles,
    };
  }
}
