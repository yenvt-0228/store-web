#!/bin/sh
set -e

echo "==> Áp migration lên database..."
npx prisma migrate deploy

echo "==> Khởi động app..."

exec "$@"
