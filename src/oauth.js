import { createClient } from '@supabase/supabase-js';
export function createOAuthClient(url, key) {
  return createClient(url, key, {
    auth: {
      storageKey: 'hoora-oauth',
      storage: sessionStorage,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
}
