-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'FULFILLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEntityType" ADD VALUE 'STOCK_COUNT';
ALTER TYPE "AuditEntityType" ADD VALUE 'VENDOR_CONTRACT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InventoryTxnType" ADD VALUE 'ISSUE';
ALTER TYPE "InventoryTxnType" ADD VALUE 'DAMAGED';
ALTER TYPE "InventoryTxnType" ADD VALUE 'CYCLE_COUNT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PO_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'CONTRACT_EXPIRY';

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "issued_to_id" UUID;

-- AlterTable
ALTER TABLE "parts" ADD COLUMN     "reorder_qty" DECIMAL(12,3),
ADD COLUMN     "sku" TEXT;

-- CreateTable
CREATE TABLE "part_reservations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "part_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "category" TEXT,
    "storage_location" TEXT,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "completed_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL,
    "stock_count_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "system_qty" DECIMAL(12,3) NOT NULL,
    "counted_qty" DECIMAL(12,3),
    "variance" DECIMAL(12,3),
    "unit_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "counted_by_id" UUID,
    "counted_at" TIMESTAMPTZ,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_contracts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "restaurant_id" UUID,
    "title" TEXT NOT NULL,
    "contract_number" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "value" DECIMAL(12,2),
    "response_hours" INTEGER,
    "terms" TEXT,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vendor_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "part_reservations_part_id_restaurant_id_status_idx" ON "part_reservations"("part_id", "restaurant_id", "status");

-- CreateIndex
CREATE INDEX "part_reservations_work_order_id_status_idx" ON "part_reservations"("work_order_id", "status");

-- CreateIndex
CREATE INDEX "stock_counts_restaurant_id_status_idx" ON "stock_counts"("restaurant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_organization_id_code_key" ON "stock_counts"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_stock_count_id_part_id_key" ON "stock_count_lines"("stock_count_id", "part_id");

-- CreateIndex
CREATE INDEX "vendor_contracts_vendor_id_idx" ON "vendor_contracts"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_contracts_end_date_idx" ON "vendor_contracts"("end_date");

-- CreateIndex
CREATE UNIQUE INDEX "parts_organization_id_sku_key" ON "parts"("organization_id", "sku");

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_issued_to_id_fkey" FOREIGN KEY ("issued_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_reservations" ADD CONSTRAINT "part_reservations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_reservations" ADD CONSTRAINT "part_reservations_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_reservations" ADD CONSTRAINT "part_reservations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_reservations" ADD CONSTRAINT "part_reservations_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_reservations" ADD CONSTRAINT "part_reservations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_counted_by_id_fkey" FOREIGN KEY ("counted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contracts" ADD CONSTRAINT "vendor_contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contracts" ADD CONSTRAINT "vendor_contracts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contracts" ADD CONSTRAINT "vendor_contracts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

