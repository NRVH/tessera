// =============================================================================
// PaneDiffImagen: diff de una imagen, con las dos revisiones una al lado de otra.
// Los bytes vienen del canal binario de git (`useDiffImagen`), en `LadoDiff`, sin saber si
// el lado es commit, índice o disco. Un lado ausente (alta o borrado) se pinta como hueco.
// El SVG no llega aquí: es texto y `PaneDePestana` lo enruta al diff de texto.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { etiquetaEstado } from './diffEditorAvisos'
import { txImagen, txVisorComun } from './textosVisores.ts'
import { etiquetaRevisiones } from '../git'
import { deltaBytes, formatoBytes } from '../../util/formatoBytes'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { useDiffImagen } from './useDiffImagen'
import type { LadoCargado, Medidas } from './cargaDiffImagen'
import type { DestinoDiff } from './diffEditorTipos'

interface PropsPaneDiffImagen {
  destino: DestinoDiff
  /** Igual que PaneEditor: visible vs. oculto (display:none) sin desmontar. */
  visible: boolean
  /**
   * Ámbito (perfil + proyecto) de ESTE pane. Los lados 'worktree' e 'index' se piden por
   * ruta relativa y el main la resuelve contra el proyecto activo: solo el pane del activo
   * debe leer, o pintaría la imagen de otro proyecto.
   */
  claveDestino: string
  /** Ver `claveDestino`. */
  claveDestinoActivo: string
  /** Tick del watcher del sistema de archivos; equivale al `tokenRecarga` del diff de texto. */
  fsTick: number
  onCerrar: () => void
}

export function PaneDiffImagen({
  destino,
  visible,
  claveDestino,
  claveDestinoActivo,
  fsTick,
  onCerrar
}: PropsPaneDiffImagen): React.JSX.Element {
  const d = useDiffImagen({ destino, claveDestino, claveDestinoActivo, fsTick })
  const t = txImagen()

  return (
    <section
      className={`editor${visible ? '' : ' hidden'}`}
      aria-label={t.diffAria}
      aria-hidden={!visible}
    >
      <CabeceraDiffImagen destino={destino} onCerrar={onCerrar} />

      {d.error && (
        <AvisoCaja
          tono="error"
          titulo={t.noSePudoLeer}
          sugerencia={t.noSePudoLeerSugerencia}
          detalle={d.error}
        />
      )}

      {!d.error && <LadosDiffImagen destino={destino} d={d} />}
      {!d.error && !d.cargando && <PieDiffImagen d={d} />}
    </section>
  )
}

type EstadoDiffImagen = ReturnType<typeof useDiffImagen>

function LadosDiffImagen({
  destino,
  d
}: {
  destino: DestinoDiff
  d: EstadoDiffImagen
}): React.JSX.Element {
  const { antes, despues } = d
  const t = txImagen()
  const hayAntes = antes.url !== null || antes.truncado
  const hayDespues = despues.url !== null || despues.truncado
  const delta = hayAntes && hayDespues ? deltaBytes(antes.tamano, despues.tamano) : ''
  return (
    <div className="image-diff">
      <Lado
        rotulo={t.antes}
        lado={antes}
        medidas={d.medAntes}
        onMedidas={d.setMedAntes}
        ilegible={d.ilegAntes}
        onIlegible={() => d.setIlegAntes(true)}
        cargando={d.cargando}
        vacioTexto={destino.estado === 'A' ? t.nuevo : t.sinVersionAnterior}
      />
      <Lado
        rotulo={t.despues}
        lado={despues}
        medidas={d.medDespues}
        onMedidas={d.setMedDespues}
        ilegible={d.ilegDespues}
        onIlegible={() => d.setIlegDespues(true)}
        cargando={d.cargando}
        vacioTexto={destino.estado === 'D' ? t.borradoEnRevision : t.sinVersionPosterior}
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
function PieDiffImagen({ d }: { d: EstadoDiffImagen }): React.JSX.Element | null {
  const { antes, despues, medAntes, medDespues } = d
  const hayAntes = antes.url !== null || antes.truncado
  const hayDespues = despues.url !== null || despues.truncado
  // "Mismo píxel" solo se afirma con las dos medidas tomadas.
  const mismasMedidas =
    medAntes !== null &&
    medDespues !== null &&
    medAntes.w === medDespues.w &&
    medAntes.h === medDespues.h
  if (!hayAntes || !hayDespues || !mismasMedidas) return null
  return (
    <footer className="image-diff-pie">
      {antes.tamano === despues.tamano
        ? txImagen().mismasDimensionesYPeso(medAntes.w, medAntes.h)
        : txImagen().mismasDimensionesOtroContenido(medAntes.w, medAntes.h)}
    </footer>
  )
}

function CabeceraDiffImagen({
  destino,
  onCerrar
}: {
  destino: DestinoDiff
  onCerrar: () => void
}): React.JSX.Element {
  return (
    // Misma cabecera que el diff de texto: identidad a la izquierda, acciones de icono a la derecha.
    <header className="panel-header editor-header">
      {/* Sin «Diff» ni ruta, que ya dice la pestaña; salvo en un renombrado, donde la ruta es el dato. */}
      <span className="panel-title">
        {/* `sola`: este `.accent` no lleva rótulo delante, así que va sin sangría. */}
        {destino.estado === 'R' && destino.rutaAnterior && (
          <span className="accent sola">{`${destino.rutaAnterior} → ${destino.ruta}`}</span>
        )}
        <span className={`diff-status-pill status-${destino.estado}`}>
          {etiquetaEstado(destino.estado)}
        </span>
        <span className="diff-revisiones">
          {etiquetaRevisiones(destino.commitHash)}
        </span>
      </span>
      <div className="panel-actions">
        <button
          className="btn btn-icon"
          onClick={onCerrar}
          title={txImagen().cerrarDiff}
          aria-label={txImagen().cerrarDiff}
        >
          <IconoCerrar />
        </button>
      </div>
    </header>
  )
}

interface PropsLado {
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
}: PropsLado): React.JSX.Element {
  const t = txImagen()
  return (
    <div className="image-diff-lado">
      <div className="image-diff-rotulo">{rotulo}</div>
      <div className="image-diff-lienzo">
        {cargando ? (
          <span className="image-diff-vacio">{txVisorComun().cargando}</span>
        ) : lado.truncado ? (
          <span className="image-diff-vacio">{t.pesaDemasiado(formatoBytes(lado.tamano))}</span>
        ) : ilegible ? (
          // El catálogo de extensiones de imagen es amplio a propósito: las que Chromium no
          // decodifica (y un lado de 0 bytes) caen aquí en vez de dejar un recuadro en blanco.
          <span className="image-diff-vacio">{t.navegadorNoDibuja}</span>
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
      {!cargando && (lado.url || lado.truncado) && (
        <div className="image-diff-meta">
          {medidas && (
            <span>
              {medidas.w}×{medidas.h}
            </span>
          )}
          <span>{formatoBytes(lado.tamano)}</span>
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
