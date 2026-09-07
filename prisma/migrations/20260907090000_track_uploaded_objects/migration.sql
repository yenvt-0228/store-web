-- CreateTable
CREATE TABLE "uploaded_objects" (
    "id" UUID NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploaded_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uploaded_objects_object_key_key" ON "uploaded_objects"("object_key");

CREATE UNIQUE INDEX "uploaded_objects_url_key" ON "uploaded_objects"("url");

CREATE INDEX "uploaded_objects_created_at_idx" ON "uploaded_objects"("created_at");
