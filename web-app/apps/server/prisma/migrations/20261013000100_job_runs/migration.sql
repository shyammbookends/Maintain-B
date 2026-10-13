-- CreateTable
CREATE TABLE "job_runs" (
    "name" TEXT NOT NULL,
    "last_started_at" TIMESTAMPTZ NOT NULL,
    "last_ended_at" TIMESTAMPTZ,
    "last_result" JSONB,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("name")
);

