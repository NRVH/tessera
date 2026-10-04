// =============================================================================
// Cabecera del pane de diff en dos pisos: arriba las acciones (navegar entre cambios,
// saltar al fuente, colapsar; y cuenta, avisos y modo del visor) y abajo la identidad
// (revisiones, ruta, estado). La ruta dispone del ancho entero y no compite con los botones.
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import { etiquetaRevisiones, esDiffDeUnLado } from '../git'
import { CONTEXTO_LINEAS } from './colapsoDiff'
import { STATUS_LABEL, TITULO_UN_LADO, etiquetaCuenta } from './diffEditorAvisos'
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
  if (target.status === 'D') return 'Este archivo está borrado: no hay fuente al que saltar'
  if (onSaltarAlFuente === undefined) {
    return 'Lo que se compara no es un archivo del proyecto, así que no hay fuente al que saltar'
  }
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
  // El `title` va en el envoltorio: un control deshabilitado no recibe eventos de ratón.
  return (
    <span className="btn-envoltura" title={motivo ?? undefined}>
      <button
        className="btn btn-icon"
        onClick={() => onSaltarAlFuente?.(lineaActual(inst))}
        disabled={motivo !== null}
        title={
          motivo === null
            ? 'Saltar al fuente (abre el archivo en la línea que estás mirando)'
            : undefined
        }
        aria-label="Saltar al fuente"
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
  return (
    <button
      className={`btn btn-icon${colapsar ? ' btn-active' : ''}`}
      onClick={() => onColapsar?.(!colapsar)}
      disabled={(!hayPlegable && !colapsar) || onColapsar === undefined}
      aria-pressed={colapsar}
      title={
        colapsar
          ? 'Mostrar el archivo completo'
          : !hayPlegable
            ? 'Este diff no tiene fragmentos sin cambios que colapsar'
            : `Colapsar los fragmentos sin cambios (${CONTEXTO_LINEAS} líneas de contexto)`
      }
      aria-label="Colapsar los fragmentos sin cambios"
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
  const hasChanges = (estado.numCambios ?? 0) > 0
  const irAlCambio = (dir: 'next' | 'previous'): void => inst.diffEditorRef.current?.goToDiff(dir)
  return (
    <div className="panel-actions diff-barra-izq">
      <button
        className="btn btn-icon"
        onClick={() => irAlCambio('previous')}
        disabled={!hasChanges}
        title="Cambio anterior (Shift+F7)"
        aria-label="Ir al cambio anterior"
      >
        <ChevronUpIcon />
      </button>
      <button
        className="btn btn-icon"
        onClick={() => irAlCambio('next')}
        disabled={!hasChanges}
        title="Cambio siguiente (F7)"
        aria-label="Ir al cambio siguiente"
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
  // El `title` explicativo va en el contenedor, no en los botones deshabilitados.
  return (
    <div
      className="diff-modo-toggle"
      role="group"
      aria-label="Modo de vista del diff"
      title={unLado ? TITULO_UN_LADO : undefined}
    >
      <button
        className={`btn btn-icon${modoEfectivo === 'lado-a-lado' ? ' btn-active' : ''}`}
        onClick={() => forzarModo(inst, 'lado-a-lado')}
        disabled={unLado}
        aria-pressed={modoEfectivo === 'lado-a-lado'}
        title={unLado ? undefined : 'Vista lado a lado'}
        aria-label="Vista lado a lado"
      >
        <IconoLadoALado />
      </button>
      <button
        className={`btn btn-icon${modoEfectivo === 'unificado' ? ' btn-active' : ''}`}
        onClick={() => forzarModo(inst, 'unificado')}
        disabled={unLado}
        aria-pressed={modoEfectivo === 'unificado'}
        title={unLado ? undefined : 'Vista unificada'}
        aria-label="Vista unificada"
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
        <span className="editor-notice">Sin cambios respecto al índice</span>
      )}
      {/* Sin aviso y con la cuenta ya calculada: en otro caso "Sin diferencias" afirmaría lo no resuelto. */}
      {!avisoVisible && numCambios !== null && (
        <span className="diff-cuenta" title="Diferencias entre las dos revisiones">
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
      <span className="diff-revisiones" title="Revisiones que se comparan">
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
        {STATUS_LABEL[target.status]}
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
