/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALERTS_API_BASE: string;
  readonly VITE_ALERTS_URL?: string;
  readonly VITE_USERS_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
