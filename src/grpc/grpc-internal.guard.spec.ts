import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { GRPC_INTERNAL_KEY } from './grpc.constant';
import { GrpcInternalGuard } from './grpc-internal.guard';

function config(key: string | undefined): ConfigService {
  return {
    getOrThrow: () => {
      if (key === undefined) throw new Error('GRPC_INTERNAL_KEY is not set');
      return key;
    },
  } as unknown as ConfigService;
}

function contextWith(provided?: string): ExecutionContext {
  return {
    switchToRpc: () => ({
      getContext: () => ({
        get: (name: string) =>
          name === GRPC_INTERNAL_KEY && provided !== undefined
            ? [provided]
            : [],
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('GrpcInternalGuard', () => {
  it('refuses to start when no key is configured', () => {
    // Failing at boot beats serving customer names, phone numbers and addresses
    // to anyone who can open a socket to the port.
    expect(() => new GrpcInternalGuard(config(undefined))).toThrow(
      'GRPC_INTERNAL_KEY',
    );
  });

  it('lets a caller with the right key through', () => {
    const guard = new GrpcInternalGuard(config('s3cret'));

    expect(guard.canActivate(contextWith('s3cret'))).toBe(true);
  });

  it.each([
    ['a wrong key', 'nope'],
    ['a prefix of the right key', 's3cre'],
    ['an empty key', ''],
  ])('rejects %s as UNAUTHENTICATED', (_case, provided) => {
    const guard = new GrpcInternalGuard(config('s3cret'));

    expect(() => guard.canActivate(contextWith(provided))).toThrow(
      RpcException,
    );
  });

  it('rejects a call carrying no key at all', () => {
    const guard = new GrpcInternalGuard(config('s3cret'));

    try {
      guard.canActivate(contextWith(undefined));
      fail('expected the guard to reject');
    } catch (error) {
      expect((error as RpcException).getError()).toMatchObject({
        code: GrpcStatus.UNAUTHENTICATED,
      });
    }
  });

  it('compares keys of different lengths without throwing', () => {
    // timingSafeEqual rejects buffers of unequal length outright, so the
    // comparison runs on fixed-length digests rather than the raw keys.
    const guard = new GrpcInternalGuard(config('short'));

    expect(() =>
      guard.canActivate(contextWith('a-considerably-longer-key')),
    ).toThrow(RpcException);
  });
});
