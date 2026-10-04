// =============================================================================
// Copiar, cortar y pegar del árbol, copiar rutas y abrir en el gestor de archivos.
// El arbitraje entre el portapapeles interno y el del sistema vive en `fileClipboard`;
// aquí se sondea, se ejecuta y se avisa. Reciben el `Arbol` del render en curso.
// Decisiones: docs/decisiones/explorador/portapapeles-de-archivos.md
// =============================================================================
import { esRutaVirtual } from '../../../../shared/jarPath'
import {
  decidirFuentePegado,
  getPortapapelesInterno,
  setPortapapelesInterno,
  type FuentePegado
} from './fileClipboard'
import { mensajeDe } from './operacionesArbol'
import type { Arbol } from './tiposArbol'

/**
 * Sondea el portapapeles y decide qué se pegaría. Limpia el interno cuando ya no manda:
 * si no, la fila cortada seguiría atenuada tras copiar otra cosa en el sistema. Solo se
 * limpia lo de ESTE proyecto: el de otro sigue siendo válido allí.
 */
export async function resolverPegable(a: Arbol): Promise<FuentePegado> {
  const { projectHostPath } = a.props
  const interno = getPortapapelesInterno()
  const sondeo = await window.tessera.clipboard.probe()
  const fuente = decidirFuentePegado(interno, projectHostPath, sondeo)
  if (interno !== null && fuente.kind !== 'interno' && interno.projectHostPath === projectHostPath) {
    setPortapapelesInterno(null)
  }
  return fuente
}

/**
 * Copia o corta lo seleccionado y deja sus rutas absolutas, una por línea, como texto en
 * el portapapeles del sistema: hace de marca de vigencia del interno y permite pegar las
 * rutas en el editor. La guarda de rutas virtuales va aquí y no en cada llamador: cortar
 * una clase de un .jar dejaba la fila atenuada para siempre.
 */
export async function copiarOCortar(
  a: Arbol,
  paths: readonly string[],
  op: 'copiar' | 'cortar'
): Promise<void> {
  const limpias = paths.filter((p) => p !== '' && !esRutaVirtual(p))
  if (limpias.length === 0) return
  // Una sola llamada: una por ruta inundaba el IPC con una selección grande.
  const absolutas = await window.tessera.files.absPath(limpias)
  // Sin ruta absoluta, la relativa hace de marca (mejor eso que un interno indetectable).
  const texto = absolutas.map((abs, i) => abs || limpias[i]).join('\n')
  await window.tessera.clipboard.write(texto)
  setPortapapelesInterno({ op, paths: limpias, projectHostPath: a.props.projectHostPath, marca: texto })
}

/**
 * Pega en `destDir` lo que decida `decidirFuentePegado`; todas las fuentes acaban en el
 * canal `files:paste`, que renombra solo si el nombre ya existe. Un fallo parcial sigue
 * siendo un pegado: se revela lo que entró y además se avisa.
 */
export async function pegarEn(a: Arbol, destDir: string, fuente: FuentePegado): Promise<void> {
  try {
    const res =
      fuente.kind === 'interno'
        ? await window.tessera.files.paste({
            destDir,
            srcs: fuente.entrada.paths,
            op: fuente.entrada.op
          })
        : await window.tessera.clipboard.pasteInto(destDir)
    // Cortar se consume: pegarlo dos veces movería algo que ya no está ahí.
    if (fuente.kind === 'interno' && fuente.entrada.op === 'cortar') {
      setPortapapelesInterno(null)
    }
    a.bumpRefresh()
    if (res.paths[0]) a.setRevealPath(res.paths[0])
    if (res.fallidos.length > 0) {
      a.setOpError(`No se pudo pegar: ${res.fallidos.join(', ')}. El resto sí se pegó.`)
    }
  } catch (err) {
    a.setOpError(mensajeDe(err))
  }
}

/**
 * Abre en el gestor de archivos. Sobre un nodo lo deja seleccionado en su carpeta; sobre
 * el vacío abre la carpeta del proyecto. `openPath` devuelve el error del sistema y hay
 * que enseñarlo: sin él, el usuario repite el gesto sin entender por qué no pasa nada.
 */
export async function abrirEnGestor(a: Arbol, esRaiz: boolean, path: string): Promise<void> {
  if (!esRaiz) {
    await window.tessera.files.reveal(path)
    return
  }
  const err = await window.tessera.files.openPath('')
  if (err) a.setOpError(err)
}

/**
 * Copia rutas al portapapeles del sistema, una por línea. La relativa lleva delante el
 * nombre del proyecto, en POSIX, para compartirla sin revelar el disco. Invalida lo que
 * hubiera copiado o cortado: si no, copiar la ruta del archivo recién cortado escribiría
 * un texto idéntico a su marca y el siguiente Ctrl+V lo movería.
 */
export async function copiarRutas(a: Arbol, paths: readonly string[], absoluta: boolean): Promise<void> {
  const lineas = absoluta
    ? await window.tessera.files.absPath([...paths])
    : paths.map((path) => (path ? `${a.props.projectName}/${path}` : a.props.projectName))
  const texto = lineas.filter((l) => l !== '').join('\n')
  if (!texto) {
    a.setOpError('No se pudo obtener la ruta.')
    return
  }
  await window.tessera.clipboard.write(texto)
  setPortapapelesInterno(null)
}
