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
| Auth | `POST /auth/register` · `GET /auth/activate` · `POST /auth/login` · `refresh` · `logout` · `forgot-password` · `reset-password` |
| User | `GET/PATCH /users/me` · `PATCH /users/me/password` |
| Sản phẩm (khách) | `GET /products` · `GET /products/featured` · `GET /products/:id` |
| Upload ảnh | `POST /admin/uploads/images` (admin, ≤10 file) · `POST /uploads/avatar` |
| Giỏ hàng | `GET /cart` · `POST /cart/items` · `PATCH /cart/items/:id` · `DELETE /cart/items/:id` · `DELETE /cart` |
| Đơn hàng | `POST /orders` · `GET /orders` · `GET /orders/:id` · `PATCH /orders/:id/cancel` |
| Thanh toán | `POST /payments` · `POST /payments/mock-callback` · `GET /payments/:orderId` |
| Admin | `/admin/users` · `/admin/categories` · `/admin/products` (kèm `/:id/images`) · `/admin/orders` |

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
