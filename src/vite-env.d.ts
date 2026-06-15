/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XNO_CREATOR_STORE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
