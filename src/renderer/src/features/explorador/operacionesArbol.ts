// =============================================================================
// Operaciones del árbol sobre el disco del proyecto: crear, renombrar, eliminar, mover
// e importar. Funciones planas que reciben el `Arbol` del render en curso; los errores
// de un gesto rápido van al banner efímero y los de un diálogo, al propio diálogo.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { esDescendiente } from '../../../../shared/jarPath'
import { basename } from './posixPath'
import {
  getPortapapelesInterno,
  setPortapapelesInterno
} from './fileClipboard'
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
  a.setDialog(null)
  a.setDialogError(null)
}

/**
 * Olvida el objetivo de los atajos y el corte pendiente si apuntaban a `paths` o a algo
 * que colgaba de ellos: si no, Ctrl+V pegaría en una carpeta que ya no existe.
 */
function olvidarObjetivos(a: Arbol, paths: readonly string[]): void {
  if (paths.length === 0) return
  const afectado = (p: string): boolean =>
    paths.some((base) => p === base || esDescendiente(base, p))
  a.setSeleccion((prev) => olvidarDeSeleccion(prev, paths))
  const interno = getPortapapelesInterno()
  if (
    interno !== null &&
    interno.projectHostPath === a.props.projectHostPath &&
    interno.paths.some(afectado)
  ) {
    setPortapapelesInterno(null)
  }
}

/** Crea archivo o carpeta y, si es archivo, lo abre en el editor. */
export async function crearNodo(a: Arbol, dir: string, name: string, isFolder: boolean): Promise<void> {
  try {
    if (isFolder) {
      const res = await window.tessera.files.createDir(dir, name)
      a.setSelectedDir(res.path)
      a.setRevealPath(res.path)
    } else {
      const res = await window.tessera.files.createFile(dir, name)
      a.props.onOpenFile({ path: res.path, name })
      a.setRevealPath(res.path)
    }
    cerrarDialogo(a)
    a.bumpRefresh()
  } catch (err) {
    a.setDialogError(mensajeDe(err))
  }
}

/** Renombra un nodo; un error de validación del main se muestra en el diálogo. */
export async function renombrarNodo(a: Arbol, path: string, newName: string): Promise<void> {
  try {
    await window.tessera.files.rename(path, newName)
    olvidarObjetivos(a, [path])
    cerrarDialogo(a)
    a.bumpRefresh()
  } catch (err) {
    a.setDialogError(mensajeDe(err))
  }
}

/**
 * Elimina un lote con una llamada, un refresco y un aviso. El borrado del main es
 * best-effort: lo que falla vuelve en `fallidos` y se dice. Solo se olvida lo que de
 * verdad se borró.
 */
export async function eliminarNodos(a: Arbol, paths: readonly string[]): Promise<void> {
  try {
    const res = await window.tessera.files.delete([...paths])
    olvidarObjetivos(a, res.deleted)
    if (res.fallidos.length > 0) {
      a.setOpError(`No se pudo eliminar: ${res.fallidos.join(', ')}.`)
    }
  } catch (err) {
    a.setOpError(mensajeDe(err))
  } finally {
    cerrarDialogo(a)
    a.bumpRefresh()
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
    const res = await window.tessera.files.move(aMover, destDir)
    if (res.conflicts.length > 0) {
      const nombres = res.conflicts.map((n) => `"${n}"`).join(', ')
      a.setOpError(
        `No se movió nada: ya ${res.conflicts.length > 1 ? 'existen' : 'existe'} ${nombres} en la carpeta destino.`
      )
      return
    }
    a.bumpRefresh()
    olvidarObjetivos(a, res.moved.length > 0 ? aMover : [])
    // La selección se vacía en vez de seguir a lo movido: apuntaría a rutas aún inexistentes.
    a.setSeleccion(SELECCION_VACIA)
    if (res.moved[0]) a.setRevealPath(res.moved[0])
  } catch (err) {
    a.setOpError(mensajeDe(err))
  }
}

/**
 * Copia al proyecto lo arrastrado desde el sistema. Si el destino ya tiene esos nombres
 * el main no copia nada y los devuelve en `conflicts`: se pregunta y, si se acepta, se
 * repite reemplazando.
 */
export async function importarNodos(
  a: Arbol,
  hostPaths: string[],
  destDir: string,
  overwrite = false
): Promise<void> {
  if (hostPaths.length === 0) {
    a.setOpError('No se pudo leer la ubicación de lo que soltaste.')
    return
  }
  try {
    const res = await window.tessera.files.import(hostPaths, destDir, overwrite)
    if (res.conflicts.length > 0) {
      a.setImportConflict({ hostPaths, destDir, conflicts: res.conflicts })
      return
    }
    a.setImportConflict(null)
    a.bumpRefresh()
    if (res.imported[0]) a.setRevealPath(res.imported[0])
  } catch (err) {
    a.setImportConflict(null)
    a.setOpError(mensajeDe(err))
  }
}

/**
 * Abre el diálogo de borrado para esas claves de fila. El texto se calcula al abrir, no
 * al pintar, para que un refresco no cambie lo que la etiqueta promete.
 */
export function abrirDialogoBorrado(a: Arbol, claves: readonly string[]): void {
  const paths = a.rutasHoja(claves)
  if (paths.length === 0) return
  a.setDialog({
    kind: 'delete',
    paths,
    nombres: paths.map((p) => basename(p)),
    hayCarpeta: paths.some((p) => a.filaPorClave.get(p)?.isDir ?? true)
  })
}
