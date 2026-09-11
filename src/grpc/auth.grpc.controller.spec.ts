import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../auth/jwt.strategy';
import { AuthGrpcController } from './auth.grpc.controller';

function build() {
  const jwt = { verifyAsync: jest.fn() };
  const strategy = { validate: jest.fn() };

  return {
    jwt,
    strategy,
    controller: new AuthGrpcController(
      jwt as unknown as JwtService,
      strategy as unknown as JwtStrategy,
    ),
  };
}

describe('AuthGrpcController', () => {
  it('answers with the claims of a valid token', async () => {
    const { controller, jwt, strategy } = build();
    jwt.verifyAsync.mockResolvedValue({
      sub: 'u-1',
      email: 'a@example.com',
      roles: ['ADMIN'],
    });
    strategy.validate.mockResolvedValue({
      id: 'u-1',
      email: 'a@example.com',
      roles: ['ADMIN'],
    });

    await expect(
      controller.verifyToken({ accessToken: 'jwt' }),
    ).resolves.toEqual({
      userId: 'u-1',
      email: 'a@example.com',
      roles: ['ADMIN'],
    });
  });

  it('runs the account checks rather than trusting the signature alone', async () => {
    // A token signed correctly still says nothing about whether the account was
    // deactivated an hour ago. That check lives in JwtStrategy.validate, and
    // reusing it is the whole reason this endpoint exists instead of handing
    // every service the JWT secret.
    const { controller, jwt, strategy } = build();
    jwt.verifyAsync.mockResolvedValue({ sub: 'u-1', email: 'a@x', roles: [] });
    strategy.validate.mockRejectedValue(new Error('ACCOUNT_INACTIVE'));

    await expect(
      controller.verifyToken({ accessToken: 'jwt' }),
    ).rejects.toThrow('ACCOUNT_INACTIVE');
  });

  it('does not tell the caller why a token was refused', async () => {
    // "expired" and "bad signature" are different facts, and only one of them
    // is safe to hand back.
    const { controller, jwt, strategy } = build();
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(
      controller.verifyToken({ accessToken: 'stale' }),
    ).rejects.toThrow(new UnauthorizedException('invalid token'));

    expect(strategy.validate).not.toHaveBeenCalled();
  });
});
