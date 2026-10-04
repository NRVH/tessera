// =============================================================================
// `tdb`: el CLI de bases de datos que Tessera pone en el PATH de sus terminales nativas para
// consultar las conexiones del perfil activo. Proceso CORTO por invocación (conecta, hace
// lo suyo, cierra y muere) con el ejecutable de Tessera bajo ELECTRON_RUN_AS_NODE=1.
// Las contraseñas llegan por el puente o el entorno y nunca se escriben en disco.
// Este archivo decide la guardia de solo lectura y despacha; el resto vive en `tdb*.cjs`.
// Decisiones: docs/decisiones/bd/tdb-registro-como-el-main.md
// =============================================================================
'use strict'

const { existsSync, readFileSync } = require('node:fs')
// Qué motores hay, su adaptador y el destino de `ls`. Sin drivers en su cadena de carga.
const motoresTdb = require('./motores.cjs')
const { fallar } = require('./tdbSalida.cjs')
const { contexto } = require('./tdbContexto.cjs')
const { adaptador, buscarConexion } = require('./tdbConexiones.cjs')
const { cmdLs } = require('./tdbLs.cjs')
const { cmdTest, ejecutarConsulta } = require('./tdbConsulta.cjs')
const { cmdSchema, cmdDescribe, cmdSessions } = require('./tdbEsquema.cjs')
const { cmdDriver } = require('./tdbDriver.cjs')
const { cmdDoctor } = require('./tdbDoctor.cjs')
const { ayuda } = require('./tdbAyuda.cjs')

/** Filas por defecto de una consulta. Un SELECT sin tope quema la ventana de
 *  contexto del agente y tira la sesión; el tope es una función, no una molestia. */
const LIMITE_POR_DEFECTO = 50

// Segunda capa sobre el candado del servidor: rechaza en el cliente lo que no sea claramente
// una lectura, para dar un mensaje CLARO en vez de un error críptico del motor y cubrir los
// motores sin candado de sesión. El muro de verdad es la transacción read-only del servidor.
// `INICIOS_LECTURA` y `esSoloLectura` van juntos y sin nada entre medias: `test-sql-clasificar`
// extrae este texto del archivo para fijar su paridad con el clasificador.
const INICIOS_LECTURA = ['select', 'with', 'show', 'desc', 'describe', 'explain']

function esSoloLectura(sql) {
  const limpio = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // comentarios de bloque
    .replace(/--[^\n]*/g, ' ') // comentarios de línea
    // Todo espacio en blanco se colapsa a uno solo ANTES de comparar: un `SELECT\n  col\nFROM t`
    // multilínea no empezaría por "select " y se rechazaría como si fuera una escritura.
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return INICIOS_LECTURA.some((k) => limpio.startsWith(k + ' ') || limpio === k)
}

/**
 * La guardia de solo lectura de `query`, ANTES de conectar (un texto rechazado ni abre
 * conexión). Por PREFIJO solo donde el muro es del SERVIDOR: donde es el autorizador (una base
 * de archivo) la guardia es él, que ve lo que la sentencia HACE. Donde el servidor no tiene
 * candado (`guardiaDeTessera`) es la del ADAPTADOR, y va delante también con una conexión de
 * escritura si el adaptador exporta `soloLecturaSiempre`.
 */
function exigirSoloLectura(ctx, con, alias, sql) {
  const api = motoresTdb.guardiaDeTessera(con.motor) ? adaptador(ctx, con) : null
  if (con.readonly === false && !(api && api.soloLecturaSiempre === true)) return
  if (api) {
    const g = api.guardiaSoloLectura(sql)
    if (!g.ok) fallar(ctx, api.mensajeGuardia(alias, g))
  } else if (motoresTdb.guardiaPorPrefijo(con.motor) && !esSoloLectura(sql)) {
    fallar(
      ctx,
      `"${alias}" es de SOLO LECTURA y esa sentencia no es una consulta.\n` +
        `    Permitidas: ${INICIOS_LECTURA.join(', ')}.`
    )
  }
}

async function cmdQuery(ctx, alias, sql, limite) {
  const con = buscarConexion(ctx, alias)
  exigirSoloLectura(ctx, con, alias, sql)
  await ejecutarConsulta(ctx, con, sql, limite)
}

/**
 * Lee el SQL de la entrada estándar. Es lo que hace robusta la consulta desde CUALQUIER
 * shell: en la línea de comandos el SQL pasa por el parser del shell, y cada uno lo estropea
 * a su manera (cmd expande `%VAR%`, bash expande `$` y backticks). Por stdin no pasa por ninguno.
 */
function leerStdin() {
  try {
    return readFileSync(0, 'utf-8')
  } catch {
    return ''
  }
}

/**
 * ¿Parece que el shell expandió una variable dentro del SQL? Busca la firma de un PATH de
 * Windows incrustado (`C:\algo;D:\algo`): una consulta corrompida así NO da error, devuelve
 * otras filas. Un falso positivo raro (siempre queda `--stdin`) vale más que una respuesta
 * silenciosamente equivocada.
 */
function pareceExpandido(texto) {
  const t = String(texto)
  if (/[A-Za-z]:[/\\][^;]{0,120};[A-Za-z]:[/\\]/.test(t)) return true
  const ruta = process.env.PATH || process.env.Path || ''
  return ruta.length > 40 && t.includes(ruta)
}

function requerido(ctx, valor, nombre) {
  if (!valor) fallar(ctx, `Falta el argumento <${nombre}>. Usa 'tdb help'.`)
  return valor
}

/**
 * De dónde sale el SQL de `query`: entrada estándar, archivo, o el argumento de toda la vida.
 * Los dos primeros son inmunes al parser del shell; el tercero pasa por el detector de expansión.
 */
function resolverSql(ctx, libres, porStdin, archivoSql) {
  if (porStdin) {
    const sql = leerStdin().trim()
    if (!sql) {
      fallar(
        ctx,
        'No llegó nada por la entrada estándar.\n' +
          "    Desde bash:  tdb query <base> --stdin <<'SQL'  …  SQL"
      )
    }
    return sql
  }
  if (archivoSql !== undefined) {
    if (!archivoSql) fallar(ctx, 'Falta la ruta después de --file.')
    if (!existsSync(archivoSql)) fallar(ctx, `No existe el archivo "${archivoSql}".`)
    const sql = readFileSync(archivoSql, 'utf-8').trim()
    if (!sql) fallar(ctx, `El archivo "${archivoSql}" está vacío.`)
    return sql
  }
  const sql = requerido(ctx, libres[2], 'SQL')
  if (pareceExpandido(sql)) {
    fallar(
      ctx,
      'Tu shell parece haber expandido una variable DENTRO del SQL: la consulta lleva\n' +
        '    incrustada una ruta del sistema. Suele pasar en cmd.exe con un LIKE que\n' +
        '    contiene %algo%, y no daría error: devolvería otras filas.\n' +
        '\n' +
        '    Pásalo por la entrada estándar, que no atraviesa ningún parser:\n' +
        "      tdb query <base> --stdin <<'SQL'  …  SQL"
    )
  }
  return sql
}

/** Separa las opciones (`--json`, `--limit N`, `--stdin`, `--file R`) de los argumentos libres. */
function leerArgumentos(argv) {
  let limite = LIMITE_POR_DEFECTO
  const iLimit = argv.indexOf('--limit')
  if (iLimit >= 0) {
    const n = Number(argv[iLimit + 1])
    if (Number.isInteger(n) && n > 0) limite = n
  }
  const iFile = argv.indexOf('--file')
  // Quita las banderas y sus valores para que las posiciones de los argumentos sean estables.
  const libres = argv.filter((a, i) => {
    if (a === '--json' || a === '--limit' || a === '--stdin' || a === '--file') return false
    if (iLimit >= 0 && i === iLimit + 1) return false
    if (iFile >= 0 && i === iFile + 1) return false
    return true
  })
  return {
    json: argv.includes('--json'),
    porStdin: argv.includes('--stdin'),
    limite,
    limiteDado: iLimit >= 0,
    archivoSql: iFile >= 0 ? argv[iFile + 1] : undefined,
    libres
  }
}

function despachar(cmd, ctx, a) {
  const { libres } = a
  switch (cmd) {
    case 'ls':
      return cmdLs(ctx)
    case 'doctor':
      return cmdDoctor(ctx)
    case 'test':
      return cmdTest(ctx, requerido(ctx, libres[1], 'alias'))
    case 'query':
      return cmdQuery(ctx, requerido(ctx, libres[1], 'alias'), resolverSql(ctx, libres, a.porStdin, a.archivoSql), a.limite)
    case 'schema':
      // El tercer argumento es el patrón de MATCH (solo motores de claves), y `--limit`, si se
      // da, cuántas claves enseña (sin él, el tope del adaptador).
      return cmdSchema(ctx, requerido(ctx, libres[1], 'alias'), libres[2], a.limiteDado ? a.limite : undefined)
    case 'describe':
      return cmdDescribe(ctx, requerido(ctx, libres[1], 'alias'), requerido(ctx, libres[2], 'tabla'))
    case 'sessions':
      return cmdSessions(ctx, requerido(ctx, libres[1], 'alias'))
    case 'driver':
      return cmdDriver(ctx, libres[1], libres[2])
    default:
      return fallar(ctx, `Comando desconocido: "${cmd}". Usa 'tdb help'.`)
  }
}

async function main(a) {
  const cmd = a.libres[0]
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return ayuda(LIMITE_POR_DEFECTO)

  // `doctor` es TOLERANTE: tiene que poder correr precisamente cuando no hay contexto, que es
  // cuando más falta hace.
  const ctx = await contexto({ tolerante: cmd === 'doctor', json: a.json })
  return despachar(cmd, ctx, a)
}

/**
 * Sale del proceso SIN esperar a que el bucle de eventos se vacíe: tras cerrar la conexión, el
 * cliente Oracle deja hilos o temporizadores vivos y el proceso tardaba ~30 s en morir aunque la
 * consulta hubiera terminado en medio segundo, y quien invoca `tdb` espera a que acabe. Antes de
 * salir se vacía stdout: con la salida canalizada, `process.exit()` a secas puede truncar lo que
 * quede en el buffer. Los caminos de error ya salen por `fallar()`.
 */
function salir(code) {
  process.exitCode = code
  process.stdout.write('', () => process.exit(code))
}

// Los argumentos se leen fuera de `main`: `fallar` necesita su `json` también si lo que revienta
// es `contexto()`, que es antes de que el `ctx` exista.
const argumentos = leerArgumentos(process.argv.slice(2))

main(argumentos)
  .then(() => salir(0))
  .catch((err) => {
    const mensaje = err && err.message ? err.message : String(err)
    fallar(argumentos, mensaje, err && err.requiereDriver ? { requiereDriver: err.requiereDriver } : undefined)
  })
