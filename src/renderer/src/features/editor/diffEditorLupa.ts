// =============================================================================
// Lupa del scrollbar del diff: al pasar el ratón por la franja del scrollbar del lado
// MODIFICADO enseña un mini-diff coloreado de esa zona, sin scrollear. Solo escucha el
// DOM del host (no lo tapa), así el arrastre del scrollbar sigue funcionando.
// Sin JSX. Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import type { editor } from 'monaco-editor'
import type { asegurarMonaco } from '../../comun/monacoSetup'
import type { InstanciaDiff } from './diffEditorInstancia'
import type { PreviaLupa, TipoFilaLupa } from './diffEditorTipos'

type Monaco = ReturnType<typeof asegurarMonaco>
type Cambio = editor.ILineChange

/** Ancho de la franja del borde derecho que activa la lupa: dentro de la regla de cambios del diff. */
const ZONA_BARRA_SCROLL_LUPA_PX = 22
/** Líneas de contexto a cada lado de la línea apuntada. */
const CONTEXTO_LUPA = 6
/** Alto de fila del preview (px); casa con line-height del CSS .diff-lens-row. */
export const ALTO_FILA_LUPA = 18
/** Ancho del popup del preview (px). */
export const ANCHO_LUPA = 480

interface Celda {
  clave: string
  num: number
  tipo: TipoFilaLupa
  texto: string
  centro: boolean
}

interface Rojo {
  inicioOriginal: number
  finOriginal: number
}

const textoCelda = (t: string): string => (t.length ? t : ' ')

/** Clasifica una línea del MODIFICADO: verde si es añadida (sin original) o cambiada. */
function tipoDeLinea(cambios: Cambio[], linea: number): TipoFilaLupa {
  for (const c of cambios) {
    if (c.modifiedEndLineNumber > 0 && linea >= c.modifiedStartLineNumber && linea <= c.modifiedEndLineNumber) {
      return c.originalEndLineNumber === 0 ? 'add' : 'change'
    }
  }
  return null
}

/**
 * Dónde intercalar las líneas borradas (rojo, del original), por línea modificada:
 * una eliminación pura va después de su inicio; una modificación muestra el "antes" justo antes.
 */
function borradosPorAncla(cambios: Cambio[]): Map<number, Rojo[]> {
  const rojos = new Map<number, Rojo[]>()
  const anota = (ancla: number, inicioOriginal: number, finOriginal: number): void => {
    const lista = rojos.get(ancla)
    if (lista) lista.push({ inicioOriginal, finOriginal })
    else rojos.set(ancla, [{ inicioOriginal, finOriginal }])
  }
  for (const c of cambios) {
    if (c.modifiedEndLineNumber === 0) {
      anota(c.modifiedStartLineNumber + 1, c.originalStartLineNumber, c.originalEndLineNumber)
    } else if (c.originalEndLineNumber > 0) {
      anota(c.modifiedStartLineNumber, c.originalStartLineNumber, c.originalEndLineNumber)
    }
  }
  return rojos
}

/** Celdas del mini-diff: líneas verdes (modificado) con las rojas (original) intercaladas en su ancla. */
function construirCeldas(
  modelo: editor.ITextModel,
  modeloOriginal: editor.ITextModel | undefined,
  cambios: Cambio[],
  centro: number
): Celda[] {
  const totalLineas = modelo.getLineCount()
  const inicio = Math.max(1, centro - CONTEXTO_LUPA)
  const fin = Math.min(totalLineas, centro + CONTEXTO_LUPA)
  const rojos = borradosPorAncla(cambios)
  const celdas: Celda[] = []
  const anadeRojos = (ancla: number): void => {
    const lista = rojos.get(ancla)
    if (!lista || !modeloOriginal) return
    for (const r of lista) {
      for (let o = r.inicioOriginal; o <= r.finOriginal; o++) {
        const texto = textoCelda(modeloOriginal.getLineContent(o))
        celdas.push({ clave: `o${o}-${celdas.length}`, num: o, tipo: 'del', texto, centro: false })
      }
    }
  }
  for (let ln = inicio; ln <= fin; ln++) {
    anadeRojos(ln)
    const texto = textoCelda(modelo.getLineContent(ln))
    celdas.push({ clave: `m${ln}`, num: ln, tipo: tipoDeLinea(cambios, ln), texto, centro: ln === centro })
  }
  anadeRojos(fin + 1)
  return celdas
}

/**
 * Línea apuntada por el ratón si cae en la franja del scrollbar y FUERA de la vista
 * (la lupa es para lo que no se ve); null en cualquier otro caso.
 */
function lineaFueraDeVista(
  host: HTMLElement,
  e: MouseEvent,
  editorModificado: editor.ICodeEditor,
  totalLineas: number
): number | null {
  const rect = host.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  if (x < rect.width - ZONA_BARRA_SCROLL_LUPA_PX || x > rect.width || y < 0 || y > rect.height) return null
  const ratio = Math.max(0, Math.min(1, y / rect.height))
  const centro = Math.max(1, Math.min(totalLineas, Math.round(ratio * totalLineas)))
  const visibles = editorModificado.getVisibleRanges()
  if (visibles.length > 0) {
    const primera = visibles[0].startLineNumber
    const ultima = visibles[visibles.length - 1].endLineNumber
    if (centro >= primera && centro <= ultima) return null
  }
  return centro
}

/** Colorea las celdas y, si el ratón no se ha movido a otra petición, publica el preview. */
function publicarPrevia(
  monaco: Monaco,
  inst: InstanciaDiff,
  celdas: Celda[],
  lenguaje: string,
  pos: { x: number; y: number }
): void {
  const peticionId = ++inst.peticionLupa
  Promise.all(celdas.map((c) => monaco.editor.colorize(c.texto, lenguaje, {})))
    .then((htmls) => {
      if (peticionId !== inst.peticionLupa) return
      const previa: PreviaLupa = {
        filas: celdas.map((c, i) => ({
          clave: c.clave,
          num: c.num,
          html: htmls[i].replace(/<br\/?>\s*$/i, ''),
          tipo: c.tipo,
          centro: c.centro
        })),
        x: pos.x,
        y: pos.y
      }
      inst.set.setLupa(previa)
    })
    .catch(() => {
      /* colorize best-effort: si falla, simplemente no se muestra la lupa */
    })
}

/** Calcula y publica la lupa para la última posición del ratón. */
function barrerLupa(
  monaco: Monaco,
  editorMonaco: editor.IStandaloneDiffEditor,
  inst: InstanciaDiff,
  host: HTMLElement,
  e: MouseEvent
): void {
  const modelo = editorMonaco.getModifiedEditor().getModel()
  if (!modelo) return
  // Con el colapso encendido el eje del scrollbar deja de ser proporcional a la línea y
  // la lupa enseñaría un trozo equivocado: se calla (ver el ADR).
  const centro = inst.colapsar ? null : lineaFueraDeVista(host, e, editorMonaco.getModifiedEditor(), modelo.getLineCount())
  if (centro === null) {
    inst.set.setLupa(null)
    return
  }
  const cambios = editorMonaco.getLineChanges() ?? []
  const celdas = construirCeldas(modelo, editorMonaco.getModel()?.original, cambios, centro)
  publicarPrevia(monaco, inst, celdas, modelo.getLanguageId(), { x: e.clientX, y: e.clientY })
}

/** Registra los listeners de la lupa sobre el host y devuelve quien los quita. */
export function instalarLupa(
  monaco: Monaco,
  editorMonaco: editor.IStandaloneDiffEditor,
  inst: InstanciaDiff,
  host: HTMLElement
): () => void {
  let rafId: number | null = null
  let pendiente: MouseEvent | null = null
  let arrastrando = false
  const escanearLupa = (): void => {
    rafId = null
    if (pendiente) barrerLupa(monaco, editorMonaco, inst, host, pendiente)
  }
  const alMoverLupa = (e: MouseEvent): void => {
    if (arrastrando) return
    pendiente = e
    if (rafId === null) rafId = requestAnimationFrame(escanearLupa)
  }
  const ocultarLupa = (): void => {
    inst.peticionLupa++
    inst.set.setLupa(null)
  }
  const alPulsarLupa = (): void => {
    arrastrando = true
    ocultarLupa()
  }
  // El mouseup va en `window` porque el botón puede soltarse fuera del host.
  const alSoltarLupa = (): void => {
    arrastrando = false
  }
  host.addEventListener('mousemove', alMoverLupa)
  host.addEventListener('mouseleave', ocultarLupa)
  host.addEventListener('mousedown', alPulsarLupa)
  window.addEventListener('mouseup', alSoltarLupa)
  return () => {
    if (rafId !== null) cancelAnimationFrame(rafId)
    host.removeEventListener('mousemove', alMoverLupa)
    host.removeEventListener('mouseleave', ocultarLupa)
    host.removeEventListener('mousedown', alPulsarLupa)
    window.removeEventListener('mouseup', alSoltarLupa)
  }
}
