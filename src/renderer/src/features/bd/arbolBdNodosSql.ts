// =============================================================================
// arbolBdNodosSql — los nodos del árbol de una conexión SQL: conexión (con o sin nivel
// «Bases»), base, esquema, carpeta por tipo, objeto, carpeta de detalle y hojas.
// Con base, cada nivel lleva un punto más de sangría y la base en su fila y en su carga.
// Puro; lo usa `arbolBdAplanado.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-modelo.md
// =============================================================================

import { descriptorSql, tieneNivelBases } from '../../../../shared/motores/index.ts'
import { contarVisibles, resolverVisibles } from '../../../../shared/dbEsquemas.ts'
import { claveBd } from './arbolBdClaves.ts'
import { ordenarEsquemas, partesDetalle } from './arbolBdReglas.ts'
import { SIN_HIJOS, cargados, conBase, inicioConexion, pendiente, type ContextoArbol, type Nodo } from './arbolBdNodo.ts'
import type { DescriptorSql } from '../../../../shared/motores/index.ts'
import type {
  DbBase,
  DbDetalle,
  DbEsquema,
  DbEsquemasRespuesta,
  DbObjeto,
  DbParteDetalle,
  DbRefObjeto,
  DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'
import type {
  CargaBd,
  FilaBaseDatos,
  FilaBd,
  FilaCarpeta,
  FilaCarpetaDetalle,
  FilaColumna,
  FilaConexion,
  FilaEsquema,
  FilaIndice,
  FilaObjeto,
  FilaRestriccion,
  InsigniaEsquemas
} from './arbolBdTipos.ts'

/** Los esquemas visibles de una respuesta según la configuración de la conexión, o null sin respuesta. */
function visiblesDe(c: DbConnection, resp: DbEsquemasRespuesta | undefined): string[] | null {
  return resp ? resolverVisibles(c.esquemas, resp.esquemas.map((x) => x.nombre), resp.porDefecto) : null
}

/** El «N de M» de una conexión sin nivel «Bases»: exacto con la lista, estimado con la introspección. */
function insigniaConexion(c: DbConnection, resp: DbEsquemasRespuesta | undefined, visibles: string[] | null): InsigniaEsquemas | null {
  if (resp && visibles) return { n: visibles.length, m: resp.esquemas.length }
  if (c.introspeccion) {
    const m = c.introspeccion.totalEsquemas
    return { n: contarVisibles(c.esquemas, m, c.introspeccion.esquemaPorDefecto), m }
  }
  return null
}

/** Una conexión SQL: sus esquemas visibles o, sin base fija en un motor que lo tiene, sus bases. */
export function nodoConexionSql(ctx: ContextoArbol, c: DbConnection, d: DescriptorSql): Nodo {
  if (tieneNivelBases(d, c)) return nodoConexionConBases(ctx, c)
  const clave = claveBd.conexion(c.id)
  const resp = ctx.e.esquemas.get(clave)
  const visibles = visiblesDe(c, resp)
  const base: FilaConexion = {
    kind: 'conexion',
    key: clave,
    depth: 0,
    conexionId: c.id,
    conexion: c,
    expandida: false,
    insignia: insigniaConexion(c, resp, visibles)
  }
  return {
    base,
    contenedor: true,
    etiqueta: c.alias,
    hijos: () => {
      const nodos = inicioConexion(ctx, c.id)
      if (resp && visibles) {
        const set = new Set(visibles)
        const lista = ordenarEsquemas(resp.esquemas.filter((x) => set.has(x.nombre)))
        for (const x of lista) nodos.push(nodoEsquema(ctx, c, x, resp.porDefecto))
        return cargados(nodos, lista.length === 0, 'Ningún esquema visible')
      }
      return pendiente(ctx, { tipo: 'esquemas', clave, conexionId: c.id }, nodos)
    }
  }
}

/**
 * Una conexión con nivel «Bases»: sus hijos son las bases VISIBLES (su «N de M»,
 * `DbConnection.bases`, con la aritmética de los esquemas) y la insignia cuenta bases.
 */
function nodoConexionConBases(ctx: ContextoArbol, c: DbConnection): Nodo {
  const clave = claveBd.conexion(c.id)
  const claveLista = claveBd.bases(c.id)
  const resp = ctx.e.bases?.get(claveLista)
  const visibles = resp ? resolverVisibles(c.bases, resp.bases.map((x) => x.nombre), resp.porDefecto) : null
  const base: FilaConexion = {
    kind: 'conexion',
    key: clave,
    depth: 0,
    conexionId: c.id,
    conexion: c,
    expandida: false,
    insignia: resp && visibles ? { n: visibles.length, m: resp.bases.length } : null,
    nivelBases: true
  }
  return {
    base,
    contenedor: true,
    etiqueta: c.alias,
    hijos: () => {
      const nodos = inicioConexion(ctx, c.id)
      if (resp && visibles) {
        const set = new Set(visibles)
        const lista = ordenarEsquemas(resp.bases.filter((x) => set.has(x.nombre)))
        for (const x of lista) nodos.push(nodoBase(ctx, c, x, resp.porDefecto))
        return cargados(nodos, lista.length === 0, 'Ninguna base visible')
      }
      return pendiente(ctx, { tipo: 'bases', clave: claveLista, conexionId: c.id }, nodos)
    }
  }
}

/**
 * Una base: sus hijos son sus esquemas visibles (la configuración de ESQUEMAS de la conexión,
 * aplicada a la lista de esta base). Una base sin acceso no pide un catálogo que daría el 916.
 */
function nodoBase(ctx: ContextoArbol, c: DbConnection, x: DbBase, porDefecto: string): Nodo {
  const clave = claveBd.base(c.id, x.nombre)
  const resp = ctx.e.esquemas.get(clave)
  const visibles = visiblesDe(c, resp)
  const fila: FilaBaseDatos = {
    kind: 'base',
    key: clave,
    depth: 1,
    conexionId: c.id,
    base: x.nombre,
    porDefecto: x.nombre === porDefecto,
    sistema: x.sistema,
    accesible: x.accesible,
    insignia: resp && visibles ? { n: visibles.length, m: resp.esquemas.length } : null,
    expandida: false
  }
  return {
    base: fila,
    contenedor: true,
    etiqueta: x.nombre,
    hijos: () => {
      if (!x.accesible) return { nodos: [], estado: { variante: 'empty', mensaje: 'Sin acceso a esta base' } }
      if (resp && visibles) {
        const set = new Set(visibles)
        const lista = ordenarEsquemas(resp.esquemas.filter((y) => set.has(y.nombre)))
        const nodos = lista.map((y) => nodoEsquema(ctx, c, y, resp.porDefecto, x.nombre))
        return cargados(nodos, lista.length === 0, 'Ningún esquema visible')
      }
      return pendiente(ctx, { tipo: 'esquemas', clave, conexionId: c.id, base: x.nombre })
    }
  }
}

/** Un nivel más de sangría con la base por encima. */
function sangria(baseDatos: string | undefined): number {
  return baseDatos === undefined ? 0 : 1
}

function nodoEsquema(ctx: ContextoArbol, c: DbConnection, x: DbEsquema, porDefecto: string, baseDatos?: string): Nodo {
  const clave = claveBd.esquema(c.id, x.nombre, baseDatos)
  const pseudo = x.pseudo === true
  const base: FilaEsquema = {
    kind: 'esquema',
    key: clave,
    depth: 1 + sangria(baseDatos),
    conexionId: c.id,
    esquema: x.nombre,
    ...conBase(baseDatos),
    porDefecto: x.nombre === porDefecto,
    sistema: x.sistema,
    pseudo,
    expandida: false
  }
  return {
    base,
    contenedor: true,
    etiqueta: x.nombre,
    hijos: () => {
      const conteos = ctx.e.conteos.get(clave)
      if (conteos) {
        const tipos: readonly DbTipoObjeto[] = pseudo ? ['sinonimo'] : descriptorSql(c.motor).catalogo.carpetas
        const nodos: Nodo[] = []
        for (const t of tipos) {
          const cuenta = conteos[t] ?? 0
          if (cuenta > 0) nodos.push(nodoCarpeta(ctx, c.id, x.nombre, t, cuenta, baseDatos))
        }
        return cargados(nodos, nodos.length === 0, 'Sin objetos')
      }
      return pendiente(ctx, { tipo: 'resumen', clave, conexionId: c.id, esquema: x.nombre, ...conBase(baseDatos) })
    }
  }
}

function nodoCarpeta(ctx: ContextoArbol, conexionId: string, esquema: string, tipo: DbTipoObjeto, cuenta: number, baseDatos?: string): Nodo {
  const clave = claveBd.carpeta(conexionId, esquema, tipo, baseDatos)
  const base: FilaCarpeta = {
    kind: 'carpeta',
    key: clave,
    depth: 2 + sangria(baseDatos),
    conexionId,
    esquema,
    ...conBase(baseDatos),
    tipo,
    cuenta,
    expandida: false
  }
  return {
    base,
    contenedor: true,
    etiqueta: null,
    hijos: () => {
      const objetos = ctx.e.objetos.get(clave)
      if (objetos) {
        const nodos = objetos.map((o) => nodoObjeto(ctx, conexionId, esquema, o, baseDatos))
        return cargados(nodos, nodos.length === 0, 'Sin objetos')
      }
      return pendiente(ctx, { tipo: 'objetos', clave, conexionId, esquema, tipoObjeto: tipo, ...conBase(baseDatos) })
    }
  }
}

/** La carga del detalle de un objeto, con su firma y su base solo si las tiene. */
function cargaDetalle(clave: string, conexionId: string, esquema: string, o: DbObjeto, partes: readonly DbParteDetalle[], baseDatos?: string): CargaBd {
  const ref: DbRefObjeto = { esquema, nombre: o.nombre, tipo: o.tipo }
  if (o.firma !== undefined) ref.firma = o.firma
  if (baseDatos !== undefined) ref.base = baseDatos
  return { tipo: 'detalle', clave, conexionId, objeto: ref, partes: [...partes] }
}

function nodoObjeto(ctx: ContextoArbol, conexionId: string, esquema: string, o: DbObjeto, baseDatos?: string): Nodo {
  const clave = claveBd.objeto(conexionId, esquema, o.tipo, o.nombre, o.firma, baseDatos)
  const partes = partesDetalle(o.tipo)
  const expandible = partes.length > 0
  const base: FilaObjeto = {
    kind: 'objeto',
    key: clave,
    depth: 3 + sangria(baseDatos),
    conexionId,
    esquema,
    ...conBase(baseDatos),
    objeto: o,
    expandible,
    expandida: false
  }
  return {
    base,
    contenedor: expandible,
    etiqueta: o.nombre,
    hijos: () => {
      const detalle = ctx.e.detalles.get(clave)
      if (detalle) {
        const nodos: Nodo[] = []
        for (const parte of partes) {
          const n = nodoCarpetaDetalle(conexionId, esquema, o, parte, detalle, baseDatos)
          if (n) nodos.push(n)
        }
        return cargados(nodos, nodos.length === 0, 'Sin detalle')
      }
      return pendiente(ctx, cargaDetalle(clave, conexionId, esquema, o, partes, baseDatos))
    }
  }
}

/** Lo común de las hojas de una parte del detalle (columnas, índices o restricciones). */
interface HojasDe {
  conexionId: string
  esquema: string
  o: DbObjeto
  parte: DbParteDetalle
  baseDatos: string | undefined
}

function hoja(base: FilaBd, etiqueta: string): Nodo {
  return { base, contenedor: false, etiqueta, hijos: SIN_HIJOS }
}

/** Las hojas de una parte del detalle, en el orden en que llegan. */
function hojasDetalle(h: HojasDe, detalle: DbDetalle): Nodo[] {
  const { conexionId, esquema, o, parte, baseDatos } = h
  const hojas: Nodo[] = []
  const claveHoja = (nombre: string): string => claveBd.hoja(conexionId, esquema, o.tipo, o.nombre, parte, nombre, baseDatos)
  const comun = { depth: 5 + sangria(baseDatos), conexionId, esquema, ...conBase(baseDatos), objeto: o }
  if (parte === 'columnas') {
    for (const col of detalle.columnas ?? []) {
      const fila: FilaColumna = { kind: 'columna', key: claveHoja(col.nombre), ...comun, columna: col }
      hojas.push(hoja(fila, col.nombre))
    }
  } else if (parte === 'indices') {
    for (const ind of detalle.indices ?? []) {
      const fila: FilaIndice = { kind: 'indice', key: claveHoja(ind.nombre), ...comun, indice: ind }
      hojas.push(hoja(fila, ind.nombre))
    }
  } else {
    for (const r of detalle.restricciones ?? []) {
      const fila: FilaRestriccion = { kind: 'restriccion', key: claveHoja(r.nombre), ...comun, restriccion: r }
      hojas.push(hoja(fila, r.nombre))
    }
  }
  return hojas
}

/** La carpeta de una parte del detalle, o null si no tiene hojas (no se pinta). */
function nodoCarpetaDetalle(
  conexionId: string,
  esquema: string,
  o: DbObjeto,
  parte: DbParteDetalle,
  detalle: DbDetalle,
  baseDatos?: string
): Nodo | null {
  const hojas = hojasDetalle({ conexionId, esquema, o, parte, baseDatos }, detalle)
  if (hojas.length === 0) return null
  const base: FilaCarpetaDetalle = {
    kind: 'carpeta-detalle',
    key: claveBd.detalle(conexionId, esquema, o.tipo, o.nombre, parte, baseDatos),
    depth: 4 + sangria(baseDatos),
    conexionId,
    esquema,
    ...conBase(baseDatos),
    objeto: o,
    parte,
    cuenta: hojas.length,
    expandida: false
  }
  return { base, contenedor: true, etiqueta: null, hijos: () => ({ nodos: hojas, estado: null }) }
}
