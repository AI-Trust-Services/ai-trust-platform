/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REGISTRY_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
