-- ============================================================================
-- MANUAL TEARDOWN SCRIPT — DO NOT RUN AUTOMATICALLY
-- ============================================================================
-- This file is NEVER executed by the ARI module loader.
-- It exists only so a user can run it in their SQL client of choice
-- (Supabase Studio, pgweb, or psql) to remove this module's tables.
--
-- Running this will PERMANENTLY DELETE all Fino data.
-- ============================================================================

DROP TABLE IF EXISTS fino_transactions CASCADE;
DROP TABLE IF EXISTS fino_income_events CASCADE;
DROP TABLE IF EXISTS fino_goals CASCADE;
DROP TABLE IF EXISTS fino_user_profile CASCADE;
