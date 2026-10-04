// =============================================================================
// Lupa del scrollbar del diff: al pasar el ratón por la franja del scrollbar del lado
// MODIFICADO enseña un mini-diff coloreado de esa zona, sin scrollear. Solo escucha el
// DOM del host (no lo tapa), así el arrastre del scrollbar sigue funcionando.
// Sin JSX. Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import type { editor } from 'monaco-editor'
import type { ensureMonaco } from '../../comun/monacoSetup'
import type { InstanciaDiff } from './diffEditorInstancia'
import type { LensPreview, LensRowKind } from './diffEditorTipos'

type Monaco = ReturnType<typeof ensureMonaco>
type Cambio = editor.ILineChange

/** Ancho de la franja del borde derecho (sobre el scrollbar) que activa la lupa. */
const LENS_SCROLLBAR_ZONE_PX = 22
/** Líneas de contexto a cada lado de la línea apuntada. */
const LENS_CONTEXT = 6
/** Alto de fila del preview (px); casa con line-height del CSS .diff-lens-row. */
export const LENS_ROW_H = 18
/** Ancho del popup del preview (px). */
export const LENS_WIDTH = 480

interface Celda {
  key: string
  num: number
  kind: LensRowKind
  text: string
  center: boolean
}

interface Rojo {
  oStart: number
  oEnd: number
}

const textoCelda = (t: string): string => (t.length ? t : ' ')

/** Clasifica una línea del MODIFICADO: verde si es añadida (sin original) o cambiada. */
function tipoDeLinea(changes: Cambio[], line: number): LensRowKind {
  for (const c of changes) {
    if (c.modifiedEndLineNumber > 0 && line >= c.modifiedStartLineNumber && line <= c.modifiedEndLineNumber) {
      return c.originalEndLineNumber === 0 ? 'add' : 'change'
    }
  }
  return null
}

/**
 * Dónde intercalar las líneas borradas (rojo, del original), por línea modificada:
 * una eliminación pura va después de su inicio; una modificación muestra el "antes" justo antes.
 */
function borradosPorAncla(changes: Cambio[]): Map<number, Rojo[]> {
  const rojos = new Map<number, Rojo[]>()
  const anota = (ancla: number, oStart: number, oEnd: number): void => {
    const lista = rojos.get(ancla)
    if (lista) lista.push({ oStart, oEnd })
    else rojos.set(ancla, [{ oStart, oEnd }])
  }
  for (const c of changes) {
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
  model: editor.ITextModel,
  origModel: editor.ITextModel | undefined,
  changes: Cambio[],
  centro: number
): Celda[] {
  const lineCount = model.getLineCount()
  const inicio = Math.max(1, centro - LENS_CONTEXT)
  const fin = Math.min(lineCount, centro + LENS_CONTEXT)
  const rojos = borradosPorAncla(changes)
  const celdas: Celda[] = []
  const anadeRojos = (ancla: number): void => {
    const lista = rojos.get(ancla)
    if (!lista || !origModel) return
    for (const r of lista) {
      for (let o = r.oStart; o <= r.oEnd; o++) {
        const text = textoCelda(origModel.getLineContent(o))
        celdas.push({ key: `o${o}-${celdas.length}`, num: o, kind: 'del', text, center: false })
      }
    }
  }
  for (let ln = inicio; ln <= fin; ln++) {
    anadeRojos(ln)
    const text = textoCelda(model.getLineContent(ln))
    celdas.push({ key: `m${ln}`, num: ln, kind: tipoDeLinea(changes, ln), text, center: ln === centro })
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
  modified: editor.ICodeEditor,
  lineCount: number
): number | null {
  const rect = host.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  if (x < rect.width - LENS_SCROLLBAR_ZONE_PX || x > rect.width || y < 0 || y > rect.height) return null
  const ratio = Math.max(0, Math.min(1, y / rect.height))
  const centro = Math.max(1, Math.min(lineCount, Math.round(ratio * lineCount)))
  const visibles = modified.getVisibleRanges()
  if (visibles.length > 0) {
    const primera = visibles[0].startLineNumber
    const ultima = visibles[visibles.length - 1].endLineNumber
    if (centro >= primera && centro <= ultima) return null
  }
  return centro
}

/** Colorea las celdas y, si el ratón no se ha movido a otra petición, publica el preview. */
function publicarPreview(
  monaco: Monaco,
  inst: InstanciaDiff,
  celdas: Celda[],
  lang: string,
  pos: { x: number; y: number }
): void {
  const reqId = ++inst.lensReq
  Promise.all(celdas.map((c) => monaco.editor.colorize(c.text, lang, {})))
    .then((htmls) => {
      if (reqId !== inst.lensReq) return
      const preview: LensPreview = {
        rows: celdas.map((c, i) => ({
          key: c.key,
          num: c.num,
          html: htmls[i].replace(/<br\/?>\s*$/i, ''),
          kind: c.kind,
          center: c.center
        })),
        x: pos.x,
        y: pos.y
      }
      inst.set.setLens(preview)
    })
    .catch(() => {
      /* colorize best-effort: si falla, simplemente no se muestra la lupa */
    })
}

/** Calcula y publica la lupa para la última posición del ratón. */
function barrerLupa(
  monaco: Monaco,
  ed: editor.IStandaloneDiffEditor,
  inst: InstanciaDiff,
  host: HTMLElement,
  e: MouseEvent
): void {
  const model = ed.getModifiedEditor().getModel()
  if (!model) return
  // Con el colapso encendido el eje del scrollbar deja de ser proporcional a la línea y
  // la lupa enseñaría un trozo equivocado: se calla (ver el ADR).
  const centro = inst.colapsar ? null : lineaFueraDeVista(host, e, ed.getModifiedEditor(), model.getLineCount())
  if (centro === null) {
    inst.set.setLens(null)
    return
  }
  const changes = ed.getLineChanges() ?? []
  const celdas = construirCeldas(model, ed.getModel()?.original, changes, centro)
  publicarPreview(monaco, inst, celdas, model.getLanguageId(), { x: e.clientX, y: e.clientY })
}

/** Registra los listeners de la lupa sobre el host y devuelve quien los quita. */
export function instalarLupa(
  monaco: Monaco,
  ed: editor.IStandaloneDiffEditor,
  inst: InstanciaDiff,
  host: HTMLElement
): () => void {
  let rafId: number | null = null
  let pending: MouseEvent | null = null
  let dragging = false
  const scanLens = (): void => {
    rafId = null
    if (pending) barrerLupa(monaco, ed, inst, host, pending)
  }
  const onLensMove = (e: MouseEvent): void => {
    if (dragging) return
    pending = e
    if (rafId === null) rafId = requestAnimationFrame(scanLens)
  }
  const hideLens = (): void => {
    inst.lensReq++
    inst.set.setLens(null)
  }
  const onLensDown = (): void => {
    dragging = true
    hideLens()
  }
  // El mouseup va en `window` porque el botón puede soltarse fuera del host.
  const onLensUp = (): void => {
    dragging = false
  }
  host.addEventListener('mousemove', onLensMove)
  host.addEventListener('mouseleave', hideLens)
  host.addEventListener('mousedown', onLensDown)
  window.addEventListener('mouseup', onLensUp)
  return () => {
    if (rafId !== null) cancelAnimationFrame(rafId)
    host.removeEventListener('mousemove', onLensMove)
    host.removeEventListener('mouseleave', hideLens)
    host.removeEventListener('mousedown', onLensDown)
    window.removeEventListener('mouseup', onLensUp)
  }
}
