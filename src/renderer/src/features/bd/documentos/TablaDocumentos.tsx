// =============================================================================
// TablaDocumentos: la tabla de documentos de MongoDB, una fila por documento y una columna
// por campo de primer nivel, con ventana virtual y el CSS de la rejilla SQL. La usan la
// pestaña de colección (con edición) y la consola del shell (solo lectura: las props de
// edición y de orden son opcionales). El orden es del servidor: la tabla avisa y pinta.
// Decisiones: docs/decisiones/bd/ui-documentos-coleccion.md
// =============================================================================

import { useEffect, useMemo, useRef } from 'react'
import type { DbDocDocumento } from '../../../../../shared/db-documentos-ipc'
import type { DbOrdenColumna } from '../../../../../shared/filtroGuiado'
import type { EstadoFilaDocs } from './coleccionDocs'
import { ordenDeColumna } from '../filtro/modeloFiltro'
import { destinoTeclado } from './ventanaVirtual'
import { useVentanaVirtual, type VentanaVirtual } from './useVentanaVirtual'
import '../rejilla.css'
import './documentos.css'

export interface EstadoFilaTabla {
  estado: EstadoFilaDocs
  /** Campos con un valor sin enviar. */
  cambiados: ReadonlySet<string>
}

export interface PropsTablaDocumentos {
  columnas: string[]
  documentos: DbDocDocumento[]
  altoFila: number
  seleccionado: number | null
  onSeleccionar: (i: number) => void
  // --- Opcionales (la edición de la pestaña de colección) ---
  /** Por fila (mismo índice que `documentos`): lo pendiente. Ausente = todo 'normal'. */
  estados?: readonly EstadoFilaTabla[]
  /** La fila del cambio que falló al enviar (filete rojo). */
  filaConError?: number | null
  /** La celda que se está editando y el texto de partida. */
  editando?: { fila: number; campo: string; valor: string } | null
  /** Doble clic en una celda. */
  onEditarCelda?: (fila: number, campo: string) => void
  onConfirmarEdicion?: (valor: string) => void
  onCancelarEdicion?: () => void
  /** Clic derecho en una fila (en una celda: su campo; en el número: null). */
  onMenu?: (fila: number, campo: string | null, x: number, y: number) => void
  /** Se acerca el final de lo cargado (para pedir la página siguiente). */
  onFinAlcanzado?: () => void
  /** Lo que va debajo de la última fila («Cargando más…», «Cargar más»). */
  pie?: React.ReactNode
  etiquetaAria?: string
  // --- Opcionales (el orden por la cabecera) ---
  /** El orden APLICADO, por prioridad (la flecha y el número). */
  orden?: readonly DbOrdenColumna[]
  /** Clic en la cabecera de `columna`; `multiple` = con Mayús. Ausente = la cabecera no ordena. */
  onOrdenar?: (columna: string, multiple: boolean) => void
  /** Por qué una columna no se ordena desde la cabecera, o null (ausente = todas se ordenan). */
  motivoNoOrdenar?: (columna: string) => string | null
}

/** La flecha del orden (la misma forma que la de la rejilla SQL). */
function FlechaOrdenDoc({ dir }: { dir: 'asc' | 'desc' }): React.JSX.Element {
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

/** El `title` de una cabecera: el nombre, el orden que tiene y cómo se ordena. */
function tituloCabeceraDoc(
  columna: string,
  estado: { dir: 'asc' | 'desc'; prioridad: number | null } | null,
  ordena: boolean,
  motivo: string | null
): string {
  const lineas = [columna]
  if (estado) {
    const dir = estado.dir === 'asc' ? 'ascendente' : 'descendente'
    lineas.push(estado.prioridad !== null ? `Orden ${dir} (prioridad ${estado.prioridad})` : `Orden ${dir}`)
  }
  if (ordena) {
    if (motivo !== null) lineas.push(`No se ordena desde aquí: ${motivo}`)
    else lineas.push('Clic: ordenar en el servidor (ascendente → descendente → sin orden)', 'Mayús+clic: añadir esta columna al orden')
  }
  return lineas.join('\n')
}

const ANCHO_MIN = 4
const ANCHO_MAX = 40
/** Filas que se miran para calcular el ancho de una columna. */
const MUESTRA_ANCHO = 60

/** `extra`: los `ch` de la flecha del orden (y su número), para que no se coma el nombre. */
function anchoColumna(nombre: string, documentos: readonly DbDocDocumento[], extra = 0): number {
  let max = nombre.length + extra
  const n = Math.min(documentos.length, MUESTRA_ANCHO)
  for (let i = 0; i < n; i++) {
    const v = documentos[i].celdas[nombre]?.vista
    if (v && v.length > max) max = v.length
    if (max >= ANCHO_MAX) break
  }
  // +2: el relleno de la celda (8 px por lado), en `ch` aproximados.
  return Math.min(ANCHO_MAX, Math.max(ANCHO_MIN, max)) + 2
}

interface Ventana extends VentanaVirtual {
  anchos: number[]
  anchoNum: number
}

/** La ventana virtual, los anchos de las columnas y el aviso de final a la vista. */
function useVentanaTabla(p: PropsTablaDocumentos): Ventana {
  const n = p.documentos.length
  const ventana = useVentanaVirtual(n, p.altoFila, p.seleccionado, p.onFinAlcanzado)
  const anchos = useMemo(
    () =>
      p.columnas.map((c) => {
        const est = p.orden ? ordenDeColumna(p.orden, c) : null
        return anchoColumna(c, p.documentos, est ? (est.prioridad !== null ? 4 : 2) : 0)
      }),
    [p.columnas, p.documentos, p.orden]
  )
  const anchoNum = Math.max(3, String(n).length) + 2

  return { ...ventana, anchos, anchoNum }
}

/** Una celda: su vista, el marcado de tipo/cambio y, si se edita, el editor en su sitio. */
function celdaDocumento(p: PropsTablaDocumentos, v: Ventana, i: number, k: number): React.JSX.Element {
  const c = p.columnas[k]
  const celda = p.documentos[i].celdas[c]
  const est = p.estados?.[i]
  const ed = p.editando && p.editando.fila === i && p.editando.campo === c ? p.editando : null
  const cls = ['db-docs-celda', celda ? `tipo-${celda.tipo}` : 'ausente']
  if (est?.cambiados.has(c)) cls.push('cambiada')
  return (
    <div
      key={c}
      className={cls.join(' ')}
      role="gridcell"
      data-campo={c}
      style={{ width: `${v.anchos[k]}ch` }}
      title={celda ? celda.vista : `Sin el campo ${c}`}
      onDoubleClick={() => p.onEditarCelda?.(i, c)}
    >
      {celda ? celda.vista : ''}
      {ed && (
        <EditorCeldaDoc
          valor={ed.valor}
          onConfirmar={(val) => p.onConfirmarEdicion?.(val)}
          onCancelar={() => p.onCancelarEdicion?.()}
        />
      )}
    </div>
  )
}

/** Una fila: su número, sus celdas y el menú contextual. */
function filaDocumento(p: PropsTablaDocumentos, v: Ventana, i: number): React.JSX.Element {
  const est = p.estados?.[i]
  const alto = p.altoFila
  const clases = ['db-docs-fila', 'db-rejilla-fila']
  if (est && est.estado === 'nuevo') clases.push('nueva')
  if (est && est.estado === 'borrado') clases.push('borrada')
  if (p.filaConError === i) clases.push('con-error')
  if (p.seleccionado === i) clases.push('sel')
  return (
    <div
      key={i}
      className={clases.join(' ')}
      role="row"
      aria-rowindex={i + 2}
      aria-selected={p.seleccionado === i}
      style={{ transform: `translateY(${i * alto}px)`, height: alto }}
      onMouseDown={() => p.onSeleccionar(i)}
      onContextMenu={(e) => {
        if (!p.onMenu) return
        e.preventDefault()
        p.onSeleccionar(i)
        const celda = (e.target as HTMLElement).closest<HTMLElement>('[data-campo]')
        p.onMenu(i, celda?.dataset.campo ?? null, e.clientX, e.clientY)
      }}
    >
      <div className={`db-rejilla-num${p.seleccionado === i ? ' sel' : ''}`} style={{ width: `${v.anchoNum}ch` }}>
        {est?.estado === 'nuevo' ? '+' : i + 1}
      </div>
      {p.columnas.map((_, k) => celdaDocumento(p, v, i, k))}
    </div>
  )
}

/** La cabecera de una columna: el nombre, la flecha del orden y el clic que ordena. */
function cabeceraDocumento(p: PropsTablaDocumentos, v: Ventana, c: string, k: number): React.JSX.Element {
  const est = p.orden ? ordenDeColumna(p.orden, c) : null
  const onOrdenar = p.onOrdenar
  const motivo = onOrdenar ? (p.motivoNoOrdenar?.(c) ?? null) : null
  const ordena = onOrdenar !== undefined && motivo === null
  return (
    <div
      key={c}
      className={`db-docs-th${ordena ? ' ordenable' : ''}${est ? ' ordenada' : ''}`}
      role="columnheader"
      aria-sort={est?.dir === 'asc' ? 'ascending' : est?.dir === 'desc' ? 'descending' : undefined}
      data-campo={c}
      style={{ width: `${v.anchos[k]}ch` }}
      title={tituloCabeceraDoc(c, est, onOrdenar !== undefined, motivo)}
      onClick={ordena ? (e) => onOrdenar(c, e.shiftKey) : undefined}
    >
      <span className="db-docs-th-nombre">{c}</span>
      {est && (
        <span className="db-rejilla-orden db-docs-orden">
          <FlechaOrdenDoc dir={est.dir} />
          {est.prioridad !== null && <span className="db-docs-orden-prioridad">{est.prioridad}</span>}
        </span>
      )}
    </div>
  )
}

/** Tabla de documentos con ventana virtual, edición de celdas y orden por la cabecera. */
export function TablaDocumentos(p: PropsTablaDocumentos): React.JSX.Element {
  const v = useVentanaTabla(p)
  const n = p.documentos.length
  const alto = p.altoFila
  const anchoTotal = `calc(${v.anchoNum + v.anchos.reduce((a, b) => a + b, 0)}ch + 2px)`

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget || n === 0) return
    const destino = destinoTeclado(e.key, p.seleccionado, n, Math.floor(v.altoVista / alto))
    if (destino === null) return
    e.preventDefault()
    p.onSeleccionar(destino)
  }

  const filas: React.JSX.Element[] = []
  for (let i = v.primera; i < v.ultima; i++) filas.push(filaDocumento(p, v, i))

  return (
    <div
      className="db-rejilla db-docs-tabla"
      role="grid"
      aria-label={p.etiquetaAria ?? 'Documentos'}
      aria-rowcount={n + 1}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ '--db-alto-fila': `${alto}px` } as React.CSSProperties}
    >
      <div className="db-rejilla-scroll" ref={v.scrollRef} onScroll={(e) => v.setScrollTop(e.currentTarget.scrollTop)}>
        <div className="db-rejilla-lienzo" style={{ width: anchoTotal, height: (n + 1) * alto + (p.pie ? alto : 0) }}>
          <div className="db-rejilla-cab db-docs-cab" role="row" style={{ height: alto }}>
            <div className="db-rejilla-esquina db-docs-esquina" style={{ width: `${v.anchoNum}ch` }} />
            {p.columnas.map((c, k) => cabeceraDocumento(p, v, c, k))}
          </div>
          <div className="db-rejilla-cuerpo db-docs-cuerpo" style={{ height: n * alto }}>
            {filas}
          </div>
          {p.pie && (
            <div className="db-docs-pie" style={{ transform: `translateY(${(n + 1) * alto}px)`, height: alto }}>
              {p.pie}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * El editor de una celda: el valor en notación del shell, en su sitio. Intro confirma, Esc
 * cancela y perder el foco confirma. El valor no se valida aquí: lo interpreta el trabajador.
 */
function EditorCeldaDoc({
  valor,
  onConfirmar,
  onCancelar
}: {
  valor: string
  onConfirmar: (v: string) => void
  onCancelar: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const hecho = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const terminar = (ok: boolean): void => {
    if (hecho.current) return
    hecho.current = true
    if (ok) onConfirmar(ref.current?.value ?? valor)
    else onCancelar()
  }
  return (
    <input
      ref={ref}
      className="db-celda-editor db-docs-editor"
      defaultValue={valor}
      spellCheck={false}
      autoComplete="off"
      aria-label="Valor del campo (notación del shell)"
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          terminar(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          terminar(false)
        }
      }}
      onBlur={() => terminar(true)}
    />
  )
}
