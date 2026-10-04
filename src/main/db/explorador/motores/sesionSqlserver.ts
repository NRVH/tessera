// =============================================================================
// La sesión de SQL Server en el main: la base como «esquema» de la consola, las columnas y la
// identidad de la edición, la clave binaria, la espera con `SET LOCK_TIMEOUT` de «Enviar» y
// SHOWPLAN_XML. No es el trabajador (`src/tdb/sesionSqlserver.cjs`). No importa `./index.ts`
// (regla de los ciclos); los valores que también lee el renderer son del descriptor.
// Decisiones: docs/decisiones/bd/motores-sesion-sqlserver.md, docs/decisiones/bd/motores-explicar.md
// =============================================================================

import type { DbPlan } from '../../../../shared/db-explorador-ipc.ts'
import type { ColumnaEdicion } from '../edicionRejilla.ts'
import { TOPE_PLAN_SQLSERVER } from '../limites.ts'
import { AVISO_PLAN_RECORTADO, planDesdeXmlSqlServer } from '../planSql.ts'
import { esFalloTrabajador, type BindEntradaLob, type BindValorSqlite, type OpcionesEjecucion, type ResultadoTrabajador } from '../protocoloTrabajador.ts'
import { aBool, noDisponible, texto } from './filasCatalogo.ts'
import { corchetes, prefijoBase, SQL_TIPO_COLUMNA } from './nombresSqlserver.ts'
import type { ContextoExplicar, MarcasTablaEdicion, SesionExplorador } from './sesion.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './tipos.ts'

/** Lo que devuelve el servidor cuando vence `SET LOCK_TIMEOUT` (medido: 1222, «Se superó el tiempo de espera de bloqueo»). */
export const CODIGO_BLOQUEO_SQLSERVER = '1222'

/** `USE` a una base que no existe (911) o sin acceso (916): la base elegida ya no vale. */
const CODIGOS_BASE_INEXISTENTE = new Set(['911', '916'])

/** El usuario no tiene permiso SHOWPLAN en la base (medido: el SET pasa y la sentencia da 262). */
const CODIGO_SIN_SHOWPLAN = '262'

/**
 * El «tipo base» que `sqlColumnasEdicion` da a un tipo CLR (`sys.types.is_assembly_type`): los
 * del sistema (geography, geometry, hierarchyid) y los de un ensamblado del usuario. Antes se
 * buscaba su base con `bt.user_type_id = t.system_type_id`, y un CLR tiene system_type_id 240,
 * que no es el user_type_id de ningún tipo (medido,): la base salía NULL y la
 * columna se ofrecía como EDITABLE.
 */
const TIPO_BASE_CLR = 'clr'

/** Tipos base (de sistema) que no se editan como texto, y por qué. */
function noEditablePorTipo(tipoBase: string): string | null {
  switch (tipoBase) {
    case 'timestamp':
      return 'rowversion: la escribe SQL Server.'
    case 'binary':
    case 'varbinary':
    case 'image':
      return 'Binaria: no se edita como texto.'
    case TIPO_BASE_CLR:
      return 'Tipo CLR: no se edita como texto.'
    case 'sql_variant':
      return 'sql_variant: un texto cambiaría su tipo guardado.'
    default:
      return null
  }
}

/**
 * Filas de `sqlColumnasEdicion`: `[nombre, tipo, tipo_base, is_identity, is_computed,
 * periodo (generated_always_type > 0), tabla_de_historia (temporal_type = 1), is_ms_shipped]`.
 */
function columnaSqlServer(f: FilaCatalogo): ColumnaEdicion {
  const nombre = texto(f[0])
  const tipo = texto(f[1])
  const base = texto(f[2]).trim().toLowerCase()
  let noEditable: string | null = null
  if (aBool(f[3])) noEditable = 'Identidad (IDENTITY): la numera SQL Server.'
  else if (aBool(f[4])) noEditable = 'Columna calculada: la calcula SQL Server.'
  else if (aBool(f[5])) noEditable = 'Periodo de una tabla temporal: lo escribe SQL Server.'
  else noEditable = noEditablePorTipo(base)
  const binaria = base === 'binary' || base === 'varbinary' || base === 'image' || base === 'timestamp'
  // SQL Server nunca se identifica por 'rowid': los originales no se usan.
  return { nombre, tipo, noEditable, binaria, lob: null, nacional: false, comparable: null }
}

// --- EXPLAIN --------------------------------------------------------------------------------

/** Opciones de las tres sentencias del EXPLAIN (con los topes del plan, ver `explicarSqlServer`). */
function opcionesExplicar(ctx: ContextoExplicar, proposito: OpcionesEjecucion['proposito'], comprobarTx: boolean): OpcionesEjecucion {
  return {
    proposito,
    maxFilas: 100,
    // SHOWPLAN compila y no ejecuta: sin envoltorio de solo lectura (sus BEGIN TRAN / IF …
    // saldrían como planes de más) y sin abrir una transacción implícita.
    candadoRO: false,
    txManual: ctx.txManual(),
    sinBegin: true,
    comprobarTx,
    // El XML del plan es un nvarchar: el TEXTSIZE de la sesión lo cortaría. El trabajador lo
    // ajusta con el tope ANTES del SET SHOWPLAN (van las tres con el mismo), así que bajo
    // SHOWPLAN no se manda nada que no sea la sentencia.
    topeCelda: TOPE_PLAN_SQLSERVER,
    topeRespuesta: TOPE_PLAN_SQLSERVER * 2 + 1024
  }
}

/** Las celdas de texto de todas las filas de todos los conjuntos de un resultado. */
function celdasDePlan(r: ResultadoTrabajador): string[] {
  const salida: string[] = []
  const leer = (filasJson: string): void => {
    for (const fila of JSON.parse(filasJson) as unknown[][]) {
      const c = fila[0]
      if (typeof c === 'string' && c !== '') salida.push(c)
    }
  }
  if (r.tipo === 'filas') leer(r.filasJson)
  for (const s of r.siguientes ?? []) if (s.tipo === 'filas') leer(s.filasJson)
  return salida
}

/**
 * EXPLAIN de SQL Server: `SET SHOWPLAN_XML ON` en su propio lote (1067 si comparte lote), la
 * sentencia TAL CUAL (el servidor la compila y devuelve una fila con el plan; no la ejecuta
 * ni toca la transacción abierta, medido) y `SET SHOWPLAN_XML OFF` SIEMPRE, también si la
 * sentencia falla o se para: una sesión que se quedara en SHOWPLAN no ejecutaría nada más.
 * Sin valores (`explainPideValores: false`: la consola no tiene parámetros). Un 262 es la
 * falta del permiso SHOWPLAN, y se dice así. Los tres viajes se esperan aquí, en el cuerpo: en
 * funciones `async` aparte sumarían turnos entre una respuesta y el siguiente envío.
 */
async function explicarSqlServer(ctx: ContextoExplicar): Promise<DbPlan> {
  await ctx.ejecutar('SET SHOWPLAN_XML ON', opcionesExplicar(ctx, 'catalogo', false))
  let r: ResultadoTrabajador | null = null
  let fallo: unknown = null
  // La sentencia va sin prefijo: la línea de un error es la de la sentencia. Si falla, el
  // prefijo SE QUEDA puesto al lanzar su error (dice al gestor que el error es de la sentencia
  // y dónde marcarlo, como el EXPLAIN de PG).
  ctx.prefijo('')
  try {
    r = await ctx.ejecutar(ctx.texto, opcionesExplicar(ctx, 'usuario', false))
  } catch (e) {
    fallo = e
  }
  if (!fallo) ctx.prefijo(null)
  // El OFF, salvo con la sesión perdida o el proceso colgado.
  let apagado: ResultadoTrabajador | null = null
  const sesionSigue = !(esFalloTrabajador(fallo) && (fallo.error.clase === 'perdida' || fallo.error.codigo === 'TESSERA-PLAZO'))
  if (sesionSigue) {
    try {
      apagado = await ctx.ejecutar('SET SHOWPLAN_XML OFF', opcionesExplicar(ctx, 'catalogo', true))
    } catch (e) {
      // Si la sentencia ya había fallado, se enseña SU error, no el del OFF (que lo taparía);
      // el gestor relee la transacción de todos modos. Si no, el del OFF, que no es de la
      // sentencia: sin posición.
      if (!fallo) throw e
    }
  }
  if (apagado) ctx.fijarTx(apagado.tx)
  if (fallo) {
    if (esFalloTrabajador(fallo) && fallo.error.codigo === CODIGO_SIN_SHOWPLAN) {
      ctx.prefijo(null)
      throw ctx.error('servidor', 'No tienes permiso para ver planes en esta base (SHOWPLAN): pídeselo a quien administre el servidor.')
    }
    throw fallo
  }
  return planDeResultadoSqlServer(ctx, r)
}

/** El plan (nodos, texto y tiempos) a partir de lo que devolvió la sentencia con SHOWPLAN. */
function planDeResultadoSqlServer(ctx: ContextoExplicar, r: ResultadoTrabajador | null): DbPlan {
  if (!r) throw ctx.error('interno', 'El servidor no devolvió el plan.')
  if (r.tipo === 'filas' && r.recortes && r.recortes.length > 0) throw ctx.error('limite', 'El plan es demasiado grande para enseñarlo.')
  const xmls = celdasDePlan(r)
  let plan: ReturnType<typeof planDesdeXmlSqlServer>
  try {
    plan = planDesdeXmlSqlServer(xmls)
  } catch {
    throw ctx.error('interno', 'El servidor devolvió un plan que Tessera no entiende.')
  }
  const tiempos = r.tipo === 'filas' ? { ejecucionMs: r.msEjecucion, lecturaMs: r.msLectura } : { ejecucionMs: r.ms, lecturaMs: 0 }
  const valor: DbPlan = { nodos: plan.nodos, texto: plan.texto, tiempos: { totalMs: Date.now() - ctx.t0, ...tiempos } }
  if (plan.recortado) valor.avisos = [AVISO_PLAN_RECORTADO]
  return valor
}

export const SESION_SQLSERVER: SesionExplorador = {
  motor: 'sqlserver',

  // `esquema` es una BASE (ver la cabecera). null = la base con la que abrió la sesión.
  sqlFijarEsquema(esquema: string | null, esquemaConexion: string | null): ConsultaCatalogo | null {
    const destino = esquema ?? esquemaConexion
    if (destino === null || destino === '') return null
    return { sql: `USE ${corchetes(destino)}`, binds: [] }
  },

  sqlLeerEsquema(): ConsultaCatalogo {
    return { sql: 'SELECT DB_NAME()', binds: [] }
  },

  esquemaInexistente(codigo: string | null): boolean {
    return codigo !== null && CODIGOS_BASE_INEXISTENTE.has(codigo)
  },

  mensajeEsquemaNoAplicado(esquema: string): string {
    return `No se puede usar la base ${esquema} en esta conexión: no existe o no tienes acceso a ella.`
  },

  sqlErroresCompilacion(): ConsultaCatalogo | null {
    return null
  },

  sqlColumnasEdicion(versionMayor: number, esquema: string, objeto: string, base?: string): ConsultaCatalogo {
    const b = prefijoBase(base)
    // `generated_always_type` y `temporal_type` son de 2016 (13); antes no hay tablas temporales.
    const periodo = versionMayor >= 13 ? 'CASE WHEN c.generated_always_type > 0 THEN 1 ELSE 0 END' : '0'
    const historia = versionMayor >= 13 ? 'CASE WHEN tb.temporal_type = 1 THEN 1 ELSE 0 END' : '0'
    return {
      sql: [
        `SELECT c.name, ${SQL_TIPO_COLUMNA.split('\n').join('\n       ')},`,
        `       CASE WHEN t.is_assembly_type = 1 THEN '${TIPO_BASE_CLR}' ELSE bt.name END, c.is_identity, c.is_computed,`,
        `       ${periodo}, ${historia}, o.is_ms_shipped`,
        `  FROM ${b}sys.columns c`,
        `  JOIN ${b}sys.objects o ON o.object_id = c.object_id`,
        `  JOIN ${b}sys.schemas s ON s.schema_id = o.schema_id`,
        `  JOIN ${b}sys.types t ON t.user_type_id = c.user_type_id`,
        `  LEFT JOIN ${b}sys.schemas ts ON ts.schema_id = t.schema_id`,
        `  LEFT JOIN ${b}sys.types bt ON bt.user_type_id = t.system_type_id`,
        `  LEFT JOIN ${b}sys.tables tb ON tb.object_id = o.object_id`,
        ' WHERE s.name = @p1 AND o.name = @p2',
        ' ORDER BY c.column_id'
      ].join('\n'),
      binds: [esquema, objeto]
    }
  },

  // El primer índice ÚNICO (restricción UNIQUE o índice único), sin filtro y habilitado, con
  // TODAS sus columnas de clave NOT NULL; el más corto primero. Filas `[índice, columna]`.
  sqlUnicaNoNula(esquema: string, objeto: string, base?: string): ConsultaCatalogo {
    const b = prefijoBase(base)
    return {
      sql: [
        'SELECT i.name, c.name',
        `  FROM ${b}sys.indexes i`,
        `  JOIN ${b}sys.objects o ON o.object_id = i.object_id`,
        `  JOIN ${b}sys.schemas s ON s.schema_id = o.schema_id`,
        `  JOIN ${b}sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0`,
        `  JOIN ${b}sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id`,
        ' WHERE s.name = @p1 AND o.name = @p2 AND i.is_unique = 1 AND i.is_primary_key = 0',
        '   AND i.has_filter = 0 AND i.is_disabled = 0',
        '   AND NOT EXISTS (',
        `     SELECT 1 FROM ${b}sys.index_columns x`,
        `       JOIN ${b}sys.columns y ON y.object_id = x.object_id AND y.column_id = x.column_id`,
        '      WHERE x.object_id = i.object_id AND x.index_id = i.index_id AND x.is_included_column = 0 AND y.is_nullable = 1)',
        ` ORDER BY (SELECT COUNT(*) FROM ${b}sys.index_columns z`,
        '            WHERE z.object_id = i.object_id AND z.index_id = i.index_id AND z.is_included_column = 0),',
        '          i.name, ic.key_ordinal'
      ].join('\n'),
      binds: [esquema, objeto]
    }
  },

  // Sin pseudo-columna estable (ver la cabecera): no se le pide nunca, la rejilla rechaza
  // antes `rowid: true`.
  sqlColumnaRowid(): string {
    return noDisponible('sqlserver', 'ROWID')
  },

  marcasTablaEdicion(primera: FilaCatalogo | undefined): MarcasTablaEdicion {
    // La tabla de HISTORIA de una temporal y los objetos del sistema los escribe el motor.
    const interna = primera !== undefined && (aBool(primera[6]) || aBool(primera[7]))
    return { temporal: false, externa: false, mantenidaPorOracle: false, interna }
  },

  columnaEdicion: columnaSqlServer,

  // Binario de verdad (ver la cabecera): el trabajador lo enlaza como VarBinary.
  bindClaveBinaria(hex: string): BindValorSqlite {
    return { sqlite: 'blob', valor: hex }
  },

  // El trabajador manda todo texto como nvarchar: ni LOB ni juego nacional que elegir.
  bindTextoEdicion(): BindEntradaLob | null {
    return null
  },

  // «Enviar» corre en una sesión propia: un tope para toda ella con su PRIMERA sentencia.
  // `SET LOCK_TIMEOUT` es de la SESIÓN (en milisegundos), no de la transacción como el
  // `SET LOCAL` de PG, pero la sesión de «Enviar» no hace otra cosa. Sin candado por filas
  // (el UPDATE ya bloquea la suya).
  esperaBloqueo: {
    forma: 'porTransaccion',
    codigoVencida: CODIGO_BLOQUEO_SQLSERVER,
    sqlTope: (segundos: number) => `SET LOCK_TIMEOUT ${Math.max(0, Math.round(segundos * 1000))}`
  },

  esTipoBinario(tipo: string): boolean {
    return /^(VAR)?BINARY\b|^IMAGE$|^TIMESTAMP$|^ROWVERSION$/.test(tipo)
  },

  bindBooleano(v: boolean): string {
    return v ? '1' : '0'
  },

  ladoClaveBinaria(marca: string): string {
    return `CONVERT(varbinary(max), ${marca}, 2)`
  },

  explicar: explicarSqlServer,

  // SHOWPLAN no ejecuta nada: tras un fallo basta con releer el estado.
  revertirTrasFalloDeExplicar(): boolean {
    return false
  },

  esBloqueoAlLeer(codigo: string | undefined): boolean {
    return codigo === CODIGO_BLOQUEO_SQLSERVER
  }
}
