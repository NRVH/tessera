// =============================================================================
// Declara `window.tessera` para el renderer y el e2e con la forma de `TesseraApi`.
// Incluye la API de delegación por composición. El objeto lo expone `index.ts` con `contextBridge`. Lo incluyen
// `tsconfig.web.json` y `tsconfig.e2e.json`.
// =============================================================================
import type { TesseraApi } from './index'

declare global {
  interface Window {
    tessera: TesseraApi
  }
}
