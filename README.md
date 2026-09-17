# Store Web API

API web bán hàng — NestJS 11 + Prisma 7 (PostgreSQL/Neon) + Redis.

Xây dựng theo hai tài liệu thiết kế:

- **Sơ đồ ERD Web bán hàng** — cấu trúc bảng, kiểu dữ liệu, quan hệ.
- **Xây dựng web site bán hàng (CSV)** — danh sách chức năng/endpoint theo từng
  vai trò Guest / User / Admin / System.

## Nội dung phát triển

Đã xong: **Auth + RBAC**, **catalog** (categories, products), **upload ảnh lên S3/R2**,
**giỏ hàng trên Redis**, **đơn hàng** và **thanh toán**, kèm hạ tầng dùng chung
(Redis, email theo event/queue, cron dọn dẹp).

Chưa làm: comments, reviews, chat, product-suggestions, statistics (đã có xuất báo cáo
đơn hàng ra `.xlsx` chạy nền).

Tài liệu Swagger: `http://localhost:3001/docs`

### Endpoint

| Nhóm | Endpoint |
| --- | --- |
| Auth | `POST /auth/register` · `GET /auth/activate` · `POST /auth/login` · `POST /auth/google` · `refresh` · `logout` · `forgot-password` · `reset-password` |
| User | `GET/PATCH /users/me` · `PATCH /users/me/password` |
| Sản phẩm (khách) | `GET /products` · `GET /products/featured` · `GET /products/:id` |
| Upload ảnh | `POST /admin/uploads/images` (admin, ≤10 file) · `POST /uploads/avatar` |
| Giỏ hàng | `GET /cart` · `POST /cart/items` · `PATCH /cart/items/:id` · `DELETE /cart/items/:id` · `DELETE /cart` |
| Đơn hàng | `POST /orders` · `GET /orders` · `GET /orders/:id` · `PATCH /orders/:id/cancel` |
| Thanh toán | `POST /payments` · `POST /payments/mock-callback` · `GET /payments/:orderId` |
| Admin | `/admin/users` (kèm `PATCH /:id` · `PATCH /:id/status`) · `/admin/categories` · `/admin/products` (kèm `/:id/images`) · `/admin/orders` |

### Lỗi database không lọt ra thành 500

Cả repo đi theo mẫu **kiểm tra rồi mới ghi** (`findUnique` xem email đã tồn tại chưa, rồi
mới `create`). Giữa hai bước đó có khe hở: hai request song song cùng đọc thấy "chưa có",
cùng đi tiếp, và **unique index của database mới là thứ chặn thật**. Lỗi Prisma ném ra
lúc đó không phải `HttpException` nên `HttpExceptionFilter` không bắt, nó rơi xuống
handler mặc định của Nest và client nhận **500**.

Đo thử bằng 8 request `POST /auth/register` cùng email chạy song song: **7/8 trả 500**.

`PrismaExceptionFilter` dịch mã lỗi Prisma sang HTTP status:

| Mã | HTTP | Khi nào |
| --- | --- | --- |
| `P2002` | 409 | ghi trùng giá trị cột `@unique` |
| `P2025` | 404 | `update`/`delete` nhắm vào bản ghi không còn |
| `P2003` | 400 | khoá ngoại trỏ tới bản ghi không có thật |
| khác | 500 | vẫn 500, nhưng log lại mã để còn lần ra |

Filter đứng ở **tầng cuối**: service nào đã tự tiền kiểm và ném `ConflictException` thì
không chạm tới nó — filter chỉ đỡ những gì lọt lưới. Nhờ vậy không phải đi vá từng
service, và chỗ nào quên tiền kiểm cũng tự động trả đúng mã.

### Admin sửa thông tin user

`PATCH /admin/users/:id` dùng `AdminUpdateUserDto`, lấy đúng bốn field mà chính người dùng
tự sửa được (`PickType` từ `UpdateProfileDto`): `name`, `phone`, `address`, `locale`.

**Cố ý không có `email` và `password`.** Đổi `email` là chiếm danh tính — và còn phá phần
liên kết Google, vì đổi sang email người khác rồi đăng nhập Google bằng email đó là vào
được tài khoản của họ. Đổi `password` ở đây thì đi vòng qua `changePassword()`, bỏ qua
kiểm mật khẩu cũ lẫn bước thu hồi refresh token. Khoá/mở tài khoản đã có endpoint riêng
`PATCH /admin/users/:id/status`.

### Đăng nhập bằng Google

`POST /auth/google` nhận **ID token** do Google Identity Services cấp cho frontend và
trả về đúng shape `{ user, tokens }` như `/auth/login` — không có redirect, không session,
nên phần còn lại của API không phải biết tài khoản đến từ đâu.

`GoogleAuthService.verifyIdToken` gọi `OAuth2Client.verifyIdToken` với `audience =
GOOGLE_CLIENT_ID`, nên chữ ký, `iss`, `aud` và `exp` đều được Google kiểm; **mọi thông tin
người dùng lấy từ payload đã verify, không tin field nào client gửi kèm**. Token thiếu
`email_verified` bị từ chối — nếu không, ai đó tạo Google account mang email của người khác
là chiếm được tài khoản qua bước liên kết bên dưới.

Email trùng với tài khoản có sẵn thì **liên kết vào tài khoản đó** (ghi `google_id`,
bật `is_verified`) chứ không tạo tài khoản thứ hai; `name`/`avatar` người dùng đã tự sửa
không bị Google ghi đè. Tài khoản tạo mới từ Google được `is_verified = true` ngay và
nhận role `USER`. Tài khoản bị khoá (`INACTIVE`) bị từ chối **trước khi** ghi `google_id`.

**Liên kết vào tài khoản chưa từng kích hoạt thì mật khẩu trên đó bị xoá** (`password =
NULL`). Nếu không, ai cũng có thể đăng ký trước bằng email người khác rồi ngồi chờ: chủ
email đăng nhập Google là `is_verified` được bật giùm, và mật khẩu kẻ kia đặt lúc đăng ký
bỗng dùng được để vào chính tài khoản đó. Tài khoản đã verified từ trước thì giữ nguyên
mật khẩu — chủ nhân đã chứng minh sở hữu email rồi. `test/auth-google.e2e-spec.ts` có
test hồi quy cho cả hai nhánh.

Tra cứu đi theo thứ tự **`google_id` trước, email sau** (hai `findUnique` riêng, không
gộp `OR`): `google_id` là danh tính thật, còn email có thể đã đổi chủ. Gộp `OR` thì khi
người dùng đổi địa chỉ Gmail, hai điều kiện trúng hai bản ghi khác nhau và kết quả tuỳ
database. Hai request đăng nhập đầu tiên chạy song song thì request thua cuộc bắt `P2002`
và dùng lại bản ghi request kia vừa tạo, thay vì trả 500.

Email được hạ về chữ thường ngay ở DTO (`@NormalizeEmail`) cho `register` / `login` /
`forgot-password`, vì unique index của Postgres phân biệt hoa thường còn Google thì luôn
trả email chữ thường — không chuẩn hoá thì `Alice@Example.com` và `alice@example.com`
thành hai tài khoản. Migration `normalize_user_emails` hạ nốt dữ liệu cũ, và **bỏ qua**
những hàng mà việc hạ chữ sẽ đụng một tài khoản khác (hai tài khoản thật, phải xử lý tay)
để không làm chết lần deploy.

Vì vậy `users.password` **nullable**: tài khoản chỉ đăng nhập bằng Google không có mật khẩu.
`POST /auth/login` coi `password = null` là sai thông tin đăng nhập (không tiết lộ email nào
tồn tại), còn `PATCH /users/me/password` trả 400 và hướng người dùng qua `forgot-password`
để đặt mật khẩu đầu tiên.

Thiếu `GOOGLE_CLIENT_ID` thì app vẫn khởi động bình thường, chỉ riêng `/auth/google`
trả 503 — giống cách `S3_BUCKET` trống không làm chết app.

### Upload ảnh

Upload **tách rời** khỏi việc gắn ảnh vào dữ liệu: gọi upload trước để lấy `url`, rồi
truyền `url` đó vào `POST /admin/products/:id/images` (ảnh sản phẩm) hoặc `PATCH /users/me`
với field `avatar` (ảnh đại diện). Nhờ vậy ảnh không bị buộc vào một request tạo/sửa cụ thể,
và ảnh đã upload có thể dùng lại.

| Endpoint | Quyền | Nội dung |
| --- | --- | --- |
| `POST /admin/uploads/images` | ADMIN | multipart field `files` → `{ images: [{ url, key }] }` |
| `POST /uploads/avatar` | user đã đăng nhập | multipart field `file` → `{ image: { url, key } }` |

**Nhận dạng ảnh bằng magic byte, không tin `mimetype` client gửi lên.**
`detectImageFormat` đọc 12 byte đầu để nhận JPEG / PNG / WebP / GIF; không khớp cái nào
thì 400. Đuôi file lưu trên storage cũng lấy từ kết quả nhận dạng này. Tên object là
`{folder}/{uuid}.{ext}` — không dùng lại tên gốc, nên không ghi đè file của nhau và
không chèn được đường dẫn lạ.

Giới hạn: **5MB mỗi ảnh**, **10 file mỗi request** (chặn hai lớp — `limits` của multer
và kiểm tra lại trong `UploadService`), **10 ảnh mỗi sản phẩm**.

**Ảnh sản phẩm nằm ở bảng `images` dùng chung** cho nhiều loại thực thể (`entity_type` +
`entity_id`, không có khoá ngoại); riêng avatar chỉ là một cột `users.avatar`.
Ảnh sản phẩm quản lý qua `POST /admin/products/:id/images`,
`PATCH .../images/:imageId` (đổi `sortOrder` / `isPrimary`), `DELETE .../images/:imageId`.
Luôn chỉ có tối đa một ảnh `isPrimary`: đặt ảnh mới làm primary thì ảnh cũ tự hạ xuống,
xoá ảnh primary thì ảnh kế tiếp được đôn lên.

**Xoá ảnh là xoá mềm** (`deleted_at`), file trên storage vẫn còn. Cron
`ImageCleanupService` chạy **4h sáng**: đánh dấu ảnh mồ côi (sản phẩm/user đã biến mất),
rồi xoá hẳn bản ghi quá **30 ngày** kèm object tương ứng trên storage, mỗi lần tối đa
500 bản ghi. Lỡ tay xoá thì còn 30 ngày để cứu.

**Storage là S3 hoặc bất kỳ thứ gì nói giao thức S3** — Cloudflare R2, MinIO — chỉ đổi
`S3_ENDPOINT` và `S3_FORCE_PATH_STYLE`. Để trống `S3_BUCKET` thì upload chạy **chế độ dev**:
không lưu file thật, chỉ log `[UPLOAD-DEV]` và vẫn trả URL đúng dạng, nên phần còn lại
của API vẫn chạy/test được khi chưa có storage.

### Giỏ hàng, đơn hàng, thanh toán

**Giỏ hàng nằm hoàn toàn trong Redis** — hash `cart:{userId}` với field là `productId`,
TTL 30 ngày trượt theo mỗi lần chạm, kể cả lần chỉ `GET /cart`. Redis chỉ giữ id và số
lượng; tên, giá, tồn kho luôn đọc mới từ Postgres nên giỏ không bao giờ hiện giá cũ.
Vì không có dòng dữ liệu riêng, `:id` trong `/cart/items/:id` chính là **productId**.

`GET /cart` gửi `HGETALL` và `EXPIRE` trong **một pipeline** nên TTL trượt không tốn
thêm round-trip. Nhánh `EXPIRE` là ghi nằm trong một endpoint đọc, nên nó best-effort:
hỏng thì chỉ ghi log, giỏ vẫn trả về. Redis chuyển read-only sẽ mất TTL trượt chứ không
làm gãy `GET /cart`.

**Thêm vào giỏ chạy bằng một Lua script nguyên tử** (`ADD_ITEM_SCRIPT`): cộng dồn,
kiểm hạn mức và đặt TTL trong đúng một lệnh. Viết kiểu `hget` → cộng → `hset` thì hai
request thêm cùng lúc sẽ đọc trúng cùng một giá trị cũ và ghi đè lẫn nhau — mất update
mà API vẫn trả 201 cho cả hai, chỉ cần khách double-click nút "Thêm vào giỏ" là dính.
Gộp cả TTL vào script còn bịt nốt khe hở "tạo key xong mới `EXPIRE`": tiến trình chết
đúng giữa hai lệnh thì key giỏ hàng nằm lại vĩnh viễn. Vượt hạn mức thì script **không
ghi gì**, nên không có giá trị tạm nào lọt ra ngoài và cũng không cần rollback. Trần mỗi
sản phẩm là 99, kiểm trên **tổng** trong giỏ chứ không phải trên từng request. `PATCH`
và xoá item cũng gói lệnh ghi cùng `EXPIRE` trong `MULTI` vì lý do tương tự.

**Trừ tồn kho ngay khi đặt hàng**, bằng một câu lệnh có điều kiện:

```ts
updateMany({ where: { id, quantity: { gte: n } }, data: { quantity: { decrement: n } } })
```

Kiểm tra và trừ nằm trong cùng một lệnh nên không có khe hở giữa hai bước — đây là
chốt chặn chống bán vượt kho khi nhiều người mua cùng lúc. Huỷ hoặc từ chối đơn thì
cộng trả lại.

**`order_items` chốt tên và giá** tại thời điểm mua. Shop đổi giá hay đổi tên sản phẩm
thì đơn cũ vẫn hiển thị đúng thứ khách đã mua với giá đã trả.

**Trạng thái đơn** đi theo máy trạng thái trong `src/order/order-state.ts`:

```
PENDING ──> CONFIRMED ──> SHIPPING ──> COMPLETED
   │             │
   ├──> REJECTED │
   └──> CANCELLED <┘
```

Khách chỉ tự huỷ được khi đơn còn `PENDING`. Admin từ chối/huỷ thì bắt buộc có lý do.
Giao xong đơn COD thì tự đánh dấu đã thanh toán.

**Giỏ có món không mua được thì chặn đặt hàng**, trả 400 kèm tên món vướng, thay vì
lặng lẽ bỏ món đó ra rồi vẫn tạo đơn — khách nhận thiếu hàng mà không hay biết là lỗi
tệ hơn nhiều so với việc bắt dọn giỏ trước. Nhánh "mua ngay" (`items` gửi thẳng trong
body) vốn đã 404 khi có món không bán được, giờ hai nhánh hành xử giống nhau.

**Thanh toán**: COD hoạt động thật; thanh toán online dùng **cổng giả lập** — sinh
`transactionId` và trả về `paymentUrl`, kết quả báo về qua `POST /payments/mock-callback`.
Callback là idempotent: cổng gọi lại lần hai không lật ngược kết quả đã chốt.

**Callback bắt buộc có chữ ký.** Endpoint này công khai (cổng gọi server-to-server nên
không có JWT), vì vậy nó xác thực `HMAC-SHA256(transactionId|success)` bằng
`PAYMENT_CALLBACK_SECRET` trước khi tra DB — thiếu bước này thì ai biết `transactionId`
cũng tự đánh dấu đơn đã thanh toán được. Chữ ký gắn với cả `success` nên không thể lấy
chữ ký của một callback thất bại đem dùng lại cho thành công. So sánh bằng
`timingSafeEqual`, và **fail closed**: chưa cấu hình secret thì mọi callback bị từ chối
kèm log lỗi, chứ không âm thầm bỏ qua kiểm tra. Thay bằng VNPay/Momo thì đổi phần dựng
link và thay HMAC bằng thuật toán ký của cổng đó.

## Quyết định thiết kế đáng chú ý

- **Giỏ hàng KHÔNG có bảng trong Postgres.** ERD có `CARTS`/`CART_ITEMS` nhưng
  theo yêu cầu, giỏ hàng sẽ lưu trong **Redis** (dữ liệu tạm, đọc/ghi nhiều, có TTL).
  `docker-compose.yml` và `RedisService` đã sẵn sàng cho việc này.
- **Khóa chính UUID v7** đúng theo ERD. uuid v7 sinh theo thời gian nên index
  không phân mảnh như uuid v4.
- **Token lưu dạng hash.** `refresh_tokens`, `email_verification_tokens`,
  `password_reset_tokens` chỉ lưu `sha256(token)`; token gốc chỉ nằm trong email
  hoặc response. DB bị lộ cũng không dùng lại được token.
- **Refresh token xoay vòng (rotation).** Mỗi refresh token dùng đúng một lần;
  nếu phát hiện dùng lại token đã thu hồi thì thu hồi TOÀN BỘ phiên của user.
- **Role đọc từ DB ở mỗi request** (không tin `roles` trong payload JWT), nên
  admin khóa tài khoản/đổi quyền là có hiệu lực ngay.
- **Email đi qua event.** Service nghiệp vụ chỉ `emit` sự kiện; `MailListener`
  lo nội dung và gửi. Bật `MAIL_QUEUE_ENABLED=true` để đẩy qua hàng đợi BullMQ.
- **Việc nền tách được ra process riêng bằng `APP_ROLE`.** Cùng một image, khác
  entrypoint: `dist/main.js` phục vụ HTTP, `dist/main.worker.js` chạy cron và tiêu thụ
  job. Chi tiết ở [Tách process việc nền](#tách-process-việc-nền-app_role).
- **Job CPU-bound chạy trong worker thread, job I/O thì không.** Xuất báo cáo `.xlsx`
  dựng file ở thread riêng vì `exceljs` là JS thuần chạy đồng bộ; gửi mail thì không cần
  vì SMTP là I/O. Chi tiết và số đo ở [Worker thread cho job ngốn CPU](#worker-thread-cho-job-ngốn-cpu).
- **Upload chỉ trả URL, không tự gắn vào bản ghi.** Endpoint upload không biết gì về
  sản phẩm hay user; việc gắn ảnh là một request riêng. Đổi nhà cung cấp storage hay
  thêm chỗ dùng ảnh mới đều không phải sửa nghiệp vụ.
- **Ảnh xoá mềm, file thật xoá bằng cron.** Xoá ảnh trong request chỉ đặt `deleted_at`;
  gọi S3 để xoá ngay sẽ làm request chậm và không rollback được nếu transaction hỏng.
- **ERD ghi `adress`** — trong code dùng đúng chính tả `address`.

## Cài đặt

```bash
npm install
cp .env.example .env      # rồi điền DATABASE_URL, JWT_SECRET...
```

### Database

```bash
npx prisma migrate dev    # tạo bảng
npm run db:seed           # tạo role ADMIN/USER + tài khoản admin đầu tiên
```

Tài khoản admin mặc định lấy từ `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`),
mặc định `admin@store-web.local` / `admin123` — **đổi trước khi deploy**.

Seed đặt ở `src/prisma/seed.ts` (không phải `prisma/`) vì Prisma Client sinh ra
import theo kiểu `./internal/class.js`, ts-node không map được `.js` sang `.ts`;
`npm run db:seed` sẽ build rồi chạy bằng node.

### Redis và MinIO (giỏ hàng, hàng đợi email, lưu ảnh)

```bash
docker compose up -d              # Redis :6379, MinIO :9000 (console :9001)
node init-bucket.mjs store-demo   # tạo bucket + bật quyền đọc công khai
```

**Giỏ hàng bắt buộc phải có Redis.** Các chức năng còn lại vẫn chạy được khi chưa bật
Redis: `RedisService` kết nối kiểu lazy, còn email mặc định gửi trực tiếp thay vì qua queue.

**MinIO chỉ để dev cho giống S3 thật.** Bỏ qua cũng được: để trống `S3_BUCKET` thì upload
chạy chế độ dev. Muốn dùng MinIO thì điền nhóm biến `S3_*` trong `.env` như `.env.example`
(`S3_ENDPOINT=http://127.0.0.1:9000`, `S3_FORCE_PATH_STYLE=true`,
`S3_PUBLIC_URL=http://127.0.0.1:9000/store-demo`). Đổi sang R2/S3 production chỉ là đổi
mấy biến này, không đụng code.

### Kafka (bus sự kiện domain)

```bash
docker compose up -d kafka    # broker KRaft, không cần ZooKeeper, :9092
```

Rồi bật trong `.env`:

```bash
KAFKA_ENABLED=true
KAFKA_BROKERS=localhost:9092
```

`KAFKA_ENABLED=false` (mặc định) thì `KafkaModule.register()` trả về module rỗng —
không nạp provider nào, không mở kết nối nào, app chạy đúng như trước khi có Kafka.

Xem message đang có trong topic:

```bash
docker exec store-web-kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 --topic store.order.events --from-beginning
```

Message mà consumer không xử lý nổi nằm ở `store.dlq` (đổi `--topic` ở lệnh trên). Còn
event **chưa** lên được topic thì nằm trong bảng `outbox_events`:

```sql
SELECT status, count(*) FROM outbox_events GROUP BY status;
SELECT id, event_name, attempts, last_error FROM outbox_events WHERE status = 'FAILED';
```

### gRPC (API nội bộ giữa các service)

```bash
GRPC_ENABLED=true
GRPC_URL=0.0.0.0:50051
GRPC_INTERNAL_KEY=$(openssl rand -hex 32)
```

Bật lên thì process API mở thêm cổng 50051 **bên cạnh** cổng HTTP — cùng một
process, hai transport. Tắt thì không nạp provider nào, không mở cổng nào.

Gọi thử bằng [grpcurl](https://github.com/fullstorydev/grpcurl) (payload là nhị
phân nên `curl` vô dụng):

```bash
grpcurl -plaintext \
  -import-path src/grpc/proto -proto order.proto \
  -H "x-internal-key: $GRPC_INTERNAL_KEY" \
  -d '{"order_code": "DH-001"}' \
  localhost:50051 store.v1.OrderService/GetOrder
```

Xem stream tiến độ báo cáo — mỗi lần trạng thái đổi là một dòng mới hiện ra:

```bash
grpcurl -plaintext -import-path src/grpc/proto -proto report.proto \
  -H "x-internal-key: $GRPC_INTERNAL_KEY" \
  -d '{"job_id": "1"}' \
  localhost:50051 store.v1.ReportService/WatchReport
```

### Email khi dev

Để trống `SMTP_HOST` → **không gửi thật**, nội dung mail (kèm link kích hoạt /
link reset) được in ra console với tiền tố `[MAIL-DEV]`.

Cấu hình SMTP thật thì log chuyển sang dòng xác nhận kèm mã phản hồi:
`Đã gửi mail tới ... | smtp=250 2.0.0 Ok: queued`.

Lưu ý khi dùng **Mailtrap gói free**: gửi nhiều mail liên tiếp sẽ bị chặn với lỗi
`550 Too many emails per second`. Lỗi này được ghi log chứ không làm hỏng request.
Bật `MAIL_QUEUE_ENABLED=true` thì BullMQ tự thử lại 3 lần với backoff, xử lý được
đúng tình huống này.

## Chạy

```bash
npm run start:dev         # watch mode
npm run start:prod        # chạy bản build
```

### Tách process việc nền (`APP_ROLE`)

Mặc định `APP_ROLE=all`: một process vừa phục vụ HTTP, vừa chạy cron, vừa tiêu thụ
job mail — tiện khi dev. Trên môi trường thật thì tách đôi:

```bash
APP_ROLE=api    npm run start:prod      # chỉ HTTP
npm run start:worker:prod               # chỉ cron + job (tự đặt APP_ROLE=worker)
```

| `APP_ROLE` | Mở cổng HTTP | Đăng ký cron | Tiêu thụ job (mail, báo cáo) | Đẩy job vào queue |
| --- | --- | --- | --- | --- |
| `all` (mặc định) | có | có | có | có |
| `api` | có | **không** | **không** | có |
| `worker` | không | có | có | có |

Hai lý do tách:

- **Cron phải chạy đúng một chỗ.** `TokenCleanupService` và `ImageCleanupService`
  xoá dữ liệu vào 3h/4h sáng. Scale API lên 3 replica mà mỗi replica đều đăng ký cron
  thì lệnh dọn chạy 3 lần cùng lúc — vì vậy `TasksModule.register()` chỉ nạp provider
  khi `APP_ROLE` khác `api`.
- **Job nặng không được giành event loop của request.** Node chạy JS trên một thread;
  một job ngốn CPU lâu là mọi request đang chờ đều bị kéo theo. `MailProcessor` và
  `ReportProcessor` chỉ được đăng ký ở process việc nền, nên process API chỉ **đẩy** job
  rồi trả response ngay. Job nào ngốn CPU thì còn đi tiếp một bước nữa —
  [worker thread](#worker-thread-cho-job-ngốn-cpu).

Gõ sai (`APP_ROLE=workers`) thì app **chết ngay lúc boot** chứ không âm thầm rơi về
`all` — fallback im lặng sẽ khiến cả hai process cùng chạy cron mà không ai biết.
Chạy sai entrypoint cũng bị chặn: `APP_ROLE=worker` + `dist/main.js`, hoặc
`APP_ROLE=api` + `dist/main.worker.js`, đều thoát với mã 1 kèm lời nhắc.

Với Docker, worker dùng **cùng một image**, chỉ khác lệnh:

```bash
docker run -e APP_ROLE=worker -e RUN_MIGRATIONS=false <image> node dist/main.worker.js
```

`RUN_MIGRATIONS=false` cho worker là bắt buộc: để `true` thì API và worker cùng chạy
`prisma migrate deploy` lúc deploy và tranh nhau advisory lock của Prisma.

#### Vì sao mọi `register()` đều đi qua `registerOnce`

Nest định danh module **động** theo *tham chiếu object*, không theo nội dung metadata:
`ByReferenceModuleOpaqueKeyFactory` (mặc định từ Nest 11) đóng một id ngẫu nhiên lên
chính object rồi nhớ id đó trên object. Nên hai lời gọi `register()` trả về hai object
khác nhau sẽ thành **hai module khác nhau**, dù metadata giống hệt từng chữ — và mọi
controller, provider, processor bên trong bị dựng hai bản.

Chuyện này đã xảy ra thật: `ReportModule` được import ở cả `AppModule` lẫn `GrpcModule`
(cho rpc `WatchReport`), và với `APP_ROLE=all` thì có **hai** `ReportProcessor` cùng rút
việc từ một hàng đợi trong cùng một process. Lỗi im lặng — route thừa thì lần khớp đầu
thắng, còn processor thừa không báo gì cả.

Vì vậy mọi module động đều khai qua
[`registerOnce`](src/common/utils/dynamic-module.util.ts), và
[app.module.spec.ts](src/app.module.spec.ts) canh bằng `toBe` để lỗi không quay lại.

### Worker thread cho job ngốn CPU

Việc nền thuần I/O (SMTP, SQL, gọi S3) **không cần** worker thread: async là đủ. Native
addon cũng không cần — `sharp` và `bcrypt` là C++ chạy trên libuv threadpool, đã song
song sẵn với event loop; muốn nhanh hơn thì tăng `UV_THREADPOOL_SIZE`.

Thứ thật sự cần là **CPU-bound viết bằng JS thuần**. Trong repo này đó là sinh file
Excel bằng `exceljs` cho báo cáo đơn hàng (`REPORT_QUEUE_ENABLED=true`):

```
POST /admin/reports/orders            -> 202 { "jobId": "7" }   (đẩy job, trả ngay)
GET  /admin/reports/orders/7          -> { state, progress, result: {...} }
GET  /admin/reports/orders/7/download -> file .xlsx
```

**File báo cáo không có URL công khai.** Nó chứa email, điện thoại và địa chỉ của mọi
khách hàng, nên job chỉ trả `objectKey`; đường tải duy nhất là endpoint `download` đi qua
`JwtAuthGuard` + `@Roles(ADMIN)`. Ba lớp bảo vệ:

- `init-bucket.mjs` chỉ mở quyền đọc ẩn danh cho `products/*` và `avatars/*` — **không**
  mở cả bucket. `GET` thẳng vào `reports/...` trả 403.
- Key là `reports/orders-<uuid v4>.xlsx`, không phải `jobId` tăng dần — id tuần tự thì
  đoán được key báo cáo của người khác.
- Object được ghi vào `uploaded_objects` nên `ImageCleanupService` xoá sau 24h ân hạn,
  trùng đúng thời gian job được giữ trong queue.

Dùng bucket production (R2/S3) thì **phải tự kiểm policy**: mở `GetObject` cho cả bucket
là mở luôn `reports/`.

Job chia làm ba đoạn, và **chỉ đoạn giữa** đi vào thread khác:

| Đoạn | Ở đâu | Vì sao |
| --- | --- | --- |
| Đọc đơn hàng từ Postgres | process worker (có DI) | I/O — async là đủ, và dùng chung một connection pool của Prisma |
| Dựng file `.xlsx` | **worker thread** | CPU-bound JS thuần, chặn event loop nếu để nguyên |
| Đẩy file lên S3 | process worker (có DI) | I/O, và tái dùng `StorageService` |

Đo trên máy dev với 30.000 dòng (`buildOrdersSheet` vs `XlsxThreadRunner`, mỗi kiểu một
process riêng để không hâm nóng JIT cho nhau):

| | Thời gian job | Event loop bị treo lâu nhất |
| --- | --- | --- |
| Dựng ngay trong process | ~1480ms | **~1000ms** |
| Dựng trong worker thread | ~1580ms | ~77ms |

Tức là đổi ~7% thời gian của chính job đó để lấy lại **event loop không bị chặn 1 giây**.
Phần 77ms còn lại là structured clone 30k dòng sang thread — việc này chạy trên thread
gọi nên không tránh được, chỉ giảm được bằng cách truyền ít dữ liệu hơn.

**Vì sao một thread mỗi job, không phải pool.** Đo tách từng phần: spawn thread + clone
dữ liệu ~55ms, `require('exceljs')` trong isolate mới ~78ms, dựng file ~1390ms. Overhead
cố định chỉ ~135ms trên một job chạy hàng giây, nên pool không đáng thêm phần quản lý
vòng đời. Đổi lại được cách ly: một job làm nổ RAM thì thread đó chết, job sau vẫn sạch.
Khi nào báo cáo chạy liên tục nhiều lần mỗi phút thì mới nên đổi sang worker sống lâu.

**Vì sao không dùng sandboxed processor của BullMQ** (`processors: [{ path, useWorkerThreads: true }]`,
`@nestjs/bullmq` có hỗ trợ): cách đó đưa **cả job** vào thread, nên phần đọc DB cũng
nằm trong đó. File processor chạy ngoài DI container nên phải tự `new PrismaClient()`
trong mỗi thread — mỗi thread một connection pool riêng, rất dễ vượt `max_connections`
của Neon. Tách theo đoạn giữ được I/O ở process chính với đúng một pool.

Quá `MAX_REPORT_ROWS` (50.000) dòng thì query lấy thừa 1 dòng để **biết mình đã cắt**,
rồi trả `truncated: true` kèm `logger.warn` — cắt mà vẫn báo `completed` với đúng 50.000
dòng thì admin không phân biệt được báo cáo đủ và báo cáo thiếu.

Khoảng ngày: `to` dạng `2026-12-31` được dịch thành `lt 2027-01-01T00:00Z` chứ không phải
`lte 2026-12-31T00:00Z` — nếu không thì trọn ngày cuối của khoảng bị loại khỏi báo cáo.
Có kèm giờ (`2026-12-31T10:30:00Z`) thì giữ nguyên `lte`.

Hai chi tiết dễ vấp:

- `XlsxThreadRunner` trỏ `join(__dirname, 'xlsx.worker.js')`, tức **file đã build**.
  `nest start` cũng chạy từ `dist` nên dev và production đều đúng, nhưng jest chạy từ
  `src` qua ts-jest thì không có file `.js` — vì vậy unit test gọi `buildOrdersSheet()`
  trực tiếp ([orders-sheet.spec.ts](src/report/orders-sheet.spec.ts)), còn e2e chỉ kiểm
  phần HTTP.
- Worker `postMessage` một `Uint8Array` **copy sang ArrayBuffer riêng** rồi mới transfer.
  Transfer thẳng `buffer.buffer` của một Node Buffer là sai: Buffer nhỏ nằm trên vùng
  nhớ pool dùng chung, transfer sẽ vô hiệu hoá cả những Buffer khác trên vùng đó.

Không bật `REPORT_QUEUE_ENABLED` thì endpoint trả **503** chứ không âm thầm dựng file
trong request — dựng ngay trong request đúng là thứ cần tránh.

### Kafka: bus sự kiện, không phải hàng đợi job

Kafka **không thay** BullMQ. Hai thứ giải hai bài toán khác nhau, nên cùng tồn tại:

| | BullMQ (Redis) | Kafka |
| --- | --- | --- |
| Dùng cho | việc nền **của chính app này** (gửi mail, dựng file báo cáo) | sự kiện domain cho **service khác** đọc |
| Message đọc xong | biến mất khỏi queue | vẫn nằm trong topic (retention), consumer mới đọc lại được từ đầu |
| Thất bại | có `attempts`, backoff, failed set, tra được trạng thái từng job | offset đi tiếp, không có khái niệm "job hỏng" |

Tức là: cần **thử lại và biết job nào hỏng** thì dùng BullMQ; cần **phát tán một
chuyện đã xảy ra** cho bên khác thì dùng Kafka.

**Transactional outbox: đơn và event cùng commit hoặc cùng không.** Trước đây service
`emit` event nội bộ rồi một listener publish thẳng lên Kafka. Đó là *dual-write*: đơn đã
nằm trong DB mà broker chết thì event bốc hơi, chỉ còn một dòng log. Bây giờ
`OrderService` ghi một dòng vào bảng `outbox_events` **bên trong chính transaction tạo
đơn** ([OutboxService.record()](src/outbox/outbox.service.ts)); transaction rollback thì
event cũng biến mất theo. [OutboxRelay](src/outbox/outbox.relay.ts) chạy 5s một lần trong
process worker, đọc các dòng `PENDING` theo thứ tự cũ nhất trước, publish, rồi đánh dấu
`SENT`. Broker chết chỉ làm event **chậm**, không làm mất.

`id` của dòng outbox chính là `eventId` trong envelope. Nhờ vậy một dòng được publish hai
lần (send thành công nhưng process chết trước khi kịp đánh dấu) vẫn mang đúng một id, và
consumer nhận ra đó là bản trùng.

Publish lỗi liên tục `OUTBOX_MAX_ATTEMPTS` lần thì dòng đó chuyển `FAILED` và được giữ lại
để xử lý tay — nếu retry mãi thì nó chặn mọi event xếp hàng phía sau. Dòng `SENT` được dọn
sau 7 ngày; dòng `FAILED` thì không bao giờ tự xoá.

> **Đánh đổi cần biết:** một dòng `FAILED` phá vỡ đúng thứ tự mà key Kafka đảm bảo — các
> event sau của **cùng đơn đó** vẫn được publish, nên consumer có thể thấy
> `order.confirmed` của một đơn nó chưa từng thấy `order.created`. Đây là giá của việc
> không để một dòng hỏng chặn mọi đơn khác, và là lý do log ở đó là `error` chứ không phải
> `warn`. Chạy `SELECT ... WHERE status = 'FAILED'` nên là một cảnh báo có người theo dõi.

> **Bật `KAFKA_ENABLED=true` thì phải có process `APP_ROLE=worker` (hoặc `all`) chạy kèm.**
> Chỉ có replica API thôi thì dòng outbox được ghi mà không ai gửi đi cả.

Bus nội bộ (`events.emit`) vẫn giữ nguyên cho mail: mail listener chạy cùng process nên
không có bài toán dual-write. Tắt `KAFKA_ENABLED` thì `OutboxService` không ghi dòng nào
và `KafkaModule.register()` trả về module rỗng.

**Chỉ mirror event đơn hàng, cố ý bỏ event mail.** Mail event mang theo token kích hoạt
và token reset mật khẩu — một topic mà service khác đọc được không phải chỗ để credential
nằm.

**Một topic cho mỗi aggregate, key là mã đơn.** `store.order.events` chứa cả
`order.created`/`confirmed`/`rejected`; cùng key thì Kafka xếp cùng partition, nên
consumer không bao giờ thấy `order.confirmed` trước `order.created`. Tên event nằm trong
envelope cùng `eventId` (để dedupe — Kafka giao *ít nhất một lần*) và `occurredAt`.

**`publish()` ném lỗi, và đó là cố ý.** Không còn ai publish từ trong request nữa, nên
lý do cũ để nuốt lỗi cũng hết: người gọi duy nhất là relay, mà một relay không phân biệt
được "đã gửi" với "mất" sẽ đánh dấu `SENT` cho một event không bao giờ tới. Timeout 3s
(`KAFKA_PUBLISH_TIMEOUT_MS`) để một broker im lặng không giữ relay lại mãi.

**Ai produce, ai consume** — cùng nguyên tắc với `MailModule`:

| `APP_ROLE` | Produce | Consume |
| --- | --- | --- |
| `all` | có | có |
| `api` | **không** | **không** |
| `worker` | có | có |

Process API chỉ *ghi outbox*, không nói chuyện với broker. Nó mà chạy relay thì scale lên
3 replica là cùng một dòng được publish 3 lần và sai cả thứ tự; nó mà consume thì mỗi
message được xử lý 3 lần.

**Consumer thử lại mãi khi broker chưa lên.** Bỏ cuộc ngay lúc boot là tệ nhất: worker
vẫn "chạy bình thường" trong khi không xử lý gì cả.

**Chống trùng bằng `eventId`.** Kafka giao *ít nhất một lần*: rebalance, offset chưa kịp
commit, hay một dòng outbox publish hai lần đều đưa cùng một event lên dây lần nữa.
Consumer đánh dấu `eventId` đã xử lý vào Redis (key `kafka:handled:<group>:<eventId>`,
TTL 7 ngày) **sau khi** handler chạy xong — đánh dấu trước rồi crash giữa chừng sẽ biến
lần giao lại thành một message bị bỏ qua. Redis chết thì *fail open*: xử lý lại còn hơn
âm thầm bỏ event.

**Message hỏng đi vào DLQ, không ném ngược ra kafkajs.** Ném lỗi ra không phải "báo lỗi",
nó là tín hiệu từ chối offset: kafkajs đọc lại đúng message đó vô hạn và chặn cả partition
phía sau. Nên một message không xử lý được sẽ được thử lại `KAFKA_HANDLER_ATTEMPTS` lần,
rồi ghi sang topic `store.dlq` kèm topic/partition/offset gốc, lỗi cuối cùng và **nguyên
văn** body để replay được — sau đó partition đi tiếp. Consumer **không** subscribe
`store.dlq`, nếu không thì các message hỏng lại quay về đúng handler đã bó tay với chúng.

Trường hợp duy nhất vẫn ném lỗi: ghi DLQ cũng hỏng. Lúc đó message không được xử lý mà
cũng không được cất đi đâu cả, commit offset là mất luôn — và một broker không nhận nổi
bản ghi DLQ thì cũng chẳng nhận được gì khác, nên chặn lại mới là đúng.

**Handler `@OnEvent('kafka.*')` bắt buộc phải idempotent.** Retry là `emitAsync` lại, tức
là **mọi** listener của event đó chạy lại, kể cả listener đã thành công ở lần trước — fan-out
emit thì không tránh được. Dù sao thì cũng phải idempotent: Kafka giao ít nhất một lần, và
`eventId` chỉ dedupe được cả message chứ không dedupe được từng listener.

**Topic được tạo lúc khởi động.** Subscribe vào topic chưa từng có message sẽ lỗi
`this server does not host this topic-partition`, nên `ensureTopics()` tạo trước (mặc
định 3 partition, đổi bằng `KAFKA_TOPIC_PARTITIONS`). Nó `listTopics()` rồi mới tạo
phần còn thiếu — gọi thẳng `createTopics` trên topic đã có sẽ ghi log lỗi mỗi lần boot.

**Thêm một loại event mới** cần ba bước: thêm tên vào `KafkaEventName`
([kafka.constant.ts](src/kafka/kafka.constant.ts)), gọi `outbox.record(tx, ...)` trong
transaction sinh ra nó, và bên nhận thì nghe
`@OnEvent('kafka.<tên event>')` — tiền tố `kafka.` là bắt buộc, không có nó thì handler
chạy cả với event nội bộ lẫn message Kafka do chính nó sinh ra, mọi side effect chạy đôi.

### gRPC: hỏi-đáp đồng bộ, phần Kafka không làm được

Kafka và gRPC không thay nhau, chúng bù cho nhau:

| | REST | Kafka | gRPC |
| --- | --- | --- | --- |
| Ai gọi | trình duyệt → API | không ai gọi ai | service → service |
| Câu hỏi | "cho tôi trang này" | "chuyện này vừa xảy ra" | "cho tôi hỏi cái này" |
| Bên kia chết | lỗi ngay | event nằm chờ trong topic | lỗi ngay |
| Hợp đồng | Swagger, viết tay | `KafkaEventName`, tự quy ước | `.proto`, compiler ép |

Cụ thể trong dự án này: `order.created` trên Kafka chỉ mang `orderCode`, email và
tổng tiền — đủ để một service quyết định nó có quan tâm hay không. Service nào
**có** quan tâm thì phải hỏi tiếp địa chỉ giao và danh sách món, và câu hỏi đó
đồng bộ. Đó là `GetOrder`.

**gRPC là transport, không phải tầng mới.** Mọi handler trong [src/grpc/](src/grpc/)
gọi thẳng vào đúng service mà HTTP controller đang dùng, và chỉ thêm hai thứ:
map sang message của proto, và dịch exception sang gRPC status. Phần "thêm hai
thứ" đó nằm trong các provider `*.grpc.service.ts`; controller chỉ còn khai báo
rpc, guard và filter — không xử lý logic.

**Chỉ đọc.** Không có `ReserveStock`. Trừ tồn kho nằm trong cùng transaction với
`tx.order.create`, đưa ra sau một RPC là mất tính nguyên tử và phải làm saga với
compensating release — lớn hơn nhiều so với một endpoint đọc.

**App lai, chạy ở process API.** `app.connectMicroservice()` trong
[main.ts](src/main.ts) gắn thêm transport gRPC vào app đang có; hai bên dùng
chung container DI, chung pool Prisma, chung kết nối Redis. Worker không mở gRPC:
nó rút queue và outbox, không trả lời ai cả.

**Tiền là `string`, không phải `double`.** Protobuf không có kiểu decimal, mà
1234.56 không biểu diễn chính xác được bằng double. Cột trong DB là
`Decimal(12,2)` nên trên dây cũng giữ nguyên như vậy. Test đã ghim kiểu này lại.

**Số thứ tự field mới là danh tính, không phải tên.** Đổi tên field thì client cũ
vẫn chạy; đổi số thì client cũ đọc địa chỉ ra khỏi ô trạng thái. `grpc.contract.spec.ts`
ghim số field của `Order` để thay đổi đó không lọt qua review.

**Exception được dịch ở biên.** Service dùng chung với HTTP nên ném
`NotFoundException`; [GrpcExceptionFilter](src/grpc/grpc-exception.filter.ts) đổi
sang `NOT_FOUND`. Không có nó thì mọi lỗi đến tay caller đều là `UNKNOWN`, và
caller không phân biệt được "đừng thử lại" với "chờ rồi thử lại".

**Cổng gRPC phải nằm trong mạng nội bộ.** `GetOrder` trả về tên, số điện thoại và
địa chỉ khách hàng, mà trước nó không có `JwtAuthGuard` — caller là service chứ
không phải người, không có token người dùng để kiểm tra.
[GrpcInternalGuard](src/grpc/grpc-internal.guard.ts) chặn bằng shared secret so
sánh timing-safe, và **không có `GRPC_INTERNAL_KEY` thì process không khởi động**.
Shared secret là mức sàn; nhiều service hơn thì cần mTLS.

**`VerifyToken` cố ý không nằm sau guard đó** — bản thân token đã là credential.

**Streaming là thứ REST không diễn đạt được.** `WatchReport` trả `Observable`:
mỗi `next` là một message, `complete` đóng stream. Thay cho việc client poll
`GET /admin/reports/orders/:jobId` mỗi 2 giây mà phần lớn câu trả lời là "vẫn
đang chạy". Chỉ gửi khi **có thay đổi**, và phần dễ quên nhất là teardown: client
ngắt kết nối mà không `clearInterval` thì còn lại một vòng lặp gõ Redis đến hết
đời process.

**Kiểu TypeScript viết tay** trong [grpc.interface.ts](src/grpc/grpc.interface.ts)
chứ không sinh tự động, để clone mới `tsc` chạy được ngay không cần bước codegen.
Cái giá là có thể lệch với `.proto`, và [grpc.contract.spec.ts](src/grpc/grpc.contract.spec.ts)
là thứ chặn: nó load `.proto` thật rồi đối chiếu từng service/method với controller.
Khi proto lớn lên thì chuyển sang `npm run proto:gen` (dùng `proto-loader-gen-types`,
không cần cài `protoc`).

**Trình duyệt không gọi gRPC trực tiếp được**, nên REST controller giữ nguyên. gRPC
chỉ dành cho service ↔ service.

## Test

```bash
npm test                  # unit test
npm run test:e2e          # e2e (dùng DB riêng trong .env.test)
```

E2E dùng database riêng khai báo ở `.env.test` và tự chạy `prisma migrate deploy`
trước khi test. Mỗi test bắt đầu bằng `TRUNCATE` toàn bộ bảng nên độc lập nhau.
`.env.test` mặc định trỏ S3 vào MinIO local; không chạy MinIO thì xoá `S3_BUCKET`
trong file đó, `upload.e2e-spec.ts` và `image-cleanup.e2e-spec.ts` vẫn chạy ở chế độ dev.

> **Chạy e2e phải qua `npm run test:e2e`, không gọi `npx jest --config test/jest-e2e.json`
> trực tiếp.** Script đó set `NODE_OPTIONS=--experimental-vm-modules`; thiếu cờ này
> Prisma Client không nạp được WASM query compiler và **mọi** suite fail với lỗi
> `import()` trông chẳng liên quan gì tới test.

### Test phần gRPC

Bốn tầng, từ rẻ tới đắt — ba tầng đầu không cần hạ tầng gì:

| Tầng | File | Cần gì | Bắt được lỗi gì |
| --- | --- | --- | --- |
| Unit | `*.grpc.service.spec.ts`, `grpc-internal.guard.spec.ts`, `grpc-exception.filter.spec.ts` | không | map sai field, guard hớ, status dịch sai |
| Hợp đồng | `grpc.contract.spec.ts` | không | `.proto` lệch code, đổi số field, tiền thành `double`, mất `stream` |
| Transport | `grpc.transport.spec.ts` | không | socket, protobuf, metadata, đóng stream — service là stub |
| E2E | `test/grpc.e2e-spec.ts` | DB + Redis | `GrpcModule` có thật sự nạp trong `AppModule` không, dữ liệu thật |

Ba tầng đầu chạy bằng `npm test`. Tầng e2e cần `npm run test:e2e`.

Vì sao cần cả tầng transport lẫn e2e: transport chứng minh **giao thức** đúng mà
không phụ thuộc hạ tầng, e2e chứng minh **app thật** có nạp module hay không —
một module đứng sau cờ env và kiểm tra `APP_ROLE` rất dễ âm thầm không đăng ký gì cả.

### Gọi tay vào server đang chạy

```bash
GRPC_ENABLED=true GRPC_INTERNAL_KEY=$(openssl rand -hex 32) npm run start:dev

# terminal khác — client Node có sẵn, không cần cài gì
npm run grpc:try                       # đi hết các endpoint, in cả lỗi lẫn kết quả
npm run grpc:try -- GetOrder DH-001
npm run grpc:try -- WatchReport 1      # xem stream nhả từng dòng
```

[scripts/grpc-client.ts](scripts/grpc-client.ts) vừa là công cụ smoke test, vừa là
ví dụ mẫu cho phía gọi — service khác sẽ viết đúng như vậy.

> Script này nằm ngoài `dist`: [tsconfig.build.json](tsconfig.build.json) loại
> `scripts` ra khỏi bản build. Nó import `../src/**`, mà chỉ cần một file ngoài
> `src/` được biên dịch là `rootDir` bị đẩy lên gốc repo, code ra `dist/src/**`
> trong khi asset (i18n, template mail, `.proto`) vẫn nằm ở `dist/**` — app chết
> lúc khởi động với lỗi `i18n path ... cannot be found`. Thêm thư mục nào ngoài
> `src/` cũng phải loại trừ như vậy.

Ai thích `grpcurl` thì `brew install grpcurl` rồi dùng cú pháp ở mục cài đặt phía trên.

## CI/CD

### CI — `.github/workflows/ci.yml`

Chạy khi push lên `main` và khi mở pull request, gồm hai job song song:

| Job | Nội dung |
| --- | --- |
| `quality` | `prisma generate` → lint → typecheck → build → unit test |
| `e2e` | Dựng PostgreSQL 16 + Redis 7 ngay trong runner rồi chạy toàn bộ e2e |

Hai điểm bắt buộc, sửa là hỏng:

- **`npx prisma generate` phải chạy trước mọi bước.** `src/generated` nằm trong
  `.gitignore` nên trên CI chưa có Prisma Client.
- **Dùng `npm run lint:ci`, không dùng `npm run lint`.** Script `lint` có cờ
  `--fix`: chạy trên CI nó tự sửa rồi báo pass, che mất lỗi thật.
- **`npm run typecheck` là bước riêng, không thay được bằng `npm run build`.**
  `nest build` dùng `tsconfig.build.json` (loại trừ `*.spec.ts`), nên lỗi kiểu trong file
  test lọt qua cả build lẫn ts-jest. `typecheck` chạy `tsconfig.json` — gồm cả test.

E2E dùng Postgres dựng trong runner chứ không dùng database Neon, để CI chạy
độc lập, song song được và không bao giờ đụng vào dữ liệu thật. CI **không dựng MinIO**:
`.env.test` sinh ra trên runner không có biến `S3_*` nên upload chạy chế độ dev — test
vẫn kiểm được validate, phân quyền và dạng URL trả về mà không cần storage thật.

### CD — `.github/workflows/cd.yml`

Đóng gói Docker image và đẩy lên GitHub Container Registry. Kích hoạt khi:

- workflow **CI chạy xong trên `main` và thành công** (CI đỏ thì không đóng gói),
- push tag `v*` (bản phát hành),
- bấm chạy tay (`workflow_dispatch`).

Image ra tại `ghcr.io/<user>/<repo>` với tag `sha-<commit>`, `latest` (từ `main`)
và tag semver khi push tag. Dùng `GITHUB_TOKEN` có sẵn — không cần tạo secret.

### Deploy lên Render

CD chỉ đẩy image lên GHCR; muốn nó deploy thật thì làm bốn bước sau **một lần**.

**1. Mở public cho package trên GHCR.** Sau khi CD chạy lần đầu, vào
`github.com/<user>?tab=packages` → chọn package → *Package settings* → *Change visibility*
→ Public. Để private thì phải khai báo credential registry bên Render, mở public nhanh hơn
cho môi trường thử.

**2. Dựng Redis.** Trên Render: *New* → *Key Value* → free plan. Copy **Internal URL**
(dạng `redis://red-xxxx:6379`) — internal nên không tính băng thông và không cần TLS.

**3. Tạo Web Service.** *New* → *Web Service* → *Existing image* →
`ghcr.io/<user>/<repo>:latest`. Health check path: `/health`. Rồi khai báo biến môi trường:

| Biến | Giá trị |
| --- | --- |
| `DATABASE_URL` | connection string Neon |
| `REDIS_URL` | Internal URL của Key Value ở bước 2 |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `PAYMENT_CALLBACK_SECRET` | `openssl rand -hex 32` |
| `APP_URL` | URL Render cấp, ví dụ `https://store-api.onrender.com` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | tài khoản admin đầu tiên |

Không cần set `PORT` — Render tự tiêm, `main.ts` đọc từ đó. Bỏ trống nhóm `S3_*` thì
upload chạy chế độ dev (không lưu file thật); muốn lưu thật thì điền Cloudflare R2.

**4. Nối CD với Render.** Trong service trên Render: *Settings* → *Deploy Hook*, copy URL.
Trên GitHub repo:

- *Settings* → *Secrets and variables* → *Actions* → **New repository secret**:
  `RENDER_DEPLOY_HOOK_URL` = URL vừa copy.
- Tab **Variables** → **New repository variable**:
  `RENDER_SERVICE_URL` = `https://<tên-service>.onrender.com`.

Xong. Từ giờ mỗi lần CI xanh trên `main`, CD sẽ build image → gọi Deploy Hook → **chờ
`/health` báo đúng commit vừa build** rồi mới báo xanh. Thiếu secret hay variable thì hai
bước đó tự bỏ qua chứ không làm đỏ workflow, nên fork hoặc repo chưa cấu hình vẫn chạy CD
bình thường.

`GIT_SHA` được nướng vào image lúc build và `/health` trả lại nó — đó là cách CD biết bản
mới đã thực sự lên sóng, thay vì chờ theo thời gian rồi đoán.

```json
{ "status": "ok", "version": "0816f78...", "uptime": 42 }
```

Vài điều cần biết về free plan: service **ngủ sau ~15 phút** không có request, lần gọi
đầu sau đó mất 30–60 giây; image gần **1 GB** nên deploy lần đầu khá lâu; `migrate deploy`
chạy ở `docker-entrypoint.sh` mỗi lần container khởi động nên schema tự theo kịp code.

### Docker

```bash
docker build -t store-api .

docker run --rm -p 3000:3000 \
  -e DATABASE_URL='postgresql://...' \
  -e JWT_SECRET='...' \
  store-api
```

`docker-entrypoint.sh` chạy `prisma migrate deploy` trước rồi mới start app;
migration lỗi thì container dừng luôn chứ không chạy với schema sai.

Vài quyết định trong `Dockerfile`:

- **`node:22-slim` (Debian), không dùng alpine** — `bcrypt` là native module,
  trên musl phải biên dịch lại từ nguồn, chậm và hay vỡ build.
- **`prisma` nằm ở `dependencies`, không phải `devDependencies`** — container cần
  CLI này để chạy migration lúc khởi động.
- **Phải copy `prisma.config.ts` vào image** — Prisma 7 không còn nhận
  `url = env(...)` trong schema, connection string bắt buộc lấy từ file config.
  CLI tự đọc được file `.ts` này mà không cần cài `typescript`.
- **Cài `openssl` trong stage runtime** — `node:22-slim` không có sẵn. Thiếu nó
  Prisma cảnh báo không nhận diện được libssl và chọn nhầm engine bản
  `openssl-1.1.x` thay vì `3.0.x`.

Image nặng khoảng **970 MB**, trong đó ~280 MB là CLI `prisma` (kéo theo
`@prisma/studio-core`, `@prisma/dev`). Đây là cái giá của việc chạy migration
ngay lúc container khởi động. Muốn image gọn hơn nhiều thì bỏ `prisma` khỏi
`dependencies`, xoá bước migrate trong `docker-entrypoint.sh`, và chạy
`prisma migrate deploy` thành một job riêng trong workflow CD.

## Cấu trúc thư mục

```
src/
├── admin/          # chức năng cho ADMIN (prefix /admin)
├── auth/           # đăng ký, kích hoạt, đăng nhập, refresh, quên/reset mật khẩu
├── common/         # dùng chung: guard RBAC, DTO phân trang, validator, event
├── generated/      # Prisma Client (sinh tự động — không sửa tay)
├── grpc/           # API nội bộ service↔service: proto, controller, service, guard, filter
├── i18n/           # thông báo song ngữ en/vi
├── kafka/          # bus sự kiện domain: client, producer, consumer, DLQ
├── mail/           # nodemailer + BullMQ + listener theo event
├── cart/           # giỏ hàng — CHỈ nằm trong Redis, không có bảng
├── chat/           # chat khách↔admin: REST để ghi, WebSocket để đẩy
├── category/       # danh mục sản phẩm: endpoint khách + admin CRUD
├── comment/        # bình luận sản phẩm (1 cấp, xoá mềm)
├── order/          # đặt hàng, huỷ, máy trạng thái, admin duyệt đơn
├── outbox/         # transactional outbox: ghi event trong transaction + relay lên Kafka
├── payment/        # COD + cổng thanh toán giả lập
├── product/        # sản phẩm: endpoint khách + admin CRUD (xoá mềm), chia sẻ MXH
├── product-suggestion/ # khách đề xuất mặt hàng, admin duyệt
├── prisma/         # PrismaService và seed
├── redis/          # kết nối Redis (giỏ hàng, hàng đợi)
├── review/         # đánh giá sao: chỉ người đã mua, mỗi người một lần
├── statistics/     # thống kê admin: doanh thu, bán chạy, đơn hàng
├── tasks/          # job chạy theo lịch (@Cron): dọn token, dọn ảnh, báo cáo doanh thu tháng
├── upload/         # nhận file ảnh, validate magic byte, đẩy lên S3/R2
└── user/           # thông tin cá nhân của user đang đăng nhập
```

## Đa ngôn ngữ

Thông báo lỗi có tiếng Anh và tiếng Việt. Chọn ngôn ngữ theo thứ tự ưu tiên:
`?lang=vi` → header `x-lang: vi` → `Accept-Language`.

```bash
curl -X POST "http://localhost:3001/auth/login?lang=vi" \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@b.c","password":"sai-mat-khau"}'
# {"errors":{"body":["Email hoặc mật khẩu không đúng"]}}
```
