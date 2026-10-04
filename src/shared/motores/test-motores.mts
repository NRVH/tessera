#!/usr/bin/env node
// =============================================================================
// Prueba del DESCRIPTOR POR MOTOR (node src/shared/motores/test-motores.mts). Cada capacidad vale lo
// que declara su motor: registro e invariante dialecto = motor, valores por motor en una tabla que
// hay que ampliar al sumar uno, `validarDestino`, `destinoLegible`, motor desconocido, familias,
// SQLite, SQL Server y MongoDB, y la neutralidad de lo compartido (ES2020, `db-ipc.ts` es una hoja).
// No importa nada del main: `tsconfig.web.json` compila `src/shared/**`, tests incluidos.
// Decisiones: docs/decisiones/bd/registro-motores-descriptor.md
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IDS_MOTORES,
  IDS_MOTORES_SQL,
  MOTORES,
  candadoSoloLecturaDe,
  descriptor,
  descriptorSql,
  destinoLegible,
  esMotor,
  esMotorSql,
  etiquetaMotor,
  etiquetasDonde,
  etiquetasSqlDonde,
  familiaDe,
  listaLegible,
  pideDominio,
  pideUsuarioYClave,
  porMotor,
  porMotorSql,
  tieneFormaDelMotor,
  tieneNivelBases,
  usaOpcional,
  autenticacionDe,
  esAutenticacion,
  type CapacidadesSql,
  type DeclaracionMotor,
  type DescriptorSql,
  type DestinoConexion,
  type FormaDestino
} from './index.ts'
import { definirMotor } from './definir.ts'
import { ESQUEMAS_SISTEMA_ORACLE, esEsquemaSistemaOracle } from './oracle.ts'
import { destinoDeRed, destinoDeRedUsuarioOpcional } from './destinoRed.ts'
import { claveDeNombre, mismoNombre, normalizarIdent, plegarSinComillas } from '../sql/identificadoresSql.ts'
import type { DbMotor, DbMotorSql } from '../db-ipc.ts'
import type { DbTipoObjeto } from '../db-explorador-ipc.ts'
import { REGLAS, dialectoDeMotor, marcadorPosicional, reglasDeMotor, type DialectoSql } from '../sql/dialectosSql.ts'
import { nunca } from '../nunca.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) console.log(`      -> ${evidence}`)
}
const j = (x: unknown): string => JSON.stringify(x)
const igual = (a: unknown, b: unknown): boolean => j(a) === j(b)
function lanza(f: () => unknown): string | null {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

const motores = Object.keys(MOTORES) as DbMotor[]
/** Los motores SQL: los únicos con `sql`, `catalogo`, `sesion` y fila de `REGLAS`. */
const motoresSql: readonly DbMotorSql[] = IDS_MOTORES_SQL

/**
 * Las banderas léxicas de SQLite con el valor que tienen en Oracle y PG: el de lo que su
 * léxico hace HOY (ninguno de los dos las tiene). Si una cambia, hay que decidirlo aquí.
 */
const SIN_BANDERAS_PASO_2: Record<string, unknown> = {
  identCorchetes: false,
  identAcentoGrave: false,
  bindInterrogacion: false,
  bindArroba: false,
  bindDolarNombre: false,
  triggerBeginEnd: false,
  hex0x: false,
  pragmas: null
}

/**
 * Las banderas de SQL Server con el valor que tienen en Oracle, PG y SQLite: el
 * de lo que su léxico hace HOY (ninguno las tiene). Si una cambia, hay que decidirlo aquí.
 */
const SIN_BANDERAS_PASO_3: Record<string, unknown> = {
  corcheteEscapeDoble: false,
  cadenaNacional: false,
  almohadillaInicial: false,
  variablesArroba: false,
  literalDinero: false,
  numerosTsql: false,
  separadorLote: null,
  hastaSeparadorLote: [],
  sinSeparadorSeEjecutanJuntas: false,
  conservaPuntoYComaFinal: false,
  clausulaOutput: false
}

// ---------------------------------------------------------------------------
// Los VALORES DE HOY: lo que decidía la rama de cada motor antes del descriptor. Al sumar
// un motor, su fila va aquí; si falta, (2) falla.
// ---------------------------------------------------------------------------
interface ValoresHoy {
  etiqueta: string
  puerto: number | null
  obligatorios: string[]
  /** derivados (`forma`, `deArchivo`) y declarados nuevos. */
  forma: string[]
  deArchivo: boolean
  extensionesArchivo: string[]
  credenciales: string
  soloLecturaPorDefecto: boolean
  excluyentes: Array<{ campos: string[]; alMenosUno: boolean; siNinguno: string; siVarios: string }>
  descartarAlGuardar: string[]
  usaClientes: boolean
  dialecto: DialectoSql
  lenguajeConsola: string
  lenguajeFuente: string
  formateador: unknown
  carpetas: DbTipoObjeto[]
  pseudoEsquemaPublico: string | null
  esquemaImplicito: string | null
  tieneSinonimos: boolean
  tieneDblinks: boolean
  sesion: unknown
}

const HOY: Record<DbMotorSql, ValoresHoy> = {
  oracle: {
    etiqueta: 'Oracle',
    puerto: 1521,
    obligatorios: ['alias', 'host', 'port', 'user'],
    forma: ['host', 'port'],
    deArchivo: false,
    extensionesArchivo: [],
    credenciales: 'usuarioClave',
    soloLecturaPorDefecto: true,
    excluyentes: [
      {
        campos: ['database', 'sid'],
        alMenosUno: true,
        siNinguno: 'Oracle necesita un Service Name o un SID.',
        siVarios: 'Indica Service Name O SID, no ambos.'
      }
    ],
    descartarAlGuardar: [],
    usaClientes: true,
    dialecto: 'oracle',
    lenguajeConsola: 'tessera-oracle-sql',
    lenguajeFuente: 'sql',
    formateador: { dialecto: 'plsql', parametros: { numbered: [':'], named: [':'], quoted: [':'] } },
    carpetas: ['tabla', 'vista', 'vistaMaterializada', 'rutina', 'paquete', 'secuencia', 'sinonimo', 'tipoObjeto', 'tipoColeccion', 'disparador'],
    pseudoEsquemaPublico: 'PUBLIC',
    esquemaImplicito: null,
    tieneSinonimos: true,
    tieneDblinks: true,
    sesion: {
      versionMinima: 11,
      paginado: { rejilla: 'cursor', relectura: 'rownum', admitidas: ['cursor', 'rownum'] },
      paginasInestablesSinOrden: false,
      lectorPorId: true,
      mantenerCursor: false,
      candadoSoloLectura: 'transaccionSoloLectura',
      esquemaTransaccional: false,
      fijarEsquemaValida: true,
      salidaServidorSiempre: false,
      explainPideValores: false,
      ddlConfirmaImplicito: true,
      rutinasConfirmanPorDentro: true,
      identidadSinPk: 'rowid',
      procesoPorSesion: false
    }
  },
  postgres: {
    etiqueta: 'PostgreSQL',
    puerto: 5432,
    obligatorios: ['alias', 'host', 'port', 'database', 'user'],
    forma: ['host', 'port'],
    deArchivo: false,
    extensionesArchivo: [],
    credenciales: 'usuarioClave',
    soloLecturaPorDefecto: true,
    excluyentes: [],
    descartarAlGuardar: ['sid'],
    usaClientes: false,
    dialecto: 'postgres',
    lenguajeConsola: 'pgsql',
    lenguajeFuente: 'pgsql',
    formateador: { dialecto: 'postgresql', parametros: null },
    carpetas: ['tabla', 'vista', 'vistaMaterializada', 'tablaForanea', 'rutina', 'secuencia', 'tipo'],
    pseudoEsquemaPublico: null,
    esquemaImplicito: 'public',
    tieneSinonimos: false,
    tieneDblinks: false,
    sesion: {
      versionMinima: 12,
      paginado: { rejilla: 'limitOffset', relectura: 'limitOffset', admitidas: ['limitOffset'] },
      paginasInestablesSinOrden: true,
      lectorPorId: false,
      mantenerCursor: true,
      candadoSoloLectura: 'envoltorioRollback',
      esquemaTransaccional: true,
      fijarEsquemaValida: false,
      salidaServidorSiempre: true,
      explainPideValores: true,
      ddlConfirmaImplicito: false,
      rutinasConfirmanPorDentro: false,
      identidadSinPk: 'unicaNoNula',
      procesoPorSesion: false
    }
  },
  // no son valores «de antes» (el motor es nuevo), sino los que SQLite declara; se
  // fijan aquí para que cambiar uno sea una decisión que se ve en el diff del test.
  sqlite: {
    etiqueta: 'SQLite',
    puerto: null,
    obligatorios: ['alias', 'archivo'],
    forma: ['archivo'],
    deArchivo: true,
    extensionesArchivo: ['db', 'sqlite', 'sqlite3', 'db3', 's3db', 'sl3'],
    credenciales: 'ninguna',
    soloLecturaPorDefecto: true,
    excluyentes: [],
    descartarAlGuardar: ['host', 'database', 'sid'],
    usaClientes: false,
    dialecto: 'sqlite',
    lenguajeConsola: 'tessera-sqlite-sql',
    lenguajeFuente: 'sql',
    formateador: { dialecto: 'sqlite', parametros: null },
    carpetas: ['tabla', 'vista', 'tablaVirtual'],
    pseudoEsquemaPublico: null,
    esquemaImplicito: 'main',
    tieneSinonimos: false,
    tieneDblinks: false,
    sesion: {
      versionMinima: 3,
      paginado: { rejilla: 'keyset', relectura: 'keyset', admitidas: ['keyset', 'limitOffset'] },
      paginasInestablesSinOrden: true,
      lectorPorId: false,
      mantenerCursor: false,
      candadoSoloLectura: 'autorizador',
      esquemaTransaccional: false,
      fijarEsquemaValida: true,
      salidaServidorSiempre: true,
      explainPideValores: false,
      ddlConfirmaImplicito: false,
      rutinasConfirmanPorDentro: false,
      identidadSinPk: 'rowid',
      procesoPorSesion: true
    }
  },
  // lo que SQL Server declara (el porqué de cada uno, en `sqlserver.ts`).
  sqlserver: {
    etiqueta: 'SQL Server',
    puerto: 1433,
    obligatorios: ['alias', 'host', 'port', 'user'],
    forma: ['host', 'port'],
    deArchivo: false,
    extensionesArchivo: [],
    credenciales: 'usuarioClave',
    soloLecturaPorDefecto: true,
    excluyentes: [],
    descartarAlGuardar: ['sid'],
    usaClientes: false,
    dialecto: 'sqlserver',
    lenguajeConsola: 'sql',
    lenguajeFuente: 'sql',
    formateador: { dialecto: 'transactsql', parametros: null },
    carpetas: ['tabla', 'vista', 'rutina', 'sinonimo', 'secuencia', 'tipo'],
    pseudoEsquemaPublico: null,
    esquemaImplicito: 'dbo',
    tieneSinonimos: true,
    tieneDblinks: false,
    sesion: {
      versionMinima: 11,
      paginado: { rejilla: 'offsetFetch', relectura: 'offsetFetch', admitidas: ['offsetFetch'] },
      paginasInestablesSinOrden: true,
      lectorPorId: false,
      mantenerCursor: false,
      candadoSoloLectura: 'clasificadorYEnvoltorio',
      esquemaTransaccional: false,
      fijarEsquemaValida: true,
      salidaServidorSiempre: true,
      explainPideValores: false,
      ddlConfirmaImplicito: false,
      rutinasConfirmanPorDentro: true,
      identidadSinPk: 'unicaNoNula',
      procesoPorSesion: false
    }
  }
}

/**
 * Los motores de las OTRAS familias: lo común (identidad y conexión) y el
 * grupo de SU familia, entero. No son valores «de antes» (los motores son nuevos) sino los que
 * declaran (el porqué de cada uno, en `mongodb.ts` y `redis.ts`); se fijan aquí para que
 * cambiar uno sea una decisión que se vea en el diff del test. La clave es `Exclude<DbMotor,
 * DbMotorSql>`: un motor nuevo de otra familia no compila hasta tener su fila.
 */
interface ValoresOtraFamilia {
  familia: 'documentos' | 'claves'
  etiqueta: string
  puerto: number | null
  obligatorios: string[]
  opcionales: string[]
  forma: string[]
  deArchivo: boolean
  extensionesArchivo: string[]
  credenciales: string
  soloLecturaPorDefecto: boolean
  excluyentes: unknown[]
  descartarAlGuardar: string[]
  usaClientes: boolean
  /** El grupo de su familia (`documentos` o `claves`), entero. */
  grupo: Record<string, unknown>
}

const OTRAS_FAMILIAS: Record<Exclude<DbMotor, DbMotorSql>, ValoresOtraFamilia> = {
  mongodb: {
    familia: 'documentos',
    etiqueta: 'MongoDB',
    puerto: 27017,
    obligatorios: ['alias', 'host', 'port'],
    opcionales: ['user', 'database', 'tls', 'srv', 'opcionesUri'],
    forma: ['host', 'port'],
    deArchivo: false,
    extensionesArchivo: [],
    credenciales: 'usuarioClave',
    soloLecturaPorDefecto: true,
    excluyentes: [],
    descartarAlGuardar: ['sid'],
    usaClientes: false,
    grupo: { nivelBases: 'sinBaseFija', candadoSoloLectura: 'listaBlanca' }
  },
  redis: {
    familia: 'claves',
    etiqueta: 'Redis',
    puerto: 6379,
    obligatorios: ['alias', 'host', 'port'],
    // + 'tls' (`rediss://`), sin cifrar por defecto.
    opcionales: ['user', 'database', 'tls'],
    forma: ['host', 'port'],
    deArchivo: false,
    extensionesArchivo: [],
    credenciales: 'usuarioClave',
    soloLecturaPorDefecto: true,
    excluyentes: [],
    descartarAlGuardar: ['sid'],
    usaClientes: false,
    grupo: { basesPorDefecto: 16, candadoSoloLectura: 'listaBlanca' }
  }
}

/** `ConnectionStore.validate` ANTES del descriptor: la parte que dependía del motor, tal cual. */
function validarDeAntes(motor: string, database: string, sid: string): string | null {
  if (motor === 'oracle' && !database && !sid) return 'Oracle necesita un Service Name o un SID.'
  if (motor === 'oracle' && database && sid) return 'Indica Service Name O SID, no ambos.'
  if (motor === 'postgres' && !database) return 'PostgreSQL necesita el nombre de la base.'
  return null
}

/** Las CINCO copias de «destino legible» de antes del descriptor, con su expresión tal cual. */
const COPIAS: Array<{ donde: string; forma: FormaDestino; f: (c: DestinoConexion) => string }> = [
  {
    // src/renderer/src/features/bd/filasArbolBd.ts, `destinoConexion`
    donde: 'filasArbolBd.destinoConexion',
    forma: 'conUsuario',
    f: (c) => {
      const base = `${c.user}@${c.host}:${c.port}`
      if (c.database) return `${base}/${c.database}`
      if (c.sid) return `${base} (SID ${c.sid})`
      return base
    }
  },
  {
    // src/main/db/agentMemoryBlock.ts, `bloqueEspacioDatos`
    donde: 'agentMemoryBlock',
    forma: 'completo',
    f: (c) => `${c.host}:${c.port}${c.database ? `/${c.database}` : c.sid ? ` (SID ${c.sid})` : ''}`
  },
  {
    // src/main/db/briefingAgente.ts, `briefingBasesAgente`
    donde: 'briefingAgente',
    forma: 'completo',
    f: (c) => `${c.host}:${c.port}${c.database ? `/${c.database}` : c.sid ? ` (SID ${c.sid})` : ''}`
  },
  {
    // src/tdb/tdb.cjs, columna DESTINO de `tdb ls`
    donde: 'tdb ls',
    forma: 'ls',
    f: (c) => `${c.host}:${c.port}/${c.database || c.sid || ''}`
  },
  {
    // src/renderer/src/features/agentes/AgentTerminalPane.tsx, `{c.motor} · {c.host}`
    donde: 'AgentTerminalPane (tras el motor)',
    forma: 'breve',
    f: (c) => `${c.host}`
  }
]

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) El registro')
  check(
    'las claves de MOTORES son oracle, postgres, sqlite, sqlserver, mongodb y redis, en ese orden (el del selector)',
    igual(motores, ['oracle', 'postgres', 'sqlite', 'sqlserver', 'mongodb', 'redis']),
    j(motores)
  )
  check('IDS_MOTORES es Object.keys(MOTORES)', igual(IDS_MOTORES, motores), j(IDS_MOTORES))
  for (const m of motores) {
    const d = MOTORES[m]
    check(`${m}: el id del descriptor es su clave`, d.id === m, d.id)
    check(`${m}: descriptor(m) es MOTORES[m]`, descriptor(m) === d, '')
    // `familia` se quitó porque nadie la leía y VOLVIÓ con MongoDB y
    // Redis, su primer lector: la de cada motor es la de la unión de su id en `db-ipc.ts`.
    const familia = esMotorSql(m) ? 'sql' : OTRAS_FAMILIAS[m].familia
    check(`${m}: familia '${familia}' (la de la unión de su id), y familiaDe(m) la devuelve`, d.familia === familia && familiaDe(m) === familia, `${d.familia} · ${familiaDe(m)}`)
  }
  for (const m of motoresSql) {
    const d: DescriptorSql = MOTORES[m]
    // LA INVARIANTE: el dialecto de un motor SQL es su MISMO id.
    // Con ella, buscar las capacidades por dialecto o por motor da el mismo descriptor.
    check(`${m}: INVARIANTE dialecto = motor (sql.dialecto === '${m}')`, d.sql.dialecto === m, d.sql.dialecto)
    check(
      `${m}: descriptor(dialecto) es el descriptor del motor (las dos claves dan lo mismo)`,
      descriptor(d.sql.dialecto) === d,
      descriptor(d.sql.dialecto).id
    )
    // La espera de bloqueos es de la sesión del main (con su SQL): una copia aquí sería la
    // misma respuesta dos veces sin nada que las obligue a coincidir (ver tipos.ts).
    check(`${m}: sin \`sesion.esperaBloqueo\` (es de la sesión del main, con su SQL)`, !('esperaBloqueo' in d.sesion), Object.keys(d.sesion).join(','))
  }
  // Y desde el otro lado: cada fila de REGLAS es la de un motor SQL con su MISMO id, y cada
  // motor SQL tiene la suya. Un motor que reutilice la gramática de otro tiene SU fila.
  const filasReglas = Object.keys(REGLAS)
  check(
    'INVARIANTE: cada fila de REGLAS es la de un motor SQL de su mismo id',
    filasReglas.every((d) => esMotorSql(d) && MOTORES[d].sql.dialecto === d),
    j(filasReglas)
  )
  check('INVARIANTE: cada motor SQL tiene su propia fila de REGLAS', motoresSql.every((m) => filasReglas.indexOf(m) >= 0), j(filasReglas))
  check(
    'ningún motor de otra familia tiene fila de REGLAS (no tiene dialecto SQL)',
    motores.filter((m) => !esMotorSql(m)).every((m) => filasReglas.indexOf(m) < 0),
    j(filasReglas)
  )

  // -------------------------------------------------------------------------
  hr('(2) Los valores de hoy, motor a motor')
  check('la tabla HOY tiene exactamente los motores SQL del registro', igual(Object.keys(HOY).sort(), motoresSql.slice().sort()), j(Object.keys(HOY)))
  check(
    'HOY y OTRAS_FAMILIAS cubren entre las dos el registro, sin repetir ninguno',
    igual([...Object.keys(HOY), ...Object.keys(OTRAS_FAMILIAS)].sort(), motores.slice().sort()),
    j([...Object.keys(HOY), ...Object.keys(OTRAS_FAMILIAS)])
  )
  for (const m of motoresSql) {
    const d: DescriptorSql = MOTORES[m]
    const h = HOY[m]
    if (!h) continue
    const campos: Array<[string, unknown, unknown]> = [
      ['etiqueta', d.etiqueta, h.etiqueta],
      ['conexion.puertoPorDefecto', d.conexion.puertoPorDefecto, h.puerto],
      ['conexion.obligatorios', d.conexion.obligatorios, h.obligatorios],
      ['conexion.forma (derivada)', d.conexion.forma, h.forma],
      ['conexion.deArchivo (derivada)', d.conexion.deArchivo, h.deArchivo],
      ['conexion.extensionesArchivo', d.conexion.extensionesArchivo, h.extensionesArchivo],
      ['conexion.credenciales', d.conexion.credenciales, h.credenciales],
      ['conexion.soloLecturaPorDefecto', d.conexion.soloLecturaPorDefecto, h.soloLecturaPorDefecto],
      ['conexion.excluyentes', d.conexion.excluyentes, h.excluyentes],
      ['conexion.descartarAlGuardar', d.conexion.descartarAlGuardar, h.descartarAlGuardar],
      ['conexion.usaClientes', d.conexion.usaClientes, h.usaClientes],
      ['sql.dialecto', d.sql.dialecto, h.dialecto],
      ['sql.lenguajeConsola', d.sql.lenguajeConsola, h.lenguajeConsola],
      ['sql.lenguajeFuente', d.sql.lenguajeFuente, h.lenguajeFuente],
      ['sql.formateador', d.sql.formateador, h.formateador],
      ['catalogo.carpetas', d.catalogo.carpetas, h.carpetas],
      ['catalogo.pseudoEsquemaPublico', d.catalogo.pseudoEsquemaPublico, h.pseudoEsquemaPublico],
      ['catalogo.esquemaImplicito', d.catalogo.esquemaImplicito, h.esquemaImplicito],
      ['catalogo.tieneSinonimos', d.catalogo.tieneSinonimos, h.tieneSinonimos],
      ['catalogo.tieneDblinks', d.catalogo.tieneDblinks, h.tieneDblinks],
      ['sesion (entera)', d.sesion, h.sesion]
    ]
    for (const [nombre, real, esperado] of campos) {
      check(`${m}: ${nombre}`, igual(real, esperado), `real ${j(real)} · esperado ${j(esperado)}`)
    }
  }
  // Los esquemas del sistema por NOMBRE: la regla de `edicionRejilla.esEsquemaDelSistema` de antes.
  const nombres = ['SYS', 'SYSTEM', 'APEX_040200', 'FLOWS_030000', 'HR', 'SCOTT', 'pg_catalog', 'information_schema', 'pg_toast', 'public', 'PUBLIC', '']
  for (const n of nombres) {
    const oracleAntes = esEsquemaSistemaOracle(n)
    const pgAntes = n === 'pg_catalog' || n === 'information_schema' || n === 'pg_toast'
    check(
      `esquemaDelSistema(${j(n)}): oracle ${oracleAntes}, postgres ${pgAntes}`,
      MOTORES.oracle.catalogo.esquemaDelSistema(n) === oracleAntes && MOTORES.postgres.catalogo.esquemaDelSistema(n) === pgAntes,
      `${MOTORES.oracle.catalogo.esquemaDelSistema(n)} / ${MOTORES.postgres.catalogo.esquemaDelSistema(n)}`
    )
  }

  // -------------------------------------------------------------------------
  hr('(3) Las tablas derivadas que siguen')
  // Las carpetas de cada motor: los literales de la antigua `CARPETAS_POR_MOTOR` (retirada
  // ya no la leía nadie fuera de los tests).
  const carpetas = porMotorSql((d) => d.catalogo.carpetas)
  check(
    'catalogo.carpetas de cada motor (los literales de antes)',
    igual(carpetas, {
      oracle: ['tabla', 'vista', 'vistaMaterializada', 'rutina', 'paquete', 'secuencia', 'sinonimo', 'tipoObjeto', 'tipoColeccion', 'disparador'],
      postgres: ['tabla', 'vista', 'vistaMaterializada', 'tablaForanea', 'rutina', 'secuencia', 'tipo'],
      sqlite: ['tabla', 'vista', 'tablaVirtual'],
      sqlserver: ['tabla', 'vista', 'rutina', 'sinonimo', 'secuencia', 'tipo']
    }),
    j(carpetas)
  )
  for (const m of motoresSql) {
    check(`${m}: dialectoDeMotor = sql.dialecto = el propio id (la invariante)`, dialectoDeMotor(m) === MOTORES[m].sql.dialecto && dialectoDeMotor(m) === m, dialectoDeMotor(m))
    check(`${m}: reglasDeMotor = REGLAS[dialecto]`, reglasDeMotor(m) === REGLAS[dialectoDeMotor(m)], '')
  }
  // Un motor fuera del registro no cae en otro dialecto ni da un TypeError anónimo: el
  // mensaje es el de `descriptor()` (antes, «reading 'sql'»).
  for (const raro of ['mysql', 'constructor']) {
    let msg = ''
    try {
      dialectoDeMotor(raro as DbMotor)
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    check(`dialectoDeMotor('${raro}') lanza «Motor desconocido»`, msg === `Motor desconocido: "${raro}".`, msg || 'no lanzó')
  }
  // Un motor de otra familia tampoco cae en un dialecto: `dialectoDeMotor` va por
  // `descriptorSql`, que lanza diciendo que no es SQL (y no «reading 'dialecto'»).
  for (const m of motores.filter((x) => !esMotorSql(x))) {
    const msg = lanza(() => dialectoDeMotor(m))
    const esperado = `${MOTORES[m].etiqueta} no es un motor SQL.`
    check(`dialectoDeMotor('${m}') lanza «${esperado}»`, msg === esperado, msg ?? 'no lanzó')
  }
  check('porMotor devuelve una entrada por motor', igual(Object.keys(porMotor((d) => d.id)), motores), j(porMotor((d) => d.id)))
  check('porMotorSql devuelve una entrada por motor SQL, en el orden del registro', igual(Object.keys(porMotorSql((d) => d.id)), motoresSql), j(porMotorSql((d) => d.id)))

  // -------------------------------------------------------------------------
  hr('(4) validarDestino: las reglas de antes y las del formulario')
  const valores = ['', 'X']
  for (const m of motores) {
    const c = MOTORES[m].conexion
    for (const database of valores) {
      for (const sid of valores) {
        const real = c.validarDestino({ database, sid })
        const antes = validarDeAntes(m, database, sid)
        check(`${m}: validarDestino(database=${j(database)}, sid=${j(sid)}) = el de antes`, real === antes, `real ${j(real)} · antes ${j(antes)}`)
        // Con los datos del formulario: falta un obligatorio del destino, o un grupo sin
        // ninguno, o un grupo con más de uno.
        const v: Record<string, string> = { database, sid }
        const faltaObligatorio = c.obligatorios.some((k) => (k === 'database' || k === 'sid') && v[k] === '')
        const grupo = c.excluyentes.some((g) => {
          const con = g.campos.filter((k) => v[k] !== '').length
          return (g.alMenosUno && con === 0) || con > 1
        })
        check(
          `${m}: validarDestino rechaza (${database || '·'}, ${sid || '·'}) sí y solo sí lo marcan obligatorios/excluyentes`,
          (real !== null) === (faltaObligatorio || grupo),
          `rechaza ${real !== null} · marca ${faltaObligatorio || grupo}`
        )
      }
    }
    check(
      `${m}: lo que se descarta al guardar no es obligatorio ni de un grupo`,
      c.descartarAlGuardar.every((k) => c.obligatorios.indexOf(k) < 0 && (c.excluyentes as ReadonlyArray<{ campos: readonly string[] }>).every((g) => g.campos.indexOf(k) < 0)),
      j(c.descartarAlGuardar)
    )
  }
  // `definirMotor` con declaraciones inventadas: lo que los dos motores de hoy no ejercitan.
  const inventado = (c: {
    obligatorios?: DeclaracionMotor['conexion']['obligatorios']
    excluyentes?: DeclaracionMotor['conexion']['excluyentes']
    faltaDestino?: DeclaracionMotor['conexion']['faltaDestino']
    opcionales?: DeclaracionMotor['conexion']['opcionales']
    carpetas?: readonly DbTipoObjeto[]
  }): DeclaracionMotor<'postgres'> => ({
    id: 'postgres',
    etiqueta: 'Inventado',
    familia: 'sql',
    conexion: {
      puertoPorDefecto: 1,
      // Por defecto con host: un motor sin ningún campo de forma no construye.
      obligatorios: c.obligatorios ?? ['alias', 'host'],
      opcionales: c.opcionales ?? [],
      excluyentes: c.excluyentes ?? [],
      faltaDestino: c.faltaDestino ?? {},
      descartarAlGuardar: [],
      usaClientes: false,
      extensionesArchivo: [],
      credenciales: 'usuarioClave',
      soloLecturaPorDefecto: true,
      destinoLegible: MOTORES.postgres.conexion.destinoLegible
    },
    sql: MOTORES.postgres.sql,
    catalogo: {
      carpetas: c.carpetas ?? [],
      pseudoEsquemaPublico: null,
      esquemaImplicito: null,
      tieneDblinks: false,
      esquemaDelSistema: () => false,
      nivelBases: 'ninguno'
    },
    sesion: MOTORES.postgres.sesion
  })
  const grupo = { campos: ['database', 'sid'] as const, alMenosUno: true, siNinguno: 'NINGUNO', siVarios: 'VARIOS' }
  const ambos = definirMotor(inventado({ obligatorios: ['alias', 'host', 'database'], faltaDestino: { database: 'FALTA BASE' }, excluyentes: [grupo] }))
  check(
    'derivado: primero los obligatorios, luego los grupos (base y SID vacíos → el del obligatorio)',
    ambos.conexion.validarDestino({ database: '', sid: '' }) === 'FALTA BASE',
    String(ambos.conexion.validarDestino({ database: '', sid: '' }))
  )
  check('derivado: con base y SID, el del grupo (varios)', ambos.conexion.validarDestino({ database: 'b', sid: 's' }) === 'VARIOS', String(ambos.conexion.validarDestino({ database: 'b', sid: 's' })))
  check('derivado: con base sola, vale', ambos.conexion.validarDestino({ database: 'b', sid: '' }) === null, '')
  const sinMinimo = definirMotor(inventado({ excluyentes: [{ ...grupo, alMenosUno: false }] }))
  check('derivado: un grupo sin «al menos uno» acepta ninguno', sinMinimo.conexion.validarDestino({ database: '', sid: '' }) === null, '')
  check('derivado: …y rechaza varios', sinMinimo.conexion.validarDestino({ database: 'b', sid: 's' }) === 'VARIOS', '')
  const comunes = definirMotor(inventado({ obligatorios: ['alias', 'host', 'port', 'user'] }))
  check(
    'derivado: alias, host, puerto y usuario no son del motor (reglas comunes del main): no los mira',
    comunes.conexion.validarDestino({ database: '', sid: '' }) === null,
    ''
  )
  const eFalta = lanza(() => definirMotor(inventado({ obligatorios: ['database'] })))
  check('un obligatorio validable SIN su mensaje no construye el descriptor', eFalta !== null && eFalta.indexOf('database') >= 0, String(eFalta))
  const eSobra = lanza(() => definirMotor(inventado({ faltaDestino: { sid: 'x' } })))
  check('un mensaje de un campo que NO es obligatorio tampoco', eSobra !== null && eSobra.indexOf('sid') >= 0, String(eSobra))
  check(
    'tieneSinonimos DERIVADO de las carpetas (con y sin «sinonimo»)',
    definirMotor(inventado({ carpetas: ['tabla', 'sinonimo'] })).catalogo.tieneSinonimos === true &&
      definirMotor(inventado({ carpetas: ['tabla'] })).catalogo.tieneSinonimos === false,
    ''
  )
  // la FORMA en disco y `deArchivo`, DERIVADAS de los obligatorios.
  const eSinForma = lanza(() => definirMotor(inventado({ obligatorios: ['alias', 'user'] })))
  check('un motor sin ningún obligatorio de forma (host, port, archivo) no construye', eSinForma !== null && eSinForma.indexOf('a dónde') >= 0, String(eSinForma))
  const deRed = definirMotor(inventado({ obligatorios: ['alias', 'host', 'port', 'database', 'user'], faltaDestino: { database: 'x' } }))
  check('derivado: forma de red = host y puerto, en el orden de obligatorios; no es de archivo', igual(deRed.conexion.forma, ['host', 'port']) && !deRed.conexion.deArchivo, j(deRed.conexion.forma))
  const deArchivo = definirMotor(inventado({ obligatorios: ['alias', 'archivo'] }))
  check('derivado: forma de archivo = el archivo; deArchivo', igual(deArchivo.conexion.forma, ['archivo']) && deArchivo.conexion.deArchivo, j(deArchivo.conexion.forma))

  const obligatoriosDeclarados: DeclaracionMotor['conexion']['obligatorios'] = ['alias', 'host']
  const excluyentesDeclarados: DeclaracionMotor['conexion']['excluyentes'] = [grupo]
  const tal = definirMotor(inventado({ obligatorios: obligatoriosDeclarados, excluyentes: excluyentesDeclarados }))
  check(
    'lo declarado pasa tal cual, con las MISMAS referencias (el formulario las compara con ===)',
    tal.conexion.obligatorios === obligatoriosDeclarados && tal.conexion.excluyentes === excluyentesDeclarados,
    ''
  )
  check(
    'faltaDestino no queda en el descriptor (solo lo usa la derivación)',
    !('faltaDestino' in MOTORES.postgres.conexion) && !('faltaDestino' in ambos.conexion),
    Object.keys(MOTORES.postgres.conexion).join(',')
  )

  // -------------------------------------------------------------------------
  hr('(5) destinoLegible contra las cinco copias a mano')
  const casos: DestinoConexion[] = []
  // Las copias eran de los motores de RED; el de archivo (SQLite) tiene su destino aparte (abajo).
  // SQL Server es de red pero tiene su destino propio (la instancia, el dominio): se
  // prueba aparte en (13). Aquí, los que usan el destino de red de siempre.
  for (const motor of [...motores.filter((m) => MOTORES[m].conexion.destinoLegible === destinoDeRed), 'mysql']) {
    for (const database of [undefined, '', 'ORCL', 'mi_base']) {
      for (const sid of [undefined, '', 'XE']) {
        casos.push({ motor, host: '10.0.0.1', port: 1521, database, sid, user: 'ALFA_LECTOR' })
      }
    }
    casos.push({ motor, host: 'srv', port: 5432, database: null, sid: null, user: 'u' })
  }
  let comparados = 0
  const fallos: string[] = []
  for (const copia of COPIAS) {
    for (const c of casos) {
      comparados++
      const real = destinoLegible(c, copia.forma)
      const antes = copia.f(c)
      if (real !== antes) fallos.push(`${copia.donde} ${j(c)}: real ${j(real)} · antes ${j(antes)}`)
    }
  }
  check(`las ${COPIAS.length} copias: ${comparados} casos iguales al byte`, fallos.length === 0, fallos.slice(0, 5).join(' | '))
  const conSid: DestinoConexion = { motor: 'oracle', host: 'h', port: 1521, sid: 'XE', user: 'u' }
  check("'completo' con SID: `h:1521 (SID XE)`", destinoLegible(conSid) === 'h:1521 (SID XE)', destinoLegible(conSid))
  check("'conUsuario' con SID: `u@h:1521 (SID XE)`", destinoLegible(conSid, 'conUsuario') === 'u@h:1521 (SID XE)', destinoLegible(conSid, 'conUsuario'))
  check("'ls' con SID: `h:1521/XE` (la de tdb, distinta a propósito)", destinoLegible(conSid, 'ls') === 'h:1521/XE', destinoLegible(conSid, 'ls'))
  check("la base gana al SID si vinieran las dos", destinoLegible({ ...conSid, database: 'ORCL' }) === 'h:1521/ORCL', destinoLegible({ ...conSid, database: 'ORCL' }))
  // el destino de un motor de ARCHIVO es el NOMBRE del archivo en todas las formas,
  // nunca la ruta (el DTO no la trae) ni el host/puerto que quedara escrito.
  const deSqlite: DestinoConexion = { motor: 'sqlite', host: 'no-se-usa', port: 5432, user: 'u', archivoVisible: 'ejemplo.db' }
  const formasSqlite = (['completo', 'conUsuario', 'ls', 'breve'] as const).map((f) => destinoLegible(deSqlite, f))
  check('sqlite: las cuatro formas son el nombre del archivo', formasSqlite.every((x) => x === 'ejemplo.db'), j(formasSqlite))
  check("sqlite: sin nombre, ''", destinoLegible({ ...deSqlite, archivoVisible: undefined }) === '', j(destinoLegible({ ...deSqlite, archivoVisible: undefined })))

  // -------------------------------------------------------------------------
  hr('(6) Un motor desconocido no rompe nada')
  for (const x of ['mysql', 'mariadb', 'SQLITE', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 'ORACLE', '', ' oracle']) {
    check(`esMotor(${j(x)}) es falso`, !esMotor(x), '')
  }
  for (const x of [undefined, null, 1, {}, ['oracle']]) {
    check(`esMotor(${j(x) ?? 'undefined'}) es falso`, !esMotor(x), '')
  }
  for (const m of motores) check(`esMotor(${j(m)})`, esMotor(m), '')
  const e1 = lanza(() => descriptor('mysql' as DbMotor))
  check('descriptor de un motor desconocido LANZA, con el motor en el mensaje', e1 !== null && e1.indexOf('mysql') >= 0, String(e1))
  const e2 = lanza(() => descriptor('constructor' as DbMotor))
  check('descriptor("constructor") también lanza', e2 !== null, String(e2))
  check("etiquetaMotor('mysql') devuelve el id", etiquetaMotor('mysql') === 'mysql', etiquetaMotor('mysql'))
  check("etiquetaMotor('sqlite') devuelve la etiqueta", etiquetaMotor('sqlite') === 'SQLite', etiquetaMotor('sqlite'))
  check("etiquetaMotor('postgres') devuelve la etiqueta", etiquetaMotor('postgres') === 'PostgreSQL', etiquetaMotor('postgres'))
  check("etiquetaMotor('constructor') no devuelve una función", etiquetaMotor('constructor') === 'constructor', String(etiquetaMotor('constructor')))
  // Los mensajes que nombran motores salen del registro.
  check("listaLegible: '', «A», «A y B», «A, B y C»", j([[], ['A'], ['A', 'B'], ['A', 'B', 'C']].map(listaLegible)) === j(['', 'A', 'A y B', 'A, B y C']), j([[], ['A'], ['A', 'B'], ['A', 'B', 'C']].map(listaLegible)))
  check(
    'etiquetasDonde(todos) = «Oracle, PostgreSQL, SQLite, SQL Server, MongoDB y Redis», en el orden del registro',
    etiquetasDonde(() => true) === 'Oracle, PostgreSQL, SQLite, SQL Server, MongoDB y Redis',
    etiquetasDonde(() => true)
  )
  check("etiquetasDonde(ninguno) = ''", etiquetasDonde(() => false) === '', etiquetasDonde(() => false))
  // SQLite declara 'rowid', y «ROWID solo existe en…» lo dice sin que nadie toque
  // ese mensaje (para eso se escribió con `etiquetasDonde`). La sesión
  // solo existe en SQL, así que la pregunta va por `etiquetasSqlDonde`.
  check(
    'etiquetasSqlDonde(los de ROWID) = «Oracle y SQLite»: «ROWID solo existe en Oracle y SQLite.»',
    etiquetasSqlDonde((d) => d.sesion.identidadSinPk === 'rowid') === 'Oracle y SQLite',
    etiquetasSqlDonde((d) => d.sesion.identidadSinPk === 'rowid')
  )
  check(
    'etiquetasSqlDonde(todos) = «Oracle, PostgreSQL, SQLite y SQL Server» (sin MongoDB ni Redis)',
    etiquetasSqlDonde(() => true) === 'Oracle, PostgreSQL, SQLite y SQL Server',
    etiquetasSqlDonde(() => true)
  )
  check(
    'etiquetasDonde(el usuario es opcional) = «MongoDB y Redis»',
    etiquetasDonde((d) => usaOpcional(d, 'user')) === 'MongoDB y Redis',
    etiquetasDonde((d) => usaOpcional(d, 'user'))
  )

  // -------------------------------------------------------------------------
  hr('(7) REGLAS: las banderas nuevas y marcadorPosicional')
  const dialectos = Object.keys(REGLAS) as DialectoSql[]
  check('cada motor SQL tiene su fila de REGLAS', motoresSql.every((m) => Object.prototype.hasOwnProperty.call(REGLAS, MOTORES[m].sql.dialecto)), j(dialectos))
  check('cada dialecto es el de algún motor SQL (subconjunto de DbMotor)', dialectos.every((d) => esMotorSql(d) && MOTORES[d].sql.dialecto === d), j(dialectos))
  const NUEVAS: Record<DialectoSql, Record<string, unknown>> = {
    oracle: {
      numerosConBase: false,
      sufijoFlotante: true,
      selectIntoCreaTabla: false,
      returningDevuelveFilas: false,
      explain: 'planFor',
      alterSession: true,
      setDeSesion: false,
      verbosDelDialecto: [],
      analyzeEsDdl: true,
      callDevuelveFilas: false,
      ejecutar: 'rutinaPlsql',
      fetchDevuelveFilas: false,
      formaSetSesion: 'ALTER SESSION SET ',
      estiloParametros: 'dosPuntosNombre',
      marcadorPosicional: 'dosPuntos',
      cadenaVaciaEsNull: true,
      insertDefaultValues: false,
      tablaFicticia: { esquema: 'SYS', nombre: 'DUAL' },
      ...SIN_BANDERAS_PASO_2,
      ...SIN_BANDERAS_PASO_3
    },
    postgres: {
      numerosConBase: true,
      sufijoFlotante: false,
      selectIntoCreaTabla: true,
      returningDevuelveFilas: true,
      explain: 'conOpciones',
      alterSession: false,
      setDeSesion: true,
      verbosDelDialecto: ['TABLE', 'SHOW', 'BEGIN', 'START', 'END', 'ABORT', 'PREPARE', 'RESET', 'DISCARD', 'DO'],
      analyzeEsDdl: false,
      callDevuelveFilas: true,
      ejecutar: 'sentenciaPreparada',
      fetchDevuelveFilas: true,
      formaSetSesion: 'SET ',
      estiloParametros: 'dolarNumero',
      marcadorPosicional: 'dolar',
      cadenaVaciaEsNull: false,
      insertDefaultValues: true,
      tablaFicticia: null,
      ...SIN_BANDERAS_PASO_2,
      ...SIN_BANDERAS_PASO_3
    },
    // SQLite (lo que hace su léxico; el porqué de cada uno, en su fila de REGLAS).
    sqlite: {
      numerosConBase: false,
      sufijoFlotante: false,
      selectIntoCreaTabla: false,
      returningDevuelveFilas: true,
      explain: 'queryPlan',
      alterSession: false,
      setDeSesion: false,
      verbosDelDialecto: ['BEGIN', 'END', 'PRAGMA'],
      analyzeEsDdl: false,
      callDevuelveFilas: false,
      ejecutar: 'noExiste',
      fetchDevuelveFilas: false,
      formaSetSesion: 'PRAGMA ',
      estiloParametros: 'sqliteMixto',
      marcadorPosicional: 'interrogacion',
      cadenaVaciaEsNull: false,
      insertDefaultValues: true,
      tablaFicticia: null,
      comandosCliente: 'sqlite3',
      cajaSinComillas: 'insensible',
      sentenciasFueraDeTx: true,
      sesionSoloLectura: [],
      formatosFijados: [],
      identCorchetes: true,
      identAcentoGrave: true,
      bindInterrogacion: true,
      bindArroba: true,
      bindDolarNombre: true,
      triggerBeginEnd: true,
      hex0x: true,
      ...SIN_BANDERAS_PASO_3
    },
    // SQL Server (lo medido, en su fila de REGLAS).
    sqlserver: {
      numerosConBase: false,
      sufijoFlotante: false,
      selectIntoCreaTabla: true,
      returningDevuelveFilas: false,
      explain: 'showplan',
      alterSession: false,
      setDeSesion: true,
      analyzeEsDdl: false,
      callDevuelveFilas: false,
      ejecutar: 'procedimientoTsql',
      fetchDevuelveFilas: true,
      formaSetSesion: 'SET ',
      estiloParametros: 'ninguno',
      marcadorPosicional: 'arrobaP',
      cadenaVaciaEsNull: false,
      insertDefaultValues: true,
      tablaFicticia: null,
      comandosCliente: null,
      comentariosAnidados: true,
      beginEsTransaccion: false,
      almohadillaEnIdent: true,
      cajaSinComillas: 'insensibleUnicode',
      sentenciasFueraDeTx: true,
      formatosFijados: ['textsize', 'implicit_transactions', 'dateformat', 'language', 'quoted_identifier'],
      identCorchetes: true,
      identAcentoGrave: false,
      bindInterrogacion: false,
      bindArroba: false,
      bindDolarNombre: false,
      triggerBeginEnd: false,
      hex0x: true,
      pragmas: null,
      corcheteEscapeDoble: true,
      cadenaNacional: true,
      almohadillaInicial: true,
      variablesArroba: true,
      literalDinero: true,
      numerosTsql: true,
      separadorLote: 'go',
      sinSeparadorSeEjecutanJuntas: true,
      conservaPuntoYComaFinal: true,
      clausulaOutput: true
    }
  }
  for (const d of dialectos) {
    const r = REGLAS[d] as unknown as Record<string, unknown>
    for (const k of Object.keys(NUEVAS[d])) {
      check(`REGLAS.${d}.${k}`, igual(r[k], NUEVAS[d][k]), `real ${j(r[k])} · esperado ${j(NUEVAS[d][k])}`)
    }
  }
  check("marcadorPosicional('oracle', 3) = ':3'", marcadorPosicional('oracle', 3) === ':3', marcadorPosicional('oracle', 3))
  check("marcadorPosicional('postgres', 12) = '$12'", marcadorPosicional('postgres', 12) === '$12', marcadorPosicional('postgres', 12))
  check("marcadorPosicional('sqlite', 7) = '?7'", marcadorPosicional('sqlite', 7) === '?7', marcadorPosicional('sqlite', 7))
  check("marcadorPosicional('sqlserver', 2) = '@p2'", marcadorPosicional('sqlserver', 2) === '@p2', marcadorPosicional('sqlserver', 2))
  const lote = REGLAS.sqlserver.hastaSeparadorLote
  check(
    'REGLAS.sqlserver.hastaSeparadorLote: en MAYÚSCULAS, sin repetidos, con CREATE PROCEDURE y DECLARE, sin BEGIN TRAN',
    lote.every((p, i) => p === p.toUpperCase() && lote.indexOf(p) === i) &&
      lote.indexOf('CREATE PROCEDURE') >= 0 &&
      lote.indexOf('DECLARE') >= 0 &&
      lote.indexOf('BEGIN TRAN') < 0 &&
      lote.indexOf('BEGIN TRANSACTION') < 0,
    j(lote)
  )
  // La lista de PRAGMA de lectura: sin repetidos dentro de cada lista, en minúsculas, y
  // (paridad con el autorizador) la cruza `src/tdb/test-sqlite-comun.mts`.
  const pr = REGLAS.sqlite.pragmas
  check(
    'REGLAS.sqlite.pragmas: dos listas en minúsculas y sin repetidos',
    pr !== null &&
      [pr.soloSinValor, pr.conArgumento].every((l) => l.every((p, i) => p === p.toLowerCase() && l.indexOf(p) === i)),
    j(pr)
  )

  // -------------------------------------------------------------------------
  hr('(8) Coherencias internas')
  for (const m of motoresSql) {
    const d: DescriptorSql = MOTORES[m]
    check(`${m}: tieneSinonimos ⇔ 'sinonimo' está en sus carpetas`, d.catalogo.tieneSinonimos === d.catalogo.carpetas.indexOf('sinonimo') >= 0, '')
    check(`${m}: un pseudo-esquema público exige sinónimos`, d.catalogo.pseudoEsquemaPublico === null || d.catalogo.tieneSinonimos, '')
    const p = d.sesion.paginado
    check(`${m}: las formas de rejilla y de relectura están entre las admitidas`, p.admitidas.indexOf(p.rejilla) >= 0 && p.admitidas.indexOf(p.relectura) >= 0, j(p))
    // Solo en un sentido: LIMIT/OFFSET no guarda estado entre páginas. Otra forma sin
    // estado que llegue con otro motor también las hará inestables.
    check(`${m}: si la rejilla pagina con LIMIT/OFFSET, las páginas son inestables sin orden`, p.rejilla !== 'limitOffset' || d.sesion.paginasInestablesSinOrden, j(p))
    check(`${m}: las carpetas no se repiten`, d.catalogo.carpetas.every((c, i) => d.catalogo.carpetas.indexOf(c) === i), j(d.catalogo.carpetas))
  }

  // -------------------------------------------------------------------------
  hr('(9) Esquemas del sistema de Oracle: la lista')
  check('no se repite ningún nombre', ESQUEMAS_SISTEMA_ORACLE.every((n, i) => ESQUEMAS_SISTEMA_ORACLE.indexOf(n) === i), '')
  check('los esquemas de EJEMPLO no son del sistema (HR, SCOTT)', !esEsquemaSistemaOracle('HR') && !esEsquemaSistemaOracle('SCOTT'), '')

  // -------------------------------------------------------------------------
  hr('(10) nunca')
  const e4 = lanza(() => nunca('sqlite' as never, 'prueba'))
  check('nunca lanza, con el valor y el contexto en el mensaje', e4 !== null && e4.indexOf('sqlite') >= 0 && e4.indexOf('prueba') >= 0, String(e4))
  const e5 = lanza(() => nunca({ a: 1 } as never))
  check('nunca con un objeto: lo escribe como JSON', e5 !== null && e5.indexOf('{"a":1}') >= 0, String(e5))

  // -------------------------------------------------------------------------
  hr('(11) Neutralidad de lo compartido (lo importa el renderer)')
  const aqui = dirname(fileURLToPath(import.meta.url))
  const escritura = join(aqui, '..', 'escrituraSql')
  const archivos = readdirSync(aqui)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(aqui, f))
    .concat(readdirSync(escritura).filter((f) => f.endsWith('.ts')).map((f) => join(escritura, f)))
    .concat([join(aqui, '..', 'nunca.ts'), join(aqui, '..', 'sql', 'dialectosSql.ts'), join(aqui, '..', 'sql', 'dialectosSqlBase.ts'), join(aqui, '..', 'formatosFilas.ts')])
    // Los contratos de las familias nuevas: los importa el renderer igual.
    .concat([join(aqui, '..', 'db-documentos-ipc.ts'), join(aqui, '..', 'db-claves-ipc.ts')])
  const prohibidos: Array<[string, RegExp]> = [
    ['process', /\bprocess\s*\./],
    ['window/document', /\b(window|document)\s*\./],
    ["import de 'electron'", /from\s+['"]electron['"]/],
    ['import de node:*', /from\s+['"]node:/],
    ['plataforma.ts', /plataforma\.ts['"]/],
    ['.at(', /\.at\(/],
    ['replaceAll', /\.replaceAll\(/],
    ['findLast', /\.findLast(Index)?\(/],
    ['Object.hasOwn', /Object\.hasOwn\(/]
  ]
  for (const a of archivos) {
    // Sin comentarios: la cabecera puede nombrar lo que el código no usa.
    const codigo = readFileSync(a, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    const malos = prohibidos.filter(([, re]) => re.test(codigo)).map(([n]) => n)
    check(`${a.slice(aqui.length - 'motores'.length)}: neutral y ES2020`, malos.length === 0, malos.join(', '))
  }
  // `db-ipc.ts` es una HOJA: lo importa todo el que habla de
  // conexiones, y un import de valor ahí (el registro, para `MOTOR_LABEL`) lo arrastraba
  // a todos y abría la puerta a un ciclo. Solo `import type`, o nada.
  const dbIpc = readFileSync(join(aqui, '..', 'db-ipc.ts'), 'utf8')
  const importsDeValor: string[] = [
    ...(dbIpc.match(/^import\s+(?!type\b)[^\n]*$/gm) ?? []),
    ...(dbIpc.match(/^export\s+\{[^}]*\}\s+from\s[^\n]*$/gm) ?? []),
    // `export * from` también carga el módulo en ejecución.
    ...(dbIpc.match(/^export\s+\*[^\n]*\sfrom\s[^\n]*$/gm) ?? [])
  ]
  check('db-ipc.ts no importa nada en ejecución (es una hoja)', importsDeValor.length === 0, importsDeValor.join(' | ') || 'ninguno')

  // -------------------------------------------------------------------------
  hr('(12) La invariante dialecto = motor, en el TIPO')
  // Estas líneas no hacen nada al correr: las comprueba `npm run typecheck`. Si alguien
  // afloja `CapacidadesSql<M>.dialecto` (lo devuelve a `DialectoSql`) o el tipo de
  // `MOTORES` (a un `Record<DbMotor, DescriptorMotor>`), el error que esperan deja de
  // existir, la directiva sobra y el typecheck FALLA.
  // @ts-expect-error — el dialecto de PostgreSQL no puede ser el de Oracle
  const dialectoAjeno: CapacidadesSql<'postgres'>['dialecto'] = 'oracle'
  // @ts-expect-error — en el registro, la clave `postgres` solo admite el descriptor de PostgreSQL
  const registroCruzado: (typeof MOTORES)['postgres'] = MOTORES.oracle
  check(
    'los dos @ts-expect-error de arriba los vigila el typecheck',
    String(dialectoAjeno) === 'oracle' && (registroCruzado as unknown) === MOTORES.oracle,
    'ver npm run typecheck'
  )
  // `DbMotorSql` (db-ipc.ts) y `DialectoSql` (dialectosSql.ts) son dos uniones
  // escritas aparte que tienen que ser la MISMA (la invariante, vista desde los tipos): un
  // motor SQL sin su dialecto, o un dialecto sin su motor, rompe la invariante sin que ningún
  // `Record` lo diga. Asignables en los dos sentidos, y un `@ts-expect-error` que SOBRA (y
  // tumba el typecheck) el día que se separen.
  type MismaUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
  const motorADialecto = (m: DbMotorSql): DialectoSql => m
  const dialectoAMotor = (d: DialectoSql): DbMotorSql => d
  const mismas: MismaUnion<DbMotorSql, DialectoSql> = true
  // @ts-expect-error — mientras sean la MISMA unión, `false` no cabe; si se separan, esta directiva sobra
  const separadas: MismaUnion<DbMotorSql, DialectoSql> = false
  check(
    'DbMotorSql y DialectoSql son la MISMA unión (typecheck), y en ejecución los motores SQL son las filas de REGLAS',
    mismas &&
      !separadas &&
      igual(motoresSql.map(motorADialecto).sort(), Object.keys(REGLAS).sort()) &&
      igual((Object.keys(REGLAS) as DialectoSql[]).map(dialectoAMotor).sort(), motoresSql.slice().sort()),
    `${j(motoresSql)} · ${j(Object.keys(REGLAS))}`
  )
  // Lo SQL no se aplica a las otras familias POR CONSTRUCCIÓN (ver «FAMILIAS» en tipos.ts): si
  // alguien vuelve al descriptor plano con grupos opcionales, estas directivas sobran.
  // @ts-expect-error — un descriptor de documentos (`DescriptorMotor<'mongodb'>`) no tiene `sql`
  const sqlDeMongo: unknown = MOTORES.mongodb.sql
  // @ts-expect-error — ni uno de claves `sesion`
  const sesionDeRedis: unknown = MOTORES.redis.sesion
  // @ts-expect-error — y sobre la UNIÓN de todos, `catalogo` no compila: se pide con `descriptorSql(m)`
  const catalogoDeCualquiera: unknown = descriptor('mongodb' as DbMotor).catalogo
  check(
    'los @ts-expect-error de la familia los vigila el typecheck (y en ejecución no hay nada)',
    sqlDeMongo === undefined && sesionDeRedis === undefined && catalogoDeCualquiera === undefined,
    'ver npm run typecheck'
  )

  // -------------------------------------------------------------------------
  hr('(13) SQL Server: opcionales, nivel «Bases», autenticación, destino y caja')
  const opcionales = porMotor((d) => d.conexion.opcionales)
  check(
    'conexion.opcionales: vacía en Oracle, PG y SQLite; SQL Server con base, instancia, autenticación, dominio y cifrado; MongoDB usuario, base, cifrado, SRV y opciones de URI; Redis, usuario, base y cifrado',
    igual(opcionales, {
      oracle: [],
      postgres: [],
      sqlite: [],
      sqlserver: ['database', 'instancia', 'autenticacion', 'dominio', 'tls'],
      mongodb: ['user', 'database', 'tls', 'srv', 'opcionesUri'],
      redis: ['user', 'database', 'tls']
    }),
    j(opcionales)
  )
  check('usaOpcional(sqlserver, instancia) y no en postgres', usaOpcional(MOTORES.sqlserver, 'instancia') && !usaOpcional(MOTORES.postgres, 'instancia'), '')
  check(
    'la base NO es obligatoria en SQL Server (árbol híbrido) y validarDestino no pide nada',
    MOTORES.sqlserver.conexion.obligatorios.indexOf('database') < 0 && MOTORES.sqlserver.conexion.validarDestino({ database: '', sid: '' }) === null,
    j(MOTORES.sqlserver.conexion.obligatorios)
  )
  const niveles = porMotorSql((d) => d.catalogo.nivelBases)
  check('catalogo.nivelBases: solo SQL Server tiene nivel «Bases»', igual(niveles, { oracle: 'ninguno', postgres: 'ninguno', sqlite: 'ninguno', sqlserver: 'sinBaseFija' }), j(niveles))
  // MongoDB tiene el MISMO árbol híbrido, con el valor en SU grupo (`documentos`).
  const nb: Array<[DbMotorSql | 'mongodb', string | null | undefined, boolean]> = [
    ['sqlserver', undefined, true],
    ['sqlserver', '', true],
    ['sqlserver', '   ', true],
    ['sqlserver', null, true],
    ['sqlserver', 'ventas', false],
    ['postgres', undefined, false],
    ['oracle', '', false],
    ['sqlite', undefined, false],
    ['mongodb', undefined, true],
    ['mongodb', '', true],
    ['mongodb', '  ', true],
    ['mongodb', null, true],
    ['mongodb', 'tienda', false]
  ]
  for (const [m, database, esperado] of nb) {
    check(`tieneNivelBases(${m}, base ${j(database)}) = ${esperado}`, tieneNivelBases(MOTORES[m], { database }) === esperado, '')
  }
  check(
    "autenticación: 'sql' y 'ntlm' valen; 'kerberos', '', 'constructor' y null no",
    esAutenticacion('sql') && esAutenticacion('ntlm') && !esAutenticacion('kerberos') && !esAutenticacion('') && !esAutenticacion('constructor') && !esAutenticacion(null),
    ''
  )
  check("autenticacionDe(ausente) = 'sql'; pideDominio: solo 'ntlm'", autenticacionDe(undefined) === 'sql' && autenticacionDe(null) === 'sql' && !pideDominio('sql') && pideDominio('ntlm'), '')
  const e6 = lanza(() => definirMotor(inventado({ obligatorios: ['alias', 'host', 'database'], faltaDestino: { database: 'X' }, opcionales: ['database'] })))
  check('definirMotor: un campo obligatorio Y opcional no construye', e6 !== null && e6.indexOf('obligatorio y opcional') >= 0, String(e6))
  const e7 = lanza(() => definirMotor(inventado({ opcionales: ['dominio'] })))
  check('definirMotor: «dominio» sin «autenticacion» no construye', e7 !== null && e7.indexOf('dominio') >= 0, String(e7))
  const base: DestinoConexion = { motor: 'sqlserver', host: 'srv', port: 1433, database: 'ventas', user: 'ana' }
  const destinos: Array<[string, DestinoConexion, FormaDestino, string]> = [
    ['completo', base, 'completo', 'srv:1433/ventas'],
    ['completo sin base', { ...base, database: '' }, 'completo', 'srv:1433'],
    ['completo con instancia (sin puerto)', { ...base, instancia: 'SQLEXPRESS' }, 'completo', 'srv\\SQLEXPRESS/ventas'],
    ['completo: el SID que quedó escrito no cuenta', { ...base, database: null, sid: 'XE' }, 'completo', 'srv:1433'],
    ['conUsuario', base, 'conUsuario', 'ana@srv:1433/ventas'],
    ['conUsuario con cuenta de dominio', { ...base, autenticacion: 'ntlm', dominio: 'DOMINIO' }, 'conUsuario', 'DOMINIO\\ana@srv:1433/ventas'],
    ['conUsuario: el dominio no cuenta con autenticación sql', { ...base, autenticacion: 'sql', dominio: 'DOMINIO' }, 'conUsuario', 'ana@srv:1433/ventas'],
    ['ls', base, 'ls', 'srv:1433/ventas'],
    ['ls sin base', { ...base, database: undefined }, 'ls', 'srv:1433/'],
    ['ls con instancia', { ...base, instancia: 'SQLEXPRESS' }, 'ls', 'srv\\SQLEXPRESS/ventas'],
    ['breve', { ...base, instancia: 'SQLEXPRESS' }, 'breve', 'srv']
  ]
  for (const [nombre, c, forma, esperado] of destinos) {
    check(`destinoLegible sqlserver ${nombre}: ${j(esperado)}`, destinoLegible(c, forma) === esperado, j(destinoLegible(c, forma)))
  }
  // La caja de SQL Server (medido en 2022 con _CI_AS): toda letra, sin tocar los acentos.
  check("sqlserver: 'Ñandú' y 'ñANDÚ' son el mismo nombre", mismoNombre('Ñandú', 'ñANDÚ', 'sqlserver'), claveDeNombre('Ñandú', 'sqlserver'))
  check("sqlserver: 'cafe' y 'café' NO (distingue acentos)", !mismoNombre('cafe', 'café', 'sqlserver'), '')
  check("sqlserver: 'Clientes' y 'CLIENTES' sí", mismoNombre('Clientes', 'CLIENTES', 'sqlserver'), '')
  check("sqlite sigue en ASCII: 'Ñandú' y 'ñandú' NO (no cambia)", !mismoNombre('Ñandú', 'ñandú', 'sqlite') && mismoNombre('Ab', 'aB', 'sqlite'), '')
  check('sqlserver: sin plegar al escribir (se enseña como está)', plegarSinComillas('MiTabla', 'sqlserver') === 'MiTabla', plegarSinComillas('MiTabla', 'sqlserver'))
  check("sqlserver: '[a]]b;c]' es el nombre 'a]b;c' (corcheteEscapeDoble)", normalizarIdent('[a]]b;c]', 'sqlserver') === 'a]b;c', normalizarIdent('[a]]b;c]', 'sqlserver'))
  check("sqlserver: '[Mi Tabla]' es 'Mi Tabla'", normalizarIdent('[Mi Tabla]', 'sqlserver') === 'Mi Tabla', normalizarIdent('[Mi Tabla]', 'sqlserver'))
  check("sqlserver: '[a]b]' (un ] suelto) no es un nombre citado", normalizarIdent('[a]b]', 'sqlserver') === '[a]b]', normalizarIdent('[a]b]', 'sqlserver'))
  check(
    "sqlite no cambia: '[x]' es 'x' y '[a]]b]' no es un nombre citado",
    normalizarIdent('[x]', 'sqlite') === 'x' && normalizarIdent('[a]]b]', 'sqlite') === '[a]]b]',
    `${normalizarIdent('[x]', 'sqlite')} / ${normalizarIdent('[a]]b]', 'sqlite')}`
  )

  // -------------------------------------------------------------------------
  hr('(14) las familias (MongoDB y Redis)')
  // (a) Los valores de las otras familias, motor a motor: lo común y el grupo de su familia.
  for (const m of motores) {
    if (esMotorSql(m)) continue
    const d = MOTORES[m]
    const h = OTRAS_FAMILIAS[m]
    const grupo = d.familia === 'documentos' ? d.documentos : d.familia === 'claves' ? d.claves : null
    const campos: Array<[string, unknown, unknown]> = [
      ['familia', d.familia, h.familia],
      ['etiqueta', d.etiqueta, h.etiqueta],
      ['conexion.puertoPorDefecto', d.conexion.puertoPorDefecto, h.puerto],
      ['conexion.obligatorios (sin usuario)', d.conexion.obligatorios, h.obligatorios],
      ['conexion.opcionales (usuario y base)', d.conexion.opcionales, h.opcionales],
      ['conexion.forma (derivada)', d.conexion.forma, h.forma],
      ['conexion.deArchivo (derivada)', d.conexion.deArchivo, h.deArchivo],
      ['conexion.extensionesArchivo', d.conexion.extensionesArchivo, h.extensionesArchivo],
      ['conexion.credenciales', d.conexion.credenciales, h.credenciales],
      ['conexion.soloLecturaPorDefecto', d.conexion.soloLecturaPorDefecto, h.soloLecturaPorDefecto],
      ['conexion.excluyentes', d.conexion.excluyentes, h.excluyentes],
      ['conexion.descartarAlGuardar', d.conexion.descartarAlGuardar, h.descartarAlGuardar],
      ['conexion.usaClientes', d.conexion.usaClientes, h.usaClientes],
      [`${d.familia} (el grupo entero)`, grupo, h.grupo]
    ]
    for (const [nombre, real, esperado] of campos) {
      check(`${m}: ${nombre}`, igual(real, esperado), `real ${j(real)} · esperado ${j(esperado)}`)
    }
    check(
      `${m}: sin \`sql\`, \`catalogo\` ni \`sesion\` en ejecución (lo SQL no se le aplica), y sin el grupo de la otra familia`,
      !('sql' in d) && !('catalogo' in d) && !('sesion' in d) && !((d.familia === 'documentos' ? 'claves' : 'documentos') in d),
      Object.keys(d).join(',')
    )
    check(`${m}: validarDestino no pide nada (sin base ni SID obligatorios)`, d.conexion.validarDestino({ database: '', sid: '' }) === null, '')
    check(`${m}: pide usuario y clave (los ofrece; el usuario no es obligatorio)`, pideUsuarioYClave(d) && usaOpcional(d, 'user') && d.conexion.obligatorios.indexOf('user') < 0, '')
    check(
      `${m}: la forma en disco es host y puerto (tieneFormaDelMotor)`,
      tieneFormaDelMotor({ motor: m, host: 'h', port: 1 }) && !tieneFormaDelMotor({ motor: m, archivo: 'x.db' }) && !tieneFormaDelMotor({ motor: m, host: 'h', port: '1' }),
      ''
    )
  }
  // El destino con el usuario OPCIONAL, en las cuatro formas, con y sin usuario y con y sin
  // base. Sin usuario, 'conUsuario' no escribe un `@` huérfano; el SID que quedara escrito no
  // cuenta (MongoDB y Redis no tienen SID). En Redis la «base» es su número.
  const mongo: DestinoConexion = { motor: 'mongodb', host: 'mongo.lan', port: 27017, database: 'tienda', user: 'lector' }
  const redis: DestinoConexion = { motor: 'redis', host: 'cache', port: 6379, database: '2', user: '' }
  const destinosFase5: Array<[string, DestinoConexion, FormaDestino, string]> = [
    ['mongodb completo', mongo, 'completo', 'mongo.lan:27017/tienda'],
    ['mongodb completo sin base', { ...mongo, database: '' }, 'completo', 'mongo.lan:27017'],
    ['mongodb completo: el SID que quedó escrito no cuenta', { ...mongo, database: null, sid: 'XE' }, 'completo', 'mongo.lan:27017'],
    ['mongodb conUsuario', mongo, 'conUsuario', 'lector@mongo.lan:27017/tienda'],
    ['mongodb conUsuario sin base', { ...mongo, database: undefined }, 'conUsuario', 'lector@mongo.lan:27017'],
    ['mongodb conUsuario SIN usuario (sin @ huérfano)', { ...mongo, user: '' }, 'conUsuario', 'mongo.lan:27017/tienda'],
    ['mongodb conUsuario sin usuario ni base', { ...mongo, user: '', database: null }, 'conUsuario', 'mongo.lan:27017'],
    ['mongodb ls', mongo, 'ls', 'mongo.lan:27017/tienda'],
    ['mongodb ls sin base', { ...mongo, database: '' }, 'ls', 'mongo.lan:27017/'],
    ['mongodb ls: el SID no cuenta', { ...mongo, database: null, sid: 'XE' }, 'ls', 'mongo.lan:27017/'],
    ['mongodb breve', mongo, 'breve', 'mongo.lan'],
    ['redis completo (base 2)', redis, 'completo', 'cache:6379/2'],
    ['redis completo sin base', { ...redis, database: '' }, 'completo', 'cache:6379'],
    ['redis conUsuario SIN usuario (la clave sola)', redis, 'conUsuario', 'cache:6379/2'],
    ['redis conUsuario con usuario ACL', { ...redis, user: 'lectura' }, 'conUsuario', 'lectura@cache:6379/2'],
    ['redis conUsuario sin usuario ni base', { ...redis, database: undefined }, 'conUsuario', 'cache:6379'],
    ['redis ls', redis, 'ls', 'cache:6379/2'],
    ['redis ls sin base', { ...redis, database: null }, 'ls', 'cache:6379/'],
    ['redis breve', redis, 'breve', 'cache']
  ]
  for (const [nombre, c, forma, esperado] of destinosFase5) {
    check(`destinoLegible ${nombre}: ${j(esperado)}`, destinoLegible(c, forma) === esperado, j(destinoLegible(c, forma)))
  }
  check(
    'mongodb y redis escriben el destino con destinoDeRedUsuarioOpcional; con usuario y base, igual que el de red de siempre',
    MOTORES.mongodb.conexion.destinoLegible === destinoDeRedUsuarioOpcional &&
      MOTORES.redis.conexion.destinoLegible === destinoDeRedUsuarioOpcional &&
      (['completo', 'conUsuario', 'ls', 'breve'] as const).every((f) => destinoDeRedUsuarioOpcional(mongo, f) === destinoDeRed(mongo, f)),
    ''
  )

  // (b) `descriptorSql`: el de un motor SQL es su descriptor; con otra familia LANZA diciendo
  // que no es SQL; con uno desconocido, como `descriptor`.
  for (const m of motoresSql) check(`descriptorSql('${m}') es MOTORES.${m}`, descriptorSql(m) === MOTORES[m], '')
  const eMongo = lanza(() => descriptorSql('mongodb'))
  check("descriptorSql('mongodb') LANZA «MongoDB no es un motor SQL.»", eMongo === 'MongoDB no es un motor SQL.', String(eMongo))
  const eRedis = lanza(() => descriptorSql('redis'))
  check("descriptorSql('redis') LANZA «Redis no es un motor SQL.»", eRedis === 'Redis no es un motor SQL.', String(eRedis))
  const eDesc = lanza(() => descriptor('mysql' as DbMotor))
  const eDescSql = lanza(() => descriptorSql('mysql' as DbMotor))
  check(
    "descriptor('mysql') y descriptorSql('mysql') LANZAN «Motor desconocido: \"mysql\".»",
    eDesc === 'Motor desconocido: "mysql".' && eDescSql === 'Motor desconocido: "mysql".',
    `${eDesc} · ${eDescSql}`
  )
  check("descriptorSql('constructor') también lanza «Motor desconocido»", lanza(() => descriptorSql('constructor' as DbMotor)) === 'Motor desconocido: "constructor".', '')

  // (c) `esMotorSql`, `familiaDe`, `IDS_MOTORES_SQL`, `porMotorSql`, `candadoSoloLecturaDe`.
  check(
    'esMotorSql: sí los cuatro SQL; no MongoDB, Redis, un desconocido ni lo que no es un id',
    motoresSql.every((m) => esMotorSql(m)) &&
      [...Object.keys(OTRAS_FAMILIAS), 'mysql', 'constructor', '', 'ORACLE', undefined, null, 1].every((x) => !esMotorSql(x)),
    j(motores.map((m) => [m, esMotorSql(m)]))
  )
  const familias = porMotor((d) => familiaDe(d.id))
  check(
    'familiaDe: sql los cuatro SQL, documentos MongoDB, claves Redis',
    igual(familias, { oracle: 'sql', postgres: 'sql', sqlite: 'sql', sqlserver: 'sql', mongodb: 'documentos', redis: 'claves' }),
    j(familias)
  )
  const eFam = lanza(() => familiaDe('mysql' as DbMotor))
  check("familiaDe('mysql') LANZA «Motor desconocido» (como descriptor)", eFam === 'Motor desconocido: "mysql".', String(eFam))
  check(
    'IDS_MOTORES_SQL = oracle, postgres, sqlite y sqlserver, en el orden del registro',
    igual(IDS_MOTORES_SQL, ['oracle', 'postgres', 'sqlite', 'sqlserver']),
    j(IDS_MOTORES_SQL)
  )
  const porSql = porMotorSql((d) => d.sesion.versionMinima)
  check('porMotorSql: una entrada por motor SQL, y ninguna de otra familia', igual(porSql, { oracle: 11, postgres: 12, sqlite: 3, sqlserver: 11 }), j(porSql))
  const candados = porMotor(candadoSoloLecturaDe)
  check(
    'candadoSoloLecturaDe de los seis: el de la sesión en SQL, listaBlanca en MongoDB y Redis',
    igual(candados, {
      oracle: 'transaccionSoloLectura',
      postgres: 'envoltorioRollback',
      sqlite: 'autorizador',
      sqlserver: 'clasificadorYEnvoltorio',
      mongodb: 'listaBlanca',
      redis: 'listaBlanca'
    }),
    j(candados)
  )
  check(
    'candadoSoloLecturaDe en SQL es sesion.candadoSoloLectura (no una copia)',
    motoresSql.every((m) => candadoSoloLecturaDe(MOTORES[m]) === MOTORES[m].sesion.candadoSoloLectura),
    ''
  )

  // (e) `definirMotor` de una declaración que NO es SQL: deriva la conexión igual, deja su
  // grupo tal cual y NO le añade `catalogo` (ni `tieneSinonimos`): solo la SQL tiene carpetas.
  const conexionInventada: DeclaracionMotor<'mongodb'>['conexion'] = {
    puertoPorDefecto: 1,
    obligatorios: ['alias', 'host', 'port'],
    opcionales: ['user'],
    excluyentes: [],
    faltaDestino: {},
    descartarAlGuardar: [],
    usaClientes: false,
    extensionesArchivo: [],
    credenciales: 'usuarioClave',
    soloLecturaPorDefecto: true,
    destinoLegible: destinoDeRedUsuarioOpcional
  }
  const declDocumentos: DeclaracionMotor<'mongodb'> = {
    id: 'mongodb',
    etiqueta: 'Inventado',
    familia: 'documentos',
    conexion: conexionInventada,
    documentos: { nivelBases: 'ninguno', candadoSoloLectura: 'listaBlanca' }
  }
  const defDocumentos = definirMotor(declDocumentos)
  check(
    'definirMotor(documentos): NO añade `catalogo` (ni `sql` ni `sesion`)',
    !('catalogo' in defDocumentos) && !('sql' in defDocumentos) && !('sesion' in defDocumentos),
    Object.keys(defDocumentos).join(',')
  )
  check(
    'definirMotor(documentos): deriva la conexión (forma, deArchivo, validarDestino, sin faltaDestino) y deja el grupo tal cual',
    igual(defDocumentos.conexion.forma, ['host', 'port']) &&
      !defDocumentos.conexion.deArchivo &&
      defDocumentos.conexion.validarDestino({ database: '', sid: '' }) === null &&
      !('faltaDestino' in defDocumentos.conexion) &&
      defDocumentos.documentos === declDocumentos.documentos &&
      defDocumentos.familia === 'documentos',
    j(defDocumentos.conexion.forma)
  )
  const defClaves = definirMotor<'redis'>({
    id: 'redis',
    etiqueta: 'Inventado',
    familia: 'claves',
    conexion: conexionInventada,
    claves: { basesPorDefecto: 4, candadoSoloLectura: 'listaBlanca' }
  })
  check(
    'definirMotor(claves): tampoco añade `catalogo`, y deja su grupo tal cual',
    !('catalogo' in defClaves) && defClaves.claves.basesPorDefecto === 4 && igual(defClaves.conexion.forma, ['host', 'port']),
    Object.keys(defClaves).join(',')
  )
  const eDocSinMensaje = lanza(() => definirMotor({ ...declDocumentos, conexion: { ...conexionInventada, obligatorios: ['alias', 'host', 'database'] } }))
  check(
    'definirMotor(documentos): un obligatorio validable sin su mensaje tampoco construye (la regla es de la conexión, común)',
    eDocSinMensaje !== null && eDocSinMensaje.indexOf('database') >= 0,
    String(eDocSinMensaje)
  )

  // -------------------------------------------------------------------------
  hr('RESULTADO (PASS/FAIL)')
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  for (const r of results.filter((x) => !x.pass)) {
    console.log(`FAIL  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
