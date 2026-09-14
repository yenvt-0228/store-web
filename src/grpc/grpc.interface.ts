/**
 * TypeScript shapes of the messages in `proto/`.
 *
 * Hand-written rather than generated: `@grpc/proto-loader` reads the .proto at
 * runtime and needs no build step, so a fresh clone compiles without one too.
 * The risk is drift, and `grpc.contract.spec.ts` is what covers it — it loads
 * the real .proto files and asserts every service and method named here exists.
 *
 * Field names are camelCase because `keepCase: false` converts them; see
 * `GRPC_LOADER_OPTIONS`.
 */

// --- order.proto -------------------------------------------------------------

export interface GetOrderRequest {
  orderCode: string;
}

export interface ListOrdersRequest {
  userId: string;
  status: string;
  page: number;
  limit: number;
}

export interface ListOrdersResponse {
  orders: Order[];
  total: number;
}

export interface Order {
  id: string;
  orderCode: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  totalAmount: string;
  shipping: Shipping;
  items: OrderItem[];
  createdAt: string;
}

export interface Shipping {
  name: string;
  phone: string;
  address: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  productPrice: string;
  quantity: number;
  subtotal: string;
}

// --- product.proto -----------------------------------------------------------

export interface GetProductRequest {
  id: string;
}

export interface Product {
  id: string;
  name: string;
  price: string;
  quantity: number;
  status: string;
}

export interface CheckStockRequest {
  items: StockQuery[];
}

export interface StockQuery {
  productId: string;
  quantity: number;
}

export interface CheckStockResponse {
  allAvailable: boolean;
  lines: StockLine[];
}

export interface StockLine {
  productId: string;
  requested: number;
  available: number;
  sufficient: boolean;
  found: boolean;
}

// --- auth.proto --------------------------------------------------------------

export interface VerifyTokenRequest {
  accessToken: string;
}

export interface TokenClaims {
  userId: string;
  email: string;
  roles: string[];
}

// --- report.proto ------------------------------------------------------------

export interface WatchReportRequest {
  jobId: string;
}

export interface ReportProgress {
  jobId: string;
  state: string;
  progress: number;
  objectKey: string;
  rows: number;
  truncated: boolean;
  failedReason: string;
}
