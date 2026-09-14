import { loadSync } from '@grpc/proto-loader';
import type { ServiceDefinition } from '@grpc/proto-loader';
import {
  GRPC_LOADER_OPTIONS,
  GRPC_PACKAGE,
  GRPC_PROTO_PATHS,
} from './grpc.constant';
import { AuthGrpcController } from './auth.grpc.controller';
import { OrderGrpcController } from './order.grpc.controller';
import { ProductGrpcController } from './product.grpc.controller';
import { ReportGrpcController } from './report.grpc.controller';

/**
 * The contract, written once.
 *
 * `grpc.interface.ts` is hand-written, so nothing but this file stops the .proto
 * and the TypeScript from drifting apart. Renaming an rpc in the proto without
 * touching the controller compiles cleanly and fails at runtime with
 * UNIMPLEMENTED, which is exactly the class of mistake generated stubs exist to
 * prevent — so it is caught here instead.
 */
const CONTRACT = {
  OrderService: { GetOrder: 'getOrder', ListOrders: 'listOrders' },
  ProductService: { GetProduct: 'getProduct', CheckStock: 'checkStock' },
  AuthService: { VerifyToken: 'verifyToken' },
  ReportService: { WatchReport: 'watchReport' },
} as const;

const CONTROLLERS: Record<keyof typeof CONTRACT, { prototype: object }> = {
  OrderService: OrderGrpcController,
  ProductService: ProductGrpcController,
  AuthService: AuthGrpcController,
  ReportService: ReportGrpcController,
};

const definition = loadSync([...GRPC_PROTO_PATHS], GRPC_LOADER_OPTIONS);

describe('gRPC contract', () => {
  it('resolves the proto paths from this file, so dist resolves them too', () => {
    // GRPC_PROTO_PATHS is built from __dirname. If that were wrong the server
    // would fail to boot, and loadSync above would have thrown already.
    expect(GRPC_PROTO_PATHS).toHaveLength(4);
  });

  describe.each(Object.entries(CONTRACT))('%s', (service, methods) => {
    const qualified = `${GRPC_PACKAGE}.${service}`;

    it('is declared in the proto under the expected package', () => {
      expect(definition[qualified]).toBeDefined();
    });

    it.each(Object.entries(methods))(
      'declares %s and implements it as %s()',
      (rpc, handler) => {
        const rpcs = definition[qualified] as ServiceDefinition;

        expect(Object.keys(rpcs)).toContain(rpc);
        expect(
          CONTROLLERS[service as keyof typeof CONTRACT].prototype,
        ).toHaveProperty(handler);
      },
    );
  });

  it('keeps WatchReport a server-streaming rpc', () => {
    // Dropping `stream` from the proto would turn the whole point of this
    // endpoint into a single reply, and every client would still compile.
    const reports = definition[
      `${GRPC_PACKAGE}.ReportService`
    ] as ServiceDefinition;

    expect(reports.WatchReport.responseStream).toBe(true);
    expect(reports.WatchReport.requestStream).toBe(false);
  });

  describe.each([
    ['Order', 'totalAmount'],
    ['OrderItem', 'productPrice'],
    ['OrderItem', 'subtotal'],
    ['Product', 'price'],
  ])('%s.%s', (message, field) => {
    it('carries money as a string, never as a floating point number', () => {
      // 1234.56 has no exact double. Switching any of these to `double` still
      // compiles, still round-trips in a smoke test, and quietly loses a cent
      // somewhere around the thousandth invoice.
      expect(fieldsOf(message)[field]?.type).toBe('TYPE_STRING');
    });
  });

  it('never renumbers a field of Order', () => {
    // The number is the identity on the wire, not the name. Renaming a field is
    // backwards compatible; renumbering one silently makes an old client read
    // the address out of the status field. Pinned so that change cannot pass
    // review unnoticed.
    const numbers = Object.fromEntries(
      Object.entries(fieldsOf('Order')).map(([name, f]) => [name, f.number]),
    );

    expect(numbers).toEqual({
      id: 1,
      orderCode: 2,
      status: 3,
      paymentStatus: 4,
      paymentMethod: 5,
      totalAmount: 6,
      shipping: 7,
      items: 8,
      createdAt: 9,
    });
  });
});

interface ProtoField {
  name: string;
  number: number;
  type: string;
}

/**
 * @param message - Message name, without the package prefix.
 * @returns Its fields, keyed by name as `keepCase: false` renders them.
 */
function fieldsOf(message: string): Record<string, ProtoField> {
  const descriptor = definition[`${GRPC_PACKAGE}.${message}`] as unknown as {
    type: { field: ProtoField[] };
  };

  return Object.fromEntries(
    descriptor.type.field.map((field) => [field.name, field]),
  );
}
