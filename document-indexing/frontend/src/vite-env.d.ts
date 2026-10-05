/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_INDEXING_API_BASE: string;
  readonly VITE_USERS_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
