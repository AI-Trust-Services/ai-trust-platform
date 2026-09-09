/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUDIT_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
