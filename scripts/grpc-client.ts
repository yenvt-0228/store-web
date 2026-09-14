/**
 * A hand-run client for the internal gRPC API.
 *
 * Two jobs in one file. It is the smoke test for a server you just started —
 * `curl` cannot speak protobuf and this machine may not have `grpcurl` — and it
 * is the worked example of the client side: this is what the shipping service
 * would write to call us.
 *
 *   npm run grpc:try                      # every call, in order
 *   npm run grpc:try -- GetOrder DH-001   # just one
 *
 * Reads GRPC_URL and GRPC_INTERNAL_KEY from .env.
 */
import 'dotenv/config';
import {
  credentials,
  loadPackageDefinition,
  Metadata,
  type ChannelCredentials,
  type Client,
  type ClientReadableStream,
  type ServiceError,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import {
  GRPC_DEFAULT_URL,
  GRPC_INTERNAL_KEY,
  GRPC_LOADER_OPTIONS,
  GRPC_PROTO_PATHS,
} from '../src/grpc/grpc.constant';

type Unary = (
  payload: unknown,
  metadata: Metadata,
  callback: (error: ServiceError | null, value?: unknown) => void,
) => void;

type Streaming = (
  payload: unknown,
  metadata: Metadata,
) => ClientReadableStream<unknown>;

type RpcClient = Client & Record<string, Unary | Streaming>;
type ClientCtor = new (url: string, creds: ChannelCredentials) => RpcClient;

const url = process.env.GRPC_URL ?? GRPC_DEFAULT_URL;
const key = process.env.GRPC_INTERNAL_KEY ?? '';

if (!key) {
  console.error(
    'GRPC_INTERNAL_KEY is not set. The server refuses every call without it.',
  );
  process.exit(1);
}

const proto = loadPackageDefinition(
  loadSync([...GRPC_PROTO_PATHS], GRPC_LOADER_OPTIONS),
) as unknown as { store: { v1: Record<string, ClientCtor> } };

const insecure = credentials.createInsecure();
const clients = {
  OrderService: new proto.store.v1.OrderService(url, insecure),
  ProductService: new proto.store.v1.ProductService(url, insecure),
  AuthService: new proto.store.v1.AuthService(url, insecure),
  ReportService: new proto.store.v1.ReportService(url, insecure),
};

function metadata(): Metadata {
  const meta = new Metadata();
  meta.set(GRPC_INTERNAL_KEY, key);
  return meta;
}

function unary(
  service: keyof typeof clients,
  method: string,
  payload: unknown,
): Promise<unknown> {
  const rpc = clients[service] as unknown as Record<string, Unary>;

  return new Promise((resolve, reject) => {
    rpc[method](payload, metadata(), (error, value) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    });
  });
}

/**
 * Runs one call and prints the outcome, including a refusal.
 *
 * A gRPC error is an expected answer here, not a crash: showing NOT_FOUND or
 * UNAUTHENTICATED next to the successful calls is half the point of the tool.
 */
async function show(label: string, run: () => Promise<unknown>): Promise<void> {
  process.stdout.write(`\n── ${label}\n`);

  try {
    console.dir(await run(), { depth: null });
  } catch (error) {
    const { code, details } = error as ServiceError;
    console.log(`   ✗ gRPC error ${code}: ${details}`);
  }
}

/** Follows the server stream to its end, printing each message as it lands. */
function watchReport(jobId: string): Promise<void> {
  const rpc = clients.ReportService as unknown as {
    WatchReport: Streaming;
  };

  return new Promise((resolve) => {
    const stream = rpc.WatchReport({ jobId }, metadata());

    stream.on('data', (message: unknown) =>
      console.dir(message, { depth: null }),
    );
    stream.on('end', () => resolve());
    stream.on('error', (error: ServiceError) => {
      console.log(`   ✗ gRPC error ${error.code}: ${error.details}`);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const [method, ...args] = process.argv.slice(2);
  console.log(`Calling ${url}`);

  if (method === 'GetOrder') {
    await show(method, () =>
      unary('OrderService', 'GetOrder', { orderCode: args[0] }),
    );
    return;
  }

  if (method === 'WatchReport') {
    await show(method, async () => {
      await watchReport(args[0]);
      return '(stream closed by the server)';
    });
    return;
  }

  // No argument: walk the whole surface, successes and refusals together.
  await show('CheckStock (empty basket)', () =>
    unary('ProductService', 'CheckStock', { items: [] }),
  );

  await show('GetOrder (an order code that will not exist)', () =>
    unary('OrderService', 'GetOrder', { orderCode: 'DH-DOES-NOT-EXIST' }),
  );

  await show('VerifyToken (garbage token)', () =>
    unary('AuthService', 'VerifyToken', { accessToken: 'not-a-jwt' }),
  );

  await show('GetOrder without the internal key — must be refused', () => {
    const rpc = clients.OrderService as unknown as Record<string, Unary>;

    return new Promise((resolve, reject) => {
      rpc.GetOrder({ orderCode: 'DH-001' }, new Metadata(), (error, value) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(value);
      });
    });
  });

  console.log(
    '\nA NOT_FOUND and an UNAUTHENTICATED above mean the server is wired correctly.',
  );
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const client of Object.values(clients)) client.close();
  });
