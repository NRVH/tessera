// =============================================================================
// La sesión de SQLite en el main: el esquema de la consola (solo `main`), la edición de la
// rejilla por el alias del rowid, la espera por archivo de «Enviar», el valor completo de una
// celda y `EXPLAIN QUERY PLAN`. No es el trabajador (`src/tdb/sesionSqlite.cjs`). No importa
// `./index.ts` (regla de los ciclos).
// Decisiones: docs/decisiones/bd/motores-sesion-sqlite.md, docs/decisiones/bd/motores-explicar.md
// =============================================================================

import type { DbPlan } from '../../../../shared/db-explorador-ipc.ts'
import type { ColumnaEdicion } from '../edicionRejilla.ts'
import { nodosSqlite, PREFIJO_EXPLICAR_SQLITE, sqlExplicarSqlite, textoPlanSqlite, AVISO_PLAN_RECORTADO } from '../planSql.ts'
import type { BindValorSqlite, ResultadoTrabajador } from '../protocoloTrabajador.ts'
import { afinidadSqlite, comparacionOriginalSqlite } from '../../../../shared/sql/originalesSql.ts'
import { aNumero, texto } from './filasCatalogo.ts'
import type { ContextoExplicar, MarcasTablaEdicion, SesionExplorador } from './sesion.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './tipos.ts'

/** Las filas de un EQP no pasan de unas decenas; el tope es el de los nodos del plan. */
const MAX_FILAS_PLAN = 5001

/** Los 16 bytes con que empieza toda base SQLite 3 (= `MAGIA_SQLITE` de `sqliteComun.cjs`). */
const MAGIA_SQLITE = 'SQLite format 3\u0000'

// La afinidad de un tipo DECLARADO (§3.1 de «Datatypes») y la regla de qué originales se
// comparan viven en `shared/sql/originalesSql.ts`: la rejilla del renderer aplica la MISMA
// regla.

/** Un entero canónico que cabe en 64 bits (`-0`, `007` o `1e3` no lo son). */
function esEnteroCanonico(v: string): boolean {
  if (!/^-?(0|[1-9]\d{0,18})$/.test(v) || v === '-0') return false
  const b = BigInt(v)
  return b >= -(2n ** 63n) && b < 2n ** 63n
}

/**
 * Un real en la FORMA en que el trabajador lo escribe (`100.0`, `0.5`, `1.0e+21`,
 * `-2.5e-07`), que vuelve al mismo valor: lleva punto decimal, y su número es finito.
 */
function esRealCanonico(v: string): boolean {
  if (!/^-?\d+\.\d+(e[+-]\d{2,3})?$/.test(v)) return false
  return Number.isFinite(Number(v))
}

/**
 * Filas de `sqlColumnasEdicion`: `[name, type, hidden, pk, tipo_tabla, wr, alias_rowid,
 * esquema, tabla]` (ver la cabecera). Una fila por columna; las marcas de la tabla, en todas.
 */
function columnaSqlite(f: FilaCatalogo): ColumnaEdicion {
  const nombre = texto(f[0])
  const tipo = texto(f[1])
  const oculta = aNumero(f[2]) ?? 0
  const afinidad = afinidadSqlite(tipo)
  const binaria = afinidad === 'BLOB' && tipo.trim() !== ''
  let noEditable: string | null = null
  if (oculta === 2 || oculta === 3) noEditable = 'Columna generada: la calcula SQLite.'
  else if (oculta === 1) noEditable = 'Columna oculta de una tabla virtual: no se escribe.'
  else if (binaria) noEditable = 'Binaria: no se edita como texto.'
  // La regla compartida con la rejilla (`shared/sql/originalesSql.ts`).
  const comparable = comparacionOriginalSqlite(tipo)
  return { nombre, tipo, noEditable, binaria, lob: null, nacional: false, comparable }
}

/** Una sentencia de consola SQLite: filas del EQP. */
async function explicarSqlite(ctx: ContextoExplicar): Promise<DbPlan> {
  ctx.prefijo(PREFIJO_EXPLICAR_SQLITE)
  const r: ResultadoTrabajador = await ctx.ejecutar(
    sqlExplicarSqlite(ctx.texto),
    {
      proposito: 'usuario',
      maxFilas: MAX_FILAS_PLAN,
      candadoRO: ctx.soloLectura,
      txManual: ctx.txManual(),
      // No ejecuta nada: nunca abre una transacción.
      sinBegin: true,
      comprobarTx: true,
      soloExplicar: true
    },
    ctx.binds
  )
  ctx.prefijo(null)
  ctx.fijarTx(r.tx)
  if (r.tipo !== 'filas') throw ctx.error('interno', 'SQLite no devolvió el plan.')
  const filas = JSON.parse(r.filasJson) as unknown[][]
  const { nodos, recortado } = nodosSqlite(filas)
  const valor: DbPlan = {
    nodos,
    texto: textoPlanSqlite(filas),
    tiempos: { totalMs: Date.now() - ctx.t0, ejecucionMs: r.msEjecucion, lecturaMs: r.msLectura }
  }
  if (recortado || r.hayMas) valor.avisos = [AVISO_PLAN_RECORTADO]
  return valor
}

export const SESION_SQLITE: SesionExplorador = {
  motor: 'sqlite',

  // Un solo esquema: nada que fijar ni a qué volver.
  sqlFijarEsquema(): ConsultaCatalogo | null {
    return null
  },

  sqlLeerEsquema(): ConsultaCatalogo {
    return { sql: "SELECT 'main'", binds: [] }
  },

  esquemaInexistente(): boolean {
    return false
  },

  mensajeEsquemaNoAplicado(esquema: string): string {
    return `SQLite no tiene el esquema ${esquema}: cada archivo es una base con un único esquema, main.`
  },

  sqlErroresCompilacion(): ConsultaCatalogo | null {
    return null
  },

  sqlColumnasEdicion(_versionMayor: number, esquema: string, objeto: string): ConsultaCatalogo {
    const tapado = (alias: string): string =>
      `EXISTS (SELECT 1 FROM pragma_table_xinfo(?2, ?1) x WHERE lower(x.name) = '${alias}')`
    return {
      sql: [
        'SELECT c.name, c.type, c.hidden, c.pk, t.type, t.wr,',
        "       CASE WHEN t.wr OR t.type NOT IN ('table', 'shadow') THEN NULL",
        `            WHEN NOT ${tapado('rowid')} THEN 'rowid'`,
        `            WHEN NOT ${tapado('_rowid_')} THEN '_rowid_'`,
        `            WHEN NOT ${tapado('oid')} THEN 'oid' END,`,
        '       t.schema, t.name,',
        // ¿Admite NULL alguna columna de la PK? Solo en una tabla CON rowid (una WITHOUT
        // ROWID exige NOT NULL en su PK); ver `claveAdmiteNulos` en la cabecera.
        '       CASE WHEN t.wr THEN 0 ELSE (SELECT count(*) FROM pragma_table_xinfo(?2, ?1) p WHERE p.pk > 0 AND p."notnull" = 0) END',
        '  FROM pragma_table_list t, pragma_table_xinfo(?2, ?1) c',
        ' WHERE t.schema = ?1 AND t.name = ?2',
        ' ORDER BY c.cid'
      ].join('\n'),
      binds: [esquema, objeto]
    }
  },

  // Sin PK, 'rowid' (la decide `decidirIdentidad` con `aliasRowid`): no se pregunta nunca.
  sqlUnicaNoNula(): ConsultaCatalogo {
    throw new Error('Catálogo: «UNIQUE NOT NULL» no se usa en SQLite: una fila sin PK se identifica por su rowid.')
  },

  // El alias que no tapa una columna (`aliasRowid` del catálogo); sin él, `rowid`.
  sqlColumnaRowid(alias?: string | null): string {
    return alias === '_rowid_' || alias === 'oid' ? alias : 'rowid'
  },

  marcasTablaEdicion(primera: FilaCatalogo | undefined): MarcasTablaEdicion {
    if (primera === undefined) return { temporal: false, externa: false, mantenidaPorOracle: false }
    const tipoTabla = texto(primera[4]).trim()
    const esquema = texto(primera[7]).trim()
    const alias = texto(primera[6]).trim()
    return {
      temporal: esquema === 'temp',
      externa: false,
      mantenidaPorOracle: false,
      interna: tipoTabla === 'shadow' || /^sqlite_/i.test(texto(primera[8])),
      aliasRowid: alias === '' ? null : alias,
      // Sin la columna (una fila de otra forma), como si admitiera: el camino seguro.
      claveAdmiteNulos: aNumero(primera[9]) !== 0
    }
  },

  columnaEdicion: columnaSqlite,

  bindClaveBinaria(hex: string): BindValorSqlite {
    return { sqlite: 'blob', valor: hex }
  },

  bindTextoEdicion(col: ColumnaEdicion, valor: string): BindValorSqlite | null {
    // Solo en una columna SIN afinidad que convierta (ver la cabecera).
    if (col.binaria || afinidadSqlite(col.tipo) !== 'BLOB') return null
    if (esEnteroCanonico(valor)) return { sqlite: 'entero', valor }
    if (esRealCanonico(valor)) return { sqlite: 'real', valor }
    return null
  },

  esperaBloqueo: {
    forma: 'porArchivo',
    codigoVencida: 'SQLITE_BUSY',
    sqlTope(segundos: number): string {
      return `PRAGMA busy_timeout = ${Math.max(0, Math.round(segundos * 1000))}`
    },
    // Bytes 18 y 19 de la cabecera: versión de escritura y de lectura del formato, 2 = WAL
    // (lo mismo que mira `analizarCabecera` de `sqliteComun.cjs`). Lo que no se puede leer
    // o no es una cabecera de SQLite, como rollback: bloquear de más solo cuesta un aviso.
    lectorBloquea(cabecera: Uint8Array | null): boolean {
      if (cabecera === null || cabecera.length < 20) return true
      for (let i = 0; i < MAGIA_SQLITE.length; i++) if (cabecera[i] !== MAGIA_SQLITE.charCodeAt(i)) return true
      return !(cabecera[18] === 2 || cabecera[19] === 2)
    }
  },

  esTipoBinario(tipo: string): boolean {
    return tipo.includes('BLOB')
  },

  bindBooleano(v: boolean): string {
    return v ? '1' : '0'
  },

  ladoClaveBinaria(marca: string): string {
    return `unhex(${marca})`
  },

  explicar: explicarSqlite,

  // En SQLite un error no aborta la transacción: basta con releer su estado.
  revertirTrasFalloDeExplicar(): boolean {
    return false
  },

  // El «ocupado» de SQLite al leer (SQLITE_BUSY) ya tiene su mensaje y no se
  // arregla leyendo sin confirmar: no es el «bloqueado» de SQL Server.
  esBloqueoAlLeer(): boolean {
    return false
  }
}
