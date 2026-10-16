-- Pay via WorldFirst for Shop - initial schema (prefix wfp_).
-- All DDL idempotent so it is safe to re-run on every deploy, and so this file
-- stays correct for a fresh install once later numbered migrations exist.

-- Non-secret module settings (singleton). Credentials (client id, signing key)
-- live in env vars, never in the database: the database is included in backups.
--
-- WHICH environment is live is a stored setting rather than an env var. An
-- environment variable on a hosted project does not reach the running server
-- until the next deployment, so choosing "Production" did nothing until a
-- redeploy and the settings panel snapped back to Sandbox. A stored setting
-- takes effect on the very next request. Sandbox is the fallback, because a
-- misconfigured shop should fail to take real money rather than take it by
-- accident.
CREATE TABLE IF NOT EXISTS "wfp_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    -- Shown on WorldFirst's cashier page against the payment (their limit is 64).
    "payment_description" TEXT NOT NULL DEFAULT '',
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    -- WorldFirst assigns each partner its own API host ("the standard domain
    -- name assigned by Platform") and publishes no single public one, so the
    -- host is the owner's to enter. One per environment, https origin only.
    "api_base_url_sandbox" TEXT NOT NULL DEFAULT '',
    "api_base_url_production" TEXT NOT NULL DEFAULT '',
    -- Comma-separated ISO 4217 codes the shop may offer this method for. GBP
    -- unless the owner's WorldFirst account is set up for more.
    "accepted_currencies" TEXT NOT NULL DEFAULT 'GBP',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wfp_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wfp_settings_singleton" CHECK ("id" = 'singleton')
);
INSERT INTO "wfp_settings" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING;

-- One row per checkout attempt: maps a shop order (or the draft it will be made
-- from) to its WorldFirst payment.
CREATE TABLE IF NOT EXISTS "wfp_payments" (
    -- This IS the payToRequestId sent to WorldFirst: their idempotency key.
    -- Generated here, written BEFORE the call goes out, so a retry of a create
    -- that timed out can be sent with the same key and never makes a second
    -- payment.
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    -- WorldFirst's own id for the payment (payToId). NULL until create answers.
    "pay_to_id" TEXT,
    -- WorldFirst's hosted cashier page for this payment. Stored so a shopper
    -- who double-submits is handed back the payment they already have rather
    -- than a second one.
    "checkout_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAIT_PAY',
    -- Major units (pounds), as NUMERIC. Converted to WorldFirst's minor units
    -- at the edge, in lib/amount.ts.
    "amount" NUMERIC(14, 2) NOT NULL,
    "currency" TEXT NOT NULL,
    -- Where to put the payer down once WorldFirst hands them back. NULL means
    -- the shop's confirmation page. Stored rather than carried in the return
    -- URL: that URL comes back through the payer's own browser.
    "return_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wfp_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "wfp_payments_order_id_idx" ON "wfp_payments" ("order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "wfp_payments_pay_to_id_key" ON "wfp_payments" ("pay_to_id");
