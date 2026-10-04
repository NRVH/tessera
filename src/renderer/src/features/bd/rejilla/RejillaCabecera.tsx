// =============================================================================
// Cabecera de la rejilla de datos: ordenar (clic = esa columna sola; Mayús+clic la añade
// o la cicla; el ciclo es del dueño, `onOrdenar`) y redimensionar por el asa (doble clic
// ajusta al contenido). Sin `onOrdenar` (la consola) la cabecera no ordena.
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import type { DbColumnaResultado } from '../../../../../shared/db-explorador-ipc'
import { IconoLlave } from '../iconosBd'
import { anchoColumnaRejilla, lineasOrdenCabecera } from '../panesBd'
import { ANCHO_MAX_MANUAL, MUESTRA_AJUSTE, OPCIONES_ANCHO, acotarAnchoManual } from './anchoColumnas'
import { medidorDe } from './useRejillaGeometria'
import { tipoVisible } from './visorValor'
import type { Rejilla } from './rejillaTipos'

/** Flecha del orden de la cabecera. */
function FlechaOrden({ dir }: { dir: 'asc' | 'desc' }): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      {dir === 'asc' ? (
        <path d="M6 2.5v7M3 5.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M6 9.5v-7M3 6.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

/** El `title` de una cabecera; `lineasOrden` es null si la rejilla no ordena. */
function tituloCabecera(
  col: DbColumnaResultado,
  esPk: boolean,
  lineasOrden: readonly string[] | null,
  noEditable: string | null
): string {
  // El tipo DECLARADO si llegó del catálogo, y si no el del trabajador: el criterio del visor.
  const lineas = [col.nombre, `${tipoVisible(col)}${col.nullable === false ? ' NOT NULL' : ''}`]
  if (esPk) lineas.push('Clave primaria')
  if (noEditable) lineas.push(`No editable: ${noEditable}`)
  if (lineasOrden) lineas.push(...lineasOrden)
  return lineas.join('\n')
}

/** Arrastre del asa: el ancho sigue al puntero, acotado. */
function alAsa(r: Rejilla, c: number, e: React.PointerEvent<HTMLDivElement>): void {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const asa = e.currentTarget
  asa.setPointerCapture(e.pointerId)
  const x0 = e.clientX
  const ancho0 = r.anchos[c]
  const { cambiarAncho, setRedimensionando } = r
  setRedimensionando(c)
  const alMover = (ev: PointerEvent): void => cambiarAncho(c, acotarAnchoManual(ancho0 + ev.clientX - x0))
  const alSoltar = (): void => {
    asa.removeEventListener('pointermove', alMover)
    asa.removeEventListener('pointerup', alSoltar)
    asa.removeEventListener('pointercancel', alSoltar)
    asa.removeEventListener('lostpointercapture', alSoltar)
    setRedimensionando(null)
  }
  asa.addEventListener('pointermove', alMover)
  asa.addEventListener('pointerup', alSoltar)
  asa.addEventListener('pointercancel', alSoltar)
  asa.addEventListener('lostpointercapture', alSoltar)
}

/** Doble clic en el asa: ajustar al contenido con una muestra mayor y sin el tope de 360. */
function ajustar(r: Rejilla, c: number): void {
  const col = r.props.columnas[c]
  if (!col) return
  const ancho = anchoColumnaRejilla(
    col,
    c,
    r.filas,
    MUESTRA_AJUSTE,
    medidorDe(r.cuerpoRef.current, 7.5),
    medidorDe(r.cabRef.current, 7.5),
    r.pk.has(col.nombre),
    { ...OPCIONES_ANCHO, max: ANCHO_MAX_MANUAL }
  )
  r.cambiarAncho(c, ancho)
}

function motivoColumna(r: Rejilla, c: number): string | null {
  return r.edicion?.motivosColumna?.[c] ?? null
}

function ariaSort(dir: 'asc' | 'desc' | null): 'ascending' | 'descending' | undefined {
  return dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined
}

function cabeceraDe(r: Rejilla, c: number): React.JSX.Element {
  const { columnas, orden, onOrdenar } = r.props
  const col = columnas[c]
  const o = orden?.find((x) => x.columna === c) ?? null
  const esPk = r.pk.has(col.nombre)
  const clase = `db-rejilla-th${onOrdenar ? ' ordenable' : ''}${r.redimensionando === c ? ' redimensionando' : ''}`
  return (
    <div
      key={c}
      role="columnheader"
      aria-colindex={c + 2}
      aria-sort={ariaSort(o?.dir ?? null)}
      className={clase}
      style={{ left: r.anchoFijo + r.pref[c], width: r.pref[c + 1] - r.pref[c] }}
      title={tituloCabecera(
        col,
        esPk,
        onOrdenar ? lineasOrdenCabecera(o, orden?.length ?? 0) : null,
        motivoColumna(r, c)
      )}
      // Mayús+clic extendería la selección de texto de la página: se corta en el mousedown.
      onMouseDown={(e) => {
        if (e.shiftKey && onOrdenar) e.preventDefault()
      }}
      onClick={(e) => onOrdenar?.(c, e.shiftKey)}
    >
      {esPk && (
        <span className="db-rejilla-pk" aria-hidden="true">
          <IconoLlave />
        </span>
      )}
      <span className="db-rejilla-th-nombre">{col.nombre}</span>
      {o && (
        <span className="db-rejilla-orden">
          <FlechaOrden dir={o.dir} />
          {o.prioridad !== null && <span className="db-rejilla-orden-num">{o.prioridad}</span>}
        </span>
      )}
      <div
        className="db-rejilla-asa"
        aria-hidden="true"
        onPointerDown={(e) => alAsa(r, c, e)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation()
          ajustar(r, c)
        }}
      />
    </div>
  )
}

/** Las cabeceras de las columnas que caen en la ventana. */
export function cabecerasRejilla(r: Rejilla, c1: number): React.JSX.Element[] {
  const out: React.JSX.Element[] = []
  for (let c = r.ven.c0; c < c1; c++) out.push(cabeceraDe(r, c))
  return out
}
