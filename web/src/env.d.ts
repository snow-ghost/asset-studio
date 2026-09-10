/// <reference types="vite/client" />

// Vite's own ImportMetaEnv (DEV, PROD, MODE, …) is merged with the one variable the studio reads. See
// adapters/http/api.ts for how VITE_STUDIO_API and DEV decide where studiod is.
interface ImportMetaEnv {
  readonly VITE_STUDIO_API?: string;
}
