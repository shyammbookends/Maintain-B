-- AlterTable
ALTER TABLE "locations" ALTER COLUMN "public_id" SET DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text);

-- AlterTable
ALTER TABLE "parts" ALTER COLUMN "public_id" SET DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text);

