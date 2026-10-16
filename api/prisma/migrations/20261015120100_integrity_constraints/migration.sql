-- Hand-written integrity rules that Prisma's schema language cannot express.
-- Prisma ignores CHECK constraints and triggers when diffing, so future migrations will not drop them.

-- Products: money and stock can never go negative; SKUs are normalised to upper case.
ALTER TABLE "products"
  ADD CONSTRAINT "products_price_non_negative" CHECK ("price" >= 0),
  ADD CONSTRAINT "products_stock_non_negative" CHECK ("stock" >= 0),
  ADD CONSTRAINT "products_sku_format" CHECK ("sku" ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),
  ADD CONSTRAINT "products_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "products_description_not_blank" CHECK (btrim("description") <> '');

-- Categories: slug is the uniqueness key, so its format must be canonical.
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "categories_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "categories_description_not_blank" CHECK (btrim("description") <> '');

-- Users: e-mail uniqueness is case-insensitive because the application stores it lower-cased.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

-- API clients: a key without permissions is meaningless; enforce at least one.
ALTER TABLE "api_clients"
  ADD CONSTRAINT "api_clients_permissions_not_empty"
  CHECK ("permissions" IS NOT NULL AND cardinality("permissions") > 0);

-- Audit log is append-only: block UPDATE and DELETE at the database level.
CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% is not allowed)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
