// =============================================================================
// Copiar, cortar y pegar del árbol, copiar rutas y abrir en el gestor de archivos.
// El arbitraje entre el portapapeles interno y el del sistema vive en `portapapelesArchivos`;
// aquí se sondea, se ejecuta y se avisa. Reciben el `Arbol` del render en curso.
// Decisiones: docs/decisiones/explorador/portapapeles-de-archivos.md
// =============================================================================
import { esRutaVirtual } from '../../../../shared/jarPath'
import { txExplorador } from './textos.ts'
import {
  decidirFuentePegado,
  obtenerPortapapelesInterno,
  fijarPortapapelesInterno,
  type FuentePegado
} from './portapapelesArchivos'
import { mensajeDe } from './operacionesArbol'
import type { Arbol } from './tiposArbol'

/**
 * Sondea el portapapeles y decide qué se pegaría. Limpia el interno cuando ya no manda:
 * si no, la fila cortada seguiría atenuada tras copiar otra cosa en el sistema. Solo se
 * limpia lo de ESTE proyecto: el de otro sigue siendo válido allí.
 */
export async function resolverPegable(a: Arbol): Promise<FuentePegado> {
  const { rutaHostProyecto } = a.props
  const interno = obtenerPortapapelesInterno()
  const sondeo = await window.tessera.portapapeles.sondear()
  const fuente = decidirFuentePegado(interno, rutaHostProyecto, sondeo)
  if (interno !== null && fuente.tipo !== 'interno' && interno.rutaHostProyecto === rutaHostProyecto) {
    fijarPortapapelesInterno(null)
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
  rutas: readonly string[],
  op: 'copiar' | 'cortar'
): Promise<void> {
  const limpias = rutas.filter((p) => p !== '' && !esRutaVirtual(p))
  if (limpias.length === 0) return
  // Una sola llamada: una por ruta inundaba el IPC con una selección grande.
  const absolutas = await window.tessera.files.rutaAbs({ raiz: a.props.rutaHostProyecto, rutas: limpias })
  // Sin ruta absoluta, la relativa hace de marca (mejor eso que un interno indetectable).
  const texto = absolutas.map((abs, i) => abs || limpias[i]).join('\n')
  await window.tessera.portapapeles.escribirTexto(texto)
  fijarPortapapelesInterno({ op, rutas: limpias, rutaHostProyecto: a.props.rutaHostProyecto, marca: texto })
}

/**
 * Pega en `destDir` lo que decida `decidirFuentePegado`; todas las fuentes acaban en el
 * canal `files:paste`, que renombra solo si el nombre ya existe. Un fallo parcial sigue
 * siendo un pegado: se revela lo que entró y además se avisa.
 */
export async function pegarEn(a: Arbol, destDir: string, fuente: FuentePegado): Promise<void> {
  const raiz = a.props.rutaHostProyecto
  try {
    const res =
      fuente.tipo === 'interno'
        ? await window.tessera.files.pegar({
            raiz,
            destDir,
            srcs: fuente.entrada.rutas,
            op: fuente.entrada.op
          })
        : await window.tessera.portapapeles.pegarEn({ raiz, destDir })
    // Cortar se consume: pegarlo dos veces movería algo que ya no está ahí.
    if (fuente.tipo === 'interno' && fuente.entrada.op === 'cortar') {
      fijarPortapapelesInterno(null)
    }
    a.forzarRefresco()
    if (res.rutas[0]) a.setRutaPorRevelar(res.rutas[0])
    if (res.fallidos.length > 0) {
      a.setOpError(txExplorador().noSePudoPegar(res.fallidos.join(', ')))
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
export async function abrirEnGestor(a: Arbol, esRaiz: boolean, ruta: string): Promise<void> {
  const raiz = a.props.rutaHostProyecto
  if (!esRaiz) {
    await window.tessera.files.revelar({ raiz, ruta })
    return
  }
  const err = await window.tessera.files.abrirRuta({ raiz, ruta: '' })
  if (err) a.setOpError(err)
}

/**
 * Copia rutas al portapapeles del sistema, una por línea. La relativa lleva delante el
 * nombre del proyecto, en POSIX, para compartirla sin revelar el disco. Invalida lo que
 * hubiera copiado o cortado: si no, copiar la ruta del archivo recién cortado escribiría
 * un texto idéntico a su marca y el siguiente Ctrl+V lo movería.
 */
export async function copiarRutas(a: Arbol, rutas: readonly string[], absoluta: boolean): Promise<void> {
  const lineas = absoluta
    ? await window.tessera.files.rutaAbs({ raiz: a.props.rutaHostProyecto, rutas: [...rutas] })
    : rutas.map((ruta) => (ruta ? `${a.props.nombreProyecto}/${ruta}` : a.props.nombreProyecto))
  const texto = lineas.filter((l) => l !== '').join('\n')
  if (!texto) {
    a.setOpError(txExplorador().noSePudoObtenerRuta)
    return
  }
  await window.tessera.portapapeles.escribirTexto(texto)
  fijarPortapapelesInterno(null)
}
