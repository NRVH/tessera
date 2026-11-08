// =============================================================================
// El tema del código activo (Configuración › Apariencia › Editor de código › Tema). Publica en variables
// CSS de :root lo que usa quien no es Monaco (los bloques de código de la vista previa de Markdown y la lupa
// del diff) y avisa a quien pinta con Monaco (`monacoSetup.ts`), que redefine su tema y lo aplica a todos
// los editores abiertos, también los de bases de datos. No importa Monaco: el ajuste se aplica al arrancar
// sin cargarlo.
// Decisiones: docs/decisiones/renderer/temas-de-codigo.md
// =============================================================================

import { esTemaCodigo, PALETAS_CODIGO, TEMA_CODIGO_POR_DEFECTO, type PaletaCodigo, type TemaCodigoId } from '../theme/temasCodigo'

let actual: TemaCodigoId = TEMA_CODIGO_POR_DEFECTO
const oyentes = new Set<(p: PaletaCodigo) => void>()

/** La paleta del tema activo, para crear lo que se pinte después con ella. */
export function paletaCodigoActiva(): PaletaCodigo {
  return PALETAS_CODIGO[actual]
}

/** Avisa de cada cambio de tema; devuelve cómo dejar de escuchar. */
export function alCambiarTemaCodigo(f: (p: PaletaCodigo) => void): () => void {
  oyentes.add(f)
  return () => oyentes.delete(f)
}

/**
 * Las variables CSS de quien no es Monaco. El fondo no está: es el de Tessera en todos los temas. Los
 * bloques de código de un documento usan el hundido de la interfaz, para distinguirse del documento.
 */
function publicarVariables(p: PaletaCodigo): void {
  const raiz = document.documentElement.style
  raiz.setProperty('--codigo-texto', p.texto)
  raiz.setProperty('--codigo-insertado', p.insertado)
  raiz.setProperty('--codigo-eliminado', p.eliminado)
}

/** Aplica un tema (uno que no existe cae al de serie) a todo lo que pinta código. */
export function fijarTemaCodigo(id: string): void {
  actual = esTemaCodigo(id) ? id : TEMA_CODIGO_POR_DEFECTO
  const p = PALETAS_CODIGO[actual]
  publicarVariables(p)
  for (const f of oyentes) f(p)
}
