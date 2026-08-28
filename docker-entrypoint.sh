#!/bin/sh
set -e

# Neon free tier ngủ khi không có kết nối, đánh thức mất vài giây; mặc định
# connect_timeout của Prisma chỉ 5s nên lần chạm đầu tiên hay trả P1001.
# Vì vậy: nới timeout + thử lại vài lần trước khi bó tay.
: "${RUN_MIGRATIONS:=true}"
: "${MIGRATE_RETRIES:=8}"
: "${MIGRATE_RETRY_DELAY:=10}"
: "${MIGRATE_FAIL_FAST:=true}"

# Neon khuyến nghị chạy migration qua endpoint trực tiếp (không -pooler).
# Đặt MIGRATE_DATABASE_URL trên Render nếu muốn dùng, không có thì xài DATABASE_URL.
DB_URL="${MIGRATE_DATABASE_URL:-$DATABASE_URL}"

if [ "$RUN_MIGRATIONS" != "true" ]; then
  echo "==> RUN_MIGRATIONS=$RUN_MIGRATIONS — bỏ qua migration."
  exec "$@"
fi

if [ -z "$DB_URL" ]; then
  echo "!!! Thiếu biến môi trường DATABASE_URL — khai báo trong Render > Environment."
  exit 1
fi

case "$DB_URL" in
  *connect_timeout=*) ;;
  *\?*) DB_URL="$DB_URL&connect_timeout=30" ;;
  *)    DB_URL="$DB_URL?connect_timeout=30" ;;
esac

DB_HOST=$(printf '%s' "$DB_URL" | sed -E 's#^[^/]+//([^@]*@)?([^:/?]+).*#\2#')

diagnose() {
  echo "--- Kiểm tra mạng tới $DB_HOST:5432 ---"
  DB_HOST="$DB_HOST" node - <<'JS' || true
const dns = require('node:dns');
const net = require('node:net');
const host = process.env.DB_HOST;

dns.lookup(host, { all: true }, (err, addrs) => {
  if (err) {
    console.log(`DNS: thất bại — ${err.code}`);
    return;
  }
  console.log('DNS:', addrs.map((a) => `${a.address} (IPv${a.family})`).join(', '));
  for (const { address, family } of addrs) {
    const sock = net.connect({ host: address, port: 5432, family });
    sock.setTimeout(8000);
    sock.on('connect', () => { console.log(`TCP ${address}: OK`); sock.destroy(); });
    sock.on('timeout', () => { console.log(`TCP ${address}: timeout (khả năng bị chặn outbound)`); sock.destroy(); });
    sock.on('error', (e) => console.log(`TCP ${address}: ${e.code}`));
  }
});
JS
  echo "--------------------------------------"
}

echo "==> Áp migration lên database ($DB_HOST)..."

i=1
while :; do
  if DATABASE_URL="$DB_URL" npx prisma migrate deploy; then
    echo "==> Migration xong."
    break
  fi

  [ "$i" -eq 1 ] && diagnose

  if [ "$i" -ge "$MIGRATE_RETRIES" ]; then
    echo "!!! Thử $MIGRATE_RETRIES lần vẫn không kết nối được database."
    if [ "$MIGRATE_FAIL_FAST" = "true" ]; then
      exit 1
    fi
    echo "!!! MIGRATE_FAIL_FAST=false — vẫn khởi động app với schema hiện có."
    break
  fi

  echo "    lần $i thất bại, chờ ${MIGRATE_RETRY_DELAY}s rồi thử lại..."
  sleep "$MIGRATE_RETRY_DELAY"
  i=$((i + 1))
done

echo "==> Khởi động app..."

exec "$@"
