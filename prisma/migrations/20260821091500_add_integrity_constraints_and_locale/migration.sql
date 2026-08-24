
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locale" VARCHAR(5) NOT NULL DEFAULT 'vi';

CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

ALTER TABLE "products"
  ADD CONSTRAINT "products_quantity_non_negative" CHECK ("quantity" >= 0);

ALTER TABLE "products"
  ADD CONSTRAINT "products_price_non_negative" CHECK ("price" >= 0);

-- Mua 0 hoặc âm sản phẩm là vô nghĩa, khác với tồn kho (được phép bằng 0).
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_product_price_non_negative" CHECK ("product_price" >= 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_subtotal_matches" CHECK ("subtotal" = "product_price" * "quantity");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_amount_non_negative" CHECK ("total_amount" >= 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_non_negative" CHECK ("amount" >= 0);

ALTER TABLE "users"
  ADD CONSTRAINT "users_locale_supported" CHECK ("locale" IN ('vi', 'en'));
