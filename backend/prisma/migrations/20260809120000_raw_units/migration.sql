-- 原始材料层：数据湖 原始/ 单元级内容的服务器备份 + 标签索引。独立于 notes 表，
-- 邀请卡/公开卡匹配只查 note_tags，raw_units 在结构上进不了任何分享。

-- CreateTable
CREATE TABLE "raw_units" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dated" DATE,
    "attribution" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "needs_confirm" BOOLEAN NOT NULL DEFAULT false,
    "duplicate_of" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "raw_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_unit_tags" (
    "raw_unit_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "raw_unit_tags_pkey" PRIMARY KEY ("raw_unit_id","tag_id")
);

-- CreateIndex
CREATE INDEX "raw_units_user_id_week_idx" ON "raw_units"("user_id", "week");

-- CreateIndex
CREATE UNIQUE INDEX "raw_units_user_id_source_key" ON "raw_units"("user_id", "source");

-- AddForeignKey
ALTER TABLE "raw_units" ADD CONSTRAINT "raw_units_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_unit_tags" ADD CONSTRAINT "raw_unit_tags_raw_unit_id_fkey" FOREIGN KEY ("raw_unit_id") REFERENCES "raw_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_unit_tags" ADD CONSTRAINT "raw_unit_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

