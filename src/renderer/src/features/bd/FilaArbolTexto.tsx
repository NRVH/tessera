// =============================================================================
// El contenido de las filas del lateral de BD que no llevan acciones propias (carpetas,
// esquemas, objetos y su detalle, colecciones, bases y claves), y el marcado de la
// coincidencia de la búsqueda. Cada función devuelve el mismo fragmento que se pintaba
// dentro de la fila; la elige la tabla de `FilaArbolContenido.tsx`.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import type { ReactNode } from 'react'
import { IconoCarpeta } from '../../comun/iconosArbol'
import { IconoBd, IconoClaveKv, IconoColeccion, IconoColumna, IconoConsola, IconoEsquema, IconoIndice, IconoLlave, IconoLlaveForanea, IconoObjetoBd } from './iconosBd'
import type { Coincidencia, FilaBd } from './arbolBd'
import { ETIQUETA_CARPETA, ETIQUETA_PARTE } from './filasArbolBd'
import { etiquetaBaseClaves } from './arbolClaves'
import { etiquetaTipo } from './claves/visorClaves'

type FilaDe<K extends FilaBd['kind']> = Extract<FilaBd, { kind: K }>

const ETIQUETA_RESTRICCION = {
  pk: 'clave primaria',
  unica: 'única',
  fk: 'clave foránea',
  check: 'check',
  exclusion: 'exclusión'
} as const

/** Parte la etiqueta para marcar la coincidencia de la búsqueda. */
export function marcar(texto: string, c: Coincidencia | undefined): ReactNode {
  if (!c) return texto
  return (
    <>
      {texto.slice(0, c[0])}
      <mark>{texto.slice(c[0], c[1])}</mark>
      {texto.slice(c[1])}
    </>
  )
}

/**
 * Como `marcar`, con los `largoPrefijo` primeros caracteres ATENUADOS: el nombre de una clave
 * dentro de su carpeta se pinta entero, y lo que ya dice la carpeta se apaga. La coincidencia
 * puede caer a caballo de las dos partes: se corta por los cuatro puntos (prefijo y los dos
 * bordes de la marca).
 */
function marcarConPrefijo(texto: string, largoPrefijo: number, c: Coincidencia | undefined): ReactNode {
  if (largoPrefijo <= 0) return marcar(texto, c)
  const cortes = [...new Set([0, largoPrefijo, ...(c ? [c[0], c[1]] : []), texto.length])].filter((x) => x >= 0 && x <= texto.length).sort((a, b) => a - b)
  const trozos: ReactNode[] = []
  for (let k = 0; k + 1 < cortes.length; k++) {
    const desde = cortes[k]
    const hasta = cortes[k + 1]
    if (desde === hasta) continue
    const t = texto.slice(desde, hasta)
    const enMarca = c !== undefined && desde >= c[0] && hasta <= c[1]
    const nodo = enMarca ? <mark>{t}</mark> : t
    trozos.push(
      desde < largoPrefijo ? (
        <span key={k} className="db-kv-prefijo">
          {nodo}
        </span>
      ) : (
        <span key={k}>{nodo}</span>
      )
    )
  }
  return <>{trozos}</>
}

export function contenidoCarpetaConsolas(fila: FilaDe<'carpeta-consolas'>, chevron: ReactNode): ReactNode {
  return (
    <>
      {chevron}
      <IconoCarpeta abierto={fila.expandida} />
      <span className="tree-label db-fila-nombre">consolas</span>
      <span className="db-fila-cuenta">{fila.cuenta}</span>
    </>
  )
}

export function contenidoConsola(fila: FilaDe<'consola'>): ReactNode {
  return (
    <>
      <span className="db-fila-icono db-icono-consola">
        <IconoConsola />
      </span>
      <span className="tree-label db-fila-nombre">{marcar(fila.consola.nombre, fila.coincidencia)}</span>
    </>
  )
}

export function contenidoEsquema(fila: FilaDe<'esquema'>, chevron: ReactNode): ReactNode {
  return (
    <>
      {chevron}
      <span className="db-fila-icono">
        <IconoEsquema />
      </span>
      <span className="tree-label db-fila-nombre">{marcar(fila.esquema, fila.coincidencia)}</span>
      {fila.porDefecto && <span className="db-fila-meta">por defecto</span>}
    </>
  )
}

export function contenidoCarpeta(fila: FilaDe<'carpeta'>, chevron: ReactNode): ReactNode {
  return (
    <>
      {chevron}
      <IconoCarpeta abierto={fila.expandida} />
      <span className="tree-label db-fila-nombre">{ETIQUETA_CARPETA[fila.tipo]}</span>
      <span className="db-fila-cuenta">{fila.cuenta}</span>
    </>
  )
}

export function contenidoObjeto(fila: FilaDe<'objeto'>, chevron: ReactNode): ReactNode {
  const o = fila.objeto
  return (
    <>
      {chevron}
      <span className={`db-fila-icono db-icono-${o.tipo}`}>
        <IconoObjetoBd tipo={o.tipo} />
      </span>
      <span className="tree-label db-fila-nombre">{marcar(o.nombre, fila.coincidencia)}</span>
      {o.firma !== undefined && <span className="db-fila-meta">({o.firma})</span>}
      {o.tabla !== undefined && <span className="db-fila-meta">sobre {o.tabla}</span>}
      {o.estado === 'invalido' && <span className="db-fila-invalido">inválido</span>}
    </>
  )
}

export function contenidoCarpetaDetalle(fila: FilaDe<'carpeta-detalle'>, chevron: ReactNode): ReactNode {
  return (
    <>
      {chevron}
      <IconoCarpeta abierto={fila.expandida} />
      <span className="tree-label db-fila-nombre">{ETIQUETA_PARTE[fila.parte]}</span>
      <span className="db-fila-cuenta">{fila.cuenta}</span>
    </>
  )
}

export function contenidoColumna(fila: FilaDe<'columna'>): ReactNode {
  const col = fila.columna
  return (
    <>
      <span className={`db-fila-icono${col.pk !== null ? ' db-icono-pk' : ''}`}>
        {col.pk !== null ? <IconoLlave /> : <IconoColumna />}
      </span>
      <span className="tree-label db-fila-nombre">{marcar(col.nombre, fila.coincidencia)}</span>
      <span className="db-fila-meta">{col.tipo}</span>
    </>
  )
}

export function contenidoIndice(fila: FilaDe<'indice'>): ReactNode {
  const ind = fila.indice
  return (
    <>
      <span className="db-fila-icono">
        <IconoIndice />
      </span>
      <span className="tree-label db-fila-nombre">{marcar(ind.nombre, fila.coincidencia)}</span>
      <span className="db-fila-meta">
        ({ind.columnas.join(', ')}){ind.unico ? ' único' : ''}
      </span>
    </>
  )
}

export function contenidoRestriccion(fila: FilaDe<'restriccion'>): ReactNode {
  const r = fila.restriccion
  return (
    <>
      <span className={`db-fila-icono${r.tipo === 'pk' ? ' db-icono-pk' : ''}`}>
        {r.tipo === 'pk' ? <IconoLlave /> : r.tipo === 'fk' ? <IconoLlaveForanea /> : <IconoIndice />}
      </span>
      <span className="tree-label db-fila-nombre">{marcar(r.nombre, fila.coincidencia)}</span>
      <span className="db-fila-meta">
        {ETIQUETA_RESTRICCION[r.tipo]}
        {r.referencia ? ` → ${r.referencia.esquema}.${r.referencia.tabla}` : ''}
      </span>
    </>
  )
}

/** Documentos: la base con el cilindro gris (como una base del nivel «Bases»). */
export function contenidoDocBase(fila: FilaDe<'doc-base'>, chevron: ReactNode): ReactNode {
  return (
    <>
      {chevron}
      <span className="db-fila-icono db-icono-base">
        <IconoBd />
      </span>
      <span className="tree-label db-fila-nombre">{marcar(fila.base, fila.coincidencia)}</span>
    </>
  )
}

/** La colección con sus llaves `{ }`, su tipo o los documentos estimados. */
export function contenidoColeccion(fila: FilaDe<'coleccion'>): ReactNode {
  return (
    <>
      <span className="db-fila-icono">
        <IconoColeccion />
      </span>
      <span className="tree-label db-fila-nombre">{marcar(fila.coleccion.nombre, fila.coincidencia)}</span>
      {fila.meta !== null && <span className="db-fila-meta">{fila.meta}</span>}
    </>
  )
}

/** La base numerada con sus claves (si el servidor las dijo) y, con un filtro, su patrón. */
export function contenidoKvBase(fila: FilaDe<'kv-base'>, chevron: ReactNode): ReactNode {
  return (
    <>
      {chevron}
      <span className="db-fila-icono db-icono-base">
        <IconoBd />
      </span>
      <span className="tree-label db-fila-nombre">{marcar(etiquetaBaseClaves(fila.indice), fila.coincidencia)}</span>
      {fila.porDefecto && <span className="db-fila-meta">por defecto</span>}
      {fila.patron !== '' && (
        <span className="db-kv-patron" title={`Filtrada por ${fila.patron}`}>
          {fila.patron}
        </span>
      )}
      {fila.claves !== null && <span className="db-fila-cuenta">{fila.claves.toLocaleString('es-ES')}</span>}
    </>
  )
}

/** Una carpeta por `:` con cuántas claves cargadas tiene. */
export function contenidoKvCarpeta(fila: FilaDe<'kv-carpeta'>, chevron: ReactNode): ReactNode {
  return (
    <>
      {chevron}
      <IconoCarpeta abierto={fila.expandida} />
      <span className="tree-label db-fila-nombre">{fila.nombre}</span>
      <span className="db-fila-cuenta">{fila.cuenta.toLocaleString('es-ES')}</span>
    </>
  )
}

/** Una clave con su NOMBRE ENTERO (lo de la carpeta, apagado) y el chip de su tipo. */
export function contenidoKvClave(fila: FilaDe<'kv-clave'>): ReactNode {
  return (
    <>
      <span className="db-fila-icono">
        <IconoClaveKv />
      </span>
      <span className="tree-label db-fila-nombre">{marcarConPrefijo(fila.nombre, fila.largoPrefijo, fila.coincidencia)}</span>
      <span className={`db-kv-tipo tipo-${fila.clave.tipo}`}>{etiquetaTipo(fila.clave.tipo, fila.clave.tipoServidor)}</span>
    </>
  )
}
