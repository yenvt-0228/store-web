import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { GrpcExceptionFilter } from './grpc-exception.filter';

async function statusOf(exception: unknown) {
  const filter = new GrpcExceptionFilter();
  jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

  return firstValueFrom(filter.catch(exception)).catch(
    (error: { code: number; message: string }) => error,
  );
}

describe('GrpcExceptionFilter', () => {
  it.each([
    [new NotFoundException('no such order'), GrpcStatus.NOT_FOUND],
    [new BadRequestException('bad'), GrpcStatus.INVALID_ARGUMENT],
    [new UnauthorizedException('nope'), GrpcStatus.UNAUTHENTICATED],
    [new ForbiddenException('nope'), GrpcStatus.PERMISSION_DENIED],
    [new ServiceUnavailableException('off'), GrpcStatus.UNAVAILABLE],
  ])('maps %s onto the matching gRPC status', async (exception, expected) => {
    // Without the mapping every one of these reaches the caller as UNKNOWN,
    // and a client cannot tell "never retry this" from "back off and retry".
    await expect(statusOf(exception)).resolves.toMatchObject({
      code: expected,
    });
  });

  it('keeps the message of a deliberate refusal', async () => {
    await expect(
      statusOf(new NotFoundException('no such order')),
    ).resolves.toMatchObject({ message: 'no such order' });
  });

  it('maps an HTTP status it does not know onto INTERNAL', async () => {
    await expect(
      statusOf(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT)),
    ).resolves.toMatchObject({ code: GrpcStatus.INTERNAL });
  });

  it('passes a gRPC error through untouched', async () => {
    // `@Catch()` takes everything, including the UNAUTHENTICATED the guard
    // raises. Flattening that to INTERNAL told a caller with a bad key that the
    // server was broken — which is both wrong and the kind of thing that gets
    // debugged from the wrong end for an afternoon.
    const refusal = new RpcException({
      code: GrpcStatus.UNAUTHENTICATED,
      message: 'missing or invalid x-internal-key',
    });

    await expect(statusOf(refusal)).resolves.toEqual({
      code: GrpcStatus.UNAUTHENTICATED,
      message: 'missing or invalid x-internal-key',
    });
  });

  it('does not leak the detail of an unexpected error to the caller', async () => {
    // A stack trace crossing a service boundary tells the caller about
    // internals it has no business knowing; it is logged on this side instead.
    await expect(
      statusOf(new Error('connect ECONNREFUSED 10.0.0.5:5432')),
    ).resolves.toEqual({
      code: GrpcStatus.INTERNAL,
      message: 'internal error',
    });
  });
});
