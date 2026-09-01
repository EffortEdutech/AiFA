/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_AI_GATEWAY_URL?: string;
  readonly VITE_AI_GATEWAY_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
