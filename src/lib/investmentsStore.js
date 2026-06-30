import { supabase } from './supabaseClient';

// In-memory cache — mirrors what localStorage.getItem("iet_investments") used to
// return synchronously. Hydrated by hydrate() on app mount / hub focus, and kept
// current by every write going through saveAll().
let _cache = [];
let _hydrated = false;
const _listeners = new Set();

function _notify() {
  _listeners.forEach(fn => { try { fn(_cache); } catch (e) { console.error(e); } });
}

// Subscribe to cache changes — used by InvestmentHub's load() effect to re-render
// after an async hydrate completes, since the very first read on mount can't be
// synchronous against a network call.
export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// Row → app record. record_data IS the full record — promoted columns exist
// only for indexing/filtering server-side and are not the source of truth for
// any field the app reads. Always prefer record_data's own fields.
function _rowToRecord(row) {
  return row.record_data;
}

// app record → row. Promotes a handful of fields into real columns for
// indexing; record_data carries the authoritative full object.
function _recordToRow(record) {
  return {
    id:           String(record.id),
    inv_number:   record.inv?.number   || null,
    inv_name:     record.inv?.name     || null,
    inv_revision: record.inv?.revision || null,
    status:       record.status        || 'Draft',
    total_ee:     record.totalEE       ?? null,
    total_comm:   record.totalComm     ?? null,
    saved_at_iso: record.savedAtISO    || null,
    record_data:  record,
  };
}

// Hydrate the in-memory cache from Supabase. Call on mount and on window focus
// (same trigger InvestmentHub already uses for localStorage reload).
export async function hydrate() {
  try {
    const { data, error } = await supabase
      .from('iet_investments')
      .select('record_data')
      .order('saved_at_iso', { ascending: false });
    if (error) throw error;
    _cache = (data || []).map(_rowToRecord);
    _hydrated = true;
    _notify();
  } catch (e) {
    console.error('Supabase hydrate failed — falling back to last known cache:', e);
    // Deliberately do NOT clear _cache on failure — keep whatever was last
    // successfully loaded rather than blanking the hub on a transient network error.
  }
  return _cache;
}

// Synchronous read — mirrors localStorage.getItem("iet_investments") + JSON.parse.
// Returns whatever is currently cached. On first call before hydrate() resolves
// this may be []; callers that need fresh data after mount should also call
// hydrate() and subscribe() (InvestmentHub's load() effect does both).
export function getAll() {
  return _cache;
}

// Synchronous-looking write — updates the in-memory cache immediately so the
// calling code's optimistic setSaved(updated) stays correct, then fires the
// Supabase upsert in the background. Errors are logged, not thrown, so a
// transient network blip doesn't crash the UI. The next hydrate() (on focus)
// will reconcile if a write silently failed.
export function saveAll(records) {
  _cache = records;
  _notify();
  _persistAll(records).catch(e => console.error('Supabase saveAll failed:', e));
  return records;
}

async function _persistAll(records) {
  if (!records.length) return;
  const rows = records.map(_recordToRow);
  const { error } = await supabase
    .from('iet_investments')
    .upsert(rows, { onConflict: 'id' });
  if (error) throw error;
}

// Delete a single record by id — used by del(). Issues an actual DELETE so
// removed records don't reappear for other team members on their next hydrate().
export function removeOne(id) {
  _cache = _cache.filter(r => String(r.id) !== String(id));
  _notify();
  supabase.from('iet_investments').delete().eq('id', String(id))
    .then(({ error }) => { if (error) console.error('Supabase delete failed:', error); });
  return _cache;
}
