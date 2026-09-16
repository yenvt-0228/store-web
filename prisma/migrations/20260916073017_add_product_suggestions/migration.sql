-- CreateEnum
CREATE TYPE "suggestion_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "product_suggestions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "reference_url" VARCHAR(500),
    "status" "suggestion_status" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_suggestions_user_id_created_at_idx" ON "product_suggestions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "product_suggestions_status_created_at_idx" ON "product_suggestions"("status", "created_at");

-- AddForeignKey
ALTER TABLE "product_suggestions" ADD CONSTRAINT "product_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_suggestions" ADD CONSTRAINT "product_suggestions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
