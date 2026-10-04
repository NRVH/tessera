// =============================================================================
// arbolBdNodosFamilias — los nodos del árbol de las familias que no son SQL: documentos
// (bases y colecciones) y claves (bases numeradas, carpetas por `:`, claves y «Cargar más»).
// Ninguno pide nada del catálogo SQL; lo que deciden `arbolDocumentos.ts` y `arbolClaves.ts`
// aquí solo se monta en nodos. Puro; lo usa `arbolBdAplanado.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-modelo.md
// =============================================================================

import { TEXTOS_DOCUMENTOS, metaColeccion, ordenarBasesDocumentos, ordenarColecciones, raizDocumentos } from './arbolDocumentos.ts'
import {
  TEXTOS_CLAVES,
  basesDeClaves,
  carpetasDeRecorrido,
  etiquetaBaseClaves,
  etiquetaCarpetaClaves,
  textoSinCoincidencias,
  vistaCargarMas,
  type BaseClaves,
  type CarpetaClaves,
  type ClaveVista,
  type RecorridoClaves
} from './arbolClaves.ts'
import { claveBd } from './arbolBdClaves.ts'
import { cargaDeConexion } from './arbolBdReglas.ts'
import { SIN_HIJOS, cargados, inicioConexion, pendiente, type ContextoArbol, type HijosNodo, type Nodo } from './arbolBdNodo.ts'
import type { DescriptorClaves, DescriptorDocumentos } from '../../../../shared/motores/index.ts'
import type { DbDocBase, DbDocColeccion } from '../../../../shared/db-documentos-ipc.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type { FilaColeccion, FilaConexion, FilaDocBase, FilaKvBase, FilaKvCarpeta, FilaKvClave, FilaKvMas } from './arbolBdTipos.ts'

/** La fila de una conexión de otra familia: sin insignia ni nivel «Bases» SQL. */
function filaConexionSinCatalogoSql(c: DbConnection): FilaConexion {
  return { kind: 'conexion', key: claveBd.conexion(c.id), depth: 0, conexionId: c.id, conexion: c, expandida: false, insignia: null }
}

// --- Documentos ---------------------------------------------------------------------

/** Una conexión de documentos: con base fija, sus colecciones; sin ella, sus bases (`raizDocumentos`). */
export function nodoConexionDocumentos(ctx: ContextoArbol, c: DbConnection, d: DescriptorDocumentos): Nodo {
  const raiz = raizDocumentos(d, c)
  return {
    base: filaConexionSinCatalogoSql(c),
    contenedor: true,
    etiqueta: c.alias,
    hijos: () => {
      const nodos = inicioConexion(ctx, c.id)
      const carga = cargaDeConexion(c)
      if (raiz.nivel === 'bases') {
        const lista = ctx.e.docBases?.get(carga.clave)
        if (lista) {
          for (const b of ordenarBasesDocumentos(lista)) nodos.push(nodoDocBase(ctx, c.id, b))
          return cargados(nodos, lista.length === 0, TEXTOS_DOCUMENTOS.sinBases)
        }
      } else {
        const cols = ctx.e.colecciones?.get(carga.clave)
        if (cols) {
          for (const x of ordenarColecciones(cols)) nodos.push(nodoColeccion(c.id, raiz.base, x, 1))
          return cargados(nodos, cols.length === 0, TEXTOS_DOCUMENTOS.sinColecciones)
        }
      }
      return pendiente(ctx, carga, nodos)
    }
  }
}

function nodoDocBase(ctx: ContextoArbol, conexionId: string, b: DbDocBase): Nodo {
  const clave = claveBd.docBase(conexionId, b.nombre)
  const fila: FilaDocBase = { kind: 'doc-base', key: clave, depth: 1, conexionId, base: b.nombre, expandida: false }
  return {
    base: fila,
    contenedor: true,
    etiqueta: b.nombre,
    hijos: () => {
      const cols = ctx.e.colecciones?.get(clave)
      if (cols) {
        const nodos = ordenarColecciones(cols).map((x) => nodoColeccion(conexionId, b.nombre, x, 2))
        return cargados(nodos, nodos.length === 0, TEXTOS_DOCUMENTOS.sinColecciones)
      }
      return pendiente(ctx, { tipo: 'colecciones', clave, conexionId, base: b.nombre })
    }
  }
}

function nodoColeccion(conexionId: string, base: string, x: DbDocColeccion, depth: number): Nodo {
  const fila: FilaColeccion = {
    kind: 'coleccion',
    key: claveBd.coleccion(conexionId, base, x.nombre),
    depth,
    conexionId,
    base,
    coleccion: x,
    meta: metaColeccion(x)
  }
  return { base: fila, contenedor: false, etiqueta: x.nombre, hijos: SIN_HIJOS }
}

// --- Claves -------------------------------------------------------------------------

/**
 * Una conexión de claves: sus bases numeradas (`basesDeClaves`). Si la lista falla, las del
 * descriptor y DETRÁS el error con su «Reintentar».
 */
export function nodoConexionClaves(ctx: ContextoArbol, c: DbConnection, d: DescriptorClaves): Nodo {
  return {
    base: filaConexionSinCatalogoSql(c),
    contenedor: true,
    etiqueta: c.alias,
    hijos: () => {
      const nodos = inicioConexion(ctx, c.id)
      const carga = cargaDeConexion(c)
      const resp = ctx.e.kvBases?.get(carga.clave) ?? null
      const error = ctx.e.errores.get(carga.clave)
      if (resp === null && !error) return { nodos, estado: { variante: 'loading', carga } }
      for (const b of basesDeClaves(resp, d, c)) nodos.push(nodoKvBase(ctx, c.id, b))
      return { nodos, estado: error ? { variante: 'error', error, carga } : null }
    }
  }
}

/** Los hijos de una base con lo recorrido: sus carpetas, sus claves y, si el cursor sigue, «Cargar más». */
function hijosRecorrido(ctx: ContextoArbol, conexionId: string, b: BaseClaves, rec: RecorridoClaves, patron: string): HijosNodo {
  const clave = claveBd.kvBase(conexionId, b.indice)
  const nodos = nodosDeCarpeta(conexionId, b.indice, carpetasDeRecorrido(rec), 2)
  // Un cursor que no es '0' sigue abierto: «Cargar más» también sin ninguna clave todavía,
  // que NO es «Sin claves».
  if (rec.cursor !== '0') nodos.push(nodoKvMas(conexionId, b.indice, rec, ctx.e.kvCargandoMas?.has(clave) === true))
  if (nodos.length === 0) {
    return { nodos, estado: { variante: 'empty', mensaje: patron === '' ? TEXTOS_CLAVES.sinClaves : textoSinCoincidencias(patron) } }
  }
  return { nodos, estado: null }
}

function nodoKvBase(ctx: ContextoArbol, conexionId: string, b: BaseClaves): Nodo {
  const clave = claveBd.kvBase(conexionId, b.indice)
  const patron = ctx.e.kvPatrones?.get(clave) ?? ''
  const fila: FilaKvBase = {
    kind: 'kv-base',
    key: clave,
    depth: 1,
    conexionId,
    indice: b.indice,
    claves: b.claves,
    porDefecto: b.porDefecto,
    patron,
    expandida: false
  }
  return {
    base: fila,
    contenedor: true,
    etiqueta: etiquetaBaseClaves(b.indice),
    hijos: () => {
      // Vacía según el servidor: un SCAN sería un viaje de balde. Con los conteos
      // desconocidos (`claves` null) se recorre siempre.
      if (b.claves === 0) return { nodos: [], estado: { variante: 'empty', mensaje: TEXTOS_CLAVES.sinClaves } }
      const rec = ctx.e.kvClaves?.get(clave)
      if (rec) return hijosRecorrido(ctx, conexionId, b, rec, patron)
      return pendiente(ctx, { tipo: 'kvClaves', clave, conexionId, base: b.indice })
    }
  }
}

/** Lo de una carpeta (o de la raíz de la base): sus carpetas y después sus claves. */
function nodosDeCarpeta(conexionId: string, indice: number, c: CarpetaClaves, depth: number): Nodo[] {
  const nodos: Nodo[] = []
  for (const h of c.carpetas) nodos.push(nodoKvCarpeta(conexionId, indice, h, depth))
  for (const k of c.claves) nodos.push(nodoKvClave(conexionId, indice, k, depth, c.prefijo.length))
  return nodos
}

function nodoKvCarpeta(conexionId: string, indice: number, c: CarpetaClaves, depth: number): Nodo {
  const fila: FilaKvCarpeta = {
    kind: 'kv-carpeta',
    key: claveBd.kvCarpeta(conexionId, indice, c.prefijo),
    depth,
    conexionId,
    indice,
    prefijo: c.prefijo,
    nombre: etiquetaCarpetaClaves(c.nombre),
    cuenta: c.total,
    expandida: false
  }
  // Como las carpetas SQL, no se buscan por su nombre: se buscan claves, que llevan el
  // prefijo en el suyo (buscar `usuario` encuentra todo lo de `usuario:`).
  return { base: fila, contenedor: true, etiqueta: null, hijos: () => ({ nodos: nodosDeCarpeta(conexionId, indice, c, depth + 1), estado: null }) }
}

function nodoKvClave(conexionId: string, indice: number, k: ClaveVista, depth: number, largoPrefijo: number): Nodo {
  const fila: FilaKvClave = {
    kind: 'kv-clave',
    key: claveBd.kvClave(conexionId, indice, k.clave.nombre.base64),
    depth,
    conexionId,
    indice,
    clave: k.clave,
    nombre: k.nombre,
    largoPrefijo
  }
  return { base: fila, contenedor: false, etiqueta: k.nombre, hijos: SIN_HIJOS }
}

function nodoKvMas(conexionId: string, indice: number, rec: RecorridoClaves, cargando: boolean): Nodo {
  const fila: FilaKvMas = {
    kind: 'kv-mas',
    key: claveBd.kvMas(conexionId, indice),
    depth: 2,
    conexionId,
    indice,
    cargando,
    vista: vistaCargarMas(rec, cargando)
  }
  return { base: fila, contenedor: false, etiqueta: null, hijos: SIN_HIJOS }
}
