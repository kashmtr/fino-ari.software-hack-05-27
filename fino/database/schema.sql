-- Fino module schema
-- Idempotent: safe to run on every module enable.
-- Mirrors modules-custom/fino/database/schema.ts

-- ─── fino_transactions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fino_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  description TEXT NOT NULL,
  statement_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fino_transactions_user_id ON fino_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_fino_transactions_user_date ON fino_transactions(user_id, date DESC);

ALTER TABLE fino_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fino_transactions_rls_select ON fino_transactions;
CREATE POLICY fino_transactions_rls_select ON fino_transactions FOR SELECT
  USING (user_id = (SELECT current_setting('app.current_user_id')));

DROP POLICY IF EXISTS fino_transactions_rls_insert ON fino_transactions;
CREATE POLICY fino_transactions_rls_insert ON fino_transactions FOR INSERT
  WITH CHECK (user_id = (SELECT current_setting('app.current_user_id')));

DROP POLICY IF EXISTS fino_transactions_rls_update ON fino_transactions;
CREATE POLICY fino_transactions_rls_update ON fino_transactions FOR UPDATE
  USING (user_id = (SELECT current_setting('app.current_user_id')));

DROP POLICY IF EXISTS fino_transactions_rls_delete ON fino_transactions;
CREATE POLICY fino_transactions_rls_delete ON fino_transactions FOR DELETE
  USING (user_id = (SELECT current_setting('app.current_user_id')));

-- ─── fino_income_events ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fino_income_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fino_income_events_user_month UNIQUE (user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_fino_income_events_user_id ON fino_income_events(user_id);

ALTER TABLE fino_income_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fino_income_events_rls_select ON fino_income_events;
CREATE POLICY fino_income_events_rls_select ON fino_income_events FOR SELECT
  USING (user_id = (SELECT current_setting('app.current_user_id')));

DROP POLICY IF EXISTS fino_income_events_rls_insert ON fino_income_events;
CREATE POLICY fino_income_events_rls_insert ON fino_income_events FOR INSERT
  WITH CHECK (user_id = (SELECT current_setting('app.current_user_id')));

DROP POLICY IF EXISTS fino_income_events_rls_update ON fino_income_events;
CREATE POLICY fino_income_events_rls_update ON fino_income_events FOR UPDATE
  USING (user_id = (SELECT current_setting('app.current_user_id')));

DROP POLICY IF EXISTS fino_income_events_rls_delete ON fino_income_events;
CREATE POLICY fino_income_events_rls_delete ON fino_income_events FOR DELETE
  USING (user_id = (SELECT current_setting('app.current_user_id')));

-- ─── fino_goals ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fino_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_amount NUMERIC(12, 2) NOT NULL,
  target_date DATE,
  monthly_contribution NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fino_goals_user_id ON fino_goals(user_id);

ALTER TABLE fino_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fino_goals_rls_select ON fino_goals;
CREATE POLICY fino_goals_rls_select ON fino_goals FOR SELECT
  USING (user_id = (SELECT current_setting('app.current_user_id')));

DROP POLICY IF EXISTS fino_goals_rls_insert ON fino_goals;
CREATE POLICY fino_goals_rls_insert ON fino_goals FOR INSERT
  WITH CHECK (user_id = (SELECT current_setting('app.current_user_id')));

DROP POLICY IF EXISTS fino_goals_rls_update ON fino_goals;
CREATE POLICY fino_goals_rls_update ON fino_goals FOR UPDATE
  USING (user_id = (SELECT current_setting('app.current_user_id')));

DROP POLICY IF EXISTS fino_goals_rls_delete ON fino_goals;
CREATE POLICY fino_goals_rls_delete ON fino_goals FOR DELETE
  USING (user_id = (SELECT current_setting('app.current_user_id')));

-- ─── fino_user_profile ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fino_user_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  savings_buffer NUMERIC(12, 2) NOT NULL DEFAULT 500,
  monthly_savings_target NUMERIC(12, 2) NOT NULL DEFAULT 200,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fino_user_profile_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_fino_user_profile_user_id ON fino_user_profile(user_id);

ALTER TABLE fino_user_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fino_user_profile_rls_select ON fino_user_profile;
CREATE POLICY fino_user_profile_rls_select ON fino_user_profile FOR SELECT
  USING (user_id = (SELECT current_setting('app.current_user_id')));

DROP POLICY IF EXISTS fino_user_profile_rls_insert ON fino_user_profile;
CREATE POLICY fino_user_profile_rls_insert ON fino_user_profile FOR INSERT
  WITH CHECK (user_id = (SELECT current_setting('app.current_user_id')));

DROP POLICY IF EXISTS fino_user_profile_rls_update ON fino_user_profile;
CREATE POLICY fino_user_profile_rls_update ON fino_user_profile FOR UPDATE
  USING (user_id = (SELECT current_setting('app.current_user_id')));

DROP POLICY IF EXISTS fino_user_profile_rls_delete ON fino_user_profile;
CREATE POLICY fino_user_profile_rls_delete ON fino_user_profile FOR DELETE
  USING (user_id = (SELECT current_setting('app.current_user_id')));
