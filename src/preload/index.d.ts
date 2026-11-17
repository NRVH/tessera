// =============================================================================
// Declara `window.tessera` para el renderer y el e2e con la forma de `ApiTessera`.
// Incluye la API de delegación por composición. El objeto lo expone `index.ts` con `contextBridge`. Lo incluyen
// `tsconfig.web.json` y `tsconfig.e2e.json`.
// =============================================================================
import type { ApiTessera } from './index'

declare global {
  interface Window {
    tessera: ApiTessera
  }
}
