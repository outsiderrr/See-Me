-- Open cards (v2 P2): a card readable at /c/<public_slug> with no login, no
-- CardHolder and no reader record of any kind. Existing cards stay 'private'.
ALTER TABLE "cards"
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'private',
ADD COLUMN "public_slug" TEXT;

CREATE UNIQUE INDEX "cards_public_slug_key" ON "cards"("public_slug");

-- Structural red line (v2 §3 #6): the no-login lookup must never be able to reach a
-- login card. The route filters kind='open' as well, but this constraint makes the
-- dangerous state unrepresentable, so a future code regression cannot recreate it.
ALTER TABLE "cards"
ADD CONSTRAINT "cards_kind_slug_ck" CHECK (
  ("kind" = 'open' AND "public_slug" IS NOT NULL)
  OR ("kind" = 'private' AND "public_slug" IS NULL)
);
