import { supabase } from './supabaseClient';

// In-memory cache — same contract as investmentsStore.js: hydrate() on app
// mount / window focus, synchronous getAll() for render, optimistic
// saveAll() for writes, subscribe() for cross-component reactivity.
let _cache = [];
const _listeners = new Set();

function _notify() {
  _listeners.forEach(fn => { try { fn(_cache); } catch (e) { console.error(e); } });
}

// Subscribe to cache changes.
export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// Row → app record. record_data IS the full item — promoted columns exist
// only for indexing/filtering server-side.
function _rowToRecord(row) {
  return row.record_data;
}

// app record → row. Promotes wbs_code/source into real columns for
// indexing; record_data carries the authoritative full object.
function _recordToRow(record, updatedBy) {
  return {
    wbs_code:    record.wbs_code,
    source:      record.source,
    record_data: record,
    updated_by:  updatedBy || 'unknown',
  };
}

// Hydrate the in-memory cache from Supabase. Call on mount and on window focus.
export async function hydrate() {
  try {
    const { data, error } = await supabase
      .from('iet_equipment_pricing')
      .select('record_data');
    if (error) throw error;
    _cache = (data || []).map(_rowToRecord);
    _notify();
  } catch (e) {
    console.error('Supabase hydrate failed — falling back to last known cache:', e);
    // Deliberately do NOT clear _cache on failure — keep whatever was last
    // successfully loaded rather than blanking the caller on a transient network error.
  }
  return _cache;
}

// Synchronous read — returns whatever is currently cached. On first call
// before hydrate() resolves this may be [].
export function getAll() {
  return _cache;
}

// Optimistic write: merges into the in-memory cache immediately (keyed on
// wbs_code so concurrent edits to different rows never conflict), then
// fires the Supabase upsert in the background. Errors are logged, not
// thrown, so a transient network blip doesn't crash the UI.
export function saveAll(records, updatedBy) {
  const byCode = new Map(_cache.map(r => [r.wbs_code, r]));
  records.forEach(r => byCode.set(r.wbs_code, r));
  _cache = Array.from(byCode.values());
  _notify();
  _persistAll(records, updatedBy).catch(e => console.error('Supabase saveAll failed:', e));
  return _cache;
}

async function _persistAll(records, updatedBy) {
  if (!records.length) return;
  const rows = records.map(r => _recordToRow(r, updatedBy));
  const { error } = await supabase
    .from('iet_equipment_pricing')
    .upsert(rows, { onConflict: 'wbs_code' });
  if (error) throw error;
}

// Audit trail — one row per changed field. Called alongside saveAll() by
// the editor's publish action (wired in Phase 3, not this file's caller yet).
export async function logPriceChange(entries) {
  // entries: [{ wbs_code, field, old_value, new_value, changed_by }]
  if (!entries.length) return { error: null };
  const { error } = await supabase.from('iet_price_change_log').insert(entries);
  if (error) console.error('Supabase logPriceChange failed:', error);
  return { error };
}
