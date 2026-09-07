import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npm run db:seed",
  },
  datasource: {
    // Prisma CLI (migrate, db execute, studio) giành advisory lock, mà lock này
    // gắn với SESSION. Qua endpoint -pooler của Neon (PgBouncer transaction
    // mode) connection bị trả về pool ngay sau transaction, lock ở lại trên một
    // backend idle không ai nhả được -> lần migrate sau treo rồi chết P1002.
    // Dùng chung biến với docker-entrypoint.sh, cùng kiểu fallback ${VAR:-...}.
    url: process.env["MIGRATE_DATABASE_URL"] || process.env["DATABASE_URL"],
  },
});
