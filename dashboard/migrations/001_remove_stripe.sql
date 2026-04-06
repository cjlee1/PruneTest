-- Migration: remove Stripe billing columns
-- Run this against your Neon database to align with the open-source schema.
--
-- What changed:
--   - api_tokens.stripe_session_id column removed (was used for Stripe webhook idempotency)
--   - subscriptions table removed (was used for Stripe subscription tracking)
--
-- Safe to run multiple times (uses IF EXISTS).

ALTER TABLE api_tokens DROP COLUMN IF EXISTS stripe_session_id;

DROP TABLE IF EXISTS subscriptions;
