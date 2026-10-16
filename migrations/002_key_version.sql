-- The key version sent in the Signature header, per environment. A NEW numbered
-- file rather than an edit to 001, so an install that already has 001 gets the
-- columns too; 001 is frozen once released, so this file alone adds them for fresh and existing installs; the DDL here
-- is idempotent, so the overlap is harmless.
ALTER TABLE "wfp_settings" ADD COLUMN IF NOT EXISTS "key_version_sandbox" TEXT NOT NULL DEFAULT '1';
ALTER TABLE "wfp_settings" ADD COLUMN IF NOT EXISTS "key_version_production" TEXT NOT NULL DEFAULT '1';
