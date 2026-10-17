// =============================================================================
// Cabecera del pane de diff en dos pisos: arriba las acciones (navegar entre cambios,
// saltar al fuente, colapsar; y cuenta, avisos y modo del visor) y abajo la identidad
// (revisiones, ruta, estado). La ruta dispone del ancho entero y no compite con los botones.
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import { etiquetaRevisiones, esDiffDeUnLado } from '../git'
import { CONTEXTO_LINEAS } from './colapsoDiff'
import { etiquetaEstado, etiquetaCuenta, tituloUnLado } from './diffEditorAvisos'
import { txDiff } from './textos.ts'
import { forzarModo } from './diffEditorModo'
import type { InstanciaDiff } from './diffEditorInstancia'
import type { DiffEditorPaneProps, DiffProblem, DiffTarget } from './diffEditorTipos'
import type { EstadoDiffEditor } from './useDiffEditor'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  IconoColapsar,
  IconoLadoALado,
  IconoLapiz,
  IconoUnificado
} from './DiffEditorIconos'

/** Por qué NO se puede saltar al fuente, o null si sí. El botón y su tooltip leen de aquí. */
function motivoSinFuenteDe(target: DiffTarget, onSaltarAlFuente: unknown): string | null {
  if (target.status === 'D') return txDiff().sinFuenteBorrado
  if (onSaltarAlFuente === undefined) return txDiff().sinFuenteNoProyecto
  return null
}

/** Línea del cursor del lado MODIFICADO; sin cursor puesto Monaco devuelve la 1. */
function lineaActual(inst: InstanciaDiff): number {
  return inst.diffEditorRef.current?.getModifiedEditor().getPosition()?.lineNumber ?? 1
}

interface BotonFuenteProps {
  target: DiffTarget
  onSaltarAlFuente: DiffEditorPaneProps['onSaltarAlFuente']
  inst: InstanciaDiff
}

function BotonSaltarAlFuente({ target, onSaltarAlFuente, inst }: BotonFuenteProps): React.JSX.Element {
  const motivo = motivoSinFuenteDe(target, onSaltarAlFuente)
  const t = txDiff()
  // El `title` va en el envoltorio: un control deshabilitado no recibe eventos de ratón.
  return (
    <span className="btn-envoltura" title={motivo ?? undefined}>
      <button
        className="btn btn-icon"
        onClick={() => onSaltarAlFuente?.(lineaActual(inst))}
        disabled={motivo !== null}
        title={motivo === null ? t.saltarAlFuenteTitulo : undefined}
        aria-label={t.saltarAlFuente}
      >
        <IconoLapiz />
      </button>
    </span>
  )
}

interface BotonColapsarProps {
  colapsar: boolean
  hayPlegable: boolean
  onColapsar: DiffEditorPaneProps['onColapsarSinCambios']
}

function BotonColapsar({ colapsar, hayPlegable, onColapsar }: BotonColapsarProps): React.JSX.Element {
  // Nunca se deshabilita estando encendido: el ajuste es global y persistido, y quedaría
  // un interruptor pulsado que no se puede soltar.
  const t = txDiff()
  return (
    <button
      className={`btn btn-icon${colapsar ? ' btn-active' : ''}`}
      onClick={() => onColapsar?.(!colapsar)}
      disabled={(!hayPlegable && !colapsar) || onColapsar === undefined}
      aria-pressed={colapsar}
      title={
        colapsar
          ? t.mostrarCompleto
          : !hayPlegable
            ? t.sinFragmentos
            : t.colapsarTitulo(CONTEXTO_LINEAS)
      }
      aria-label={t.colapsar}
    >
      <IconoColapsar />
    </button>
  )
}

interface AccionesIzqProps {
  pane: DiffEditorPaneProps
  estado: EstadoDiffEditor
}

function AccionesIzquierda({ pane, estado }: AccionesIzqProps): React.JSX.Element {
  const { inst } = estado
  const t = txDiff()
  const hasChanges = (estado.numCambios ?? 0) > 0
  const irAlCambio = (dir: 'next' | 'previous'): void => inst.diffEditorRef.current?.goToDiff(dir)
  return (
    <div className="panel-actions diff-barra-izq">
      <button
        className="btn btn-icon"
        onClick={() => irAlCambio('previous')}
        disabled={!hasChanges}
        title={t.cambioAnteriorTitulo}
        aria-label={t.cambioAnterior}
      >
        <ChevronUpIcon />
      </button>
      <button
        className="btn btn-icon"
        onClick={() => irAlCambio('next')}
        disabled={!hasChanges}
        title={t.cambioSiguienteTitulo}
        aria-label={t.cambioSiguiente}
      >
        <ChevronDownIcon />
      </button>
      <span className="panel-actions-sep" aria-hidden="true" />
      <BotonSaltarAlFuente target={pane.target} onSaltarAlFuente={pane.onSaltarAlFuente} inst={inst} />
      <BotonColapsar
        colapsar={pane.colapsarSinCambios ?? false}
        hayPlegable={estado.hayPlegable}
        onColapsar={pane.onColapsarSinCambios}
      />
    </div>
  )
}

interface SelectorModoProps {
  estado: EstadoDiffEditor
  unLado: boolean
}

function SelectorModo({ estado, unLado }: SelectorModoProps): React.JSX.Element {
  const { inst, modoEfectivo } = estado
  const t = txDiff()
  // El `title` explicativo va en el contenedor, no en los botones deshabilitados.
  return (
    <div
      className="diff-modo-toggle"
      role="group"
      aria-label={t.modoDelDiff}
      title={unLado ? tituloUnLado() : undefined}
    >
      <button
        className={`btn btn-icon${modoEfectivo === 'lado-a-lado' ? ' btn-active' : ''}`}
        onClick={() => forzarModo(inst, 'lado-a-lado')}
        disabled={unLado}
        aria-pressed={modoEfectivo === 'lado-a-lado'}
        title={unLado ? undefined : t.ladoALado}
        aria-label={t.ladoALado}
      >
        <IconoLadoALado />
      </button>
      <button
        className={`btn btn-icon${modoEfectivo === 'unificado' ? ' btn-active' : ''}`}
        onClick={() => forzarModo(inst, 'unificado')}
        disabled={unLado}
        aria-pressed={modoEfectivo === 'unificado'}
        title={unLado ? undefined : t.unificada}
        aria-label={t.unificada}
      >
        <IconoUnificado />
      </button>
    </div>
  )
}

interface AccionesDerProps {
  pane: DiffEditorPaneProps
  estado: EstadoDiffEditor
  avisoVisible: DiffProblem | null
}

function AccionesDerecha({ pane, estado, avisoVisible }: AccionesDerProps): React.JSX.Element {
  const { saveError, editable, problem, numCambios } = estado
  const t = txDiff()
  const unLado = pane.contenidoEnMemoria?.unLado ?? esDiffDeUnLado(pane.target)
  const hasChanges = (numCambios ?? 0) > 0
  return (
    <div className="panel-actions diff-barra-der">
      {/* Con `title`: el aviso es lo único que encoge y el texto entero tiene que seguir a mano. */}
      {saveError && (
        <span className="editor-notice editor-notice-error" title={saveError}>
          {saveError}
        </span>
      )}
      {/* Tras guardar, la pestaña no se cierra sola: cerrarla bajo el cursor es hostil. */}
      {editable && !hasChanges && !problem && (
        <span className="editor-notice">{t.sinCambiosIndice}</span>
      )}
      {/* Sin aviso y con la cuenta ya calculada: en otro caso "Sin diferencias" afirmaría lo no resuelto. */}
      {!avisoVisible && numCambios !== null && (
        <span className="diff-cuenta" title={t.diferenciasEntreRevisiones}>
          {etiquetaCuenta(numCambios)}
        </span>
      )}
      <SelectorModo estado={estado} unLado={unLado} />
    </div>
  )
}

function IdentidadDiff({ target }: { target: DiffTarget }): React.JSX.Element {
  return (
    <div className="diff-identidad">
      <span className="diff-revisiones" title={txDiff().revisionesQueSeComparan}>
        {etiquetaRevisiones(target.commitHash)}
      </span>
      {/* El `dir="ltr"` hace seguro el truncado por la izquierda (`.diff-ruta-larga`). */}
      <span className="diff-ruta diff-ruta-larga" title={target.path}>
        <span dir="ltr">
          {target.status === 'R' && target.oldPath
            ? `${target.oldPath} → ${target.path}`
            : target.path}
        </span>
      </span>
      <span className={`diff-status-pill status-${target.status}`}>
        {etiquetaEstado(target.status)}
      </span>
    </div>
  )
}

interface CabeceraProps {
  pane: DiffEditorPaneProps
  estado: EstadoDiffEditor
  avisoVisible: DiffProblem | null
}

/** Cabecera del diff: acciones arriba, identidad (o la que dé quien monta el pane) abajo. */
export function DiffCabecera({ pane, estado, avisoVisible }: CabeceraProps): React.JSX.Element {
  return (
    <header className="panel-header editor-header diff-header">
      <div className="diff-barra">
        <AccionesIzquierda pane={pane} estado={estado} />
        <AccionesDerecha pane={pane} estado={estado} avisoVisible={avisoVisible} />
      </div>
      {pane.identidad ?? <IdentidadDiff target={pane.target} />}
    </header>
  )
}
