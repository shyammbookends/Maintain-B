-- CreateEnum
CREATE TYPE "CustomFieldEntity" AS ENUM ('WORK_ORDER', 'ASSET');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'CHECKBOX');

-- AlterEnum
ALTER TYPE "StepInputType" ADD VALUE 'SECTION';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "custom_fields" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "inspection_items" ADD COLUMN     "show_if_answer" TEXT,
ADD COLUMN     "show_if_position" INTEGER;

-- AlterTable
ALTER TABLE "procedure_steps" ADD COLUMN     "show_if_answer" TEXT,
ADD COLUMN     "show_if_position" INTEGER;

-- AlterTable
ALTER TABLE "work_order_checklist_items" ADD COLUMN     "show_if_answer" TEXT,
ADD COLUMN     "show_if_position" INTEGER;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "custom_fields" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity" "CustomFieldEntity" NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_labels" (
    "work_order_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,

    CONSTRAINT "work_order_labels_pkey" PRIMARY KEY ("work_order_id","label_id")
);

-- CreateIndex
CREATE INDEX "custom_fields_organization_id_entity_idx" ON "custom_fields"("organization_id", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "labels_organization_id_name_key" ON "labels"("organization_id", "name");

-- CreateIndex
CREATE INDEX "work_order_labels_label_id_idx" ON "work_order_labels"("label_id");

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_labels" ADD CONSTRAINT "work_order_labels_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_labels" ADD CONSTRAINT "work_order_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

