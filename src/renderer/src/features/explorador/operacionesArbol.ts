// =============================================================================
// Operaciones del árbol sobre el disco del proyecto: crear, renombrar, eliminar, mover
// e importar. Funciones planas que reciben el `Arbol` del render en curso; los errores
// de un gesto rápido van al banner efímero y los de un diálogo, al propio diálogo.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { esDescendiente } from '../../../../shared/jarPath'
import { basename } from './rutaPosix'
import { txExplorador } from './textos.ts'
import {
  obtenerPortapapelesInterno,
  fijarPortapapelesInterno
} from './portapapelesArchivos'
import {
  SELECCION_VACIA,
  olvidarDeSeleccion,
  origenesAMover,
  puedeSoltarN
} from './seleccionArbol'
import type { Arbol } from './tiposArbol'

/** Texto de un error desconocido. */
export function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Cierra el diálogo activo y su error. */
export function cerrarDialogo(a: Arbol): void {
  a.setDialogo(null)
  a.setErrorDialogo(null)
}

/**
 * Olvida el objetivo de los atajos y el corte pendiente si apuntaban a `rutas` o a algo
 * que colgaba de ellos: si no, Ctrl+V pegaría en una carpeta que ya no existe.
 */
function olvidarObjetivos(a: Arbol, rutas: readonly string[]): void {
  if (rutas.length === 0) return
  const afectado = (p: string): boolean =>
    rutas.some((base) => p === base || esDescendiente(base, p))
  a.setSeleccion((prev) => olvidarDeSeleccion(prev, rutas))
  const interno = obtenerPortapapelesInterno()
  if (
    interno !== null &&
    interno.rutaHostProyecto === a.props.rutaHostProyecto &&
    interno.rutas.some(afectado)
  ) {
    fijarPortapapelesInterno(null)
  }
}

/** Crea archivo o carpeta y, si es archivo, lo abre en el editor. */
export async function crearNodo(a: Arbol, dir: string, nombre: string, esCarpeta: boolean): Promise<void> {
  try {
    const req = { raiz: a.props.rutaHostProyecto, dir, nombre }
    if (esCarpeta) {
      const res = await window.tessera.files.crearCarpeta(req)
      a.setDirSeleccionado(res.ruta)
      a.setRutaPorRevelar(res.ruta)
    } else {
      const res = await window.tessera.files.crearArchivo(req)
      a.props.onAbrirArchivo({ ruta: res.ruta, nombre })
      a.setRutaPorRevelar(res.ruta)
    }
    cerrarDialogo(a)
    a.forzarRefresco()
  } catch (err) {
    a.setErrorDialogo(mensajeDe(err))
  }
}

/** Renombra un nodo; un error de validación del main se muestra en el diálogo. */
export async function renombrarNodo(a: Arbol, ruta: string, nombreNuevo: string): Promise<void> {
  try {
    await window.tessera.files.renombrar({ raiz: a.props.rutaHostProyecto, ruta, nombreNuevo })
    olvidarObjetivos(a, [ruta])
    cerrarDialogo(a)
    a.forzarRefresco()
  } catch (err) {
    a.setErrorDialogo(mensajeDe(err))
  }
}

/**
 * Elimina un lote con una llamada, un refresco y un aviso. El borrado del main es
 * best-effort: lo que falla vuelve en `fallidos` y se dice. Solo se olvida lo que de
 * verdad se borró.
 */
export async function eliminarNodos(a: Arbol, rutas: readonly string[]): Promise<void> {
  try {
    const res = await window.tessera.files.borrarVarios({ raiz: a.props.rutaHostProyecto, rutas: [...rutas] })
    olvidarObjetivos(a, res.borrados)
    if (res.fallidos.length > 0) {
      a.setOpError(txExplorador().noSePudoEliminar(res.fallidos.join(', ')))
    }
  } catch (err) {
    a.setOpError(mensajeDe(err))
  } finally {
    cerrarDialogo(a)
    a.forzarRefresco()
  }
}

/**
 * Mueve todo lo arrastrado a `destDir`, en un solo viaje al main para que el todo o nada
 * sea posible. La selección solo se olvida si se movió algo, y el refresco va detrás del
 * `return` de conflictos: ahí el main no tocó el disco.
 */
export async function moverNodos(a: Arbol, srcs: readonly string[], destDir: string): Promise<void> {
  if (!puedeSoltarN(srcs, destDir)) return
  const aMover = origenesAMover(srcs, destDir)
  if (aMover.length === 0) return
  try {
    const res = await window.tessera.files.moverVarios({ raiz: a.props.rutaHostProyecto, srcs: aMover, destDir })
    if (res.conflictos.length > 0) {
      const nombres = res.conflictos.map((n) => `"${n}"`).join(', ')
      a.setOpError(txExplorador().noSeMovio(res.conflictos.length > 1, nombres))
      return
    }
    a.forzarRefresco()
    olvidarObjetivos(a, res.movidos.length > 0 ? aMover : [])
    // La selección se vacía en vez de seguir a lo movido: apuntaría a rutas aún inexistentes.
    a.setSeleccion(SELECCION_VACIA)
    if (res.movidos[0]) a.setRutaPorRevelar(res.movidos[0])
  } catch (err) {
    a.setOpError(mensajeDe(err))
  }
}

/**
 * Copia al proyecto lo arrastrado desde el sistema. Si el destino ya tiene esos nombres
 * el main no copia nada y los devuelve en `conflictos`: se pregunta y, si se acepta, se
 * repite reemplazando.
 */
export async function importarNodos(
  a: Arbol,
  rutasHost: string[],
  destDir: string,
  sobrescribir = false
): Promise<void> {
  if (rutasHost.length === 0) {
    a.setOpError(txExplorador().noSePudoLeerUbicacion)
    return
  }
  try {
    const res = await window.tessera.files.importarDesdeHost({ raiz: a.props.rutaHostProyecto, rutasHost, destDir, sobrescribir })
    if (res.conflictos.length > 0) {
      a.setConflictoImportacion({ rutasHost, destDir, conflictos: res.conflictos })
      return
    }
    a.setConflictoImportacion(null)
    a.forzarRefresco()
    if (res.importados[0]) a.setRutaPorRevelar(res.importados[0])
  } catch (err) {
    a.setConflictoImportacion(null)
    a.setOpError(mensajeDe(err))
  }
}

/**
 * Abre el diálogo de borrado para esas claves de fila. El texto se calcula al abrir, no
 * al pintar, para que un refresco no cambie lo que la etiqueta promete.
 */
export function abrirDialogoBorrado(a: Arbol, claves: readonly string[]): void {
  const rutas = a.rutasHoja(claves)
  if (rutas.length === 0) return
  a.setDialogo({
    tipo: 'delete',
    rutas,
    nombres: rutas.map((p) => basename(p)),
    hayCarpeta: rutas.some((p) => a.filaPorClave.get(p)?.esDir ?? true)
  })
}
