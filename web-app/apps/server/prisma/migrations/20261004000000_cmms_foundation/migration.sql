-- CreateEnum
CREATE TYPE "AssetCriticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "WorkOrderCostType" AS ENUM ('VENDOR', 'MATERIAL', 'TRAVEL', 'OTHER');

-- AlterEnum
ALTER TYPE "AssetEventType" ADD VALUE 'TRANSFERRED';

-- AlterEnum
ALTER TYPE "AssetStatus" ADD VALUE 'WARNING';

-- AlterEnum
ALTER TYPE "AttachmentKind" ADD VALUE 'AUDIO';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LocationType" ADD VALUE 'BUILDING';
ALTER TYPE "LocationType" ADD VALUE 'FLOOR';
ALTER TYPE "LocationType" ADD VALUE 'AREA';
ALTER TYPE "LocationType" ADD VALUE 'ROOM';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'REQUEST_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'REQUEST_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'WORK_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'WORK_CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PermissionAction" ADD VALUE 'COMPLETE';
ALTER TYPE "PermissionAction" ADD VALUE 'CLOSE';

-- AlterEnum
ALTER TYPE "RequestStatus" ADD VALUE 'APPROVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkOrderStatus" ADD VALUE 'DRAFT';
ALTER TYPE "WorkOrderStatus" ADD VALUE 'SCHEDULED';
ALTER TYPE "WorkOrderStatus" ADD VALUE 'VERIFIED';
ALTER TYPE "WorkOrderStatus" ADD VALUE 'REOPENED';
ALTER TYPE "WorkOrderStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "criticality" "AssetCriticality" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "install_date" DATE,
ADD COLUMN     "parent_id" UUID;

-- AlterTable
ALTER TABLE "locations" ADD COLUMN "public_id" TEXT;
-- Existing rows get a random QR id (new rows get one from the app).
UPDATE "locations" SET "public_id" = substr(md5(random()::text || id::text), 1, 16) WHERE "public_id" IS NULL;
ALTER TABLE "locations" ALTER COLUMN "public_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "parts" ADD COLUMN "public_id" TEXT;
-- Existing rows get a random QR id (new rows get one from the app).
UPDATE "parts" SET "public_id" = substr(md5(random()::text || id::text), 1, 16) WHERE "public_id" IS NULL;
ALTER TABLE "parts" ALTER COLUMN "public_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "review_note" TEXT;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "manager_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "hourly_rate" DECIMAL(10,2),
ADD COLUMN     "job_title" TEXT;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMPTZ,
ADD COLUMN     "parent_id" UUID,
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "scheduled_start" TIMESTAMPTZ,
ADD COLUMN     "supervisor_id" UUID,
ADD COLUMN     "vendor_id" UUID,
ADD COLUMN     "verified_at" TIMESTAMPTZ,
ADD COLUMN     "verified_by_id" UUID;

-- CreateTable
CREATE TABLE "work_order_assignments" (
    "work_order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "added_by_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_assignments_pkey" PRIMARY KEY ("work_order_id","user_id")
);

-- CreateTable
CREATE TABLE "work_order_costs" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "type" "WorkOrderCostType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "vendor_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_order_assignments_user_id_idx" ON "work_order_assignments"("user_id");

-- CreateIndex
CREATE INDEX "work_order_costs_work_order_id_idx" ON "work_order_costs"("work_order_id");

-- CreateIndex
CREATE INDEX "work_order_costs_vendor_id_idx" ON "work_order_costs"("vendor_id");

-- CreateIndex
CREATE INDEX "assets_parent_id_idx" ON "assets"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_public_id_key" ON "locations"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "parts_public_id_key" ON "parts"("public_id");

-- CreateIndex
CREATE INDEX "work_orders_parent_id_idx" ON "work_orders"("parent_id");

-- CreateIndex
CREATE INDEX "work_orders_vendor_id_idx" ON "work_orders"("vendor_id");

-- CreateIndex
CREATE INDEX "work_orders_scheduled_start_idx" ON "work_orders"("scheduled_start");

-- AddForeignKey
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_costs" ADD CONSTRAINT "work_order_costs_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_costs" ADD CONSTRAINT "work_order_costs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_costs" ADD CONSTRAINT "work_order_costs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

