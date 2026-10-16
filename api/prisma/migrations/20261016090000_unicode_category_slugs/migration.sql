-- Allow non-Latin (e.g. Arabic) category slugs. A slug is lower-case, has no whitespace,
-- and consists of non-empty segments separated by single hyphens.
ALTER TABLE "categories"
  DROP CONSTRAINT "categories_slug_format",
  ADD CONSTRAINT "categories_slug_format"
  CHECK ("slug" = lower("slug") AND "slug" ~ '^[^-[:space:]]+(-[^-[:space:]]+)*$');
