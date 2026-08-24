-- CreateEnum
CREATE TYPE "image_entity_type" AS ENUM ('USER', 'PRODUCT');

-- CreateTable
CREATE TABLE "images" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_type" "image_entity_type" NOT NULL,
    "image_url" VARCHAR(500) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "images_entity_type_entity_id_sort_order_idx" ON "images"("entity_type", "entity_id", "sort_order");

CREATE INDEX "images_deleted_at_idx" ON "images"("deleted_at");


ALTER TABLE "images"
  ADD CONSTRAINT "images_sort_order_non_negative" CHECK ("sort_order" >= 0);

CREATE UNIQUE INDEX "images_one_primary_per_entity"
  ON "images" ("entity_type", "entity_id")
  WHERE "is_primary" AND "deleted_at" IS NULL;
