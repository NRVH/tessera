// =============================================================================
// MySQL y MariaDB: de las filas de `information_schema` a los tipos del contrato (columnas,
// restricciones, índices, FK y fuente) y la tabla de códigos de nombres -> tipo de objeto. Las listas
// de columnas llegan como array JSON (`sqlMysql.ts`). Puro; lo ensambla `catalogoMysql.ts`.
// Decisiones: docs/decisiones/bd/catalogo-motores-mysql.md
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
import { citar } from '../../../../shared/sql/identificadoresSql.ts'
import { aBool, aNumero, avisoSinFuente, clasificarFk, texto, textoOpcional, TIPO_RESTRICCION } from './filasCatalogo.ts'
import type { DialectoCatalogo, FilaCatalogo } from './tipos.ts'

/** Código de `sqlNombres` -> tipo de objeto. */
export const TIPO_NOMBRE_MYSQL: Readonly<Record<string, DbTipoObjeto>> = { T: 'tabla', V: 'vista', F: 'rutina' }

/** Una lista de columnas en JSON (`["a","b"]`) como array; lo que no es una lista, vacía. */
export function listaDeJson(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => texto(x))
  const s = texto(v).trim()
  if (s === '') return []
  try {
    const x: unknown = JSON.parse(s)
    return Array.isArray(x) ? x.filter((e) => e !== null && e !== undefined).map((e) => texto(e)) : []
  } catch {
    return []
  }
}

/** Un nombre de MySQL entre acentos graves. */
export function citarMysql(nombre: string): string {
  return citar(nombre, 'mysql')
}

/**
 * Lo que se enseña como «por defecto» de una columna: la expresión de una generada, el
 * AUTO_INCREMENT o el valor por defecto (MariaDB escribe `NULL` cuando no hay ninguno).
 */
function porDefectoDe(f: FilaCatalogo): string | undefined {
  const extra = texto(f[6]).trim()
  const generada = textoOpcional(f[7])
  if (generada !== undefined) {
    const guardada = /STORED|PERSISTENT/i.test(extra)
    return `GENERATED ALWAYS AS (${generada}) ${guardada ? 'STORED' : 'VIRTUAL'}`
  }
  if (/auto_increment/i.test(extra)) return 'AUTO_INCREMENT'
  const defecto = textoOpcional(f[3])
  if (defecto === undefined || defecto.toUpperCase() === 'NULL') return undefined
  const alActualizar = /on update (\S+)/i.exec(extra)
  return alActualizar ? `${defecto} ON UPDATE ${alActualizar[1]}` : defecto
}

/** Filas de `sqlColumnas` -> columnas del detalle, con la posición en la PK ya incluida. */
export function mapearColumnas(filas: readonly FilaCatalogo[]): DbColumnaInfo[] {
  const columnas: DbColumnaInfo[] = []
  for (const f of filas) {
    const col: DbColumnaInfo = {
      nombre: texto(f[0]),
      posicion: aNumero(f[4]) ?? columnas.length + 1,
      tipo: texto(f[1]),
      nullable: aBool(f[2]),
      pk: aNumero(f[8])
    }
    const defecto = porDefectoDe(f)
    if (defecto !== undefined) col.porDefecto = defecto
    const comentario = textoOpcional(f[5])
    if (comentario !== undefined) col.comentario = comentario
    columnas.push(col)
  }
  return columnas
}

/** Filas de `sqlRestricciones` -> restricciones. */
export function mapearRestricciones(filas: readonly FilaCatalogo[]): DbRestriccionInfo[] {
  const salida: DbRestriccionInfo[] = []
  for (const f of filas) {
    const tipo = TIPO_RESTRICCION[texto(f[1]).trim()]
    if (!tipo) continue
    const r: DbRestriccionInfo = { nombre: texto(f[0]), tipo, columnas: listaDeJson(f[3]) }
    const clausula = textoOpcional(f[2])
    if (tipo === 'check' && clausula !== undefined) r.definicion = `CHECK (${clausula})`
    const tabla = textoOpcional(f[5])
    if (tipo === 'fk' && tabla !== undefined) r.referencia = { esquema: texto(f[4]), tabla, columnas: listaDeJson(f[6]) }
    salida.push(r)
  }
  return salida
}

/** Filas de `sqlIndices` -> índices. */
export function mapearIndices(filas: readonly FilaCatalogo[]): DbIndiceInfo[] {
  return filas
    .filter((f) => texto(f[0]) !== '')
    .map((f) => {
      const i: DbIndiceInfo = { nombre: texto(f[0]), unico: aBool(f[1]), columnas: listaDeJson(f[4]) }
      const tipo = texto(f[3]).trim().toUpperCase()
      if (tipo === 'FULLTEXT' || tipo === 'SPATIAL') i.definicion = `${tipo} (${i.columnas.map(citarMysql).join(', ')})`
      return i
    })
}

/** Filas de `sqlFks` -> relaciones. */
export function mapearFks(esquema: string, objeto: string, filas: readonly FilaCatalogo[]): DbRelacionesFk {
  const r: DbRelacionesFk = { salientes: [], entrantes: [] }
  for (const f of filas) {
    const fk: DbFk = {
      nombre: texto(f[0]),
      desde: { esquema: texto(f[1]), tabla: texto(f[2]), columnas: listaDeJson(f[3]) },
      hacia: { esquema: texto(f[4]), tabla: texto(f[5]), columnas: listaDeJson(f[6]) }
    }
    clasificarFk(fk, esquema, objeto, r)
  }
  return r
}

/** La programación de un evento como la escribe su CREATE (`EVERY 1 DAY`, `AT '…'`). */
function programacionDe(f: FilaCatalogo): string {
  if (texto(f[1]).trim().toUpperCase() === 'ONE TIME') return `AT '${texto(f[2])}'`
  return `EVERY ${texto(f[3]).trim()} ${texto(f[4]).trim()}`
}

/** El cuerpo de una fila de fuente, o la fuente vacía con su aviso. */
function sinCuerpo(origen: string): DbFuente {
  return { partes: [], origen, aviso: avisoSinFuente() }
}

/**
 * Cómo se reconstruye la definición de cada tipo: la vista de `information_schema` de donde sale,
 * la columna de su cuerpo y el texto a partir del nombre citado, la fila y el cuerpo.
 */
interface Reconstruccion {
  origen: string
  columnaCuerpo: number
  texto: (nombre: string, f: FilaCatalogo, cuerpo: string) => string
}

const RECONSTRUCCION: Partial<Record<DbTipoObjeto, Reconstruccion>> = {
  vista: { origen: 'information_schema.VIEWS', columnaCuerpo: 0, texto: (n, _f, c) => `CREATE OR REPLACE VIEW ${n} AS\n${c}` },
  rutina: {
    origen: 'information_schema.ROUTINES',
    columnaCuerpo: 3,
    texto: (n, f, c) => {
      const tipo = texto(f[0]).trim().toUpperCase()
      const devuelve = tipo === 'FUNCTION' && textoOpcional(f[2]) !== undefined ? `\nRETURNS ${texto(f[2])}` : ''
      return `CREATE ${tipo} ${n}(${texto(f[1])})${devuelve}\n${c}`
    }
  },
  disparador: {
    origen: 'information_schema.TRIGGERS',
    columnaCuerpo: 4,
    texto: (n, f, c) => `CREATE TRIGGER ${n} ${texto(f[0])} ${texto(f[1])} ON ${citarMysql(texto(f[2]))} FOR EACH ${texto(f[3])}\n${c}`
  },
  evento: {
    origen: 'information_schema.EVENTS',
    columnaCuerpo: 0,
    texto: (n, f, c) => {
      const estado = texto(f[5]).trim().toUpperCase() === 'ENABLED' ? 'ENABLE' : 'DISABLE'
      return `CREATE EVENT ${n} ON SCHEDULE ${programacionDe(f)} ${estado}\nDO ${c}`
    }
  }
}

/** Filas de `sqlFuente` -> la definición reconstruida, con su origen. */
export function mapearFuente(_d: DialectoCatalogo, ref: DbRefObjeto, filas: readonly FilaCatalogo[]): DbFuente {
  const r = RECONSTRUCCION[ref.tipo]
  if (!r) return sinCuerpo('information_schema')
  const f = filas[0]
  const cuerpo = f ? textoOpcional(f[r.columnaCuerpo]) : undefined
  if (!f || cuerpo === undefined) return sinCuerpo(r.origen)
  const nombre = `${citarMysql(ref.esquema)}.${citarMysql(ref.nombre)}`
  return { partes: [{ titulo: 'Definición', texto: r.texto(nombre, f, cuerpo) }], origen: r.origen }
}
