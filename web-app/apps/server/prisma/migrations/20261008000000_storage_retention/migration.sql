-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'STORAGE_ALERT';

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "compacted_at" TIMESTAMPTZ,
ADD COLUMN     "file_removed_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "attachments_kind_created_at_idx" ON "attachments"("kind", "created_at");

