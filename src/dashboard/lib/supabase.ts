import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = !!url && !!key;
// Somente a chave anon (pública); o acesso real é controlado por RLS + login.
export const supabase = createClient(url ?? 'http://invalid.local', key ?? 'missing');
