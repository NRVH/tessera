// =============================================================================
// Las capturas de los artículos, generadas por `npm run capturas:academy` en `capturas/` como
// `<id>.<idioma>.webp`. Vite las empaqueta como recursos y aquí solo se resuelve su URL; una
// captura que aún no existe no se pinta. No lo importa ningún test: `import.meta.glob` es de Vite.
// =============================================================================

import { idiomaActual } from '../../../../shared/i18n'

const URLS = import.meta.glob<string>('./capturas/*.webp', { eager: true, query: '?url', import: 'default' })

/** La URL de la captura en el idioma de la interfaz, o la del otro si solo hay esa. */
export function urlDeCaptura(id: string): string | undefined {
  const idioma = idiomaActual()
  const otro = idioma === 'es' ? 'en' : 'es'
  return URLS[`./capturas/${id}.${idioma}.webp`] ?? URLS[`./capturas/${id}.${otro}.webp`]
}
