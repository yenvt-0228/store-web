DO $$
DECLARE
  leftovers int;
BEGIN
  SELECT count(*) INTO leftovers
  FROM "users" u
  WHERE u."email" <> lower(u."email");

  IF leftovers > 0 THEN
    RAISE EXCEPTION
      'Còn % email chưa chuẩn hoá vì trùng nhau khi hạ chữ thường — cần gộp hoặc đổi email thủ công trước khi migrate',
      leftovers;
  END IF;
END $$;

CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower("email"));
