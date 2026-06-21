-- DropForeignKey
ALTER TABLE "note_tags" DROP CONSTRAINT "note_tags_tag_id_fkey";

-- AddForeignKey
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
