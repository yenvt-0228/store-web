import { INestApplication } from '@nestjs/common';
import {
  credentials,
  loadPackageDefinition,
  Metadata,
  status as GrpcStatus,
  type ChannelCredentials,
  type Client,
  type ClientReadableStream,
  type ServiceError,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import {
  GRPC_INTERNAL_KEY,
  GRPC_LOADER_OPTIONS,
  GRPC_PROTO_PATHS,
} from '../src/grpc/grpc.constant';
import { OrderStatus, UserStatus } from '../src/generated/prisma/enums';
import {
  createTestApp,
  db,
  resetDb,
  seedProduct,
  seedUser,
  shippingInfo,
} from './test-helpers';

/**
 * The gRPC surface against the real application.
 *
 * `src/grpc/grpc.transport.spec.ts` already proves the wire format with stubbed
 * services. What it cannot prove is that `GrpcModule` is reachable from the real
 * `AppModule` at all — a module gated behind an env flag and a role check is
 * exactly the kind of thing that silently registers nothing. This boots the
 * whole app, hits a real database and asks over a real socket.
 */
const URL = '127.0.0.1:50952';
const KEY = process.env.GRPC_INTERNAL_KEY ?? 'e2e-internal-key';

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

function meta(key: string = KEY): Metadata {
  const metadata = new Metadata();
  metadata.set(GRPC_INTERNAL_KEY, key);
  return metadata;
}

function call(
  client: RpcClient,
  method: string,
  payload: unknown,
  metadata: Metadata = meta(),
): Promise<Record<string, unknown>> {
  const rpc = client as unknown as Record<string, Unary>;

  return new Promise((resolve, reject) => {
    rpc[method](payload, metadata, (error, value) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(value as Record<string, unknown>);
    });
  });
}

describe('gRPC (e2e) — internal API on the real app', () => {
  let app: INestApplication;
  let orders: RpcClient;
  let products: RpcClient;
  let auth: RpcClient;

  beforeAll(async () => {
    app = await createTestApp({ grpcUrl: URL });

    const proto = loadPackageDefinition(
      loadSync([...GRPC_PROTO_PATHS], GRPC_LOADER_OPTIONS),
    ) as unknown as { store: { v1: Record<string, ClientCtor> } };

    const pkg = proto.store.v1;
    const insecure = credentials.createInsecure();
    orders = new pkg.OrderService(URL, insecure);
    products = new pkg.ProductService(URL, insecure);
    auth = new pkg.AuthService(URL, insecure);
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  afterAll(async () => {
    orders.close();
    products.close();
    auth.close();
    await app.close();
  });

  async function seedOrder(overrides: { status?: OrderStatus } = {}) {
    const user = await seedUser(app, { email: 'grpc@example.com' });
    const product = await seedProduct(app, { price: 617.25, quantity: 10 });

    const order = await db(app).order.create({
      data: {
        userId: user.id,
        orderCode: 'DH-GRPC-1',
        paymentMethod: 'COD',
        status: overrides.status ?? OrderStatus.CONFIRMED,
        totalAmount: 1234.5,
        shippingName: shippingInfo.shippingName,
        shippingPhone: shippingInfo.shippingPhone,
        shippingAddress: shippingInfo.shippingAddress,
        items: {
          create: [
            {
              productId: product.id,
              productName: product.name,
              productPrice: 617.25,
              quantity: 2,
              subtotal: 1234.5,
            },
          ],
        },
      },
    });

    return { user, product, order };
  }

  it('serves gRPC and HTTP from the same application', async () => {
    // The hybrid setup in main.ts is the claim being tested: one process, two
    // transports, one DI container. If GrpcModule had registered nothing, the
    // call below would fail with UNIMPLEMENTED.
    const { order } = await seedOrder();

    const reply = await call(orders, 'GetOrder', {
      orderCode: order.orderCode,
    });

    expect(reply).toMatchObject({ orderCode: 'DH-GRPC-1' });
    expect(app.getHttpServer()).toBeDefined();
  });

  it('reads a real order out of the database', async () => {
    const { order, product } = await seedOrder();

    const reply = await call(orders, 'GetOrder', {
      orderCode: order.orderCode,
    });

    expect(reply).toMatchObject({
      id: order.id,
      orderCode: 'DH-GRPC-1',
      status: 'CONFIRMED',
      // Decimal(12,2) survives the trip as a string, not as 1234.5.
      totalAmount: '1234.50',
      shipping: {
        name: shippingInfo.shippingName,
        phone: shippingInfo.shippingPhone,
        address: shippingInfo.shippingAddress,
      },
      items: [
        {
          productId: product.id,
          productPrice: '617.25',
          quantity: 2,
          subtotal: '1234.50',
        },
      ],
    });
    expect(reply.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('answers NOT_FOUND for an order code that does not exist', async () => {
    await expect(
      call(orders, 'GetOrder', { orderCode: 'DH-NOPE' }),
    ).rejects.toMatchObject({ code: GrpcStatus.NOT_FOUND });
  });

  it('lists a customer’s orders with a real total', async () => {
    const { user } = await seedOrder();

    const reply = await call(orders, 'ListOrders', {
      userId: user.id,
      status: '',
      page: 0,
      limit: 0,
    });

    expect(reply.total).toBe(1);
    expect(reply.orders).toHaveLength(1);
  });

  it('refuses a caller without the internal key', async () => {
    // The endpoint answers with a customer's name, phone and address, and there
    // is no user login in front of it.
    const { order } = await seedOrder();

    await expect(
      call(orders, 'GetOrder', { orderCode: order.orderCode }, new Metadata()),
    ).rejects.toMatchObject({ code: GrpcStatus.UNAUTHENTICATED });
  });

  it('refuses a caller with the wrong internal key', async () => {
    await expect(
      call(products, 'GetProduct', { id: 'whatever' }, meta('wrong-key')),
    ).rejects.toMatchObject({ code: GrpcStatus.UNAUTHENTICATED });
  });

  it('reports real stock, and tells a missing product from a sold-out one', async () => {
    const product = await seedProduct(app, { quantity: 3 });

    const reply = await call(products, 'CheckStock', {
      items: [
        { productId: product.id, quantity: 2 },
        { productId: product.id, quantity: 99 },
        { productId: '00000000-0000-4000-8000-000000000000', quantity: 1 },
      ],
    });

    expect(reply.allAvailable).toBe(false);
    expect(reply.lines).toEqual([
      {
        productId: product.id,
        requested: 2,
        available: 3,
        sufficient: true,
        found: true,
      },
      {
        productId: product.id,
        requested: 99,
        available: 3,
        sufficient: false,
        found: true,
      },
      {
        productId: '00000000-0000-4000-8000-000000000000',
        requested: 1,
        available: 0,
        sufficient: false,
        found: false,
      },
    ]);
  });

  it('verifies a token issued by the HTTP side of the same app', async () => {
    const user = await seedUser(app, {
      email: 'claims@example.com',
      roles: ['ADMIN'],
    });

    await expect(
      call(auth, 'VerifyToken', { accessToken: user.accessToken }),
    ).resolves.toEqual({
      userId: user.id,
      email: 'claims@example.com',
      roles: ['ADMIN'],
    });
  });

  it('refuses a token whose account was deactivated after it was issued', async () => {
    // The reason this endpoint exists rather than sharing the JWT secret: the
    // signature is still perfectly valid here.
    const user = await seedUser(app, { email: 'gone@example.com' });
    await db(app).user.update({
      where: { id: user.id },
      data: { status: UserStatus.INACTIVE },
    });

    await expect(
      call(auth, 'VerifyToken', { accessToken: user.accessToken }),
    ).rejects.toMatchObject({ code: GrpcStatus.PERMISSION_DENIED });
  });

  it('refuses a garbage token as UNAUTHENTICATED', async () => {
    await expect(
      call(auth, 'VerifyToken', { accessToken: 'not-a-jwt' }),
    ).rejects.toMatchObject({ code: GrpcStatus.UNAUTHENTICATED });
  });

  it('does not require the internal key to verify a token', async () => {
    // The token IS the credential there; every other endpoint needs the key.
    const user = await seedUser(app, { email: 'nokey@example.com' });

    await expect(
      call(
        auth,
        'VerifyToken',
        { accessToken: user.accessToken },
        new Metadata(),
      ),
    ).resolves.toMatchObject({ userId: user.id });
  });
});
