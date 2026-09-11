import { Module, type INestMicroservice } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  credentials,
  loadPackageDefinition,
  type ChannelCredentials,
  Metadata,
  status as GrpcStatus,
  type Client,
  type ClientReadableStream,
  type ServiceError,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { NotFoundException } from '@nestjs/common';
import { OrderService } from '../order/order.service';
import { ProductService } from '../product/product.service';
import { ReportService } from '../report/report.service';
import { AuthGrpcController } from './auth.grpc.controller';
import { JwtService } from '@nestjs/jwt';
import { JwtStrategy } from '../auth/jwt.strategy';
import { GrpcInternalGuard } from './grpc-internal.guard';
import { OrderGrpcController } from './order.grpc.controller';
import { ProductGrpcController } from './product.grpc.controller';
import { ReportGrpcController } from './report.grpc.controller';
import {
  GRPC_INTERNAL_KEY,
  GRPC_LOADER_OPTIONS,
  GRPC_PACKAGE,
  GRPC_PROTO_PATHS,
} from './grpc.constant';

/**
 * The one test that proves the wiring, not just the code.
 *
 * Everything else here mocks the transport away. This binds a real port, loads
 * the real .proto and speaks real protobuf over a real socket, which is the only
 * way to catch the failures that live between the pieces: a proto path that does
 * not resolve, an rpc name the server never registered, metadata the guard reads
 * from the wrong place, a stream that never closes.
 *
 * No database and no Redis — the domain services are stubs. This is about the
 * transport.
 */
const KEY = 'test-internal-key';
const URL = '127.0.0.1:50951';

const ORDER = {
  id: 'a9f0-1',
  orderCode: 'DH-001',
  status: 'CONFIRMED',
  paymentStatus: 'PAID',
  paymentMethod: 'COD',
  totalAmount: 1234.5,
  shipping: { name: 'Nguyễn Văn A', phone: '0900000000', address: '1 Đường A' },
  items: [
    {
      id: 'i-1',
      productId: 'p-1',
      productName: 'Bàn phím',
      productPrice: 617.25,
      quantity: 2,
      subtotal: 1234.5,
    },
  ],
  payment: null,
  cancelReason: null,
  rejectReason: null,
  createdAt: new Date('2026-09-10T03:00:00.000Z'),
};

const reportStates = [
  {
    jobId: '7',
    state: 'active',
    progress: 40,
    result: null,
    failedReason: null,
  },
  {
    jobId: '7',
    state: 'completed',
    progress: 100,
    result: {
      objectKey: 'reports/orders-1.xlsx',
      rows: 3,
      bytes: 10,
      buildMs: 1,
      truncated: false,
    },
    failedReason: null,
  },
];

@Module({
  controllers: [
    OrderGrpcController,
    ProductGrpcController,
    AuthGrpcController,
    ReportGrpcController,
  ],
  providers: [
    GrpcInternalGuard,
    { provide: ConfigService, useValue: { getOrThrow: () => KEY } },
    {
      provide: OrderService,
      useValue: {
        findByCode: (code: string) =>
          code === ORDER.orderCode
            ? Promise.resolve(ORDER)
            : Promise.reject(new NotFoundException('no such order')),
        findAll: () =>
          Promise.resolve({
            data: [ORDER],
            meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
          }),
      },
    },
    {
      provide: ProductService,
      useValue: {
        findOne: () =>
          Promise.resolve({
            id: 'p-1',
            name: 'Bàn phím',
            price: 617.2,
            quantity: 5,
            status: 'ACTIVE',
          }),
        checkStock: () => Promise.resolve({ allAvailable: true, lines: [] }),
      },
    },
    {
      provide: ReportService,
      useValue: {
        status: () => Promise.resolve(reportStates.shift() ?? reportStates[0]),
      },
    },
    { provide: JwtService, useValue: {} },
    { provide: JwtStrategy, useValue: {} },
  ],
})
class GrpcTestModule {}

/**
 * `loadPackageDefinition` builds the client classes at runtime, so there is no
 * static type for them. This is the smallest honest description of what is
 * actually called below.
 */
type Unary = (
  payload: unknown,
  metadata: Metadata,
  callback: (error: ServiceError | null, value?: unknown) => void,
) => void;

type Streaming = (
  payload: unknown,
  metadata: Metadata,
) => ClientReadableStream<Record<string, unknown>>;

type RpcClient = Client & Record<string, Unary | Streaming>;

type ClientCtor = new (url: string, creds: ChannelCredentials) => RpcClient;

function metadata(key = KEY): Metadata {
  const meta = new Metadata();
  meta.set(GRPC_INTERNAL_KEY, key);
  return meta;
}

describe('gRPC transport (real socket)', () => {
  let server: INestMicroservice;
  let orders: RpcClient;
  let products: RpcClient;
  let reports: RpcClient;

  beforeAll(async () => {
    server = await NestFactory.createMicroservice<MicroserviceOptions>(
      GrpcTestModule,
      {
        transport: Transport.GRPC,
        options: {
          package: GRPC_PACKAGE,
          protoPath: [...GRPC_PROTO_PATHS],
          url: URL,
          loader: GRPC_LOADER_OPTIONS,
        },
        logger: false,
      },
    );
    await server.listen();

    const proto = loadPackageDefinition(
      loadSync([...GRPC_PROTO_PATHS], GRPC_LOADER_OPTIONS),
    ) as unknown as { store: { v1: Record<string, ClientCtor> } };

    const pkg = proto.store.v1;
    const insecure = credentials.createInsecure();
    orders = new pkg.OrderService(URL, insecure);
    products = new pkg.ProductService(URL, insecure);
    reports = new pkg.ReportService(URL, insecure);
  });

  afterAll(async () => {
    orders.close();
    products.close();
    reports.close();
    await server.close();
  });

  function call(
    client: RpcClient,
    method: string,
    payload: unknown,
    meta: Metadata = metadata(),
  ): Promise<Record<string, unknown>> {
    // Called as a property of the client, not through `.call`: grpc-js needs the
    // client as `this`, and this project sets `strictBindCallApply: false`, so
    // `.call` hands back `any` and takes the callback's types with it.
    const rpc = client as unknown as Record<string, Unary>;

    return new Promise((resolve, reject) => {
      rpc[method](payload, meta, (error, value) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(value as Record<string, unknown>);
      });
    });
  }

  it('answers a unary call end to end', async () => {
    // camelCase on BOTH sides: field names never travel in binary protobuf —
    // only field numbers do — and `keepCase: false` is what each end uses to
    // render the descriptor into JavaScript. snake_case belongs to the .proto
    // file and to text clients like grpcurl, not to this call.
    const order = await call(orders, 'GetOrder', { orderCode: 'DH-001' });

    expect(order).toMatchObject({
      orderCode: 'DH-001',
      totalAmount: '1234.50',
      createdAt: '2026-09-10T03:00:00.000Z',
    });
  });

  it('drops a field the proto does not declare, instead of forwarding it', async () => {
    // The schema is the filter: an unknown field never reaches the handler.
    const order = await call(orders, 'GetOrder', {
      orderCode: 'DH-001',
      notInTheProto: 'ignored',
    });

    expect(order).not.toHaveProperty('notInTheProto');
    expect(order).not.toHaveProperty('cancelReason');
  });

  it('turns a NotFoundException into NOT_FOUND on the wire', async () => {
    await expect(
      call(orders, 'GetOrder', { orderCode: 'nope' }),
    ).rejects.toMatchObject({ code: GrpcStatus.NOT_FOUND });
  });

  it('rejects a call with no internal key as UNAUTHENTICATED', async () => {
    await expect(
      call(orders, 'GetOrder', { orderCode: 'DH-001' }, new Metadata()),
    ).rejects.toMatchObject({ code: GrpcStatus.UNAUTHENTICATED });
  });

  it('rejects a call with the wrong internal key', async () => {
    await expect(
      call(products, 'GetProduct', { id: 'p-1' }, metadata('wrong')),
    ).rejects.toMatchObject({ code: GrpcStatus.UNAUTHENTICATED });
  });

  it('fills proto3 defaults for fields the caller left out', async () => {
    // No `items` in the request at all; the handler still receives [].
    const result = await call(products, 'CheckStock', {});

    expect(result).toEqual({ allAvailable: true, lines: [] });
  });

  it('streams several messages and closes the call itself', async () => {
    const seen: Record<string, unknown>[] = [];

    const rpc = reports as unknown as { WatchReport: Streaming };
    const stream = rpc.WatchReport({ jobId: '7' }, metadata());

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (message: Record<string, unknown>) =>
        seen.push(message),
      );
      // 'end' is the server closing the stream, which is what completing the
      // Observable has to produce. A stream that only stops arriving would hang
      // this test instead.
      stream.on('end', () => resolve());
      stream.on('error', (error: Error) => reject(error));
    });

    expect(seen.map((m) => m.state)).toEqual(['active', 'completed']);
    expect(seen[1]).toMatchObject({
      objectKey: 'reports/orders-1.xlsx',
      rows: 3,
      // proto3 default, not undefined.
      failedReason: '',
    });
  }, 15_000);
});
