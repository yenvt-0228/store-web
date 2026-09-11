import { DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppRole, resolveAppRole } from '../common/app-role';
import { OrderModule } from '../order/order.module';
import { ProductModule } from '../product/product.module';
import { ReportModule } from '../report/report.module';
import { AuthGrpcController } from './auth.grpc.controller';
import { grpcEnabled } from './grpc.constant';
import { GrpcInternalGuard } from './grpc-internal.guard';
import { OrderGrpcController } from './order.grpc.controller';
import { ProductGrpcController } from './product.grpc.controller';
import { ReportGrpcController } from './report.grpc.controller';

export { grpcEnabled };

/**
 * Wires the internal gRPC surface.
 *
 * This is a transport, not a layer: every handler delegates to the same domain
 * service the HTTP controllers use, and adds only what the wire needs —
 * mapping to the proto message, and translating exceptions into gRPC statuses.
 *
 * It belongs to the HTTP process rather than the worker. The worker has no port
 * to serve on and answers no questions; it drains queues and the outbox. gRPC
 * is the synchronous, someone-is-waiting half of the system, which is exactly
 * what the API process already is.
 */
@Module({})
export class GrpcModule {
  static register(): DynamicModule {
    // The worker process runs `createApplicationContext`, so a controller here
    // would be built and never reachable.
    if (!grpcEnabled() || resolveAppRole() === AppRole.WORKER) {
      return { module: GrpcModule };
    }

    return {
      module: GrpcModule,
      imports: [
        OrderModule,
        ProductModule,
        AuthModule,
        ReportModule.register(),
      ],
      controllers: [
        OrderGrpcController,
        ProductGrpcController,
        AuthGrpcController,
        ReportGrpcController,
      ],
      providers: [GrpcInternalGuard],
    };
  }
}
