import {
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';

/**
 * gRPC status for each HTTP status the services throw.
 *
 * Without this every failure reaches the caller as UNKNOWN(2), and a caller
 * cannot tell "no such order" from "the database is down" — one is a normal
 * answer to retry never, the other is a reason to back off and try again.
 */
const GRPC_STATUS_BY_HTTP: Partial<Record<number, GrpcStatus>> = {
  [HttpStatus.BAD_REQUEST]: GrpcStatus.INVALID_ARGUMENT,
  [HttpStatus.UNAUTHORIZED]: GrpcStatus.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: GrpcStatus.PERMISSION_DENIED,
  [HttpStatus.NOT_FOUND]: GrpcStatus.NOT_FOUND,
  [HttpStatus.CONFLICT]: GrpcStatus.ALREADY_EXISTS,
  [HttpStatus.UNPROCESSABLE_ENTITY]: GrpcStatus.INVALID_ARGUMENT,
  [HttpStatus.TOO_MANY_REQUESTS]: GrpcStatus.RESOURCE_EXHAUSTED,
  [HttpStatus.SERVICE_UNAVAILABLE]: GrpcStatus.UNAVAILABLE,
  [HttpStatus.GATEWAY_TIMEOUT]: GrpcStatus.DEADLINE_EXCEEDED,
};

/**
 * Turns the exceptions the domain services already throw into gRPC statuses.
 *
 * The services are shared with the HTTP API and throw `NotFoundException` and
 * friends. Rewriting them to throw `RpcException` instead would mean two error
 * vocabularies for one piece of logic, so the translation happens here, at the
 * transport boundary where it belongs.
 */
@Catch()
export class GrpcExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GrpcExceptionFilter.name);

  /**
   * @param exception - Anything thrown by a handler.
   * @returns An observable that errors with a gRPC status object.
   */
  catch(exception: unknown): Observable<never> {
    // Already a gRPC error — the guard raises these. `@Catch()` takes
    // everything, so without this branch an UNAUTHENTICATED from the guard came
    // out the other side as INTERNAL, and a caller with a bad key was told the
    // server was broken.
    if (exception instanceof RpcException) {
      return throwError(() => exception.getError());
    }

    if (exception instanceof HttpException) {
      const code =
        GRPC_STATUS_BY_HTTP[exception.getStatus()] ?? GrpcStatus.INTERNAL;

      return throwError(() => ({ code, message: exception.message }));
    }

    // Anything else is a bug rather than a refusal, so it is logged in full
    // here and reduced to a flat message on the wire: a stack trace crossing a
    // service boundary tells the caller about internals it has no business
    // knowing.
    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );

    return throwError(() => ({
      code: GrpcStatus.INTERNAL,
      message: 'internal error',
    }));
  }
}
