
-- CreateEnum
CREATE TYPE "RepeatUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "RepeatBasis" AS ENUM ('SCHEDULE', 'COMPLETION');

-- DropForeignKey
ALTER TABLE "requests" DROP CONSTRAINT "requests_requested_by_id_fkey";

-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "guest_name" TEXT,
ADD COLUMN     "guest_phone" TEXT,
ALTER COLUMN "requested_by_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "portal_id" TEXT NOT NULL DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text);

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "repeat_basis" "RepeatBasis",
ADD COLUMN     "repeat_every" INTEGER,
ADD COLUMN     "repeat_unit" "RepeatUnit",
ADD COLUMN     "repeated_from_id" UUID;

-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_views_organization_id_resource_idx" ON "saved_views"("organization_id", "resource");

-- CreateIndex
CREATE INDEX "saved_views_user_id_resource_idx" ON "saved_views"("user_id", "resource");

-- CreateIndex
CREATE INDEX "requests_restaurant_id_guest_phone_idx" ON "requests"("restaurant_id", "guest_phone");

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_portal_id_key" ON "restaurants"("portal_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_repeated_from_id_key" ON "work_orders"("repeated_from_id");

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_repeated_from_id_fkey" FOREIGN KEY ("repeated_from_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

