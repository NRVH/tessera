// =============================================================================
// La sesión de PostgreSQL en el main: `set_config('search_path', …)` y `RESET search_path`, las
// columnas de pg_attribute con su `relpersistence`, el `\x` de un bytea, `SET LOCAL lock_timeout`
// de «Enviar», `decode(…, 'hex')` del valor completo y el EXPLAIN con SAVEPOINT. No es el
// trabajador (`src/tdb/sesionPostgres.cjs`). No importa `./index.ts`; de `edicionRejilla.ts` solo tipos.
// Decisiones: docs/decisiones/bd/sesiones-por-motor.md,docs/decisiones/bd/motores-explicar.md
// =============================================================================

import type { DbPlan } from '../../../../shared/db-explorador-ipc.ts'
import { citar } from '../../../../shared/sql/identificadoresSql.ts'
import type { ColumnaEdicion } from '../edicionRejilla.ts'
import { TOPE_PLAN_PG } from '../limites.ts'
import {
  AVISO_PLAN_RECORTADO,
  planDesdeJsonPg,
  PREFIJO_EXPLICAR_PG,
  SQL_PUNTO_PG,
  SQL_SOLTAR_PUNTO_PG,
  SQL_VOLVER_AL_PUNTO_PG,
  sqlExplicarPg
} from '../planSql.ts'
import { esFalloTrabajador, type BindEntradaLob, type OpcionesEjecucion, type ResultadoTrabajador } from '../protocoloTrabajador.ts'
import { noDisponible, texto } from './filasCatalogo.ts'
import type { ContextoExplicar, MarcasTablaEdicion, SesionExplorador } from './sesion.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './tipos.ts'

/**
 * Valor de `search_path` para un esquema elegido. Se CONSERVA `public` detrás del elegido:
 * es donde viven las extensiones (uuid-ossp, pgcrypto, PostGIS…). El porqué entero, en la
 * cabecera de `consolaSql.ts`.
 */
export function searchPathDe(esquema: string): string {
  return esquema === 'public' ? 'public' : `${citar(esquema)}, public`
}

/**
 * Filas de `sqlColumnasEdicion`: `[attname, format_type, tipo_base, attgenerated,
 * attidentity, relpersistence]` (externa no existe en PG: las foráneas son otro tipo de
 * objeto).
 */
function columnaPg(f: FilaCatalogo): ColumnaEdicion {
  const nombre = texto(f[0])
  const tipo = texto(f[1])
  const base = texto(f[2]).trim().toLowerCase()
  const generada = texto(f[3]).trim()
  const identidad = texto(f[4]).trim()
  const binaria = base === 'bytea'
  let noEditable: string | null = null
  if (generada !== '') noEditable = 'Columna generada: la calcula PostgreSQL.'
  else if (identidad === 'a') noEditable = 'Identidad GENERATED ALWAYS: la numera PostgreSQL.'
  else if (binaria) noEditable = 'Binaria: no se edita como texto.'
  // PG nunca se identifica por 'rowid' (la PK o la UNIQUE NOT NULL encuentran la fila por
  // su valor), así que sus originales no se usan: nada que decidir aquí.
  return { nombre, tipo, noEditable, binaria, lob: null, nacional: false, comparable: null }
}

// --- El EXPLAIN y su punto de guardado ------------------------------------------------------

/**
 * Una sentencia del punto de guardado del Explain: SQL fijo de Tessera, sin candado ni
 * BEGIN, y `catalogo`, así que un Stop no la corta (el trabajador solo cancela lo del
 * usuario) y no cuenta como sentencia.
 */
function sentenciaPunto(ctx: ContextoExplicar, sql: string, comprobarTx: boolean): Promise<ResultadoTrabajador> {
  return ctx.ejecutar(sql, { proposito: 'catalogo', maxFilas: 1, candadoRO: false, sinBegin: true, comprobarTx })
}

/**
 * SAVEPOINT antes del EXPLAIN. false si resulta que ya no había transacción (25P01: el
 * estado que conoce el main iba por detrás del servidor): sin transacción no hay nada que
 * proteger y el EXPLAIN va como siempre. Cualquier otro error sube (una transacción ya
 * fallida da 25P02, lo mismo que habría dado el EXPLAIN).
 */
async function ponerPunto(ctx: ContextoExplicar): Promise<boolean> {
  try {
    await sentenciaPunto(ctx, SQL_PUNTO_PG, false)
    return true
  } catch (e) {
    if (esFalloTrabajador(e) && e.error.codigo === '25P01') return false
    throw e
  }
}

/**
 * Cierra el punto del Explain: RELEASE y, si el EXPLAIN falló, antes ROLLBACK TO, que saca
 * a la transacción del estado abortado y la deja como estaba antes del SAVEPOINT (el
 * EXPLAIN no hizo nada que perder). Un 57014 aquí es un Stop que llegó tarde, como el que
 * el trabajador reintenta en el ROLLBACK de su envoltorio: el punto sigue vivo (el RELEASE
 * no llegó a hacerse), así que se repite UNA vez con ROLLBACK TO + RELEASE. Tras un EXPLAIN
 * que salió bien, el RELEASE lee el estado EXACTO de la transacción (el SAVEPOINT no asigna
 * xid: `abierta` sigue `abierta`).
 */
async function soltarPunto(ctx: ContextoExplicar, fallo: boolean): Promise<ResultadoTrabajador> {
  const soltar = async (volver: boolean): Promise<ResultadoTrabajador> => {
    if (volver) await sentenciaPunto(ctx, SQL_VOLVER_AL_PUNTO_PG, false)
    return sentenciaPunto(ctx, SQL_SOLTAR_PUNTO_PG, !fallo)
  }
  try {
    return await soltar(fallo)
  } catch (e) {
    if (esFalloTrabajador(e) && e.error.codigo === '57014') return soltar(true)
    throw e
  }
}

/**
 * `EXPLAIN (FORMAT JSON)` sin ANALYZE (ver también la cabecera de `planSql.ts`). Era la
 * rama de PG de `correrExplicar` (hoy en `sesiones/explicar.ts`), con el mismo orden de operaciones (y con
 * su porqué, que se había quedado en el gestor):
 *   - Con una transacción abierta del usuario (Manual con algo hecho, o un BEGIN a mano en
 *     Auto) va entre SAVEPOINT y RELEASE (ROLLBACK TO si falla o se para): en PG un error
 *     aborta la transacción ENTERA, y un Explain no puede llevarse lo pendiente. El estado
 *     es el que dejó la última operación; si iba por detrás y ya no hay transacción, el
 *     SAVEPOINT lo dice (25P01) y se sigue sin él.
 *   - En solo lectura no hay transacción del usuario: va dentro del envoltorio BEGIN READ
 *     ONLY … ROLLBACK de siempre, que ya lo aísla.
 *   - Nunca abre un BEGIN (sin ANALYZE no escribe nada), y lleva sus binds: el
 *     planificador usa los valores, así que se exigen (`explainPideValores`).
 *   - El JSON de un plan grande pasa de los 64 Ki de una celda de la rejilla: topes propios.
 */
async function explicarPg(ctx: ContextoExplicar): Promise<DbPlan> {
  const estado = ctx.estadoTx()
  const punto = !ctx.soloLectura && (estado === 'abierta' || estado === 'pendiente') && (await ponerPunto(ctx))
  ctx.prefijo(PREFIJO_EXPLICAR_PG)
  // Cada viaje se espera aquí, en el cuerpo: en una función `async` aparte sumaría turnos.
  let r: ResultadoTrabajador
  try {
    r = await ctx.ejecutar(sqlExplicarPg(ctx.texto), opcionesExplicarPg(ctx, punto), ctx.binds)
  } catch (e) {
    // Error, Stop o statement_timeout: la transacción vuelve a como estaba antes del
    // SAVEPOINT. Con la sesión perdida o el proceso colgado no hay nada que hacer.
    const sesionSigue = !(esFalloTrabajador(e) && (e.error.clase === 'perdida' || e.error.codigo === 'TESSERA-PLAZO'))
    if (punto && sesionSigue) {
      try {
        await soltarPunto(ctx, true)
      } catch {
        // El error que se enseña es el del EXPLAIN; el gestor relee el estado real, que
        // dirá `fallida` si esto no pudo arreglarlo.
      }
    }
    throw e
  }
  ctx.prefijo(null)
  ctx.fijarTx(punto ? (await soltarPunto(ctx, false)).tx : r.tx)
  return planDeResultadoPg(ctx, r)
}

/** Las opciones del EXPLAIN (sin ANALYZE: nunca abre una transacción) y los topes de su JSON. */
function opcionesExplicarPg(ctx: ContextoExplicar, punto: boolean): OpcionesEjecucion {
  return {
    proposito: 'usuario',
    maxFilas: 1,
    candadoRO: ctx.soloLectura,
    txManual: ctx.txManual(),
    // EXPLAIN sin ANALYZE no escribe: nunca abre una transacción.
    sinBegin: true,
    // Con el punto, el estado exacto lo da el RELEASE (un viaje menos).
    comprobarTx: !punto,
    topeCelda: TOPE_PLAN_PG,
    topeRespuesta: TOPE_PLAN_PG * 2 + 1024
  }
}

/** El plan (nodos, texto y tiempos) a partir de lo que devolvió el EXPLAIN. */
function planDeResultadoPg(ctx: ContextoExplicar, r: ResultadoTrabajador): DbPlan {
  if (r.tipo !== 'filas') throw ctx.error('interno', 'El servidor no devolvió el plan.')
  if (r.recortes && r.recortes.length > 0) throw ctx.error('limite', 'El plan es demasiado grande para enseñarlo.')
  const celda = (JSON.parse(r.filasJson) as unknown[][])[0]?.[0]
  let plan: ReturnType<typeof planDesdeJsonPg>
  try {
    plan = planDesdeJsonPg(typeof celda === 'string' ? celda : JSON.stringify(celda))
  } catch {
    throw ctx.error('interno', 'El servidor devolvió un plan que Tessera no entiende.')
  }
  const valor: DbPlan = {
    nodos: plan.nodos,
    texto: plan.texto,
    tiempos: { totalMs: Date.now() - ctx.t0, ejecucionMs: r.msEjecucion, lecturaMs: r.msLectura }
  }
  if (plan.recortado) valor.avisos = [AVISO_PLAN_RECORTADO]
  return valor
}

export const SESION_POSTGRES: SesionExplorador = {
  motor: 'postgres',

  // `null` = `RESET search_path`: el valor con el que abrió la sesión (el de
  // `postgresql.conf`, la base o el rol), no uno inventado por Tessera. PG no necesita
  // recordar el de la conexión.
  sqlFijarEsquema(esquema: string | null): ConsultaCatalogo | null {
    if (esquema === null) return { sql: 'RESET search_path', binds: [] }
    return { sql: "SELECT set_config('search_path', $1, false)", binds: [searchPathDe(esquema)] }
  },

  sqlLeerEsquema(): ConsultaCatalogo {
    return { sql: 'SELECT current_schema()', binds: [] }
  },

  // `set_config` acepta cualquier nombre: ningún error dice que el esquema no existe (la
  // señal es que `current_schema()` lo salte, y la mira `trasReaplicarEsquema`).
  esquemaInexistente(): boolean {
    return false
  },

  // PG salta del `search_path` un esquema que no existe, pero también uno sin USAGE (el
  // catálogo los lista igual): el mensaje no afirma que no exista.
  mensajeEsquemaNoAplicado(esquema: string): string {
    return `No se puede usar el esquema ${esquema} en esta conexión: no existe o no tienes permiso de uso (USAGE) sobre él.`
  },

  // PG no deja una unidad «creada con errores»: lo que ve su validador (la sintaxis del
  // cuerpo, con `check_function_bodies`) hace FALLAR el CREATE en el acto, con su error y
  // su posición, que la consola ya enseña; lo demás sale al ejecutarla. No guarda errores
  // de compilación que leer después.
  sqlErroresCompilacion(): ConsultaCatalogo | null {
    return null
  },

  sqlColumnasEdicion(_versionMayor: number, esquema: string, objeto: string): ConsultaCatalogo {
    return {
      sql: [
        'SELECT a.attname, format_type(a.atttypid, a.atttypmod),',
        "       CASE WHEN t.typtype = 'd' THEN format_type(t.typbasetype, NULL) ELSE t.typname END,",
        '       a.attgenerated::text, a.attidentity::text, c.relpersistence::text',
        '  FROM pg_attribute a',
        '  JOIN pg_class c ON c.oid = a.attrelid',
        '  JOIN pg_namespace n ON n.oid = c.relnamespace',
        '  JOIN pg_type t ON t.oid = a.atttypid',
        ' WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped',
        ' ORDER BY a.attnum'
      ].join('\n'),
      binds: [esquema, objeto]
    }
  },

  // Una fila sin PK de PG se identifica por una UNIQUE con TODAS sus columnas NOT NULL
  // (`identidadSinPk: 'unicaNoNula'`): con una columna que admita NULL, dos filas pueden
  // compartir el valor y un UPDATE tocaría las dos. La más corta primero, y dentro de cada
  // restricción sus columnas en el orden en que se declaró. Mudada TAL CUAL desde
  // `edicionRejilla.ts`: mismo SQL al byte.
  sqlUnicaNoNula(esquema: string, objeto: string): ConsultaCatalogo {
    return {
      sql: [
        'SELECT k.conname, a.attname',
        '  FROM pg_constraint k',
        '  JOIN pg_class c ON c.oid = k.conrelid',
        '  JOIN pg_namespace n ON n.oid = c.relnamespace',
        '  JOIN LATERAL unnest(k.conkey) WITH ORDINALITY AS u(num, orden) ON true',
        '  JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.num',
        " WHERE n.nspname = $1 AND c.relname = $2 AND k.contype = 'u'",
        '   AND NOT EXISTS (',
        '     SELECT 1 FROM unnest(k.conkey) AS x(num)',
        '       JOIN pg_attribute b ON b.attrelid = k.conrelid AND b.attnum = x.num',
        '      WHERE NOT b.attnotnull)',
        ' ORDER BY cardinality(k.conkey), k.conname, u.orden'
      ].join('\n'),
      binds: [esquema, objeto]
    }
  },

  // PG no tiene ROWID (su `ctid` cambia con cada UPDATE y un VACUUM FULL: no identifica
  // una fila entre la lectura y el envío). No se le pide nunca: la rejilla rechaza antes
  // `rowid: true` con `mensajeSinRowid`.
  sqlColumnaRowid(): string {
    return noDisponible('postgres', 'ROWID')
  },

  marcasTablaEdicion(primera: FilaCatalogo | undefined): MarcasTablaEdicion {
    // relpersistence 't' = TEMP. Ni tablas externas ni cuentas que mantenga el motor.
    const temporal = primera !== undefined && texto(primera[5]).trim() === 't'
    return { temporal, externa: false, mantenidaPorOracle: false }
  },

  columnaEdicion: columnaPg,

  // La forma de entrada de un bytea: '\x…'.
  bindClaveBinaria(hex: string): string {
    return '\\x' + hex
  },

  // En PG todo tipo tiene entrada de texto: ni LOB ni juego nacional.
  bindTextoEdicion(): BindEntradaLob | null {
    return null
  },

  // `SET LOCAL`: vale hasta el COMMIT o el ROLLBACK, cubre TODAS las sentencias de la
  // transacción (también el INSERT) y la sesión efímera no hereda nada. Al vencer, 55P03.
  esperaBloqueo: {
    forma: 'porTransaccion',
    sqlTope(segundos: number): string {
      return `SET LOCAL lock_timeout = '${segundos}s'`
    },
    codigoVencida: '55P03'
  },

  esTipoBinario(tipo: string): boolean {
    return tipo === 'BYTEA'
  },

  bindBooleano(v: boolean): string {
    return v ? 'true' : 'false'
  },

  ladoClaveBinaria(marca: string): string {
    return `decode(${marca}, 'hex')`
  },

  explicar: explicarPg,

  // El envoltorio (solo lectura) o el punto de guardado ya aislaron el EXPLAIN: basta con
  // releer el estado real de la transacción.
  revertirTrasFalloDeExplicar(): boolean {
    return false
  },

  // En PG (MVCC) un lector no espera nunca a un escritor: ningún error de
  // leer es «bloqueado».
  esBloqueoAlLeer(): boolean {
    return false
  }
}
