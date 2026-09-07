UPDATE "users" u
SET "email" = lower(u."email")
WHERE u."email" <> lower(u."email")
  AND NOT EXISTS (
    SELECT 1
    FROM "users" o
    WHERE o."id" <> u."id"
      AND o."email" = lower(u."email")
  );
