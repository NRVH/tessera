// =============================================================================
// Teclado del árbol: Escape, borrar, seleccionar todo y copiar, cortar y pegar con el
// modificador principal de cada plataforma. Va en el `onKeyDown` del div del panel y
// NUNCA en un listener de `window`: ahí chocaría con los atajos del editor y de las
// terminales. La decisión de qué acorde borra vive en `util/atajos.ts`.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { tocaContenedor } from '../../../../shared/jarPath'
import { esAtajoBorrado, esModPrincipal } from '../../util/atajos'
import { destinoPegado } from './fileClipboard'
import { abrirDialogoBorrado, mensajeDe } from './operacionesArbol'
import { copiarOCortar, pegarEn, resolverPegable } from './portapapelesArbol'
import { SELECCION_VACIA, seleccionarTodo } from './seleccionArbol'
import type { Arbol } from './tiposArbol'

/** Escape y borrar, que no llevan el modificador principal. true = tecla atendida. */
function teclaSinModificador(a: Arbol, e: React.KeyboardEvent<HTMLDivElement>): boolean {
  const desnudo = !esModPrincipal(e) && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey
  if (desnudo && e.key === 'Escape') {
    if (a.seleccion.claves.size === 0) return true
    e.preventDefault()
    a.setSeleccion(SELECCION_VACIA)
    return true
  }
  // Se borra con la tecla de cada plataforma (`Supr` o `⌘⌫`), no con un `key === 'Delete'`.
  if (esAtajoBorrado(e)) {
    if (a.seleccion.claves.size === 0) return true
    e.preventDefault()
    abrirDialogoBorrado(a, [...a.seleccion.claves])
    return true
  }
  return false
}

/**
 * Ctrl+V / ⌘V: pega en la carpeta de la fila líder, o en la raíz si no hay. El destino se
 * comprueba con `tocaContenedor` y no con `esRutaVirtual`: para una clase en la raíz de un
 * .jar, `parentDir` da `x.jar!`, que `esRutaVirtual` da por buena y el main reventaba.
 */
async function pegarConTeclado(a: Arbol): Promise<void> {
  const fila = a.seleccion.lider !== null ? a.filaPorClave.get(a.seleccion.lider) : undefined
  const destino = fila ? destinoPegado(fila.leaf.path, fila.isDir) : ''
  if (tocaContenedor(destino)) return
  try {
    const fuente = await resolverPegable(a)
    if (fuente.kind === 'ninguno') return
    await pegarEn(a, destino, fuente)
  } catch (err) {
    a.setOpError(mensajeDe(err))
  }
}

/** `onKeyDown` del panel del árbol. */
export async function manejarTeclaArbol(
  a: Arbol,
  e: React.KeyboardEvent<HTMLDivElement>
): Promise<void> {
  // Con un diálogo o el menú abiertos no se atiende nada: Escape y borrar no llevan Ctrl.
  if (a.dialog !== null || a.menu !== null || a.importConflict !== null) return
  if (teclaSinModificador(a, e)) return
  // Shift y Alt siguen anulando: AltGr llega como Ctrl+Alt y no debe copiar a escondidas.
  if (!esModPrincipal(e) || e.altKey || e.shiftKey) return
  const key = e.key.toLowerCase()
  // Seleccionar todo lo visible; no el proyecto entero, que nadie ha desplegado.
  if (key === 'a') {
    e.preventDefault()
    a.setSeleccion(seleccionarTodo(a.clavesNodo))
    return
  }
  if (key === 'v') {
    e.preventDefault()
    await pegarConTeclado(a)
    return
  }
  if (key !== 'c' && key !== 'x') return
  const paths = a.rutasHoja(a.seleccion.claves)
  if (paths.length === 0) return
  e.preventDefault()
  await copiarOCortar(a, paths, key === 'c' ? 'copiar' : 'cortar')
}
