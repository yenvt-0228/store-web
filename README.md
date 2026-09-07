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

Chưa làm: comments, reviews, chat, product-suggestions, statistics.

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

## Test

```bash
npm test                  # unit test
npm run test:e2e          # e2e (dùng DB riêng trong .env.test)
```

E2E dùng database riêng khai báo ở `.env.test` và tự chạy `prisma migrate deploy`
trước khi test. Mỗi test bắt đầu bằng `TRUNCATE` toàn bộ bảng nên độc lập nhau.
`.env.test` mặc định trỏ S3 vào MinIO local; không chạy MinIO thì xoá `S3_BUCKET`
trong file đó, `upload.e2e-spec.ts` và `image-cleanup.e2e-spec.ts` vẫn chạy ở chế độ dev.

## CI/CD

### CI — `.github/workflows/ci.yml`

Chạy khi push lên `main` và khi mở pull request, gồm hai job song song:

| Job | Nội dung |
| --- | --- |
| `quality` | `prisma generate` → lint → build → unit test |
| `e2e` | Dựng PostgreSQL 16 + Redis 7 ngay trong runner rồi chạy toàn bộ e2e |

Hai điểm bắt buộc, sửa là hỏng:

- **`npx prisma generate` phải chạy trước mọi bước.** `src/generated` nằm trong
  `.gitignore` nên trên CI chưa có Prisma Client.
- **Dùng `npm run lint:ci`, không dùng `npm run lint`.** Script `lint` có cờ
  `--fix`: chạy trên CI nó tự sửa rồi báo pass, che mất lỗi thật.

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
├── i18n/           # thông báo song ngữ en/vi
├── mail/           # nodemailer + BullMQ + listener theo event
├── cart/           # giỏ hàng — CHỈ nằm trong Redis, không có bảng
├── category/       # danh mục sản phẩm (admin CRUD)
├── order/          # đặt hàng, huỷ, máy trạng thái, admin duyệt đơn
├── payment/        # COD + cổng thanh toán giả lập
├── product/        # sản phẩm: endpoint khách + admin CRUD (xoá mềm)
├── prisma/         # PrismaService và seed
├── redis/          # kết nối Redis (giỏ hàng, hàng đợi)
├── tasks/          # job chạy theo lịch (@Cron): dọn token hết hạn, dọn ảnh
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
