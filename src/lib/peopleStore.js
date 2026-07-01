import { supabase } from './supabaseClient';

// Seed matches SAMPLE_PEOPLE in App.jsx so getAll() returns a populated list
// synchronously before the first hydrate() resolves — prevents empty People tab flash.
const DEFAULT_PEOPLE = [
  {id:1,name:"Daniel Lawrence",email:"d.lawrence@essentialenergy.com.au",role:"Lead Estimator",team:"Zone Substation",canReview:true,active:true},
  {id:2,name:"Steven Hannigan",email:"s.hannigan@essentialenergy.com.au",role:"Lead Estimator",team:"Zone Substation",canReview:true,active:true},
  {id:3,name:"Richard Gonzalez",email:"r.gonzalez@essentialenergy.com.au",role:"Senior Estimator",team:"Subtransmission",canReview:true,active:true},
  {id:4,name:"Wayne Trezise",email:"w.trezise@essentialenergy.com.au",role:"Senior Estimator",team:"Commissioning",canReview:true,active:true},
  {id:5,name:"Joshua Walker",email:"j.walker@essentialenergy.com.au",role:"Estimator",team:"Zone Substation",canReview:false,active:true},
  {id:6,name:"Matt Baker",email:"m.baker@essentialenergy.com.au",role:"Estimator",team:"Communications",canReview:false,active:true},
  {id:7,name:"Ryan Evans",email:"r.evans@essentialenergy.com.au",role:"Estimator",team:"Civil & Earthing",canReview:false,active:true},
  {id:8,name:"Stephanie Dewar",email:"s.dewar@essentialenergy.com.au",role:"Project Manager",team:"Zone Substation",canReview:true,active:true},
  {id:9,name:"Adrian Bruce",email:"a.bruce@essentialenergy.com.au",role:"Estimator",team:"Subtransmission",canReview:false,active:true},
  {id:10,name:"Ben Morgan",email:"b.morgan@essentialenergy.com.au",role:"Estimator",team:"Zone Substation",canReview:false,active:false},
];

let _cache = [...DEFAULT_PEOPLE];
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

function _personToRow(person) {
  return {
    id:          String(person.id),
    name:        person.name,
    email:       person.email  || null,
    role:        person.role   || null,
    team:        person.team   || null,
    can_review:  !!person.canReview,
    active:      person.active !== false,
    record_data: person,
  };
}

export async function hydrate() {
  try {
    const { data, error } = await supabase
      .from('iet_people')
      .select('record_data');
    if (error) throw error;
    if (data && data.length) {
      _cache = data.map(_rowToRecord);
      _notify();
    }
  } catch(e) {
    console.error('peopleStore.hydrate failed — falling back to last known cache:', e);
  }
  return _cache;
}

export function getAll() {
  return _cache;
}

export function saveAll(records) {
  _cache = records;
  _notify();
  _persistAll(records).catch(e => console.error('peopleStore.saveAll failed:', e));
  return records;
}

async function _persistAll(records) {
  if (!records.length) return;
  const rows = records.map(_personToRow);
  const { error } = await supabase
    .from('iet_people')
    .upsert(rows, { onConflict: 'id' });
  if (error) throw error;
}

export function removeOne(id) {
  _cache = _cache.filter(p => String(p.id) !== String(id));
  _notify();
  supabase.from('iet_people').delete().eq('id', String(id))
    .then(({ error }) => { if (error) console.error('peopleStore.removeOne failed:', error); });
  return _cache;
}
