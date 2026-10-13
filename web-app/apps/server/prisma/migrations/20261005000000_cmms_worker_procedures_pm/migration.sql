-- CreateEnum
CREATE TYPE "EvidenceStage" AS ENUM ('BEFORE', 'DURING', 'AFTER');

-- CreateEnum
CREATE TYPE "FinalCondition" AS ENUM ('FULLY_WORKING', 'WORKING_WITH_LIMITATIONS', 'NOT_WORKING', 'NEEDS_REPLACEMENT');

-- CreateEnum
CREATE TYPE "PartCondition" AS ENUM ('NEW', 'REFURBISHED', 'USED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Frequency" ADD VALUE 'YEARLY';
ALTER TYPE "Frequency" ADD VALUE 'ONCE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'WORK_STARTED';
ALTER TYPE "NotificationType" ADD VALUE 'WORK_RESCHEDULED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StepInputType" ADD VALUE 'CHECKBOX';
ALTER TYPE "StepInputType" ADD VALUE 'MULTIPLE_CHOICE';
ALTER TYPE "StepInputType" ADD VALUE 'PHOTO';
ALTER TYPE "StepInputType" ADD VALUE 'SIGNATURE';

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "caption" TEXT,
ADD COLUMN     "stage" "EvidenceStage";

-- AlterTable
ALTER TABLE "inspection_items" ADD COLUMN     "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "require_photo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "procedure_steps" ADD COLUMN     "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "require_photo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "work_order_checklist_items" ADD COLUMN     "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "require_photo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "work_order_parts" ADD COLUMN     "condition" "PartCondition" NOT NULL DEFAULT 'NEW';

-- AlterTable
ALTER TABLE "work_order_time_entries" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "manual" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "work_order_completion_reports" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "problem_found" TEXT NOT NULL,
    "root_cause" TEXT,
    "work_performed" TEXT NOT NULL,
    "new_parts_installed" TEXT,
    "old_parts_removed" TEXT,
    "quantity_repaired" INTEGER,
    "quantity_replaced" INTEGER,
    "additional_materials" TEXT,
    "additional_issue" TEXT,
    "recommendation" TEXT,
    "notes" TEXT,
    "final_condition" "FinalCondition" NOT NULL,
    "no_parts_used" BOOLEAN NOT NULL DEFAULT false,
    "labour_minutes" INTEGER NOT NULL DEFAULT 0,
    "confirmed_by_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "work_order_completion_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_order_completion_reports_work_order_id_key" ON "work_order_completion_reports"("work_order_id");

-- AddForeignKey
ALTER TABLE "work_order_completion_reports" ADD CONSTRAINT "work_order_completion_reports_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_completion_reports" ADD CONSTRAINT "work_order_completion_reports_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_time_entries" ADD CONSTRAINT "work_order_time_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

