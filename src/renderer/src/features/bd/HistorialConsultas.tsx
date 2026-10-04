// =============================================================================
// HistorialConsultas: el popover del HISTORIAL de consultas de la consola SQL. Cuelga
// del botón del reloj de la barra (o de su acorde) y lista lo ejecutado, lo más
// reciente arriba: hora, ✓/✗/⊘, la primera línea del SQL y, a la derecha, conexión,
// esquema y duración. Enter INSERTA la elegida en el cursor del editor; Esc cierra.
// El estado y el teclado viven en `consola/useHistorialConsultas.ts`.
// Decisiones: docs/decisiones/bd/ui-consola-historial.md
// =============================================================================

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { DbEntradaHistorial } from '../../../../shared/db-explorador-ipc'
import {
  TEXTO_BORRAR_TODO,
  TEXTO_CONEXION_BORRADA,
  aliasHistorial,
  detalleHistorial,
  glifoHistorial,
  horaHistorial,
  primeraLineaSql
} from './consola/historialConsola'
import { formatoDuracion } from './consola/marcasConsola'
import { cantidad } from './consola/salidaConsola'
import { IconoEliminar } from '../../comun/iconosMenu'
import { HUECO, MARGEN, recolocar, type PosicionPopover } from './consola/popoverFlotante'
import { useCierreYFoco } from './consola/usePopoverFlotante'
import { teclaHistorial, useHistorialConsultas, type HistorialConsultasProps } from './consola/useHistorialConsultas'

const ANCHO = 600

type Historial = ReturnType<typeof useHistorialConsultas>

/** Identidad a la izquierda y, a la derecha, solo el icono de «Borrar todo…». */
function CabeceraHistorial({ h }: { h: Historial }): React.JSX.Element {
  // Deshabilitado solo si el historial ENTERO está vacío: con «Solo esta conexión» o un
  // filtro, una lista vacía no dice que no haya nada que borrar.
  const vacioDeVerdad = h.entradas !== null && h.total === 0 && h.filtro.trim() === '' && !h.soloEsta
  return (
    <div className="db-hist-cabecera">
      <span className="db-hist-titulo">
        Historial <span className="db-hist-cuenta">{h.entradas ? cantidad(h.total, 'consulta', 'consultas') : ''}</span>
      </span>
      <div className="panel-actions">
        {vacioDeVerdad ? (
          <span className="btn-envoltura" title="El historial está vacío">
            <button type="button" className="btn btn-icon db-hist-borrar-todo" aria-label="Borrar todo el historial…" disabled>
              <IconoEliminar />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-icon db-hist-borrar-todo"
            title="Borrar todo el historial…"
            aria-label="Borrar todo el historial…"
            onClick={() => h.setConfirmando(true)}
          >
            <IconoEliminar />
          </button>
        )}
      </div>
    </div>
  )
}

/** La confirmación de «Borrar todo», en línea: un modal encima contaría como clic fuera. */
function FranjaBorrarTodo({ h }: { h: Historial }): React.JSX.Element {
  return (
    <div className="db-hist-confirmar" role="alert">
      <span className="db-hist-confirmar-texto">{TEXTO_BORRAR_TODO}</span>
      <div className="db-hist-confirmar-botones">
        <button type="button" className="btn btn-ghost" autoFocus onClick={h.cerrarConfirmacion}>
          Cancelar
        </button>
        <button type="button" className="btn danger" onClick={h.borrarTodo}>
          Borrar todo
        </button>
      </div>
    </div>
  )
}

/** El filtro (combobox de la lista) y la casilla «Solo esta conexión». */
function ControlesHistorial({
  h,
  filtroRef,
  idBase,
  alias
}: {
  h: Historial
  filtroRef: RefObject<HTMLInputElement>
  idBase: string
  alias: string
}): React.JSX.Element {
  return (
    <div className="db-hist-controles">
      <input
        ref={filtroRef}
        className="db-hist-filtro"
        value={h.filtro}
        placeholder="Filtrar por texto del SQL"
        spellCheck={false}
        role="combobox"
        aria-expanded="true"
        aria-controls={`${idBase}-lista`}
        aria-activedescendant={h.total > 0 ? `${idBase}-h${h.activo}` : undefined}
        aria-label="Filtrar el historial"
        onChange={(e) => {
          // Seguir tecleando retira el Enter que esperaba a la lista anterior.
          h.enterEsperandoRef.current = false
          h.setFiltro(e.target.value)
        }}
      />
      <label className="db-hist-solo" title={`Solo lo ejecutado en ${alias}`}>
        <input
          type="checkbox"
          checked={h.soloEsta}
          onChange={(e) => {
            h.enterEsperandoRef.current = false
            h.setSoloEsta(e.target.checked)
          }}
        />
        Solo esta conexión
      </label>
    </div>
  )
}

/** El error con «Reintentar», «Cargando…» o la lista vacía. */
function EstadoHistorial({ h }: { h: Historial }): React.JSX.Element {
  return (
    <>
      {h.error && (
        <div className="db-hist-estado error" role="alert">
          <span className="db-hist-error-texto" title={h.error}>
            {h.error}
          </span>
          <button type="button" className="db-fila-accion" onClick={h.reintentar}>
            Reintentar
          </button>
        </div>
      )}
      {!h.error && h.entradas === null && <div className="db-hist-estado">Cargando el historial…</div>}
      {!h.error && h.entradas !== null && h.total === 0 && (
        <div className="db-hist-estado">
          {h.filtro.trim() !== '' ? 'Ninguna consulta coincide.' : 'Todavía no hay consultas en el historial.'}
        </div>
      )}
    </>
  )
}

/** Una consulta: glifo, hora, primera línea del SQL, lo demás y su papelera. */
function FilaHistorial({
  e,
  i,
  h,
  idBase,
  ahora
}: {
  e: DbEntradaHistorial
  i: number
  h: Historial
  idBase: string
  ahora: number
}): React.JSX.Element {
  const g = glifoHistorial(e.resultado)
  const a = aliasHistorial(e.conexionId, h.alias)
  const meta = [a, e.esquema ?? null, formatoDuracion(e.ms)].filter((x): x is string => !!x).join(' · ')
  return (
    <div
      id={`${idBase}-h${i}`}
      role="option"
      aria-selected={i === h.activo}
      className={`db-hist-fila${i === h.activo ? ' activa' : ''}`}
      title={detalleHistorial(e, a)}
      // Sin robar el foco al filtro.
      onMouseDown={(ev) => ev.preventDefault()}
      onMouseMove={() => {
        if (i !== h.activo) h.setActivo(i)
      }}
      onClick={() => h.insertar(i)}
    >
      <span className={`db-hist-glifo ${g.clase}`} aria-label={g.etiqueta}>
        {g.simbolo}
      </span>
      <span className="db-hist-hora">{horaHistorial(e.en, ahora)}</span>
      <span className="db-hist-sql">{primeraLineaSql(e.sql)}</span>
      <span className={`db-hist-meta${a === TEXTO_CONEXION_BORRADA ? ' borrada' : ''}`}>{meta}</span>
      <button
        type="button"
        className="db-hist-borrar"
        tabIndex={-1}
        title="Borrar del historial"
        aria-label="Borrar del historial"
        onClick={(ev) => {
          ev.stopPropagation()
          h.borrar(i)
        }}
      >
        <IconoEliminar />
      </button>
    </div>
  )
}

/** El popover del historial de consultas, por portal y alineado a su botón. */
export function HistorialConsultas(p: HistorialConsultasProps): React.JSX.Element {
  const { conexion, ancla } = p
  const plataforma = window.tessera.plataforma
  const idBase = useId()
  const raizRef = useRef<HTMLDivElement>(null)
  const filtroRef = useRef<HTMLInputElement>(null)
  const h = useHistorialConsultas(p, filtroRef)
  // Clic fuera o Esc cierran sin hacer nada.
  useCierreYFoco(raizRef, filtroRef, p.onCerrar)
  const [pos, setPos] = useState<PosicionPopover>({
    left: Math.max(MARGEN, ancla.right - ANCHO),
    top: ancla.bottom + HUECO
  })
  // Bajo el botón y alineado por la derecha; si no cabe debajo, encima.
  useLayoutEffect(
    () => recolocar(raizRef.current, (ancho) => ancla.right - ancho, ancla.top, ancla.bottom, setPos),
    [ancla.right, ancla.top, ancla.bottom, h.total, h.confirmando, h.error]
  )
  // La fila activa, a la vista.
  useEffect(() => {
    if (h.total === 0) return
    document.getElementById(`${idBase}-h${h.activo}`)?.scrollIntoView({ block: 'nearest' })
    // `idBase` no cambia en la vida del popover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.activo, h.total])

  // La hora de referencia se fija al llegar la lista: «de hoy» no cambia mientras se mira.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ahora = useMemo(() => Date.now(), [h.entradas])
  const teclaBorrar = plataforma === 'mac' ? '⌘⌫' : 'Supr'

  const contenido = (
    <div
      ref={raizRef}
      className="db-hist-pop"
      role="dialog"
      aria-label={`Historial de consultas de ${conexion.alias}`}
      style={{ left: pos.left, top: pos.top, width: `min(${ANCHO}px, calc(100vw - ${MARGEN * 2}px))` }}
      onKeyDown={(e) => teclaHistorial(e, h, plataforma, filtroRef.current)}
    >
      <CabeceraHistorial h={h} />
      {h.confirmando && <FranjaBorrarTodo h={h} />}
      <ControlesHistorial h={h} filtroRef={filtroRef} idBase={idBase} alias={conexion.alias} />
      <EstadoHistorial h={h} />
      <div id={`${idBase}-lista`} className="db-hist-lista" role="listbox" aria-label="Consultas ejecutadas">
        {(h.entradas ?? []).map((e, i) => (
          <FilaHistorial key={e.id} e={e} i={i} h={h} idBase={idBase} ahora={ahora} />
        ))}
      </div>
      <div className="db-hist-pie">
        Enter inserta en el cursor · {teclaBorrar} borra (con el filtro vacío) · Esc cierra
      </div>
    </div>
  )

  return createPortal(contenido, document.body)
}
