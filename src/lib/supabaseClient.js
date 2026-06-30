import { createClient } from '@supabase/supabase-js';

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Supabase env vars missing — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
    'Investments will fail to load or save. Check .env (local) or repo secrets (deployed).'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
