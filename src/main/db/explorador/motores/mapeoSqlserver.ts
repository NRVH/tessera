// =============================================================================
// SQL Server: de las filas de `sys.*` a los tipos del contrato (columnas, restricciones, índices,
// FK, fuente y tipo de un objeto) y a los tipos del DDL. Sin STRING_AGG (es de 2017; el mínimo es
// 2012): las listas de columnas llegan una fila por columna y se agrupan aquí.
// Puro; lo ensambla `catalogoSqlserver.ts` y lo usa `verDdlSqlserver.ts`.
// =============================================================================

import type {
  DbColumnaInfo,
  DbFk,
  DbFuente,
  DbIndiceInfo,
  DbRefObjeto,
  DbRelacionesFk,
  DbRestriccionInfo,
  DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import {
  ddlTablaSqlServer,
  type ColumnaDdlSqlServer,
  type IndiceDdlSqlServer,
  type RestriccionDdlSqlServer
} from '../ddlCatalogo.ts'
import { aBool, aNumero, AVISO_SIN_FUENTE, clasificarFk, texto, textoOpcional } from './filasCatalogo.ts'
import { CARPETA_DE_TIPO } from './sqlSqlserver.ts'
import type { DialectoCatalogo, FilaCatalogo } from './tipos.ts'

/** Una fila de `sqlColumnas` como columna del DDL. */
export function columnaDdl(f: FilaCatalogo): ColumnaDdlSqlServer {
  const c: ColumnaDdlSqlServer = { nombre: texto(f[0]), tipo: texto(f[1]), nullable: aBool(f[2]) }
  const defecto = textoOpcional(f[3])
  if (defecto !== undefined) c.defecto = defecto
  const calculada = textoOpcional(f[7])
  if (calculada !== undefined) c.calculada = { expresion: calculada, persistida: aBool(f[11]) }
  if (aBool(f[6])) c.identidad = { semilla: textoOpcional(f[9]) ?? '1', incremento: textoOpcional(f[10]) ?? '1' }
  return c
}

/** Filas de `sqlColumnas` -> columnas del detalle (calculadas e identidades se dicen como lo que son). */
export function mapearColumnas(filas: readonly FilaCatalogo[]): DbColumnaInfo[] {
  const columnas: DbColumnaInfo[] = []
  for (const f of filas) {
    const d = columnaDdl(f)
    const col: DbColumnaInfo = {
      nombre: d.nombre,
      posicion: aNumero(f[4]) ?? columnas.length + 1,
      tipo: d.tipo,
      nullable: d.nullable,
      pk: aNumero(f[8])
    }
    if (d.calculada) col.porDefecto = `AS ${d.calculada.expresion}${d.calculada.persistida ? ' PERSISTED' : ''}`
    else if (d.identidad) col.porDefecto = `IDENTITY(${d.identidad.semilla},${d.identidad.incremento})`
    else if (d.defecto !== undefined) col.porDefecto = d.defecto
    const comentario = textoOpcional(f[5])
    if (comentario !== undefined) col.comentario = comentario
    columnas.push(col)
  }
  return columnas
}

const TIPO_RESTRICCION_SQLSERVER: Record<string, RestriccionDdlSqlServer['tipo']> = {
  PK: 'pk',
  UQ: 'unica',
  F: 'fk',
  C: 'check'
}

/** `NO_ACTION` → undefined (es lo de por defecto); `CASCADE`, `SET_NULL`… → `CASCADE`, `SET NULL`. */
function accionFk(v: unknown): string | undefined {
  const t = texto(v).trim().toUpperCase()
  if (t === '' || t === 'NO_ACTION') return undefined
  return t.replace(/_/g, ' ')
}

/** Crea la restricción de la primera fila de su nombre, con lo que trae de propio (FK, CHECK, índice). */
function nuevaRestriccion(nombre: string, tipo: RestriccionDdlSqlServer['tipo'], f: FilaCatalogo): RestriccionDdlSqlServer {
  const r: RestriccionDdlSqlServer = { nombre, tipo, columnas: [] }
  const definicion = textoOpcional(f[2])
  if (definicion !== undefined) r.definicion = definicion
  if (tipo === 'fk') {
    r.referencia = { esquema: texto(f[4]), tabla: texto(f[5]), columnas: [] }
    const alBorrar = accionFk(f[8])
    if (alBorrar) r.alBorrar = alBorrar
    const alActualizar = accionFk(f[9])
    if (alActualizar) r.alActualizar = alActualizar
  }
  const indice = textoOpcional(f[10])
  if (indice !== undefined) r.agrupada = indice.toUpperCase() === 'CLUSTERED'
  return r
}

/** Las filas de `sqlRestricciones` agrupadas por restricción, en el orden en que llegan. */
export function restriccionesDdl(filas: readonly FilaCatalogo[]): RestriccionDdlSqlServer[] {
  const porNombre = new Map<string, RestriccionDdlSqlServer>()
  for (const f of filas) {
    const tipo = TIPO_RESTRICCION_SQLSERVER[texto(f[1]).trim()]
    if (!tipo) continue
    const nombre = texto(f[0])
    let r = porNombre.get(nombre)
    if (!r) {
      r = nuevaRestriccion(nombre, tipo, f)
      porNombre.set(nombre, r)
    }
    const columna = textoOpcional(f[3])
    if (columna !== undefined) r.columnas.push({ nombre: columna, descendente: aBool(f[11]) })
    const ref = textoOpcional(f[6])
    if (r.referencia && ref !== undefined) r.referencia.columnas.push(ref)
  }
  return [...porNombre.values()]
}

export function mapearRestricciones(filas: readonly FilaCatalogo[]): DbRestriccionInfo[] {
  return restriccionesDdl(filas).map((r) => {
    const salida: DbRestriccionInfo = { nombre: r.nombre, tipo: r.tipo, columnas: r.columnas.map((c) => c.nombre) }
    if (r.definicion !== undefined) salida.definicion = r.definicion
    if (r.referencia) salida.referencia = { ...r.referencia, columnas: r.referencia.columnas.slice() }
    return salida
  })
}

/** Las filas de `sqlIndices` agrupadas por índice: claves e incluidas por separado. */
export function indicesDdl(filas: readonly FilaCatalogo[]): IndiceDdlSqlServer[] {
  const porNombre = new Map<string, IndiceDdlSqlServer>()
  for (const f of filas) {
    const nombre = texto(f[0])
    if (nombre === '') continue
    let i = porNombre.get(nombre)
    if (!i) {
      i = {
        nombre,
        unico: aBool(f[1]),
        deRestriccion: aBool(f[2]) || aBool(f[3]),
        tipo: texto(f[4]).trim().toUpperCase(),
        columnas: [],
        incluidas: [],
        esquema: texto(f[10]),
        tabla: texto(f[11])
      }
      const filtro = textoOpcional(f[9])
      if (filtro !== undefined) i.filtro = filtro
      porNombre.set(nombre, i)
    }
    const columna = texto(f[5])
    if (aBool(f[8])) i.incluidas.push(columna)
    else i.columnas.push({ nombre: columna, descendente: aBool(f[6]) })
  }
  return [...porNombre.values()]
}

/** El CREATE INDEX de un índice suelto (el mismo texto que pone el DDL de la tabla). */
function ddlIndiceComoTexto(i: IndiceDdlSqlServer): string {
  return ddlTablaSqlServer({ esquema: i.esquema, nombre: i.tabla, columnas: [], restricciones: [], indices: [i], soloIndices: true })
}

export function mapearIndices(filas: readonly FilaCatalogo[]): DbIndiceInfo[] {
  return indicesDdl(filas).map((i) => {
    const info: DbIndiceInfo = { nombre: i.nombre, unico: i.unico, columnas: i.columnas.map((c) => c.nombre) }
    // La definición es la del DDL (sin los de una restricción, que salen en el CREATE TABLE).
    if (!i.deRestriccion) info.definicion = ddlIndiceComoTexto(i)
    return info
  })
}

/** Filas de `sqlFks` (una por columna) -> relaciones. */
export function mapearFks(esquema: string, objeto: string, filas: readonly FilaCatalogo[]): DbRelacionesFk {
  const r: DbRelacionesFk = { salientes: [], entrantes: [] }
  const porClave = new Map<string, DbFk>()
  for (const f of filas) {
    const clave = JSON.stringify([texto(f[1]), texto(f[2]), texto(f[0])])
    let fk = porClave.get(clave)
    if (!fk) {
      fk = {
        nombre: texto(f[0]),
        desde: { esquema: texto(f[1]), tabla: texto(f[2]), columnas: [] },
        hacia: { esquema: texto(f[4]), tabla: texto(f[5]), columnas: [] }
      }
      porClave.set(clave, fk)
    }
    fk.desde.columnas.push(texto(f[3]))
    fk.hacia.columnas.push(texto(f[6]))
  }
  for (const fk of porClave.values()) clasificarFk(fk, esquema, objeto, r)
  return r
}

/** Aviso de una definición que el servidor no enseña aunque el objeto existe. */
const AVISO_SIN_DEFINICION =
  'SQL Server no enseña la definición: el objeto está cifrado (WITH ENCRYPTION) o te falta el permiso VIEW DEFINITION.'

/** Filas de `sqlFuente` -> la definición de la vista o la rutina, con su aviso si no se ve. */
export function mapearFuente(_d: DialectoCatalogo, _ref: DbRefObjeto, filas: readonly FilaCatalogo[]): DbFuente {
  const origen = 'sys.sql_modules'
  if (filas.length === 0) return { partes: [], origen, aviso: AVISO_SIN_FUENTE }
  const valor = textoOpcional(filas[0][0])
  if (valor === undefined) return { partes: [], origen, aviso: AVISO_SIN_DEFINICION }
  return { partes: [{ titulo: 'Definición', texto: valor }], origen }
}

/** El tipo de contrato de la primera fila de `sqlTipoDeObjeto`. */
export function mapearTipoDeObjeto(filas: readonly FilaCatalogo[]): DbTipoObjeto | null {
  const f = filas[0]
  if (!f) return null
  return CARPETA_DE_TIPO[texto(f[0]).trim()] ?? null
}
