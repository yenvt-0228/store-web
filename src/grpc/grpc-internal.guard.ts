import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { status as GrpcStatus, type Metadata } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { createHash, timingSafeEqual } from 'node:crypto';
import { GRPC_INTERNAL_KEY } from './grpc.constant';

/**
 * Lets only callers holding the shared internal key through.
 *
 * This matters more here than on any HTTP route. `GetOrder` answers with a
 * customer's name, phone number and address, and unlike the REST API there is
 * no `JwtAuthGuard` in front of it — the caller is a service, not a person, so
 * there is no user token to check. An unauthenticated gRPC port reachable from
 * outside the cluster is a customer-data dump behind one `grpcurl`.
 *
 * A shared secret is the floor, not the ceiling: mTLS is what you want once
 * more than two services talk to each other.
 */
@Injectable()
export class GrpcInternalGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(config: ConfigService) {
    // getOrThrow, so a deployment that enables gRPC without setting a key fails
    // at boot instead of serving customer data to anyone who can reach the port.
    this.expected = digest(config.getOrThrow<string>('GRPC_INTERNAL_KEY'));
  }

  canActivate(context: ExecutionContext): boolean {
    const metadata = context.switchToRpc().getContext<Metadata>();
    const provided = metadata.get(GRPC_INTERNAL_KEY)[0];

    if (typeof provided !== 'string' || !this.matches(provided)) {
      throw new RpcException({
        code: GrpcStatus.UNAUTHENTICATED,
        message: `missing or invalid ${GRPC_INTERNAL_KEY}`,
      });
    }

    return true;
  }

  private matches(provided: string): boolean {
    // Compared as fixed-length digests: `timingSafeEqual` throws on a length
    // mismatch, and the length of a rejected key is itself a hint worth not
    // leaking.
    return timingSafeEqual(digest(provided), this.expected);
  }
}

/**
 * @param value - Secret to reduce to a fixed-length buffer.
 * @returns Its SHA-256 digest.
 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
