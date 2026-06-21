ALTER TABLE "tags"
ADD COLUMN "icon" TEXT,
ADD COLUMN "pinned_at" TIMESTAMPTZ(6);

CREATE TABLE "note_images" (
    "id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "note_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "note_images_note_id_sort_order_idx" ON "note_images"("note_id", "sort_order");

ALTER TABLE "note_images"
ADD CONSTRAINT "note_images_note_id_fkey"
FOREIGN KEY ("note_id") REFERENCES "notes"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Rotate existing local four-character codes into the new eight-character format.
UPDATE "cards"
SET "invite_code" = translate(upper(substr(md5("id"), 1, 8)), '01', 'ZY');
