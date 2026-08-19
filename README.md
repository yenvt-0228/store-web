# Store Web API

API web bán hàng — NestJS 11 + Prisma 7 (PostgreSQL/Neon) + Redis.

Xây dựng theo hai tài liệu thiết kế:

- **Sơ đồ ERD Web bán hàng** — cấu trúc bảng, kiểu dữ liệu, quan hệ.
- **Xây dựng web site bán hàng (CSV)** — danh sách chức năng/endpoint theo từng
  vai trò Guest / User / Admin / System.

## Nội dung phát triển

Phát triển các chức năng: **Roles (RBAC) + Auth đầy đủ**, kèm hạ tầng dùng chung
(Redis, email theo event/queue, cron), categories, products, cart, orders, payments,
comments, reviews, chat, product-suggestions, statistics.

Tài liệu Swagger: `http://localhost:3001/docs`

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

### Redis (cho giỏ hàng và hàng đợi email)

```bash
docker compose up -d
```

Chưa cần Redis vẫn chạy được toàn bộ chức năng hiện tại: `RedisService` kết nối
kiểu lazy, còn email mặc định gửi trực tiếp thay vì qua queue.

### Email khi dev

Để trống `SMTP_HOST` → **không gửi thật**, nội dung mail (kèm link kích hoạt /
link reset) được in ra console với tiền tố `[MAIL-DEV]`.

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

## CI/CD

### CI — `.github/workflows/ci.yml`

Chạy khi push lên `main` và khi mở pull request, gồm hai job song song:

| Job | Nội dung |
| --- | --- |
| `quality` | `prisma generate` → lint → build → unit test |
| `e2e` | Dựng PostgreSQL 16 ngay trong runner rồi chạy toàn bộ e2e |

Hai điểm bắt buộc, sửa là hỏng:

- **`npx prisma generate` phải chạy trước mọi bước.** `src/generated` nằm trong
  `.gitignore` nên trên CI chưa có Prisma Client.
- **Dùng `npm run lint:ci`, không dùng `npm run lint`.** Script `lint` có cờ
  `--fix`: chạy trên CI nó tự sửa rồi báo pass, che mất lỗi thật.

E2E dùng Postgres dựng trong runner chứ không dùng database Neon, để CI chạy
độc lập, song song được và không bao giờ đụng vào dữ liệu thật.

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
├── prisma/         # PrismaService và seed
├── redis/          # kết nối Redis (giỏ hàng, hàng đợi)
├── tasks/          # job chạy theo lịch (@Cron)
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
