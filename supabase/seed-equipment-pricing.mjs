// One-time seed for iet_equipment_pricing from public/data/equipment_pricing.json.
// Run once, from the repo root, after the DDL in schema.sql is live:
//   node supabase/seed-equipment-pricing.mjs
//
// Do NOT run this again against a table that already has manager-published
// edits — it upserts on wbs_code and will overwrite them with the original
// JSON values.
//
// Scope note: only covers the 5 sources actually present in
// equipment_pricing.json (PCE/SCADA/Comms/Civil/Assembly = 333 rows).
// Inventory pricing lives in a differently-shaped file with no wbs_code
// and is deferred — see schema.sql comment above iet_equipment_pricing.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = (m[2] || '').trim();
    }
  } catch {
    // no .env — assume vars are already exported in the environment
  }
}

loadEnv();

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — check .env');
  process.exit(1);
}

const sb = createClient(url, key);

const data = JSON.parse(readFileSync(new URL('../public/data/equipment_pricing.json', import.meta.url), 'utf8'));
const entries = Object.entries(data);

const EXPECTED = 333;
if (entries.length !== EXPECTED) {
  console.error(`Expected ${EXPECTED} source items, found ${entries.length} — re-verify equipment_pricing.json before seeding`);
  process.exit(1);
}

const rows = entries.map(([wbs_code, item]) => ({
  wbs_code,
  source: item.source,
  record_data: item,
  updated_by: 'seed-migration-2026-07-01',
}));

const CHUNK = 500;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const { error } = await sb.from('iet_equipment_pricing').upsert(chunk, { onConflict: 'wbs_code' });
  if (error) {
    console.error(`Seed failed at rows ${i}-${i + chunk.length}:`, error.message);
    process.exit(1);
  }
  console.log(`Seeded rows ${i}-${i + chunk.length} of ${rows.length}`);
}

const { count, error: countError } = await sb
  .from('iet_equipment_pricing')
  .select('wbs_code', { count: 'exact', head: true });
if (countError) {
  console.error('Post-seed count check failed:', countError.message);
  process.exit(1);
}
console.log('Total rows in table:', count);
if (count !== EXPECTED) {
  console.error(`Row count mismatch after seed: expected ${EXPECTED}, got ${count}`);
  process.exit(1);
}
