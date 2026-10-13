-- CreateEnum
CREATE TYPE "PmTriggerType" AS ENUM ('TIME', 'METER');

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('CSV', 'PDF');

-- AlterTable
ALTER TABLE "pm_schedules" ADD COLUMN     "last_triggered_reading" DECIMAL(14,3),
ADD COLUMN     "meter_id" UUID,
ADD COLUMN     "meter_interval" DECIMAL(14,3),
ADD COLUMN     "meter_threshold" DECIMAL(14,3),
ADD COLUMN     "next_due_reading" DECIMAL(14,3),
ADD COLUMN     "trigger_type" "PmTriggerType" NOT NULL DEFAULT 'TIME';

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "restaurant_id" UUID,
    "report_key" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "frequency" "ReportFrequency" NOT NULL,
    "time_of_day" TEXT NOT NULL,
    "day_of_week" INTEGER,
    "day_of_month" INTEGER,
    "format" "ReportFormat" NOT NULL DEFAULT 'PDF',
    "recipient_user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "recipient_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ NOT NULL,
    "last_run_at" TIMESTAMPTZ,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedule_runs" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "scheduled_for" TIMESTAMPTZ NOT NULL,
    "status" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "rows" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_schedule_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_schedules_active_next_run_at_idx" ON "report_schedules"("active", "next_run_at");

-- CreateIndex
CREATE INDEX "report_schedules_organization_id_idx" ON "report_schedules"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_schedule_runs_schedule_id_scheduled_for_key" ON "report_schedule_runs"("schedule_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "pm_schedules_meter_id_idx" ON "pm_schedules"("meter_id");

-- AddForeignKey
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "asset_meters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedule_runs" ADD CONSTRAINT "report_schedule_runs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "report_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

