/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XNO_CREATOR_STORE_URL?: string
  readonly VITE_LOGIN_RECEIVER_NANO_ADDRESS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
