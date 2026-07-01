-- ═══════════════════════════════════════════════════════════════
-- IET ESTIMATION TOOL — SUPABASE DATABASE SCHEMA
-- Paste this into Supabase → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- ── REFERENCE TABLES (populated by CSV import) ─────────────────

CREATE TABLE IF NOT EXISTS wbs_master (
  wbs_code                 TEXT PRIMARY KEY,
  depth                    INTEGER NOT NULL,
  parent_wbs_code          TEXT,
  level_1                  TEXT,
  level_2                  TEXT,
  level_3                  TEXT,
  level_4                  TEXT,
  level_5                  TEXT,
  level_6                  TEXT,
  description              TEXT NOT NULL,
  scope                    TEXT,
  default_resource_type    TEXT,
  default_delivery_method  TEXT,
  uom_ee                   TEXT,
  uom_copperleaf           TEXT,
  crew_size                NUMERIC,
  hrs_per_person           NUMERIC,
  total_hrs_per_unit       NUMERIC,
  install_wbs_codes        TEXT,
  commission_wbs_codes     TEXT,
  is_active                BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS resource_rates (
  resource_name            TEXT PRIMARY KEY,
  ee_internal_rate         NUMERIC,
  commercial_rate          NUMERIC,
  aer_code                 TEXT,
  erp_code                 TEXT,
  copperleaf_code          TEXT,
  copperleaf_unit_type     TEXT,
  ans_margin_pct           NUMERIC,
  ans_margin_dollar        NUMERIC
);

CREATE TABLE IF NOT EXISTS burden_margin_rates (
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_type                TEXT,
  investment_type          TEXT,
  rate_pct                 NUMERIC,
  rate_decimal             NUMERIC,
  notes                    TEXT
);

CREATE TABLE IF NOT EXISTS aer_rate_classification (
  aer_code                 TEXT PRIMARY KEY,
  commercial_rate_hr       NUMERIC,
  erp_code                 TEXT,
  notes                    TEXT
);

CREATE TABLE IF NOT EXISTS scope_links (
  link_id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supply_wbs_code          TEXT NOT NULL,
  supply_description       TEXT,
  install_l4               TEXT,
  install_wbs_codes        TEXT,
  commission_l4            TEXT,
  commission_wbs_codes     TEXT
);

CREATE TABLE IF NOT EXISTS standard_hours (
  wbs_code                 TEXT PRIMARY KEY,
  description              TEXT,
  scope                    TEXT,
  crew_size                NUMERIC,
  hrs_per_person           NUMERIC,
  total_hrs_per_unit       NUMERIC,
  default_resource_type    TEXT
);

CREATE TABLE IF NOT EXISTS period_contract_equipment (
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wbs_code                 TEXT,
  family_voltage           TEXT,
  category                 TEXT,
  contract_number          TEXT,
  oracle_contract_id       TEXT,
  contract_item_no         TEXT,
  item_description         TEXT,
  make                     TEXT,
  model                    TEXT,
  rating_description       TEXT,
  drawing_number           TEXT,
  current_price_aud        NUMERIC,
  lead_time_weeks          TEXT,
  is_llt                   TEXT,
  price_comments           TEXT,
  comments                 TEXT
);

-- ── PEOPLE (managed via WBS Manager) ──────────────────────────────
CREATE TABLE IF NOT EXISTS iet_people (
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  display_name             TEXT NOT NULL,
  email                    TEXT,
  role                     TEXT,
  team                     TEXT,
  can_review               BOOLEAN DEFAULT FALSE,
  is_active                BOOLEAN DEFAULT TRUE,
  notes                    TEXT
);

-- Insert default people (update with your real team)
INSERT INTO iet_people (display_name, email, role, team, can_review) VALUES
  ('Daniel Lawrence',  'daniel.lawrence@yourdomain.com.au',  'Lead Estimator',  'Zone Substation',  TRUE),
  ('Sarah Chen',       'sarah.chen@yourdomain.com.au',       'Estimator',       'Zone Substation',  FALSE),
  ('Mark Thompson',    'mark.thompson@yourdomain.com.au',    'Estimator',       'Subtransmission',  FALSE),
  ('Priya Nair',       'priya.nair@yourdomain.com.au',       'Senior Estimator','Zone Substation',  TRUE),
  ('Michael Santos',   'michael.santos@yourdomain.com.au',   'Lead Estimator',  'Commissioning',    TRUE),
  ('Emma Blackwood',   'emma.blackwood@yourdomain.com.au',   'Project Manager', 'Zone Substation',  TRUE)
ON CONFLICT DO NOTHING;

-- ── INVESTMENTS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investments (
  id                              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  investment_name                 TEXT NOT NULL,
  investment_number               TEXT,
  wacs_number                     TEXT,
  investment_type                 TEXT DEFAULT 'Commercially Funded',
  estimate_class                  TEXT DEFAULT 'Class 4',
  revision                        TEXT DEFAULT 'A',
  status                          TEXT DEFAULT 'Draft',
  complexity                      TEXT,
  new_technology                  TEXT,
  spend_profile_type              TEXT DEFAULT 'Default (Automatic)',
  estimated_by                    TEXT,
  reviewed_by                     TEXT,
  planning_start_month            DATE,
  planning_duration_months        INTEGER DEFAULT 4,
  design_start_month              INTEGER DEFAULT 1,
  design_duration_months          INTEGER DEFAULT 9,
  construction_start_month        INTEGER DEFAULT 6,
  construction_duration_months    INTEGER DEFAULT 15,
  llt_mode                        TEXT DEFAULT 'Manual',
  contingency_pct                 NUMERIC DEFAULT 0.001,
  -- Escalation rates by stream and FY
  esc_ee_fy26                     NUMERIC DEFAULT 0.045,
  esc_ee_fy27                     NUMERIC DEFAULT 0.038,
  esc_ee_fy28                     NUMERIC DEFAULT 0.035,
  esc_ee_fy29                     NUMERIC DEFAULT 0.035,
  esc_con_fy26                    NUMERIC DEFAULT 0.049,
  esc_con_fy27                    NUMERIC DEFAULT 0.045,
  esc_con_fy28                    NUMERIC DEFAULT 0.040,
  esc_con_fy29                    NUMERIC DEFAULT 0.035,
  esc_mat_fy26                    NUMERIC DEFAULT 0.049,
  esc_mat_fy27                    NUMERIC DEFAULT 0.040,
  esc_mat_fy28                    NUMERIC DEFAULT 0.040,
  esc_mat_fy29                    NUMERIC DEFAULT 0.040,
  -- Audit
  estimate_date                   DATE DEFAULT CURRENT_DATE,
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW()
);

-- ── ESTIMATE LINES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estimate_lines (
  id                         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  investment_id              BIGINT NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  wbs_code                   TEXT NOT NULL,
  quantity                   NUMERIC DEFAULT 0,
  factor_multiplier          NUMERIC DEFAULT 1,
  delivery_method            TEXT DEFAULT 'EE Delivered',
  install_hrs_override       NUMERIC,           -- null = use standard hours
  contractor_unit_rate       NUMERIC,
  plant_cost                 NUMERIC DEFAULT 0,
  materials_cost             NUMERIC DEFAULT 0,
  comments                   TEXT,
  -- Calculated fields (stored for fast reporting)
  ee_labour_hours            NUMERIC DEFAULT 0,
  install_hours_total        NUMERIC DEFAULT 0,
  commission_hours_total     NUMERIC DEFAULT 0,
  ee_internal_total          NUMERIC DEFAULT 0,
  commercial_total           NUMERIC DEFAULT 0,
  -- Audit
  entered_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW(),
  -- Unique constraint: one line per WBS item per investment
  UNIQUE (investment_id, wbs_code)
);

-- ── INDEXES for performance ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wbs_parent         ON wbs_master (parent_wbs_code);
CREATE INDEX IF NOT EXISTS idx_wbs_depth          ON wbs_master (depth);
CREATE INDEX IF NOT EXISTS idx_wbs_scope          ON wbs_master (scope);
CREATE INDEX IF NOT EXISTS idx_wbs_level1         ON wbs_master (level_1);
CREATE INDEX IF NOT EXISTS idx_scope_links_supply ON scope_links (supply_wbs_code);
CREATE INDEX IF NOT EXISTS idx_est_lines_inv      ON estimate_lines (investment_id);
CREATE INDEX IF NOT EXISTS idx_est_lines_wbs      ON estimate_lines (wbs_code);
CREATE INDEX IF NOT EXISTS idx_pce_wbs            ON period_contract_equipment (wbs_code);

-- ── ROW LEVEL SECURITY (enable for production) ─────────────────────
-- By default, Supabase allows all operations with the anon key.
-- For a demo this is fine. Before going to production, enable RLS:
--
-- ALTER TABLE investments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE estimate_lines ENABLE ROW LEVEL SECURITY;
-- -- Then add policies to restrict who can read/write each row.
-- -- See: supabase.com/docs/guides/database/row-level-security

-- ── UPDATED_AT TRIGGER ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER investments_updated_at
  BEFORE UPDATE ON investments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER estimate_lines_updated_at
  BEFORE UPDATE ON estimate_lines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── IET_USERS (team-demo only — mirrors iet_investments pattern) ────
-- Run in Supabase SQL Editor after deploying iet-team-demo.
-- The update_updated_at() function above must exist first.
CREATE TABLE IF NOT EXISTS iet_users (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  role        text NOT NULL,
  pin         text NOT NULL,
  record_data jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE iet_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open anon access - demo only" ON iet_users
  FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER iet_users_updated_at
  BEFORE UPDATE ON iet_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
INSERT INTO iet_users (id, name, role, pin, record_data) VALUES
  ('u1', 'Steven Hannigan', 'Estimation Senior Specialist', '1234',
    '{"id":"u1","name":"Steven Hannigan","role":"Estimation Senior Specialist","pin":"1234"}'::jsonb),
  ('u2', 'Daniel Lawrence', 'ND Team Leader', '2345',
    '{"id":"u2","name":"Daniel Lawrence","role":"ND Team Leader","pin":"2345"}'::jsonb),
  ('u3', 'ND Manager', 'ND Manager', '1607',
    '{"id":"u3","name":"ND Manager","role":"ND Manager","pin":"1607"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── IET_PEOPLE (team-demo only — replaces old iet_people schema above) ──
-- Drop the old BIGINT-PK iet_people if it exists from the earlier schema version,
-- then create the new text-PK version matching the iet_investments pattern.
-- WARNING: only run this if the old table has no live data you need to keep.
-- DROP TABLE IF EXISTS iet_people;   -- uncomment if replacing the old schema
CREATE TABLE IF NOT EXISTS iet_people (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  email       text,
  role        text,
  team        text,
  can_review  boolean DEFAULT false,
  active      boolean DEFAULT true,
  record_data jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE iet_people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open anon access - demo only" ON iet_people
  FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER iet_people_updated_at
  BEFORE UPDATE ON iet_people
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
INSERT INTO iet_people (id, name, email, role, team, can_review, active, record_data) VALUES
  ('1','Daniel Lawrence','d.lawrence@essentialenergy.com.au','Lead Estimator','Zone Substation',true,true,'{"id":1,"name":"Daniel Lawrence","email":"d.lawrence@essentialenergy.com.au","role":"Lead Estimator","team":"Zone Substation","canReview":true,"active":true}'::jsonb),
  ('2','Steven Hannigan','s.hannigan@essentialenergy.com.au','Lead Estimator','Zone Substation',true,true,'{"id":2,"name":"Steven Hannigan","email":"s.hannigan@essentialenergy.com.au","role":"Lead Estimator","team":"Zone Substation","canReview":true,"active":true}'::jsonb),
  ('3','Richard Gonzalez','r.gonzalez@essentialenergy.com.au','Senior Estimator','Subtransmission',true,true,'{"id":3,"name":"Richard Gonzalez","email":"r.gonzalez@essentialenergy.com.au","role":"Senior Estimator","team":"Subtransmission","canReview":true,"active":true}'::jsonb),
  ('4','Wayne Trezise','w.trezise@essentialenergy.com.au','Senior Estimator','Commissioning',true,true,'{"id":4,"name":"Wayne Trezise","email":"w.trezise@essentialenergy.com.au","role":"Senior Estimator","team":"Commissioning","canReview":true,"active":true}'::jsonb),
  ('5','Joshua Walker','j.walker@essentialenergy.com.au','Estimator','Zone Substation',false,true,'{"id":5,"name":"Joshua Walker","email":"j.walker@essentialenergy.com.au","role":"Estimator","team":"Zone Substation","canReview":false,"active":true}'::jsonb),
  ('6','Matt Baker','m.baker@essentialenergy.com.au','Estimator','Communications',false,true,'{"id":6,"name":"Matt Baker","email":"m.baker@essentialenergy.com.au","role":"Estimator","team":"Communications","canReview":false,"active":true}'::jsonb),
  ('7','Ryan Evans','r.evans@essentialenergy.com.au','Estimator','Civil & Earthing',false,true,'{"id":7,"name":"Ryan Evans","email":"r.evans@essentialenergy.com.au","role":"Estimator","team":"Civil & Earthing","canReview":false,"active":true}'::jsonb),
  ('8','Stephanie Dewar','s.dewar@essentialenergy.com.au','Project Manager','Zone Substation',true,true,'{"id":8,"name":"Stephanie Dewar","email":"s.dewar@essentialenergy.com.au","role":"Project Manager","team":"Zone Substation","canReview":true,"active":true}'::jsonb),
  ('9','Adrian Bruce','a.bruce@essentialenergy.com.au','Estimator','Subtransmission',false,true,'{"id":9,"name":"Adrian Bruce","email":"a.bruce@essentialenergy.com.au","role":"Estimator","team":"Subtransmission","canReview":false,"active":true}'::jsonb),
  ('10','Ben Morgan','b.morgan@essentialenergy.com.au','Estimator','Zone Substation',false,false,'{"id":10,"name":"Ben Morgan","email":"b.morgan@essentialenergy.com.au","role":"Estimator","team":"Zone Substation","canReview":false,"active":false}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- iet_equipment_pricing — live-editable equipment/materials pricing
-- (team-demo only — Live Equipment Pricing Phase 1, 2026-07-01)
-- Added additively. Does not alter iet_investments, iet_users, or iet_people.
-- One row per wbs_code (granular, not a blob-per-file) so concurrent
-- edits to different rows never clobber each other.
--
-- Scope note: source data audited against public/data/equipment_pricing.json
-- on 2026-07-01 contains only 333 items across PCE(135)/SCADA(104)/Comms(42)/
-- Assembly(41)/Civil(11) — there is no "Inventory" source in that file. A
-- separate public/data/inventory_materials.json exists (5,397 rows) but has
-- no wbs_code/source fields and cannot be keyed into this schema as-is.
-- Inventory pricing is therefore deferred until its WBS-mapped source is
-- identified — this table and seed cover the 5 confirmed sources only.
-- ============================================================
CREATE TABLE IF NOT EXISTS iet_equipment_pricing (
  wbs_code     TEXT PRIMARY KEY,
  source       TEXT NOT NULL,          -- PCE | SCADA | Comms | Civil | Assembly
  record_data  JSONB NOT NULL,         -- full item object — authoritative, same shape as equipment_pricing.json values
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   TEXT
);

CREATE INDEX IF NOT EXISTS idx_iet_equipment_pricing_source ON iet_equipment_pricing(source);

ALTER TABLE iet_equipment_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open anon access - demo only" ON iet_equipment_pricing
  FOR ALL USING (true) WITH CHECK (true);

-- Reuses update_updated_at(), already defined above for iet_users/iet_people.
CREATE TRIGGER iet_equipment_pricing_updated_at
  BEFORE UPDATE ON iet_equipment_pricing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- iet_price_change_log — append-only audit trail for pricing publishes.
-- Every equipmentPricingStore.saveAll() write is paired with a call to
-- logPriceChange() so publishes are always traceable (who/when/what),
-- even though there is no approval gate on this self-service flow.
-- ============================================================
CREATE TABLE IF NOT EXISTS iet_price_change_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wbs_code    TEXT NOT NULL,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  changed_by  TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iet_price_change_log_wbs_code ON iet_price_change_log(wbs_code);

ALTER TABLE iet_price_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open anon access - demo only" ON iet_price_change_log
  FOR ALL USING (true) WITH CHECK (true);
