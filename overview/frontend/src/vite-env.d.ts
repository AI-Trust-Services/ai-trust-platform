/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OVERVIEW_API_BASE: string;
  readonly VITE_ALERTS_API_BASE: string;
  readonly VITE_ALERTS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
