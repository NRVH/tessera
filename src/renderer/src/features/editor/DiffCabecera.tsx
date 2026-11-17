// =============================================================================
// Cabecera del pane de diff en dos pisos: arriba las acciones (navegar entre cambios,
// saltar al fuente, colapsar; y cuenta, avisos y modo del visor) y abajo la identidad
// (revisiones, ruta, estado). La ruta dispone del ancho entero y no compite con los botones.
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import { etiquetaRevisiones, esDiffDeUnLado } from '../git'
import { Cruce, Presente } from '../../comun/Presente'
import { CONTEXTO_LINEAS } from './colapsoDiff'
import { etiquetaEstado, etiquetaCuenta, tituloUnLado } from './diffEditorAvisos'
import { txDiff } from './textos.ts'
import { forzarModo } from './diffEditorModo'
import type { InstanciaDiff } from './diffEditorInstancia'
import type { PropsPaneDiffEditor, ProblemaDiff, DestinoDiff } from './diffEditorTipos'
import type { EstadoDiffEditor } from './useDiffEditor'
import {
  IconoChevronAbajo,
  IconoChevronArriba,
  IconoColapsar,
  IconoLadoALado,
  IconoLapiz,
  IconoUnificado
} from './DiffEditorIconos'

/** Por qué NO se puede saltar al fuente, o null si sí. El botón y su tooltip leen de aquí. */
function motivoSinFuenteDe(destino: DestinoDiff, onSaltarAlFuente: unknown): string | null {
  if (destino.estado === 'D') return txDiff().sinFuenteBorrado
  if (onSaltarAlFuente === undefined) return txDiff().sinFuenteNoProyecto
  return null
}

/** Línea del cursor del lado MODIFICADO; sin cursor puesto Monaco devuelve la 1. */
function lineaActual(inst: InstanciaDiff): number {
  return inst.diffEditorRef.current?.getModifiedEditor().getPosition()?.lineNumber ?? 1
}

interface PropsBotonFuente {
  destino: DestinoDiff
  onSaltarAlFuente: PropsPaneDiffEditor['onSaltarAlFuente']
  inst: InstanciaDiff
}

function BotonSaltarAlFuente({ destino, onSaltarAlFuente, inst }: PropsBotonFuente): React.JSX.Element {
  const motivo = motivoSinFuenteDe(destino, onSaltarAlFuente)
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

interface PropsBotonColapsar {
  colapsar: boolean
  hayPlegable: boolean
  onColapsar: PropsPaneDiffEditor['onColapsarSinCambios']
}

function BotonColapsar({ colapsar, hayPlegable, onColapsar }: PropsBotonColapsar): React.JSX.Element {
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

interface PropsAccionesIzq {
  pane: PropsPaneDiffEditor
  estado: EstadoDiffEditor
}

function AccionesIzquierda({ pane, estado }: PropsAccionesIzq): React.JSX.Element {
  const { inst } = estado
  const t = txDiff()
  const hayCambios = (estado.numCambios ?? 0) > 0
  const irAlCambio = (dir: 'next' | 'previous'): void => inst.diffEditorRef.current?.goToDiff(dir)
  return (
    <div className="panel-actions diff-barra-izq">
      <button
        className="btn btn-icon"
        onClick={() => irAlCambio('previous')}
        disabled={!hayCambios}
        title={t.cambioAnteriorTitulo}
        aria-label={t.cambioAnterior}
      >
        <IconoChevronArriba />
      </button>
      <button
        className="btn btn-icon"
        onClick={() => irAlCambio('next')}
        disabled={!hayCambios}
        title={t.cambioSiguienteTitulo}
        aria-label={t.cambioSiguiente}
      >
        <IconoChevronAbajo />
      </button>
      <span className="panel-actions-sep" aria-hidden="true" />
      <BotonSaltarAlFuente destino={pane.destino} onSaltarAlFuente={pane.onSaltarAlFuente} inst={inst} />
      <BotonColapsar
        colapsar={pane.colapsarSinCambios ?? false}
        hayPlegable={estado.hayPlegable}
        onColapsar={pane.onColapsarSinCambios}
      />
    </div>
  )
}

interface PropsSelectorModo {
  estado: EstadoDiffEditor
  unLado: boolean
}

function SelectorModo({ estado, unLado }: PropsSelectorModo): React.JSX.Element {
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

interface PropsAccionesDer {
  pane: PropsPaneDiffEditor
  estado: EstadoDiffEditor
  avisoVisible: ProblemaDiff | null
}

function AccionesDerecha({ pane, estado, avisoVisible }: PropsAccionesDer): React.JSX.Element {
  const { errorGuardado, editable, problema, numCambios } = estado
  const t = txDiff()
  const unLado = pane.contenidoEnMemoria?.unLado ?? esDiffDeUnLado(pane.destino)
  const hayCambios = (numCambios ?? 0) > 0
  return (
    <div className="panel-actions diff-barra-der">
      {/* Con `title`: el aviso es lo único que encoge y el texto entero tiene que seguir a mano. */}
      <Presente visible={!!errorGuardado} como="span" className="editor-notice editor-notice-error mov-aparece" title={errorGuardado ?? undefined}>
          {errorGuardado}
      </Presente>
      {/* Tras guardar, la pestaña no se cierra sola: cerrarla bajo el cursor es hostil. */}
      <Presente visible={editable && !hayCambios && !problema} como="span" className="editor-notice mov-aparece">{t.sinCambiosIndice}</Presente>
      {/* Sin aviso y con la cuenta ya calculada: en otro caso "Sin diferencias" afirmaría lo no resuelto. */}
      <Cruce className="diff-cuenta" clave={!avisoVisible && numCambios !== null ? String(numCambios) : 'vacio'}>
        <span>{!avisoVisible && numCambios !== null ? etiquetaCuenta(numCambios) : '\u00a0'}</span>
      </Cruce>
      <SelectorModo estado={estado} unLado={unLado} />
    </div>
  )
}

function IdentidadDiff({ destino }: { destino: DestinoDiff }): React.JSX.Element {
  return (
    <div className="diff-identidad">
      <span className="diff-revisiones">
        {etiquetaRevisiones(destino.commitHash)}
      </span>
      {/* El `dir="ltr"` hace seguro el truncado por la izquierda (`.diff-ruta-larga`). */}
      <span className="diff-ruta diff-ruta-larga" title={destino.ruta}>
        <span dir="ltr">
          {destino.estado === 'R' && destino.rutaAnterior
            ? `${destino.rutaAnterior} → ${destino.ruta}`
            : destino.ruta}
        </span>
      </span>
      <span className={`diff-status-pill status-${destino.estado}`}>
        {etiquetaEstado(destino.estado)}
      </span>
    </div>
  )
}

interface PropsCabecera {
  pane: PropsPaneDiffEditor
  estado: EstadoDiffEditor
  avisoVisible: ProblemaDiff | null
}

/** Cabecera del diff: acciones arriba, identidad (o la que dé quien monta el pane) abajo. */
export function DiffCabecera({ pane, estado, avisoVisible }: PropsCabecera): React.JSX.Element {
  return (
    <header className="panel-header editor-header diff-header">
      <div className="diff-barra">
        <AccionesIzquierda pane={pane} estado={estado} />
        <AccionesDerecha pane={pane} estado={estado} avisoVisible={avisoVisible} />
      </div>
      {pane.identidad ?? <IdentidadDiff destino={pane.destino} />}
    </header>
  )
}
