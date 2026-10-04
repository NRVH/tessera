// =============================================================================
// ImageDiffPane: diff de una imagen, con las dos revisiones una al lado de otra.
// Los bytes vienen del canal binario de git (`useImageDiff`), en `DiffSide`, sin saber si
// el lado es commit, índice o disco. Un lado ausente (alta o borrado) se pinta como hueco.
// El SVG no llega aquí: es texto y `PaneDeTab` lo enruta al diff de texto.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { STATUS_LABEL } from './diffEditorAvisos'
import { etiquetaRevisiones } from '../git'
import { deltaBytes, formatoBytes } from '../../util/formatoBytes'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { useImageDiff } from './useImageDiff'
import type { LadoCargado, Medidas } from './imageDiffCarga'
import type { DiffTarget } from './diffEditorTipos'

interface ImageDiffPaneProps {
  target: DiffTarget
  /** Igual que EditorPane: visible vs. oculto (display:none) sin desmontar. */
  visible: boolean
  /**
   * Ámbito (perfil + proyecto) de ESTE pane. Los lados 'worktree' e 'index' se piden por
   * ruta relativa y el main la resuelve contra el proyecto activo: solo el pane del activo
   * debe leer, o pintaría la imagen de otro proyecto.
   */
  targetKey: string
  /** Ver `targetKey`. */
  activeTargetKey: string
  /** Tick del watcher del sistema de archivos; equivale al `reloadToken` del diff de texto. */
  fsTick: number
  onClose: () => void
}

export function ImageDiffPane({
  target,
  visible,
  targetKey,
  activeTargetKey,
  fsTick,
  onClose
}: ImageDiffPaneProps): React.JSX.Element {
  const d = useImageDiff({ target, targetKey, activeTargetKey, fsTick })

  return (
    <section
      className={`editor${visible ? '' : ' hidden'}`}
      aria-label="Diff de imagen"
      aria-hidden={!visible}
    >
      <CabeceraImageDiff target={target} onClose={onClose} />

      {d.error && (
        <AvisoCaja
          tono="error"
          titulo="No se pudo leer la imagen."
          sugerencia="Puede que la revisión ya no exista o que el repositorio esté en un estado raro."
          detalle={d.error}
        />
      )}

      {!d.error && <LadosImageDiff target={target} d={d} />}
      {!d.error && !d.cargando && <PieImageDiff d={d} />}
    </section>
  )
}

type EstadoImageDiff = ReturnType<typeof useImageDiff>

function LadosImageDiff({
  target,
  d
}: {
  target: DiffTarget
  d: EstadoImageDiff
}): React.JSX.Element {
  const { antes, despues } = d
  const hayAntes = antes.url !== null || antes.truncated
  const hayDespues = despues.url !== null || despues.truncated
  const delta = hayAntes && hayDespues ? deltaBytes(antes.size, despues.size) : ''
  return (
    <div className="image-diff">
      <Lado
        rotulo="Antes"
        lado={antes}
        medidas={d.medAntes}
        onMedidas={d.setMedAntes}
        ilegible={d.ilegAntes}
        onIlegible={() => d.setIlegAntes(true)}
        cargando={d.cargando}
        vacioTexto={target.status === 'A' ? 'No existía: el archivo es nuevo.' : 'No hay versión anterior.'}
      />
      <Lado
        rotulo="Después"
        lado={despues}
        medidas={d.medDespues}
        onMedidas={d.setMedDespues}
        ilegible={d.ilegDespues}
        onIlegible={() => d.setIlegDespues(true)}
        cargando={d.cargando}
        vacioTexto={target.status === 'D' ? 'Se borró en esta revisión.' : 'No hay versión posterior.'}
        extra={delta}
      />
    </div>
  )
}

/**
 * Veredicto de un vistazo cuando las dos revisiones miden lo mismo. Con distinto peso el
 * contenido cambió seguro; con el mismo peso no se afirma nada más (la pestaña puede seguir
 * abierta tras revertir el archivo), solo se constatan los datos.
 */
function PieImageDiff({ d }: { d: EstadoImageDiff }): React.JSX.Element | null {
  const { antes, despues, medAntes, medDespues } = d
  const hayAntes = antes.url !== null || antes.truncated
  const hayDespues = despues.url !== null || despues.truncated
  // "Mismo píxel" solo se afirma con las dos medidas tomadas.
  const mismasMedidas =
    medAntes !== null &&
    medDespues !== null &&
    medAntes.w === medDespues.w &&
    medAntes.h === medDespues.h
  if (!hayAntes || !hayDespues || !mismasMedidas) return null
  return (
    <footer className="image-diff-pie">
      {antes.size === despues.size
        ? `Mismas dimensiones (${medAntes.w}×${medAntes.h}) y mismo peso.`
        : `Mismas dimensiones (${medAntes.w}×${medAntes.h}): el cambio está en el contenido.`}
    </footer>
  )
}

function CabeceraImageDiff({
  target,
  onClose
}: {
  target: DiffTarget
  onClose: () => void
}): React.JSX.Element {
  return (
    // Misma cabecera que el diff de texto: identidad a la izquierda, acciones de icono a la derecha.
    <header className="panel-header editor-header">
      {/* Sin «Diff» ni ruta, que ya dice la pestaña; salvo en un renombrado, donde la ruta es el dato. */}
      <span className="panel-title">
        {/* `sola`: este `.accent` no lleva rótulo delante, así que va sin sangría. */}
        {target.status === 'R' && target.oldPath && (
          <span className="accent sola">{`${target.oldPath} → ${target.path}`}</span>
        )}
        <span className={`diff-status-pill status-${target.status}`}>
          {STATUS_LABEL[target.status]}
        </span>
        <span className="diff-revisiones" title="Revisiones que se comparan">
          {etiquetaRevisiones(target.commitHash)}
        </span>
      </span>
      <div className="panel-actions">
        <button className="btn btn-icon" onClick={onClose} title="Cerrar diff" aria-label="Cerrar diff">
          <IconoCerrar />
        </button>
      </div>
    </header>
  )
}

interface LadoProps {
  rotulo: string
  lado: LadoCargado
  medidas: Medidas | null
  onMedidas: (m: Medidas) => void
  /** El navegador no pudo decodificar estos bytes (formato exótico o 0 bytes). */
  ilegible: boolean
  onIlegible: () => void
  cargando: boolean
  vacioTexto: string
  /** Línea extra bajo los metadatos (el delta de peso, solo en el lado derecho). */
  extra?: string
}

function Lado({
  rotulo,
  lado,
  medidas,
  onMedidas,
  ilegible,
  onIlegible,
  cargando,
  vacioTexto,
  extra
}: LadoProps): React.JSX.Element {
  return (
    <div className="image-diff-lado">
      <div className="image-diff-rotulo">{rotulo}</div>
      <div className="image-diff-lienzo">
        {cargando ? (
          <span className="image-diff-vacio">Cargando…</span>
        ) : lado.truncated ? (
          <span className="image-diff-vacio">
            Pesa {formatoBytes(lado.size)} y supera el máximo de 50 MiB: no se puede pintar.
          </span>
        ) : ilegible ? (
          // El catálogo de extensiones de imagen es amplio a propósito: las que Chromium no
          // decodifica (y un lado de 0 bytes) caen aquí en vez de dejar un recuadro en blanco.
          <span className="image-diff-vacio">
            El navegador no sabe dibujar este formato. Ábrelo desde el explorador con la
            aplicación del sistema.
          </span>
        ) : lado.url ? (
          <img
            className="image-diff-img"
            src={lado.url}
            alt={rotulo}
            onLoad={(e) =>
              onMedidas({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight
              })
            }
            onError={onIlegible}
          />
        ) : (
          <span className="image-diff-vacio">{vacioTexto}</span>
        )}
      </div>
      {/* Metadatos solo con archivo: en un alta, "0×0 · 0 B" leería como un archivo vacío. */}
      {!cargando && (lado.url || lado.truncated) && (
        <div className="image-diff-meta">
          {medidas && (
            <span>
              {medidas.w}×{medidas.h}
            </span>
          )}
          <span>{formatoBytes(lado.size)}</span>
          {extra && <span className="image-diff-delta">{extra}</span>}
        </div>
      )}
    </div>
  )
}

function IconoCerrar(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  )
}
