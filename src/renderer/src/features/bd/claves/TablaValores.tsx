// =============================================================================
// TablaValores: la tabla virtual de los elementos de una clave de tipo colección (hash, list,
// set, zset, stream). Columnas fijas por tipo y celdas que son bytes; solo se montan las
// filas a la vista y las columnas van en `ch`. Toma el CSS de `TablaDocumentos`.
// Decisiones: docs/decisiones/bd/ui-claves-pestana.md
// =============================================================================

import { destinoTeclado } from '../documentos/ventanaVirtual'
import { useVentanaVirtual } from '../documentos/useVentanaVirtual'
import type { TablaValor } from './visorClaves'

export interface PropsTablaValores {
  tabla: TablaValor
  altoFila: number
  seleccionado: number | null
  onSeleccionar: (i: number) => void
  onMenu: (i: number, x: number, y: number) => void
  pie: React.ReactNode
  etiquetaAria: string
}

type Fila = TablaValor['filas'][number]
type Columna = TablaValor['columnas'][number]

function celdaValor(c: Columna, f: Fila, k: number): React.JSX.Element {
  const celda = f.celdas[k]
  const cls = ['db-docs-celda', 'db-kv-celda']
  if (c.numerica) cls.push('numerica')
  if (celda?.binario) cls.push('binario')
  if (celda?.ausente) cls.push('ausente')
  return (
    <div key={k} className={cls.join(' ')} role="gridcell" style={{ width: `${c.ancho}ch` }} title={celda?.ausente ? `Sin ${c.titulo}` : celda?.texto}>
      {celda?.texto ?? ''}
    </div>
  )
}

function filaValor(p: PropsTablaValores, i: number, anchoNum: number): React.JSX.Element {
  const f = p.tabla.filas[i]
  const alto = p.altoFila
  const sel = p.seleccionado === i
  return (
    <div
      key={f.clave}
      className={`db-docs-fila db-rejilla-fila${sel ? ' sel' : ''}`}
      role="row"
      aria-rowindex={i + 2}
      aria-selected={sel}
      style={{ transform: `translateY(${i * alto}px)`, height: alto }}
      onMouseDown={() => p.onSeleccionar(i)}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenu(i, e.clientX, e.clientY)
      }}
    >
      <div className={`db-rejilla-num${sel ? ' sel' : ''}`} style={{ width: `${anchoNum}ch` }}>
        {i + 1}
      </div>
      {p.tabla.columnas.map((c, k) => celdaValor(c, f, k))}
    </div>
  )
}

/** Tabla virtual de los elementos de una clave; las flechas, RePág/AvPág, Inicio y Fin mueven la selección. */
export function TablaValores(p: PropsTablaValores): React.JSX.Element {
  const { columnas, filas } = p.tabla
  const n = filas.length
  const alto = p.altoFila
  const v = useVentanaVirtual(n, alto, p.seleccionado)
  const anchoNum = Math.max(3, String(n).length) + 2
  const anchoTotal = `calc(${anchoNum + columnas.reduce((a, c) => a + c.ancho, 0)}ch + 2px)`

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget || n === 0) return
    const destino = destinoTeclado(e.key, p.seleccionado, n, Math.floor(v.altoVista / alto))
    if (destino === null) return
    e.preventDefault()
    p.onSeleccionar(destino)
  }

  const vivas: React.JSX.Element[] = []
  for (let i = v.primera; i < v.ultima; i++) vivas.push(filaValor(p, i, anchoNum))

  return (
    <div
      className="db-rejilla db-docs-tabla"
      role="grid"
      aria-label={p.etiquetaAria}
      aria-rowcount={n + 1}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ '--db-alto-fila': `${alto}px` } as React.CSSProperties}
    >
      <div className="db-rejilla-scroll" ref={v.scrollRef} onScroll={(e) => v.setScrollTop(e.currentTarget.scrollTop)}>
        <div className="db-rejilla-lienzo" style={{ width: anchoTotal, height: (n + 1) * alto + (p.pie ? alto : 0) }}>
          <div className="db-rejilla-cab db-docs-cab" role="row" style={{ height: alto }}>
            <div className="db-rejilla-esquina db-docs-esquina" style={{ width: `${anchoNum}ch` }} />
            {columnas.map((c, k) => (
              <div key={k} className={`db-docs-th db-kv-th${c.numerica ? ' numerica' : ''}`} role="columnheader" style={{ width: `${c.ancho}ch` }} title={c.titulo}>
                {c.titulo}
              </div>
            ))}
          </div>
          <div className="db-rejilla-cuerpo db-docs-cuerpo" style={{ height: n * alto }}>
            {vivas}
          </div>
          {p.pie && (
            <div className="db-kv-pie" style={{ transform: `translateY(${(n + 1) * alto}px)`, height: alto }}>
              {p.pie}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
