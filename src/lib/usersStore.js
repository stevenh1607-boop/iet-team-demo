import { supabase } from './supabaseClient';

// Seed matches DEFAULT_USERS so getAll() returns a non-empty list synchronously
// before the first hydrate() resolves — prevents an empty login screen flash.
const DEFAULT_USERS = [
  {id:"u1", name:"Steven Hannigan", role:"Estimation Senior Specialist", pin:"1234"},
  {id:"u2", name:"Daniel Lawrence",  role:"ND Team Leader",               pin:"2345"},
  {id:"u3", name:"ND Manager",       role:"ND Manager",                   pin:"1607"},
];

let _cache = [...DEFAULT_USERS];
const _listeners = new Set();

function _notify() {
  _listeners.forEach(fn => { try { fn(_cache); } catch(e) { console.error(e); } });
}

export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _rowToRecord(row) {
  return row.record_data;
}

function _userToRow(user) {
  return {
    id:          String(user.id),
    name:        user.name,
    role:        user.role,
    pin:         user.pin,
    record_data: user,
  };
}

export async function hydrate() {
  try {
    const { data, error } = await supabase
      .from('iet_users')
      .select('record_data');
    if (error) throw error;
    if (data && data.length) {
      _cache = data.map(_rowToRecord);
      _notify();
    }
  } catch(e) {
    console.error('usersStore.hydrate failed — falling back to last known cache:', e);
  }
  return _cache;
}

export function getAll() {
  return _cache;
}

export function saveAll(records) {
  _cache = records;
  _notify();
  _persistAll(records).catch(e => console.error('usersStore.saveAll failed:', e));
  return records;
}

async function _persistAll(records) {
  if (!records.length) return;
  const rows = records.map(_userToRow);
  const { error } = await supabase
    .from('iet_users')
    .upsert(rows, { onConflict: 'id' });
  if (error) throw error;
}

export function removeOne(id) {
  _cache = _cache.filter(u => String(u.id) !== String(id));
  _notify();
  supabase.from('iet_users').delete().eq('id', String(id))
    .then(({ error }) => { if (error) console.error('usersStore.removeOne failed:', error); });
  return _cache;
}
