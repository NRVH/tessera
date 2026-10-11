// =============================================================================
// La sesión de MySQL y MariaDB en el main: `USE` para el esquema de la consola (en MySQL la base es el
// esquema), las columnas de `information_schema` para editar la rejilla, la UNIQUE NOT NULL de una
// tabla sin PK, `innodb_lock_wait_timeout` de «Enviar», `UNHEX` de una clave binaria y el EXPLAIN
// FORMAT=JSON. No es el trabajador (`src/tdb/sesionMysql.cjs`). No importa `./index.ts`.
// Decisiones: docs/decisiones/bd/motores-sesion-mysql.md
// =============================================================================

import type { DbPlan } from '../../../../shared/db-explorador-ipc.ts'
import type { ColumnaEdicion } from '../edicionRejilla.ts'
import { TOPE_PLAN_PG } from '../limites.ts'
import { AVISO_PLAN_RECORTADO, planDesdeJsonMysql, PREFIJO_EXPLICAR_MYSQL, sqlExplicarMysql } from '../planSql.ts'
import type { BindEntradaLob, ResultadoTrabajador } from '../protocoloTrabajador.ts'
import { noDisponible, texto } from './filasCatalogo.ts'
import { citarMysql } from './mapeoMysql.ts'
import type { ContextoExplicar, MarcasTablaEdicion, SesionExplorador } from './sesion.ts'
import { my } from './sqlMysql.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './tipos.ts'

/** Los tipos binarios de MySQL (sin el tamaño y en minúsculas). */
const BINARIOS = new Set(['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob'])
/** Los tipos espaciales: se leen como texto (WKT) pero no se escriben así. */
const ESPACIALES = new Set(['geometry', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon', 'geometrycollection', 'geomcollection'])

/**
 * Filas de `sqlColumnasEdicion`: `[nombre, COLUMN_TYPE, DATA_TYPE, EXTRA, expresión generada]`.
 * Lo que no se escribe y por qué: la generada, la binaria (como en PG), la de bits (su texto no es
 * su valor) y la espacial.
 */
function columnaMysql(f: FilaCatalogo): ColumnaEdicion {
  const nombre = texto(f[0])
  const tipo = texto(f[1])
  const base = texto(f[2]).trim().toLowerCase()
  const generada = texto(f[4]).trim() !== '' || /\bGENERATED\b|\bVIRTUAL\b|\bPERSISTENT\b|\bSTORED\b/i.test(texto(f[3]))
  const binaria = BINARIOS.has(base)
  let noEditable: string | null = null
  if (generada) noEditable = 'Columna generada: la calcula el servidor.'
  else if (binaria) noEditable = 'Binaria: no se edita como texto.'
  else if (base === 'bit') noEditable = "BIT: se edita desde la consola (b'0101')."
  else if (ESPACIALES.has(base)) noEditable = 'Espacial: se edita desde la consola (ST_GeomFromText).'
  return { nombre, tipo, noEditable, binaria, lob: null, nacional: false, comparable: null }
}

/** `EXPLAIN FORMAT=JSON` (ver la cabecera): no ejecuta y un error suyo no deshace la transacción. */
async function explicarMysql(ctx: ContextoExplicar): Promise<DbPlan> {
  ctx.prefijo(PREFIJO_EXPLICAR_MYSQL)
  const r = await ctx.ejecutar(
    sqlExplicarMysql(ctx.texto),
    {
      proposito: 'usuario',
      maxFilas: 1,
      candadoRO: ctx.soloLectura,
      txManual: ctx.txManual(),
      // EXPLAIN sin ANALYZE no escribe: nunca abre una transacción.
      sinBegin: true,
      topeCelda: TOPE_PLAN_PG,
      topeRespuesta: TOPE_PLAN_PG * 2 + 1024
    },
    ctx.binds
  )
  ctx.prefijo(null)
  ctx.fijarTx(r.tx)
  return planDeResultado(ctx, r)
}

/** El plan (nodos, texto y tiempos) a partir de lo que devolvió el EXPLAIN. */
function planDeResultado(ctx: ContextoExplicar, r: ResultadoTrabajador): DbPlan {
  if (r.tipo !== 'filas') throw ctx.error('interno', 'El servidor no devolvió el plan.')
  if (r.recortes && r.recortes.length > 0) throw ctx.error('limite', 'El plan es demasiado grande para enseñarlo.')
  const celda = (JSON.parse(r.filasJson) as unknown[][])[0]?.[0]
  let plan: ReturnType<typeof planDesdeJsonMysql>
  try {
    plan = planDesdeJsonMysql(typeof celda === 'string' ? celda : JSON.stringify(celda))
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

export const SESION_MYSQL: SesionExplorador = {
  motor: 'mysql',

  // En MySQL la «posición» de la sesión es la BASE: `USE`. `null` vuelve a la de la conexión;
  // sin ella no hay forma de quedarse sin base, y la sesión sigue donde esté.
  sqlFijarEsquema(esquema: string | null, esquemaConexion: string | null): ConsultaCatalogo | null {
    const destino = esquema ?? esquemaConexion
    return destino ? my([`USE ${citarMysql(destino)}`]) : null
  },

  sqlLeerEsquema(): ConsultaCatalogo {
    return my(['SELECT DATABASE()'])
  },

  // 1049: la base no existe; 1044: sin permiso sobre ella (para el usuario, lo mismo: no está).
  esquemaInexistente(codigo: string | null): boolean {
    return codigo === '1049' || codigo === '1044'
  },

  mensajeEsquemaNoAplicado(esquema: string): string {
    return `No se puede usar la base ${esquema} en esta conexión: no existe o no tienes permiso sobre ella.`
  },

  // MySQL no guarda errores de compilación: un CREATE con errores falla en el acto.
  sqlErroresCompilacion(): ConsultaCatalogo | null {
    return null
  },

  sqlColumnasEdicion(_versionMayor: number, esquema: string, objeto: string): ConsultaCatalogo {
    return my(
      [
        'SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, EXTRA, GENERATION_EXPRESSION',
        '  FROM information_schema.COLUMNS',
        ' WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        ' ORDER BY ORDINAL_POSITION'
      ],
      [esquema, objeto]
    )
  },

  // Una fila sin PK se identifica por un índice ÚNICO con todas sus columnas NOT NULL (y sin
  // partes funcionales): con una que admita NULL, dos filas pueden compartir el valor. El más
  // corto primero; dentro de cada uno, sus columnas en orden.
  sqlUnicaNoNula(esquema: string, objeto: string): ConsultaCatalogo {
    return my(
      [
        'SELECT s.INDEX_NAME, s.COLUMN_NAME',
        '  FROM information_schema.STATISTICS s',
        " WHERE s.TABLE_SCHEMA = ? AND s.TABLE_NAME = ? AND s.NON_UNIQUE = 0 AND s.INDEX_NAME <> 'PRIMARY'",
        '   AND NOT EXISTS (',
        '     SELECT 1 FROM information_schema.STATISTICS s2',
        '       LEFT JOIN information_schema.COLUMNS c',
        '         ON c.TABLE_SCHEMA = s2.TABLE_SCHEMA AND c.TABLE_NAME = s2.TABLE_NAME AND c.COLUMN_NAME = s2.COLUMN_NAME',
        '      WHERE s2.TABLE_SCHEMA = s.TABLE_SCHEMA AND s2.TABLE_NAME = s.TABLE_NAME AND s2.INDEX_NAME = s.INDEX_NAME',
        "        AND (s2.COLUMN_NAME IS NULL OR c.IS_NULLABLE <> 'NO'))",
        ' ORDER BY (SELECT COUNT(*) FROM information_schema.STATISTICS s3',
        '            WHERE s3.TABLE_SCHEMA = s.TABLE_SCHEMA AND s3.TABLE_NAME = s.TABLE_NAME AND s3.INDEX_NAME = s.INDEX_NAME),',
        '          s.INDEX_NAME, s.SEQ_IN_INDEX'
      ],
      [esquema, objeto]
    )
  },

  // MySQL no tiene una dirección de fila estable: no se le pide nunca (`identidadSinPk`).
  sqlColumnaRowid(): string {
    return noDisponible('mysql', 'ROWID')
  },

  // Las tablas TEMPORARY no salen en `information_schema`: ninguna marca que leer.
  marcasTablaEdicion(): MarcasTablaEdicion {
    return { temporal: false, externa: false, mantenidaPorOracle: false }
  },

  columnaEdicion: columnaMysql,

  // La clave binaria viaja en hexadecimal y la convierte `UNHEX` (`ladoClaveBinaria`).
  bindClaveBinaria(hex: string): string {
    return hex
  },

  bindTextoEdicion(): BindEntradaLob | null {
    return null
  },

  // La espera de InnoDB a un bloqueo de fila es de la SESIÓN; la sesión de «Enviar» es efímera, así
  // que no se hereda. Al vencer, 1205.
  esperaBloqueo: {
    forma: 'porTransaccion',
    sqlTope(segundos: number): string {
      return `SET SESSION innodb_lock_wait_timeout = ${Math.max(1, Math.floor(segundos))}`
    },
    codigoVencida: '1205'
  },

  esTipoBinario(tipo: string): boolean {
    return BINARIOS.has(tipo.replace(/\(.*$/, '').trim().toLowerCase())
  },

  bindBooleano(v: boolean): string {
    return v ? '1' : '0'
  },

  ladoClaveBinaria(marca: string): string {
    return `UNHEX(${marca})`
  },

  explicar: explicarMysql,

  // Un error de MySQL no deshace la transacción ni la deja inservible: basta con releer su estado.
  revertirTrasFalloDeExplicar(): boolean {
    return false
  },

  // InnoDB lee sin esperar a un escritor (lectura consistente): ningún error de leer es «bloqueado».
  esBloqueoAlLeer(): boolean {
    return false
  }
}
