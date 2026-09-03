/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin. Leave unset for same-origin deployments. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
