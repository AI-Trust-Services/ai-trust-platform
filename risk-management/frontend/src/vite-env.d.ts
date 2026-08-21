/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RISK_MANAGEMENT_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
