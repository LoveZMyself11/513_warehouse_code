import { createClient } from "@supabase/supabase-js";
import { authSessionStorage } from "./authStorage";
import { createStorageUploadFetch } from "./uploadFetch";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: `sb-${new URL(supabaseUrl!).hostname.split(".")[0]}-auth-token`,
        storage: authSessionStorage.storage,
      },
      global: { fetch: createStorageUploadFetch() },
    })
  : null;
