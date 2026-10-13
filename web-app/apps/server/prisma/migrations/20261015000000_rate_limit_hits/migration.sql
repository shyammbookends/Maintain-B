-- Shared counters for rate limits on serverless hosting, where every function
-- instance would otherwise count on its own (login, SSO, public portal, exports).
CREATE TABLE "rate_limit_hits" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "reset_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "rate_limit_hits_reset_at_idx" ON "rate_limit_hits"("reset_at");
