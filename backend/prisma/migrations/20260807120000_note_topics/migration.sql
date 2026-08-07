-- A topic connects several notes into one readable line of thought. It is nullable
-- so every existing note remains valid; the reader derives a legacy topic from the
-- source line when this field is absent.
ALTER TABLE "notes" ADD COLUMN "topic" TEXT;
