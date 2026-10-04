// =============================================================================
// Prueba de los atajos `tdb`: se generan en un tmpdir y se EJECUTAN de verdad desde los tres shells (sh,
// PowerShell, cmd; los que no estén se saltan). Fija además, ejecutando `tdb`, cómo nombra el sitio de los
// montajes, el entorno de cada conexión, la lectura del registro igual que el main (`.bak`, formato ajeno,
// archivo ilegible, id repetido, motor desconocido) y que una contraseña solo viaja al destino para el que
// se emitió (la huella). (node src/main/db/test-shim.mts)
// Decisiones: docs/decisiones/bd/puente-atajos-de-tdb.md, docs/decisiones/bd/puente-huella-del-destino.md
// =============================================================================
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generarShims, SHIM_DIR } from './shims.ts'
import { DbBridge } from './dbBridge.ts'
import { construirEntornoHost } from './hostEnv.ts'
import { huellaDestino } from './huellaDestino.ts'
import { citarPowerShell, citarSh } from '../../shared/citarShell.ts'
import { esWindows } from '../../shared/plataforma.ts'
import {
  MOTORES_CONOCIDOS,
  ajenasDelPerfil,
  conocidas,
  lecturaConRespaldo,
  leerRegistro,
  perfilDeEntrada,
  quitarPorId,
  serializarRegistro,
  type Registro
} from './registroConexiones.ts'

let fallos = 0
let saltados = 0

function comprobar(nombre: string, condicion: boolean, detalle?: string): void {
  if (condicion) {
    console.log(`  ✓ ${nombre}`)
  } else {
    fallos++
    console.log(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ''}`)
  }
}

function saltar(nombre: string, motivo: string): void {
  saltados++
  console.log(`  — ${nombre} (saltado: ${motivo})`)
}

// --- Citado ------------------------------------------------------------------
// El citado en sí (forma y viaje de ida y vuelta real por sh y PowerShell) se prueba
// en `shared/test-citar-shell.mts`, que es donde vive ahora. Aquí sólo se fija que
// los atajos lo USAN: una ruta con apóstrofo NO es rebuscada —`C:\Users\O'Brien\...`
// es un usuario de Windows perfectamente normal— y sin escapar rompe los tres a la vez.

console.log('\nCitado de rutas en los atajos\n')
{
  const exe = "C:\\Users\\O'Brien\\Tessera.exe"
  const script = "C:\\Users\\O'Brien\\tdb.cjs"
  const shims = generarShims({ exe, script, sello: 'T' }, 'windows')
  const sh = shims.find((s) => s.nombre === 'tdb')!
  const ps1 = shims.find((s) => s.nombre === 'tdb.ps1')!
  comprobar(
    'sh: el atajo lleva la ruta horneada con el citado POSIX (`\'\\\'\'`)',
    sh.contenido.includes(`TESSERA_EXE=${citarSh(exe)}`) && sh.contenido.includes(`TESSERA_TDB=${citarSh(script)}`),
    sh.contenido.split('\n').find((l) => l.includes('TESSERA_EXE=')) ?? '(sin línea)'
  )
  comprobar(
    "sh: el apóstrofo va cerrado, escapado y reabierto (no duplicado)",
    sh.contenido.includes("O'" + String.fromCharCode(92) + "''Brien") && !sh.contenido.includes("O''Brien"),
    sh.contenido.split('\n').find((l) => l.includes('TESSERA_EXE=')) ?? '(sin línea)'
  )
  comprobar(
    "PowerShell: el atajo lleva la ruta horneada con el citado de PowerShell (`''`)",
    ps1.contenido.includes(`{ ${citarPowerShell(exe)} }`) && ps1.contenido.includes("O''Brien"),
    ps1.contenido.split('\n').find((l) => l.includes('$exe =')) ?? '(sin línea)'
  )
}
{
  const conEspacios = 'C:\\Program Files\\Tessera\\Tessera.exe'
  comprobar('sh: los espacios no necesitan escape dentro de comillas simples', citarSh(conEspacios) === `'${conEspacios}'`)
  comprobar('PowerShell: idem', citarPowerShell(conEspacios) === `'${conEspacios}'`)
}

// --- Fin de línea ------------------------------------------------------------

console.log('\nFin de línea\n')
{
  // La plataforma se fija EXPLÍCITA: `generarShims` devuelve los tres atajos sólo en
  // Windows, así que sin este argumento estos casos comprobarían una cosa u otra según
  // dónde se corra el test — y los de PowerShell/cmd, que son los que documentan el
  // fallo del CRLF, dejarían de comprobarse en cuanto alguien lo ejecutara desde un Mac.
  const shims = generarShims(
    { exe: 'C:\\x\\node.exe', script: 'C:\\x\\tdb.cjs', sello: 'T' },
    'windows'
  )
  const sh = shims.find((s) => s.nombre === 'tdb')!
  // Un solo CR en la línea del shebang convierte el intérprete en "/bin/sh\r", que
  // no existe. El error que da ("bad interpreter") no menciona el CR por ningún lado,
  // así que este invariante se fija aquí y no a ojo.
  comprobar('el atajo sh no lleva NI UN CR', !sh.contenido.includes('\r'))
  comprobar('el atajo sh empieza por el shebang', sh.contenido.startsWith('#!/bin/sh\n'))
  comprobar('el atajo sh se declara LF', sh.eol === 'lf')
  for (const nombre of ['tdb.ps1', 'tdb.cmd']) {
    const s = shims.find((x) => x.nombre === nombre)!
    const lineas = s.contenido.split('\n').slice(0, -1)
    comprobar(`${nombre} va entero en CRLF`, lineas.every((l) => l.endsWith('\r')))
  }
  comprobar('Windows genera los TRES atajos', shims.length === 3)
}

// --- Cuántos atajos por plataforma -------------------------------------------

console.log('\nAtajos por plataforma\n')
{
  // En macOS no hay PowerShell, ni cmd, ni `PATHEXT`: el `sh` es el único shell que va
  // a ver ese PATH. Escribir los otros dos dejaría en `userData` dos ficheros que nada
  // puede ejecutar y haría mentir a `tdb doctor`, que deduce el shell de QUÉ atajo se
  // usó y anunciaría "Git Bash / MSYS" en un Mac.
  const mac = generarShims({ exe: '/x/node', script: '/x/tdb.cjs', sello: 'T' }, 'mac')
  comprobar('macOS genera UN solo atajo', mac.length === 1)
  comprobar('y es el de sh', mac[0].nombre === 'tdb' && mac[0].eol === 'lf')
  comprobar(
    'sin .ps1 ni .cmd, que allí nada puede ejecutar',
    !mac.some((s) => s.nombre.endsWith('.ps1') || s.nombre.endsWith('.cmd'))
  )
  const otra = generarShims({ exe: '/x/node', script: '/x/tdb.cjs', sello: 'T' }, 'otra')
  comprobar('Linux se comporta como macOS, no como Windows', otra.length === 1)
}

// --- Ejecución real ----------------------------------------------------------

const tdbCjs = path.join(process.cwd(), 'src', 'tdb', 'tdb.cjs')
if (!existsSync(tdbCjs)) {
  console.log(`\n  ! No encuentro ${tdbCjs}; ejecuta el test desde la raíz del repo.\n`)
  process.exit(1)
}

const dir = mkdtempSync(path.join(tmpdir(), 'tessera-shim-'))
const binDir = path.join(dir, 'bin', SHIM_DIR)
mkdirSync(binDir, { recursive: true })

// `node.exe` hace de ejecutable en vez de Tessera.exe: el atajo no sabe ni le
// importa cuál de los dos es, y así el test corre sin la app instalada.
for (const { nombre, contenido, eol } of generarShims({
  exe: process.execPath,
  script: tdbCjs,
  sello: 'test'
})) {
  const destino = path.join(binDir, nombre)
  writeFileSync(destino, contenido)
  // EL MISMO `chmod` QUE HACE PRODUCCIÓN (`escribirAtajos` en `controlador/atajosTdb.ts`), y por el mismo
  // motivo: `writeFileSync` crea el archivo en 0644, y en macOS el shell responde
  // `Permission denied` a un atajo que está ahí, en el PATH y con el contenido
  // correcto. En Windows es un no-op (no hay bit de ejecución; manda `PATHEXT`).
  //
  // Se replica aquí a propósito, en vez de dar el permiso por hecho: si producción
  // dejara de ponerlo, este test tiene que poder seguir siendo el que lo cace, y para
  // eso tiene que reproducir el mismo camino de escritura.
  if (eol === 'lf') chmodSync(destino, 0o755)
}

/** Entorno de una terminal de Tessera con un registro de mentira y una conexión. */
const registro = path.join(dir, 'db-connections.json')
writeFileSync(
  registro,
  JSON.stringify({
    connections: [
      {
        id: 'c1',
        profileId: 'p1',
        alias: 'mibase',
        motor: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'demo',
        user: 'u',
        readonly: true
      }
    ]
  })
)
// Ojo con el entorno heredado: dentro de una terminal de agente de Tessera, `TESSERA_DB_PIPE` y
// `TESSERA_DB_SESSION` apuntan al puente vivo del usuario y en `tdb` el puente manda sobre el entorno,
// así que pisaría el ámbito de mentira del test (verde en una consola normal, rojo dentro de Tessera).
// Se anulan todas las TESSERA_* y se vuelven a poner solo las del escenario.
const entornoLimpio = Object.fromEntries(
  Object.keys(process.env)
    .filter((k) => k.startsWith('TESSERA_'))
    .map((k) => [k, undefined])
)
const entorno = {
  ...process.env,
  ...entornoLimpio,
  // `path.delimiter` y no un `;` literal: en macOS el separador del PATH es `:`, y con
  // el punto y coma clavado la carpeta de atajos quedaba pegada al resto del PATH en un
  // único segmento inexistente. El síntoma era `bash: tdb: command not found` con el
  // atajo recién escrito y correcto — el mismo fallo que este test existe para cazar.
  PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
  Path: undefined,
  TESSERA_DB_REGISTRY: registro,
  TESSERA_PROFILE: 'p1',
  TESSERA_DB_SCOPE: 'c1',
  TESSERA_EXE: process.execPath,
  TESSERA_TDB: tdbCjs
} as NodeJS.ProcessEnv

/**
 * La huella del destino de la `base-pg` (`k1`) de varios registros de abajo, que viaja con su
 * contraseña de mentira (`TESSERA_DB_DESTINO_K1`): `tdb` no usa un secreto
 * sin la huella de su destino, y `doctor` lo contaría como de otro destino. Calculada con la
 * función del MAIN: que `tdb` la acepte es, de paso, la paridad de las dos copias.
 */
const HUELLA_K1 = huellaDestino({ motor: 'postgres', host: 'localhost', port: 5432, database: 'demo', user: 'u' })

/**
 * Nombre real del ejecutable de cada shell en ESTE sistema.
 *
 * En macOS no llevan `.exe`, y `powershell`/`cmd` sencillamente no existen: sus casos
 * se saltan solos por `existeEjecutable`, que es el comportamiento correcto —no son un
 * fallo allí, son un shell que no está—. Lo que NO puede saltarse es `bash`: en macOS
 * es el shell sobre el que corre la herramienta Bash del agente, o sea exactamente el
 * caso que el atajo `sh` existe para desbloquear.
 */
function exeDeShell(shell: 'bash' | 'powershell' | 'cmd'): string {
  const sufijo = esWindows() ? '.exe' : ''
  return `${shell === 'powershell' ? 'powershell' : shell}${sufijo}`
}

/**
 * ¿Está este ejecutable en el PATH?
 *
 * `where` es de Windows; en macOS/Linux el equivalente es `which`. Con `where` clavado,
 * en un Mac TODOS los shells se declaraban "no instalado" y los nueve casos de esta
 * sección se saltaban en silencio — incluidos los de bash, que sí existe. Un test que
 * se salta solo es peor que uno que falla: parece verde.
 */
function existeEjecutable(cmd: string): boolean {
  const buscador = esWindows() ? 'where' : 'which'
  const r = spawnSync(buscador, [cmd], { encoding: 'utf-8', shell: false })
  return r.status === 0
}

/**
 * Si bash arranca como shell de LOGIN (`-l`). Solo hace falta donde se prueba que el atajo se
 * RESUELVE (el `/etc/profile` de Git Bash rehace el PATH, y ahí es donde fallaba); en las
 * secciones de textos bash es solo el vehículo y se lanza sin perfil, como PowerShell
 * (`-NoProfile`) y cmd (`/d`). Con login, cada una de sus ~150 llamadas cargaba además el
 * perfil de quien corre la prueba: ~0,35 s en reposo y más de 10 s con la batería cargando la
 * máquina, que es como la prueba llegó al tope de 900 s sin estar colgada.
 */
let bashConLogin = true

/** Argumentos para que un shell ejecute UNA línea y termine. */
function argsDeShell(shell: 'bash' | 'powershell' | 'cmd', linea: string): string[] {
  const args: Record<typeof shell, string[]> = {
    bash: [bashConLogin ? '-lc' : '-c', linea],
    powershell: ['-NoProfile', '-NonInteractive', '-Command', linea],
    cmd: ['/d', '/c', linea]
  }
  return args[shell]
}

/**
 * Tope de CADA hijo. Ninguno tenía: un `tdb` o un shell que no terminara (o un nieto que se
 * quedara con su stdout) colgaba la prueba entera hasta que la batería la mataba a los
 * 900 s, sin decir en qué línea. Con la máquina cargada un hijo sano tarda un par de
 * segundos; pasado el tope se mata y el fallo NOMBRA el shell y la línea.
 */
const PLAZO_HIJO_MS = 120_000

/** El texto que se añade a la salida de un hijo que agotó su tope. */
function avisoColgado(shell: string, linea: string): string {
  return `\n[test-shim] COLGADO: «${linea}» en ${shell} no terminó en ${PLAZO_HIJO_MS / 1000} s y se mató`
}

/** Ejecuta una línea en un shell concreto y devuelve salida y código. */
function correr(
  shell: 'bash' | 'powershell' | 'cmd',
  linea: string,
  stdin?: string,
  env: NodeJS.ProcessEnv = entorno
): { out: string; code: number } {
  const exe = exeDeShell(shell)
  const r = spawnSync(exe, argsDeShell(shell, linea), {
    encoding: 'utf-8',
    env,
    input: stdin,
    cwd: dir,
    timeout: PLAZO_HIJO_MS
  })
  const colgado = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
  if (colgado) console.log(avisoColgado(shell, linea))
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}${colgado ? avisoColgado(shell, linea) : ''}`, code: r.status ?? -1 }
}

/**
 * Como `correr`, pero SIN bloquear el bucle de eventos. Hace falta cuando el puente
 * vive en ESTE proceso: con `spawnSync` el servidor no podría contestar mientras se
 * espera al hijo, `tdb` agotaría su timeout y seguiría sin puente — y el test
 * estaría comprobando el respaldo creyendo que comprueba el puente.
 */
function correrAsincrono(
  shell: 'bash' | 'powershell' | 'cmd',
  linea: string,
  env: NodeJS.ProcessEnv
): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    const hijo = spawn(exeDeShell(shell), argsDeShell(shell, linea), { env, cwd: dir })
    let out = ''
    let hecho = false
    const fin = (r: { out: string; code: number }): void => {
      if (hecho) return
      hecho = true
      clearTimeout(reloj)
      resolve(r)
    }
    // Se resuelve SIN esperar al `close`: si un nieto se queda con el stdout, ese evento no
    // llega nunca aunque se mate al shell.
    const reloj = setTimeout(() => {
      console.log(avisoColgado(shell, linea))
      hijo.kill()
      fin({ out: out + avisoColgado(shell, linea), code: -1 })
    }, PLAZO_HIJO_MS)
    hijo.stdout.on('data', (t: Buffer) => {
      out += t.toString('utf-8')
    })
    hijo.stderr.on('data', (t: Buffer) => {
      out += t.toString('utf-8')
    })
    hijo.on('error', () => fin({ out, code: -1 }))
    hijo.on('close', (code) => fin({ out, code: code ?? -1 }))
  })
}

/**
 * Espera a que el puente de prueba escuche, con tope. Antes eran 250 ms fijos: con la máquina
 * cargada el `listen` del pipe llega más tarde y la prueba cantaba «no escucha» sin estar roto.
 */
async function esperarPuente(puente: DbBridge, msMax = 10_000): Promise<boolean> {
  for (const fin = Date.now() + msMax; !puente.listo && Date.now() < fin; ) {
    await new Promise((r) => setTimeout(r, 50))
  }
  return puente.listo
}

console.log('\nResolución de `tdb` en cada shell\n')

const shells: Array<'bash' | 'powershell' | 'cmd'> = ['bash', 'powershell', 'cmd']
const disponibles = shells.filter((s) => existeEjecutable(exeDeShell(s)))

for (const shell of shells) {
  if (!disponibles.includes(shell)) {
    saltar(`${shell}: resuelve \`tdb\``, 'no está instalado')
    continue
  }
  // ESTA es la comprobación que importa: que el nombre pelado `tdb` se resuelva.
  // Antes fallaba en bash y en cmd, y ahí es donde vive el agente.
  const { out, code } = correr(shell, 'tdb doctor --json')
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(out.trim().split(/\r?\n/).pop() ?? '')
  } catch {
    json = null
  }
  comprobar(`${shell}: resuelve \`tdb\` y responde doctor`, code === 0 && json?.ok === true, out.slice(0, 300))
  if (json) {
    comprobar(`${shell}: ve el ámbito y la conexión montada`, json.conexionesVisibles === 1, JSON.stringify(json))
    comprobar(`${shell}: reconoce que el atajo está en el PATH`, json.atajoEnPath === true, JSON.stringify(json))
  }
}

console.log('\nSQL a prueba de shells\n')

// El SQL que rompe todo si viaja por la línea de comandos: porcentajes (cmd los
// expande), dólares y admiración (bash), comillas de los dos tipos y saltos de línea.
const SQL_HOSTIL = "SELECT '%García%', \"x\", 'a!b', '$HOME'\nFROM t\nWHERE c LIKE '%2026%'"

for (const shell of shells) {
  if (!disponibles.includes(shell)) {
    saltar(`${shell}: --stdin conserva el SQL intacto`, 'no está instalado')
    continue
  }
  // Sin conexión real no se puede consultar, pero sí comprobar lo único que este
  // test puede comprobar: que el SQL llega ENTERO hasta el motor. Si el shell lo
  // hubiera destrozado, el guardia de solo-lectura o el parser fallarían antes.
  const { out } = correr(shell, 'tdb query mibase --stdin --json', SQL_HOSTIL)
  const llego = !out.includes('SOLO LECTURA') && !out.includes('Falta el argumento')
  comprobar(`${shell}: --stdin conserva el SQL intacto`, llego, out.slice(0, 200))
}

if (disponibles.includes('cmd')) {
  // cmd expande %VAR% en la línea del usuario, antes de que el .cmd exista para el
  // sistema. No hay arreglo posible dentro del batch, así que el comportamiento
  // correcto es NEGARSE, no acertar a veces.
  const { out, code } = correr('cmd', 'tdb query mibase "SELECT 1"')
  comprobar('cmd: `query` sin --stdin se NIEGA', code === 3 && out.includes('--stdin'), `code=${code} ${out.slice(0, 200)}`)
  const r2 = correr('cmd', 'tdb query mibase --stdin --json', 'SELECT 1')
  comprobar('cmd: `query` con --stdin SÍ se ejecuta', !r2.out.includes('expande las'), r2.out.slice(0, 200))
}

if (disponibles.includes('bash')) {
  // MSYS convierte a ruta de Windows cualquier argumento que empiece por "/" —un
  // hint de Oracle al principio del SQL, por ejemplo—. Sin desactivarlo, la consulta
  // sale mal SIN dar error, que es el peor resultado posible.
  const { out } = correr('bash', "tdb query /noexiste --json 2>&1")
  comprobar(
    'bash: un argumento que empieza por "/" NO se convierte a ruta de Windows',
    !out.includes('Program Files') && !out.includes('C:/'),
    out.slice(0, 250)
  )
}

console.log('\nCódigo de salida\n')

for (const shell of shells) {
  if (!disponibles.includes(shell)) {
    saltar(`${shell}: propaga el código de salida`, 'no está instalado')
    continue
  }
  // `tdb` sale con 1 ante un error de uso. Si el atajo se lo comiera, un script que
  // encadene consultas seguiría adelante como si nada hubiera fallado.
  const { code } = correr(shell, 'tdb query no-existe-esta-base --stdin', 'SELECT 1')
  comprobar(`${shell}: propaga el código de salida`, code === 1, `code=${code}`)
}

// --- Redacción: «este proyecto» o «el agente de datos» ------------------------

console.log('\nCómo nombra `tdb` el sitio de los montajes\n')

/** Lee la última línea de la salida como JSON (la de `--json`), o null. */
function jsonDe(out: string): Record<string, unknown> | null {
  try {
    return JSON.parse(out.trim().split(/\r?\n/).pop() ?? '')
  } catch {
    return null
  }
}

// Un shell basta: lo que se prueba es el TEXTO de `tdb`, y la resolución del atajo en
// cada shell ya la cubre la sección de arriba. bash primero, porque es el del agente
// (Git Bash en Windows, el shell de la herramienta Bash en macOS).
const shellTextos = disponibles.includes('bash') ? 'bash' : disponibles[0]
// Desde aquí bash es solo el vehículo de los textos: sin login (ver `bashConLogin`).
bashConLogin = false
if (!shellTextos) {
  saltar('redacción de los mensajes de tdb', 'no hay ningún shell disponible')
} else {
  // Ámbito DEFINIDO que no casa con ninguna conexión del registro: es el vacío "no
  // tiene ninguna base montada" (y no el de "no hay conexiones en el perfil"). Un id
  // inexistente y no la cadena vacía: una variable VACÍA no sobrevive igual en todos
  // los shells, y el caso a probar es el mismo.
  const sinMontar = { ...entorno, TESSERA_DB_SCOPE: 'ninguna-montada', TESSERA_DB_MODE: 'env' } as NodeJS.ProcessEnv
  const espacio = { ...sinMontar, TESSERA_DB_ESPACIO: '1' } as NodeJS.ProcessEnv

  // PROYECTO: los textos de siempre, carácter a carácter en lo que se compara.
  const lsProyecto = correr(shellTextos, 'tdb ls', undefined, sinMontar).out
  comprobar(
    `${shellTextos}: en un proyecto, \`ls\` dice «Este PROYECTO no tiene ninguna base montada.»`,
    lsProyecto.includes('Este PROYECTO no tiene ninguna base montada.') && !lsProyecto.includes('agente de datos'),
    lsProyecto.slice(0, 300)
  )
  const doctorProyecto = correr(shellTextos, 'tdb doctor', undefined, sinMontar).out
  comprobar(
    `${shellTextos}: en un proyecto, \`doctor\` dice «acotado a este proyecto» y su veredicto de siempre`,
    doctorProyecto.includes('acotado a este proyecto') &&
      doctorProyecto.includes('Contexto correcto, pero este proyecto no tiene ninguna base montada.') &&
      !doctorProyecto.includes('agente de datos'),
    doctorProyecto.slice(-400)
  )

  // ESPACIO DE DATOS, por el entorno (contrato `env`, sin puente).
  const lsEspacio = correr(shellTextos, 'tdb ls', undefined, espacio).out
  comprobar(
    `${shellTextos}: con TESSERA_DB_ESPACIO=1, \`ls\` dice «El agente de datos no tiene ninguna base montada.»`,
    lsEspacio.includes('El agente de datos no tiene ninguna base montada.'),
    lsEspacio.slice(0, 300)
  )
  comprobar(`${shellTextos}: y \`ls\` no dice «proyecto» por ningún lado`, !/proyecto/i.test(lsEspacio), lsEspacio.slice(0, 300))
  const doctorEspacio = correr(shellTextos, 'tdb doctor', undefined, espacio).out
  comprobar(
    `${shellTextos}: con la marca, \`doctor\` dice «acotado al agente de datos» y lo nombra en el veredicto`,
    doctorEspacio.includes('acotado al agente de datos') &&
      doctorEspacio.includes('Contexto correcto, pero el agente de datos no tiene ninguna base montada.'),
    doctorEspacio.slice(-400)
  )
  // «este proyecto», no «proyecto» a secas: el volcado de `doctor` enseña rutas (la del
  // guion, la del ejecutable), y la carpeta del repo puede llamarse como quiera.
  comprobar(`${shellTextos}: y \`doctor\` no dice «este proyecto»`, !/este proyecto/i.test(doctorEspacio), doctorEspacio.slice(-400))

  // `--json`: el campo nuevo, y que la marca NO cambia el ámbito (mismo recuento).
  const jsonProyecto = jsonDe(correr(shellTextos, 'tdb doctor --json', undefined, sinMontar).out)
  const jsonEspacio = jsonDe(correr(shellTextos, 'tdb doctor --json', undefined, espacio).out)
  comprobar(
    `${shellTextos}: \`doctor --json\` expone espacioDatos (false / true)`,
    jsonProyecto?.espacioDatos === false && jsonEspacio?.espacioDatos === true,
    `${JSON.stringify(jsonProyecto?.espacioDatos)} / ${JSON.stringify(jsonEspacio?.espacioDatos)}`
  )
  comprobar(
    `${shellTextos}: la marca no cambia el ámbito (mismas visibles, mismo "acotado")`,
    jsonProyecto !== null &&
      jsonEspacio !== null &&
      jsonProyecto.conexionesVisibles === jsonEspacio.conexionesVisibles &&
      jsonProyecto.ambitoDefinido === true &&
      jsonEspacio.ambitoDefinido === true,
    `${JSON.stringify(jsonProyecto)} / ${JSON.stringify(jsonEspacio)}`
  )
  // Solo el '1' marca: cualquier otro valor es un proyecto.
  const lsOtroValor = correr(shellTextos, 'tdb ls', undefined, { ...sinMontar, TESSERA_DB_ESPACIO: '0' }).out
  comprobar(
    `${shellTextos}: TESSERA_DB_ESPACIO distinto de '1' cuenta como proyecto`,
    lsOtroValor.includes('Este PROYECTO no tiene ninguna base montada.'),
    lsOtroValor.slice(0, 200)
  )

  // EL PUENTE MANDA sobre el entorno, también en esto. Un puente REAL en este proceso
  // (por eso el hijo se lanza sin bloquear), con la conexión del registro en el
  // perfil y el ámbito vacío.
  const puente = new DbBridge({
    conexionesDelPerfil: (id) =>
      id === 'p1' ? [{ id: 'c1', profileId: 'p1', motor: 'postgres', host: 'localhost', port: 5432, database: 'demo', user: 'u' }] : [],
    secretoDe: () => null
  })
  puente.start()
  if (!(await esperarPuente(puente))) {
    comprobar('el puente de prueba levanta', false, 'no escucha')
  } else {
    const RUTA = path.join(dir, 'espacio-de-datos')
    puente.setScope('p1', RUTA, [])
    /** Entorno de modo puente. `TESSERA_DB_SCOPE: 'c1'` (heredado) lo pisa el puente. */
    const conPuente = (token: string, marca: boolean): NodeJS.ProcessEnv =>
      ({
        ...entorno,
        TESSERA_DB_MODE: 'pipe',
        TESSERA_DB_PIPE: puente.pipe,
        TESSERA_DB_SESSION: token,
        ...(marca ? { TESSERA_DB_ESPACIO: '1' } : {})
      }) as NodeJS.ProcessEnv

    // El puente dice "espacio" y el entorno no dice nada: gana el puente.
    const porPuente = await correrAsincrono(
      shellTextos,
      'tdb ls',
      conPuente(puente.mint('p1', RUTA, { espacioDatos: true }), false)
    )
    comprobar(
      `${shellTextos}: con el puente marcando el espacio (sin variable), \`ls\` dice «El agente de datos…»`,
      porPuente.out.includes('El agente de datos no tiene ninguna base montada.'),
      porPuente.out.slice(0, 300)
    )
    // El puente dice "proyecto" y el entorno dice "espacio": gana el puente, que es
    // de este instante (el entorno se fijó al arrancar el pty).
    const contraEntorno = await correrAsincrono(
      shellTextos,
      'tdb ls',
      conPuente(puente.mint('p1', RUTA, { espacioDatos: false }), true)
    )
    comprobar(
      `${shellTextos}: si el puente dice proyecto, manda sobre TESSERA_DB_ESPACIO=1`,
      contraEntorno.out.includes('Este PROYECTO no tiene ninguna base montada.'),
      contraEntorno.out.slice(0, 300)
    )
  }
  puente.stop()
}

// --- El entorno de cada conexión en `tdb ls` -----------
// En PRODUCCIÓN, Tessera pide confirmación al usuario antes de cada escritura; `tdb`
// no pasa por ese diálogo, así que `ls` marca las de producción y deja la regla
// escrita debajo (la misma que el bloque de memoria del agente).
console.log('\nEntorno de las conexiones en `tdb ls`\n')
if (!shellTextos) {
  saltar('el entorno en `tdb ls`', 'no hay ningún shell disponible')
} else {
  const registroEntornos = path.join(dir, 'db-connections-entornos.json')
  const con = (id: string, alias: string, extra: Record<string, unknown>): Record<string, unknown> => ({
    id,
    profileId: 'p1',
    alias,
    motor: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'demo',
    user: 'u',
    readonly: true,
    ...extra
  })
  writeFileSync(
    registroEntornos,
    JSON.stringify({
      connections: [
        con('e1', 'base-dev', { entorno: 'desarrollo' }),
        con('e2', 'base-prod', { entorno: 'produccion', readonly: false }),
        con('e3', 'base-sin', {}),
        con('e4', 'base-rara', { entorno: 'prod' }),
        con('e5', 'base-pruebas', { entorno: 'pruebas' })
      ]
    })
  )
  const conEntornos = {
    ...entorno,
    TESSERA_DB_REGISTRY: registroEntornos,
    TESSERA_DB_SCOPE: 'e1,e2,e3,e4,e5',
    TESSERA_DB_MODE: 'env'
  } as NodeJS.ProcessEnv
  const ls = correr(shellTextos, 'tdb ls', undefined, conEntornos).out
  const lineaDe = (alias: string): string => ls.split(/\r?\n/).find((l) => l.includes(alias)) ?? ''
  comprobar(`${shellTextos}: \`ls\` tiene la columna ENTORNO`, /\bENTORNO\b/.test(ls), ls.slice(0, 500))
  comprobar(`${shellTextos}: producción en MAYÚSCULAS en su fila`, lineaDe('base-prod').includes('PRODUCCIÓN'), lineaDe('base-prod'))
  comprobar(
    `${shellTextos}: pruebas y desarrollo con su nombre`,
    lineaDe('base-pruebas').includes('pruebas') && lineaDe('base-dev').includes('desarrollo'),
    `${lineaDe('base-pruebas')} / ${lineaDe('base-dev')}`
  )
  comprobar(
    `${shellTextos}: NEGATIVO: sin entorno, o con uno que no existe, no se pinta nada`,
    !/PRODUCCIÓN|pruebas|desarrollo|prod\b/.test(lineaDe('base-sin')) && !/PRODUCCIÓN|prod\b/.test(lineaDe('base-rara')),
    `${lineaDe('base-sin')} / ${lineaDe('base-rara')}`
  )
  comprobar(
    `${shellTextos}: el aviso de debajo nombra solo las de producción, con la regla`,
    ls.includes('PRODUCCIÓN: base-prod.') && ls.includes('No escribas en ella salvo que el usuario lo pida explícitamente.'),
    ls.slice(-300)
  )
  const lsSinProd = correr(shellTextos, 'tdb ls', undefined, { ...conEntornos, TESSERA_DB_SCOPE: 'e1,e3' }).out
  comprobar(
    `${shellTextos}: NEGATIVO: sin ninguna de producción montada, ni aviso ni regla`,
    lsSinProd.includes('base-dev') && !lsSinProd.includes('No escribas') && !lsSinProd.includes('PRODUCCIÓN:'),
    lsSinProd.slice(0, 400)
  )
  const json = jsonDe(correr(shellTextos, 'tdb ls --json', undefined, conEntornos).out) as { conexiones?: Array<{ alias: string; entorno?: string }> } | null
  const prod = json?.conexiones?.find((c) => c.alias === 'base-prod')
  comprobar(`${shellTextos}: \`ls --json\` lleva el entorno tal como está en el registro`, prod?.entorno === 'produccion', JSON.stringify(prod))
}

// --- Motores que este `tdb` no conoce (compatibilidad del registro) ------------
// El main conserva tal cual las conexiones que no entiende, así que el ARCHIVO que lee
// `tdb` las trae (el ejemplo es una DuckDB: antes era una SQLite,
// que ya se conoce). Antes: `ls` pintaba la SQLite como «:0/», y con secreto la conexión
// SQLite acababa en el adaptador de PostgreSQL y la de SQL Server hablaba el protocolo de
// PG contra su puerto. El puerto de la SQL Server de mentira es el 1 y no el 1433 a
// propósito: si esto volviera a caer en el adaptador de PG, que falle rápido contra un
// puerto cerrado en vez de colgarse contra algo que escuche.
console.log('\nConexiones de un motor que este `tdb` no conoce\n')
if (!shellTextos) {
  saltar('los motores desconocidos en `tdb`', 'no hay ningún shell disponible')
} else {
  const registroAjenas = path.join(dir, 'db-connections-ajenas.json')
  writeFileSync(
    registroAjenas,
    JSON.stringify({
      version: 2,
      connections: [
        { id: 'k1', profileId: 'p1', alias: 'base-pg', motor: 'postgres', host: 'localhost', port: 5432, database: 'demo', user: 'u', readonly: true },
        { id: 'a1', profileId: 'p1', alias: 'Local DuckDB', motor: 'duckdb', ruta: 'C:/datos/app.db', readonly: true },
        { id: 'a2', profileId: 'p1', alias: 'SQLSRV', motor: 'mysql', host: '127.0.0.1', port: 1, database: 'master', user: 'sa', readonly: true, entorno: 'produccion' },
        // Lo que el main conserva sin poder ni listarlo: tampoco debe tumbar a `tdb`.
        null,
        'basura'
      ]
    })
  )
  const conAjenas = {
    ...entorno,
    TESSERA_DB_REGISTRY: registroAjenas,
    TESSERA_DB_SCOPE: 'k1,a1,a2',
    TESSERA_DB_MODE: 'env',
    // Con secreto, que es el caso medido: sin él fallaba antes por «no hay contraseña».
    TESSERA_DB_SECRET_A1: 'x',
    TESSERA_DB_SECRET_A2: 'x'
  } as NodeJS.ProcessEnv
  const MARCA = 'motor desconocido: actualiza Tessera'
  const errorDe = (alias: string, motor: string): string => `"${alias}" es de un motor (${motor}) que este tdb no conoce: actualiza Tessera`

  const ls = correr(shellTextos, 'tdb ls', undefined, conAjenas)
  const lineaDe = (alias: string): string => ls.out.split(/\r?\n/).find((l) => l.includes(alias)) ?? ''
  comprobar(`${shellTextos}: \`ls\` no se cae con entradas que no son objetos`, ls.code === 0, `code=${ls.code} ${ls.out.slice(0, 300)}`)
  comprobar(
    `${shellTextos}: \`ls\` lista la DuckDB y la SQL Server con su motor y la marca`,
    lineaDe('Local DuckDB').includes('duckdb') && lineaDe('Local DuckDB').includes(MARCA) && lineaDe('SQLSRV').includes('mysql') && lineaDe('SQLSRV').includes(MARCA),
    `${lineaDe('Local DuckDB')} / ${lineaDe('SQLSRV')}`
  )
  comprobar(`${shellTextos}: NEGATIVO: ni «:0/» ni «undefined» en la tabla`, !ls.out.includes(':0/') && !ls.out.includes('undefined'), ls.out.slice(0, 500))
  comprobar(
    `${shellTextos}: NEGATIVO: la de PostgreSQL sigue con su destino y sin la marca`,
    lineaDe('base-pg').includes('localhost:5432/demo') && !lineaDe('base-pg').includes(MARCA),
    lineaDe('base-pg')
  )
  comprobar(
    `${shellTextos}: debajo, la explicación nombra solo las de motor desconocido`,
    ls.out.includes('Requieren una versión más nueva de Tessera: Local DuckDB, SQLSRV.') && ls.out.includes('actualiza Tessera.'),
    ls.out.slice(-300)
  )
  comprobar(
    `${shellTextos}: NEGATIVO: una de motor desconocido no sale en el aviso de PRODUCCIÓN`,
    !ls.out.includes('PRODUCCIÓN: SQLSRV') && !lineaDe('SQLSRV').includes('PRODUCCIÓN'),
    ls.out.slice(-300)
  )

  const json = jsonDe(correr(shellTextos, 'tdb ls --json', undefined, conAjenas).out) as { conexiones?: Array<Record<string, unknown>> } | null
  const porId = (id: string) => json?.conexiones?.find((c) => c.id === id)
  comprobar(
    `${shellTextos}: \`ls --json\` marca las de motor desconocido y deja las demás como estaban`,
    porId('a1')?.motorDesconocido === true && porId('a2')?.motorDesconocido === true && porId('k1') !== undefined && !('motorDesconocido' in (porId('k1') ?? {})),
    JSON.stringify(json?.conexiones?.map((c) => [c.id, c.motorDesconocido]))
  )

  const consulta = correr(shellTextos, 'tdb query "Local DuckDB" --stdin', 'SELECT 1', conAjenas)
  comprobar(
    `${shellTextos}: consultar la DuckDB (con secreto) es el error explícito, código 1`,
    consulta.code === 1 && consulta.out.includes(errorDe('Local DuckDB', 'duckdb')),
    `code=${consulta.code} ${consulta.out.slice(0, 300)}`
  )
  comprobar(
    `${shellTextos}: NEGATIVO: la DuckDB no llega a ningún adaptador (nada de conexión ni de PostgreSQL)`,
    !/ECONNREFUSED|password|authentication|postgres|connect/i.test(consulta.out.replace(errorDe('Local DuckDB', 'duckdb'), '')),
    consulta.out.slice(0, 300)
  )
  const prueba = correr(shellTextos, 'tdb test SQLSRV', undefined, conAjenas)
  comprobar(
    `${shellTextos}: probar la SQL Server es el error explícito, sin hablar con su puerto`,
    prueba.code === 1 && prueba.out.includes(errorDe('SQLSRV', 'mysql')) && !/ECONNREFUSED|timeout/i.test(prueba.out),
    `code=${prueba.code} ${prueba.out.slice(0, 300)}`
  )
  const sinSecreto = correr(shellTextos, 'tdb test "Local DuckDB"', undefined, {
    ...conAjenas,
    TESSERA_DB_SECRET_A1: undefined
  } as NodeJS.ProcessEnv)
  comprobar(
    `${shellTextos}: sin secreto, el error es el del motor y NO «no hay contraseña»`,
    sinSecreto.out.includes(errorDe('Local DuckDB', 'duckdb')) && !sinSecreto.out.includes('contraseña'),
    sinSecreto.out.slice(0, 300)
  )
  const escritura = correr(shellTextos, 'tdb query SQLSRV --stdin', 'DELETE FROM t', conAjenas)
  comprobar(
    `${shellTextos}: una escritura contra ella da el error del motor, no el de SOLO LECTURA`,
    escritura.out.includes(errorDe('SQLSRV', 'mysql')) && !escritura.out.includes('SOLO LECTURA'),
    escritura.out.slice(0, 300)
  )
  const pruebaJson = jsonDe(correr(shellTextos, 'tdb test SQLSRV --json', undefined, conAjenas).out)
  // el MISMO contrato en las dos órdenes. `ls --json` marcaba con
  // `motorDesconocido: true` y el error con `motorDesconocido: 'mysql'`, así que un
  // agente que lo comprobara de una sola forma se comportaba distinto según la orden.
  // Ahora es booleano en los dos, y el motor va en `motor`, que es el campo con que
  // `ls --json` ya lo daba (la entrada entera).
  comprobar(
    `${shellTextos}: con --json, el error lleva \`motorDesconocido: true\` y el motor en \`motor\``,
    pruebaJson?.ok === false && pruebaJson?.motorDesconocido === true && pruebaJson?.motor === 'mysql' && String(pruebaJson?.error).includes('actualiza Tessera'),
    JSON.stringify(pruebaJson)
  )
  comprobar(
    `${shellTextos}: y es el mismo tipo que la marca de \`ls --json\` (una sola comprobación vale para las dos)`,
    pruebaJson?.motorDesconocido === porId('a2')?.motorDesconocido && pruebaJson?.motor === porId('a2')?.motor,
    `error=${JSON.stringify(pruebaJson?.motorDesconocido)} ls=${JSON.stringify(porId('a2')?.motorDesconocido)}`
  )

  // `doctor` SIN ámbito (la consola del perfil ve todas): la de PostgreSQL tiene su
  // secreto, las otras dos no pueden tenerlo. Contarlas daba «sin contraseña» falso.
  const doctor = correr(shellTextos, 'tdb doctor', undefined, {
    ...conAjenas,
    TESSERA_DB_SCOPE: undefined,
    TESSERA_DB_SECRET_A1: undefined,
    TESSERA_DB_SECRET_A2: undefined,
    TESSERA_DB_SECRET_K1: 'x',
    TESSERA_DB_DESTINO_K1: HUELLA_K1
  } as NodeJS.ProcessEnv)
  comprobar(
    `${shellTextos}: \`doctor\` no cuenta las de motor desconocido como «sin contraseña»`,
    doctor.out.includes('Todo en orden') && !doctor.out.includes('sin contraseña'),
    doctor.out.slice(-300)
  )
}

// --- Motor conocido con una forma que no se reconoce ----------------
// El main decide qué es ajeno por la FORMA entera (`tieneFormaConocida`), no solo por
// el motor: una PG de una versión más nueva sin host ni puerto (por socket, por URL) es
// ajena, la UI la enseña como «requiere una versión más nueva» y el main no sirve su
// secreto. `tdb` solo miraba el motor: `ls` pintaba «undefined:undefined/» y `query`
// mandaba a guardar la contraseña desde un formulario que no la abre. En un registro
// APARTE para no mover las expectativas de la sección anterior.
console.log('\nConexiones de motor conocido con una forma que este `tdb` no reconoce\n')
if (!shellTextos) {
  saltar('las formas desconocidas en `tdb`', 'no hay ningún shell disponible')
} else {
  const registroForma = path.join(dir, 'db-connections-forma.json')
  writeFileSync(
    registroForma,
    JSON.stringify({
      version: 2,
      connections: [
        { id: 'k1', profileId: 'p1', alias: 'base-pg', motor: 'postgres', host: 'localhost', port: 5432, database: 'demo', user: 'u', readonly: true },
        { id: 'f1', profileId: 'p1', alias: 'PG-SOCKET', motor: 'postgres', socket: '/var/run/postgresql', database: 'demo', user: 'u', readonly: false, entorno: 'produccion' }
      ]
    })
  )
  const conForma = {
    ...entorno,
    TESSERA_DB_REGISTRY: registroForma,
    TESSERA_DB_SCOPE: undefined,
    TESSERA_DB_MODE: 'env',
    TESSERA_DB_SECRET_K1: 'x',
    TESSERA_DB_DESTINO_K1: HUELLA_K1
  } as NodeJS.ProcessEnv
  // La parte de `tdb`: una de motor CONOCIDO que no se reconoce por su
  // forma no tiene por qué venir de una versión más nueva —puede ser una edición a mano
  // del archivo—, y la UI lo dice así. `tdb` decía «actualiza Tessera» a secas.
  const errorForma = '"PG-SOCKET" está guardada de una forma que este tdb no reconoce.'
  const origenForma = /versión más nueva de Tessera \(actualiza para usarla\) o de una\s+edición a mano del archivo; Tessera la conserva tal cual\./

  const ls = correr(shellTextos, 'tdb ls', undefined, conForma)
  const linea = ls.out.split(/\r?\n/).find((l) => l.includes('PG-SOCKET')) ?? ''
  comprobar(
    `${shellTextos}: \`ls\` lista la de forma desconocida con su marca, y sin «undefined»`,
    ls.code === 0 && linea.includes('forma no reconocida (ver debajo)') && !ls.out.includes('undefined'),
    `code=${ls.code} ${linea}`
  )
  comprobar(
    `${shellTextos}: NEGATIVO: ni su «escritura» ni su PRODUCCIÓN se afirman en \`ls\``,
    !linea.includes('escritura') && !ls.out.includes('PRODUCCIÓN: PG-SOCKET'),
    ls.out.slice(-300)
  )
  comprobar(
    `${shellTextos}: debajo, la explicación la nombra con los DOS orígenes posibles`,
    ls.out.includes('No se reconoce cómo están guardadas: PG-SOCKET.') && /versión más nueva de Tessera \(actualiza para usarlas\) o de una\s+edición a mano del archivo; Tessera las conserva tal cual\./.test(ls.out),
    ls.out.slice(-400)
  )
  comprobar(
    `${shellTextos}: NEGATIVO: no la da por «de una versión más nueva», ni manda a borrarla`,
    !ls.out.includes('Requieren una versión más nueva de Tessera: PG-SOCKET') && !/elimina|bórrala|borra/i.test(ls.out),
    ls.out.slice(-400)
  )
  const json = jsonDe(correr(shellTextos, 'tdb ls --json', undefined, conForma).out) as { conexiones?: Array<Record<string, unknown>> } | null
  const f1 = json?.conexiones?.find((c) => c.id === 'f1')
  const k1 = json?.conexiones?.find((c) => c.id === 'k1')
  comprobar(
    `${shellTextos}: \`ls --json\` la marca con \`formaDesconocida\` (y no como motor desconocido)`,
    f1?.formaDesconocida === true && !('motorDesconocido' in (f1 ?? {})) && k1 !== undefined && !('formaDesconocida' in k1),
    JSON.stringify(json?.conexiones?.map((c) => [c.id, c.formaDesconocida, c.motorDesconocido]))
  )
  const consulta = correr(shellTextos, 'tdb query PG-SOCKET --stdin', 'SELECT 1', conForma)
  comprobar(
    `${shellTextos}: consultarla es el error explícito de la forma (con sus dos orígenes), y NO «no hay contraseña»`,
    consulta.code === 1 && consulta.out.includes(errorForma) && origenForma.test(consulta.out) && !consulta.out.includes('contraseña'),
    `code=${consulta.code} ${consulta.out.slice(0, 400)}`
  )
  const pruebaJson = jsonDe(correr(shellTextos, 'tdb test PG-SOCKET --json', undefined, conForma).out)
  comprobar(
    `${shellTextos}: con --json, el error lleva \`formaDesconocida: true\` y el motor en \`motor\` (como el de motor desconocido)`,
    pruebaJson?.ok === false && pruebaJson?.formaDesconocida === true && pruebaJson?.motor === 'postgres' && !('motorDesconocido' in (pruebaJson ?? {})) && origenForma.test(String(pruebaJson?.error)),
    JSON.stringify(pruebaJson)
  )
  const doctor = correr(shellTextos, 'tdb doctor', undefined, conForma)
  comprobar(
    `${shellTextos}: \`doctor\` no la cuenta como «sin contraseña»`,
    doctor.out.includes('Todo en orden') && !doctor.out.includes('sin contraseña'),
    doctor.out.slice(-300)
  )
}

// --- Entradas sin alias o sin id ---------------------
// El main conserva tal cual lo que no entiende, y una ajena no tiene por qué traer
// alias (ni id). `tdb` las nombraba con el alias CRUDO: «Disponibles: "base-pg",
// "undefined"», una fila ALIAS «undefined» en `ls` y «Requieren…: undefined.». Y como
// se buscaba por `String(c.alias)`, `tdb query undefined` ENCONTRABA la entrada sin
// alias. Sin ámbito (la consola del perfil), que es donde se ve una entrada sin id.
console.log('\nEntradas sin alias o sin id\n')
if (!shellTextos) {
  saltar('las entradas sin nombre en `tdb`', 'no hay ningún shell disponible')
} else {
  const registroSinNombre = path.join(dir, 'db-connections-sin-nombre.json')
  writeFileSync(
    registroSinNombre,
    JSON.stringify({
      version: 2,
      connections: [
        { id: 'k1', profileId: 'p1', alias: 'base-pg', motor: 'postgres', host: 'localhost', port: 5432, database: 'demo', user: 'u', readonly: true },
        // Sin alias: se nombra por su id, como en la UI.
        { id: 's1', profileId: 'p1', motor: 'duckdb', ruta: 'a.db' },
        // Ni alias ni id.
        { profileId: 'p1', motor: 'duckdb', ruta: 'b.db' }
      ]
    })
  )
  const sinNombre = {
    ...entorno,
    TESSERA_DB_REGISTRY: registroSinNombre,
    TESSERA_DB_SCOPE: undefined,
    TESSERA_DB_MODE: 'env',
    TESSERA_DB_SECRET_K1: 'x',
    TESSERA_DB_DESTINO_K1: HUELLA_K1
  } as NodeJS.ProcessEnv

  const q = correr(shellTextos, 'tdb query foo --stdin', 'SELECT 1', sinNombre)
  comprobar(
    `${shellTextos}: «Disponibles» nombra solo las que se pueden usar, y cuenta las demás sin «undefined»`,
    q.code === 1 && q.out.includes('Disponibles: "base-pg"') && !q.out.includes('Disponibles: "base-pg",') && q.out.includes('2 que este tdb no sabe usar') && !q.out.includes('undefined'),
    `code=${q.code} ${q.out.slice(0, 300)}`
  )
  const ls = correr(shellTextos, 'tdb ls', undefined, sinNombre)
  comprobar(
    `${shellTextos}: \`ls\` nombra la de sin alias por su id y la de sin nada como «(sin nombre)», nunca «undefined»`,
    ls.code === 0 && !ls.out.includes('undefined') && ls.out.includes('Requieren una versión más nueva de Tessera: s1, (sin nombre).'),
    ls.out.slice(0, 600)
  )
  const u = correr(shellTextos, 'tdb query undefined --stdin', 'SELECT 1', sinNombre)
  comprobar(
    `${shellTextos}: NEGATIVO: \`tdb query undefined\` no encuentra la entrada sin alias (no es su nombre)`,
    u.code === 1 && u.out.includes('No hay ninguna conexión llamada "undefined"') && !u.out.includes('no conoce'),
    `code=${u.code} ${u.out.slice(0, 300)}`
  )
  const porId = correr(shellTextos, 'tdb query s1 --stdin', 'SELECT 1', sinNombre)
  comprobar(
    `${shellTextos}: y la de sin alias se sigue encontrando por su id (y da el error de su motor)`,
    porId.code === 1 && porId.out.includes('"s1" es de un motor (duckdb) que este tdb no conoce'),
    `code=${porId.code} ${porId.out.slice(0, 300)}`
  )
}

// --- La copia de una conexión con su MISMO id ---------------
// El main lee como AJENA (id repetido) una conexión de forma conocida cuyo id ya tiene
// otra ANTERIOR del registro (una entrada copiada y pegada a mano): todo lo que va por id
// resolvía a la primera, y la copia abría el servidor de la otra con su contraseña. `tdb`
// lee el archivo por su cuenta y el secreto va por id (`secretoDe`): `tdb query Copia`
// conectaba al host de la COPIA con la contraseña de la ORIGINAL. Con la misma regla que el
// main (`entradasDeLista`), y su tabla de paridad.
console.log('\nLa copia de una conexión con su mismo id\n')
if (!shellTextos) {
  saltar('las conexiones con el id de otra en `tdb`', 'no hay ningún shell disponible')
} else {
  const ORIGINAL = { id: 'r1', profileId: 'p1', alias: 'Original', motor: 'postgres', host: 'localhost', port: 5432, database: 'demo', user: 'u', readonly: true }
  const COPIA = { ...ORIGINAL, alias: 'Copia', host: 'otro-host.invalid', entorno: 'produccion' }
  const DE_P2 = { ...ORIGINAL, profileId: 'p2', alias: 'En otro perfil' }
  const registroRep = path.join(dir, 'db-connections-repetido.json')
  writeFileSync(registroRep, JSON.stringify({ version: 1, connections: [ORIGINAL, COPIA, DE_P2] }))
  const envRep = (perfil: string): NodeJS.ProcessEnv =>
    ({
      ...entorno,
      TESSERA_DB_REGISTRY: registroRep,
      TESSERA_PROFILE: perfil,
      TESSERA_DB_SCOPE: undefined,
      TESSERA_DB_MODE: 'env',
      TESSERA_DB_SECRET_R1: 'x',
      // La huella de la ORIGINAL, que es para la que Tessera emite la contraseña de `r1`.
      TESSERA_DB_DESTINO_R1: huellaDestino(ORIGINAL)
    }) as NodeJS.ProcessEnv
  const errorCopia = '"Copia" comparte su identificador con "Original": este tdb no puede distinguirlas'

  const ls = correr(shellTextos, 'tdb ls', undefined, envRep('p1'))
  const lineaDe = (alias: string): string => ls.out.split(/\r?\n/).find((l) => l.includes(alias)) ?? ''
  comprobar(
    `${shellTextos}: \`ls\` lista la copia con su marca, sin destino ni modo, y la original como siempre`,
    ls.code === 0 &&
      lineaDe('Copia').includes('id repetido (ver debajo)') &&
      !lineaDe('Copia').includes('otro-host') &&
      !lineaDe('Copia').includes('solo lectura') &&
      lineaDe('Original').includes('localhost:5432/demo'),
    `${lineaDe('Original')} / ${lineaDe('Copia')}`
  )
  comprobar(
    `${shellTextos}: debajo, con quién comparte el id; y su PRODUCCIÓN no se afirma (no se puede usar)`,
    ls.out.includes('Comparten su identificador con otra conexión: Copia (con "Original").') &&
      ls.out.includes('Elimina desde Tessera la que sobre.') &&
      !ls.out.includes('PRODUCCIÓN: Copia'),
    ls.out.slice(-500)
  )
  const json = jsonDe(correr(shellTextos, 'tdb ls --json', undefined, envRep('p1')).out) as { conexiones?: Array<Record<string, unknown>> } | null
  const copiaJ = json?.conexiones?.find((c) => c.alias === 'Copia')
  const origJ = json?.conexiones?.find((c) => c.alias === 'Original')
  comprobar(
    `${shellTextos}: \`ls --json\` marca la copia con \`idRepetido\` y \`comparteCon\` (campos NUEVOS: la original sale como antes)`,
    copiaJ?.idRepetido === true &&
      copiaJ?.comparteCon === 'Original' &&
      !('formaDesconocida' in (copiaJ ?? {})) &&
      origJ !== undefined &&
      !('idRepetido' in origJ) &&
      !('comparteCon' in origJ),
    JSON.stringify(json?.conexiones?.map((c) => [c.alias, c.idRepetido, c.comparteCon]))
  )
  const consulta = correr(shellTextos, 'tdb query Copia --stdin', 'SELECT 1', envRep('p1'))
  comprobar(
    `${shellTextos}: consultar la copia es el error explícito, código 1, sin intentar conectar (ni con la contraseña de la original)`,
    consulta.code === 1 &&
      consulta.out.includes(errorCopia) &&
      !/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|password|authentication|contraseña|actualiza/i.test(consulta.out.replace(errorCopia, '')),
    `code=${consulta.code} ${consulta.out.slice(0, 300)}`
  )
  const pruebaJson = jsonDe(correr(shellTextos, 'tdb test Copia --json', undefined, envRep('p1')).out)
  comprobar(
    `${shellTextos}: con --json, el error lleva la MISMA marca que \`ls --json\` (\`idRepetido\`, \`comparteCon\`) y el motor`,
    pruebaJson?.ok === false && pruebaJson?.idRepetido === true && pruebaJson?.comparteCon === 'Original' && pruebaJson?.motor === 'postgres',
    JSON.stringify(pruebaJson)
  )
  const lsP2 = jsonDe(correr(shellTextos, 'tdb ls --json', undefined, envRep('p2')).out) as { conexiones?: Array<Record<string, unknown>> } | null
  const p2J = lsP2?.conexiones?.find((c) => c.alias === 'En otro perfil')
  const consultaP2 = correr(shellTextos, 'tdb query "En otro perfil" --stdin', 'SELECT 1', envRep('p2'))
  comprobar(
    `${shellTextos}: la de OTRO perfil también es copia (los ids son de todo el registro), sin nombrar la original`,
    p2J?.idRepetido === true &&
      !('comparteCon' in (p2J ?? {})) &&
      consultaP2.code === 1 &&
      consultaP2.out.includes('comparte su identificador con una conexión de otro perfil') &&
      !consultaP2.out.includes('Original'),
    `${JSON.stringify(p2J)} ${consultaP2.out.slice(0, 200)}`
  )
  const doctor = correr(shellTextos, 'tdb doctor', undefined, envRep('p1'))
  comprobar(
    `${shellTextos}: \`doctor\` no cuenta la copia como «sin contraseña»`,
    doctor.out.includes('Todo en orden') && !doctor.out.includes('sin contraseña'),
    doctor.out.slice(-300)
  )

  // PARIDAD con el main: para cada registro, qué es cada entrada del perfil p1 por los dos
  // lados —la conocida, la copia (y con quién), la ajena de motor o de forma—: `leerRegistro`
  // + `ajenasDelPerfil` frente a `tdb ls --json`. Las posiciones que importan: la copia
  // DELANTE de la original (gana la primera), una ajena de motor o de forma delante (no
  // cuenta como «anterior»), una primera de otro perfil, tres con el mismo id, y la mitad
  // negativa: ids distintos (también por mayúsculas: un id no se compara sin distinguirlas).
  // Un motor que esta versión no conoce (antes era una SQLite; hoy
  // SQLite se conoce y su FORMA es otra: ver los casos de abajo).
  const LITE = { id: 'r1', profileId: 'p1', alias: 'Lite', motor: 'mysql', instancia: 'SQLEXPRESS' }
  const ROTA = { ...ORIGINAL, alias: 'Rota', port: 'x' }
  // la FORMA de cada motor sale de su descriptor en los tres sitios (main, `tdb`,
  // ConnectionStore). Una SQLite con su `archivo` es conocida en los dos lados, SIN host ni
  // puerto; una sin `archivo` (una `ruta` de otra versión, o un archivo que no es texto) es
  // de forma no reconocida en los dos; y una PG con archivo y sin host sigue siendo ajena.
  const ARCHIVO = { id: 's1', profileId: 'p1', alias: 'Archivo', motor: 'sqlite', archivo: path.join(dir, 'a.db'), readonly: true }
  const SIN_ARCHIVO = { id: 's2', profileId: 'p1', alias: 'SinArchivo', motor: 'sqlite', ruta: 'a.db', host: 'h', port: 1 }
  const ARCHIVO_NUMERO = { id: 's3', profileId: 'p1', alias: 'ArchivoNum', motor: 'sqlite', archivo: 7 }
  const PG_CON_ARCHIVO = { id: 's4', profileId: 'p1', alias: 'PgArchivo', motor: 'postgres', archivo: 'a.db', database: 'd', user: 'u' }
  const casos: Array<Array<Record<string, unknown>>> = [
    [ORIGINAL, COPIA],
    [COPIA, ORIGINAL],
    [ORIGINAL, COPIA, { ...COPIA, alias: 'Copia 2' }],
    [{ ...ORIGINAL, profileId: 'p2', alias: 'P2' }, COPIA],
    [LITE, ORIGINAL, COPIA],
    [ROTA, ORIGINAL, COPIA],
    [ORIGINAL, { ...COPIA, id: 'r2' }],
    [ORIGINAL, { ...COPIA, id: 'R1' }],
    [ARCHIVO, SIN_ARCHIVO, ARCHIVO_NUMERO, PG_CON_ARCHIVO, ORIGINAL]
  ]
  const claseMain = (conexiones: Array<Record<string, unknown>>): Record<string, string> => {
    const r = leerRegistro(JSON.stringify({ version: 1, connections: conexiones }))
    const out: Record<string, string> = {}
    if (!r) return out
    for (const c of conocidas(r)) if (c.profileId === 'p1') out[c.alias] = 'conocida'
    for (const a of ajenasDelPerfil(r, 'p1')) {
      out[a.alias] = a.idRepetido
        ? `repetida:${a.idRepetido.tipo === 'conexion' ? `con ${a.idRepetido.alias}` : a.idRepetido.tipo}`
        : (MOTORES_CONOCIDOS as readonly string[]).includes(a.motor)
          ? 'forma'
          : 'motor'
    }
    return out
  }
  const claseTdb = (conexiones: Array<Record<string, unknown>>, i: number): Record<string, string> => {
    const ruta = path.join(dir, `paridad-repetido-${i}.json`)
    writeFileSync(ruta, JSON.stringify({ version: 1, connections: conexiones }))
    const r = spawnSync(process.execPath, [tdbCjs, 'ls', '--json'], { env: { ...envRep('p1'), TESSERA_DB_REGISTRY: ruta }, encoding: 'utf-8', timeout: PLAZO_HIJO_MS })
    const j = jsonDe(r.stdout ?? '') as { conexiones?: Array<Record<string, unknown>> } | null
    const out: Record<string, string> = {}
    for (const c of j?.conexiones ?? []) {
      out[String(c.alias)] = c.idRepetido
        ? `repetida:${typeof c.comparteCon === 'string' ? `con ${c.comparteCon}` : 'otroPerfil'}`
        : c.formaDesconocida
          ? 'forma'
          : c.motorDesconocido
            ? 'motor'
            : 'conocida'
    }
    return out
  }
  const discrepancias: string[] = []
  const vistas = new Set<string>()
  casos.forEach((caso, i) => {
    const m = claseMain(caso)
    const t = claseTdb(caso, i)
    for (const v of Object.values(m)) vistas.add(v)
    if (JSON.stringify(m, Object.keys(m).sort()) !== JSON.stringify(t, Object.keys(t).sort())) {
      discrepancias.push(`caso ${i}: main=${JSON.stringify(m)} tdb=${JSON.stringify(t)}`)
    }
  })
  comprobar(
    `paridad del id repetido: \`tdb\` y el main clasifican igual cada entrada en ${casos.length} registros (${[...vistas].sort().join(', ')})`,
    discrepancias.length === 0 &&
      ['conocida', 'repetida:con Original', 'repetida:con Copia', 'repetida:otroPerfil', 'motor', 'forma'].every((v) => vistas.has(v)),
    discrepancias.join('; ') || [...vistas].join(', ')
  )
  const formas = claseMain(casos[casos.length - 1])
  comprobar(
    'la FORMA por motor (del descriptor): SQLite con archivo, conocida sin host ni puerto; sin archivo (o no de texto), y PG con archivo y sin host, de forma no reconocida',
    formas.Archivo === 'conocida' && formas.SinArchivo === 'forma' && formas.ArchivoNum === 'forma' && formas.PgArchivo === 'forma' && formas.Original === 'conocida',
    JSON.stringify(formas)
  )
}

// --- La contraseña solo viaja al destino para el que se emitió ----
// El resquicio, medido: sin puente la terminal lleva la contraseña en `TESSERA_DB_SECRET_<ID>` fijada al
// abrirla y `tdb` lee el registro en cada invocación. Con dos entradas del mismo id y la terminal abierta,
// eliminar la original hacía que `tdb` mandara su contraseña al servidor de la copia. Un PostgreSQL de
// mentira apunta la que le llega. Con puente, lo mismo tras editar el archivo a mano con Tessera abierta
// (lo que lee `tdb` es el disco; lo que sirve el puente, la memoria).

/**
 * Servidor PostgreSQL de mentira: responde al arranque pidiendo la contraseña EN CLARO
 * (`AuthenticationCleartextPassword`) y apunta la que le llega, sin contestar nada más. Cuenta
 * también las conexiones: «no llegó nada» se comprueba con ellas, no solo con las contraseñas.
 */
async function servidorPgFalso(): Promise<{ puerto: number; recibidas: string[]; conexiones: () => number; cerrar: () => Promise<void> }> {
  const recibidas: string[] = []
  let conexiones = 0
  const servidor = net.createServer((s) => {
    conexiones++
    let buf = Buffer.alloc(0)
    let fase: 'arranque' | 'clave' = 'arranque'
    s.on('error', () => {})
    s.on('data', (trozo: Buffer) => {
      buf = Buffer.concat([buf, trozo])
      for (;;) {
        if (fase === 'arranque') {
          // StartupMessage (o SSLRequest): Int32 largo (se cuenta a sí mismo) + Int32 código.
          if (buf.length < 8) return
          const largo = buf.readInt32BE(0)
          if (buf.length < largo) return
          const codigo = buf.readInt32BE(4)
          buf = buf.subarray(largo)
          if (codigo === 80877103) {
            s.write('N') // SSLRequest: sin TLS.
            continue
          }
          fase = 'clave'
          const pide = Buffer.alloc(9)
          pide.write('R', 0, 'latin1')
          pide.writeInt32BE(8, 1)
          pide.writeInt32BE(3, 5)
          s.write(pide)
          continue
        }
        // PasswordMessage: 'p' + Int32 largo (se cuenta a sí mismo) + la contraseña + NUL.
        if (buf.length < 5 || buf[0] !== 0x70) return
        const largo = buf.readInt32BE(1)
        if (buf.length < 1 + largo) return
        recibidas.push(buf.subarray(5, largo).toString('utf-8'))
        s.destroy()
        return
      }
    })
  })
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()))
  const puerto = (servidor.address() as net.AddressInfo).port
  return {
    puerto,
    recibidas,
    conexiones: () => conexiones,
    cerrar: () => new Promise<void>((r) => servidor.close(() => r()))
  }
}

console.log('\nLa contraseña solo viaja al destino para el que se emitió\n')
if (!shellTextos) {
  saltar('la contraseña y su destino en `tdb`', 'no hay ningún shell disponible')
} else {
  const pg = await servidorPgFalso()
  const SECRETOS: Record<string, string> = {
    Buena: 'secreto-de-la-buena',
    Original: 'secreto-de-la-original',
    Editable: 'secreto-de-la-editable'
  }
  const BASE = { profileId: 'p1', motor: 'postgres', port: 5432, database: 'demo', user: 'u', readonly: true }
  // La original no se contacta nunca en esta prueba: un host que no resuelve.
  const BUENA = { ...BASE, id: 'd0', alias: 'Buena', host: '127.0.0.1', port: pg.puerto }
  const ORIGINAL = { ...BASE, id: 'd1', alias: 'Original', host: 'original.invalid' }
  const COPIA = { ...ORIGINAL, alias: 'Copia', host: '127.0.0.1', port: pg.puerto }
  const EDITABLE = { ...BASE, id: 'd2', alias: 'Editable', host: 'original.invalid' }
  const rutaReg = path.join(dir, 'db-connections-destino.json')
  const escribirReg = (conexiones: unknown[]): void => writeFileSync(rutaReg, JSON.stringify({ version: 1, connections: conexiones }))
  /** Lo que el main tiene en memoria: la lectura del registro, como al arrancar. */
  const leerMemoria = (): Registro => leerRegistro(readFileSync(rutaReg, 'utf-8'))!
  const secretoEn = (r: Registro, id: string): string | null => {
    const c = conocidas(r).find((x) => x.id === id)
    return c ? (SECRETOS[c.alias] ?? null) : null
  }
  /** El entorno de una terminal SIN puente, construido como lo construye el main al abrirla. */
  const terminalSinPuente = (memoria: Registro, montados: string[]): NodeJS.ProcessEnv => {
    const { env } = construirEntornoHost(
      {
        binDir,
        registryPath: rutaReg,
        driversDir: path.join(dir, 'drivers'),
        conexionesDelPerfil: (p) => conocidas(memoria).filter((c) => c.profileId === p),
        secretoDe: (id) => secretoEn(memoria, id),
        espacioDeDatos: () => path.join(dir, 'espacio')
      },
      'p1',
      path.join(dir, 'proyecto-destino'),
      montados
    )
    // El PATH de la construcción es solo la carpeta de atajos (el main la antepone al heredado).
    return { ...entorno, ...env, PATH: entorno.PATH } as NodeJS.ProcessEnv
  }
  /** `tdb test <alias>`, y lo que le llegó al servidor de mentira por el camino. */
  const probar = async (alias: string, env: NodeJS.ProcessEnv): Promise<{ out: string; code: number; recibidas: string[]; conexiones: number }> => {
    pg.recibidas.length = 0
    const antes = pg.conexiones()
    const r = await correrAsincrono(shellTextos, `tdb test "${alias}"`, env)
    return { ...r, recibidas: [...pg.recibidas], conexiones: pg.conexiones() - antes }
  }

  // MITAD POSITIVA: con el registro como estaba al abrir la terminal, la contraseña llega. Sin
  // esto, «no llegó nada» se cumpliría también con un `tdb` que no conectara nunca.
  escribirReg([BUENA])
  const envBuena = terminalSinPuente(leerMemoria(), ['d0'])
  const buena = await probar('Buena', envBuena)
  comprobar(
    `${shellTextos}: sin puente, con la conexión como estaba al abrir la terminal, su contraseña llega a su servidor`,
    JSON.stringify(buena.recibidas) === JSON.stringify([SECRETOS.Buena]),
    `recibidas=${JSON.stringify(buena.recibidas)} ${buena.out.slice(0, 200)}`
  )
  const doctorBuena = jsonDe(correr(shellTextos, 'tdb doctor --json', undefined, envBuena).out)
  comprobar(
    `${shellTextos}: NEGATIVO: \`doctor --json\` no cuenta como de otro destino la que casa`,
    doctorBuena?.secretosDeOtroDestino === 0 && doctorBuena?.secretosEnElEntorno === 1,
    JSON.stringify(doctorBuena)
  )
  // Un secreto SIN su huella (Tessera los entrega siempre juntos) no se sabe para qué destino
  // es: no se usa.
  const sinHuella = await probar('Buena', { ...envBuena, TESSERA_DB_DESTINO_D0: undefined } as NodeJS.ProcessEnv)
  comprobar(
    `${shellTextos}: sin puente, una contraseña SIN la huella de su destino no se usa`,
    sinHuella.code === 1 && sinHuella.recibidas.length === 0 && sinHuella.conexiones === 0 && sinHuella.out.includes('cambió desde que se abrió esta terminal'),
    `recibidas=${JSON.stringify(sinHuella.recibidas)} ${sinHuella.out.slice(0, 200)}`
  )

  // EL CASO: original y copia con el mismo id, la terminal abierta con la original
  // montada, y la original eliminada desde Tessera (como lo hace el main: `quitarPorId` con la
  // conocida pedida, y el registro serializado desde la memoria, con la copia tal cual).
  escribirReg([ORIGINAL, COPIA])
  const memoriaRep = leerMemoria()
  const envRep = terminalSinPuente(memoriaRep, ['d1'])
  writeFileSync(rutaReg, serializarRegistro({ ...memoriaRep, entradas: quitarPorId(memoriaRep.entradas, 'd1', 'conocida').entradas }))
  const tras = await probar('Copia', envRep)
  comprobar(
    `${shellTextos}: sin puente, tras eliminar la ORIGINAL con la terminal abierta, su contraseña NO llega al servidor de la copia`,
    tras.recibidas.length === 0 && tras.conexiones === 0,
    `recibidas=${JSON.stringify(tras.recibidas)} conexiones=${tras.conexiones} ${tras.out.slice(0, 200)}`
  )
  comprobar(
    `${shellTextos}: y lo dice: la conexión cambió desde que se abrió la terminal, que se recargue (código 1)`,
    tras.code === 1 && /La conexión "Copia" cambió desde que se abrió esta terminal[\s\S]*Recarga la terminal/.test(tras.out),
    `code=${tras.code} ${tras.out.slice(0, 400)}`
  )
  const trasJson = jsonDe(correr(shellTextos, 'tdb test Copia --json', undefined, envRep).out)
  comprobar(
    `${shellTextos}: con --json, \`ok: false\` y la marca \`destinoCambiado\``,
    trasJson?.ok === false && trasJson?.destinoCambiado === true,
    JSON.stringify(trasJson)
  )
  const doctorRep = correr(shellTextos, 'tdb doctor', undefined, envRep).out
  const doctorRepJ = jsonDe(correr(shellTextos, 'tdb doctor --json', undefined, envRep).out)
  comprobar(
    `${shellTextos}: \`doctor\` no da «Todo en orden»: nombra la que cambió y manda a recargar (y lo cuenta en --json)`,
    doctorRep.includes('Cambiaron desde que Tessera entregó su contraseña: Copia.') &&
      !doctorRep.includes('Todo en orden') &&
      doctorRepJ?.secretosDeOtroDestino === 1,
    `${doctorRep.slice(-300)} ${JSON.stringify(doctorRepJ?.secretosDeOtroDestino)}`
  )

  // Y cualquier otro cambio de DESTINO con la terminal abierta: la contraseña de la terminal se
  // emitió para el de antes (con otra contraseña nueva guardada, la vieja iría al servidor nuevo).
  escribirReg([EDITABLE])
  const envEditable = terminalSinPuente(leerMemoria(), ['d2'])
  escribirReg([{ ...EDITABLE, host: '127.0.0.1', port: pg.puerto }])
  const editada = await probar('Editable', envEditable)
  comprobar(
    `${shellTextos}: sin puente, una conexión cuyo destino se editó con la terminal abierta no recibe la contraseña de entonces`,
    editada.recibidas.length === 0 && editada.conexiones === 0,
    `recibidas=${JSON.stringify(editada.recibidas)} conexiones=${editada.conexiones} ${editada.out.slice(0, 200)}`
  )
  // La otra causa sin puente: el archivo editado A MANO con Tessera
  // abierta. La memoria no se relee, así que la terminal abierta DESPUÉS de la edición recibe
  // la contraseña con la huella de la memoria, y recargarla da lo mismo otra vez. Nada llega al
  // servidor, y el mensaje tiene que dar también el remedio que sí sirve (reiniciar Tessera),
  // como ya hacía `doctor`: antes solo decía «Recarga la terminal».
  escribirReg([EDITABLE])
  const memoriaVieja = leerMemoria()
  escribirReg([{ ...EDITABLE, host: '127.0.0.1', port: pg.puerto }])
  const aManoSinPuente = await probar('Editable', terminalSinPuente(memoriaVieja, ['d2']))
  comprobar(
    `${shellTextos}: sin puente, con el archivo editado a mano con Tessera abierta, una terminal RECARGADA tampoco la manda, y el mensaje dice «si sigue igual, reinicia Tessera»`,
    aManoSinPuente.code === 1 &&
      aManoSinPuente.recibidas.length === 0 &&
      aManoSinPuente.conexiones === 0 &&
      /Recarga la terminal[\s\S]*si sigue igual[\s\S]*reinicia Tessera/.test(aManoSinPuente.out),
    `code=${aManoSinPuente.code} recibidas=${JSON.stringify(aManoSinPuente.recibidas)} ${aManoSinPuente.out.slice(0, 400)}`
  )
  // NEGATIVO: lo que NO es el destino se edita sin reabrir nada (renombrarla, su entorno, su
  // solo lectura): la contraseña sigue siendo para ese servidor y ese usuario.
  escribirReg([BUENA])
  const envRenombrar = terminalSinPuente(leerMemoria(), ['d0'])
  escribirReg([{ ...BUENA, alias: 'Renombrada', entorno: 'pruebas', readonly: false, notas: 'x' }])
  const renombrada = await probar('Renombrada', envRenombrar)
  comprobar(
    `${shellTextos}: NEGATIVO: renombrarla o cambiar su entorno o su solo lectura no la corta (su contraseña llega)`,
    JSON.stringify(renombrada.recibidas) === JSON.stringify([SECRETOS.Buena]),
    `recibidas=${JSON.stringify(renombrada.recibidas)} ${renombrada.out.slice(0, 200)}`
  )

  // PARIDAD de la huella: la del main (`huellaDestino`) y la copia de `tdb` dan lo mismo en las
  // formas en que un registro trae su destino —con base o sin ella, a `null` o vacía, Oracle
  // por SID, un host con acentos—; se mide con `doctor --json` sin ámbito, que cuenta las que
  // traen una contraseña de otro destino. Y la otra mitad: con un solo campo del destino
  // cambiado en cada una, TODAS cuentan.
  const FORMAS: Array<Record<string, unknown>> = [
    { ...BASE, id: 'f1', alias: 'F1', host: 'h' },
    { ...BASE, id: 'f2', alias: 'F2', host: 'h', database: undefined },
    { ...BASE, id: 'f3', alias: 'F3', host: 'h', database: null },
    { ...BASE, id: 'f4', alias: 'F4', host: 'h', database: '' },
    { ...BASE, id: 'f5', alias: 'F5', motor: 'oracle', host: 'ora.lan', port: 1521, database: undefined, sid: 'XE', user: 'ADM' },
    { ...BASE, id: 'f6', alias: 'F6', host: 'bäse-ñ.lan', user: 'José' },
    // SQL Server: con instancia, cuenta de dominio y cifrado, y solo con el cifrado.
    {
      ...BASE,
      id: 'f7',
      alias: 'F7',
      motor: 'sqlserver',
      host: 'mssql.lan',
      port: 1433,
      database: undefined,
      user: 'ana',
      instancia: 'SQLEXPRESS',
      autenticacion: 'ntlm',
      dominio: 'DOMINIO',
      tls: { cifrar: true, confiarCertificado: false }
    },
    { ...BASE, id: 'f8', alias: 'F8', motor: 'sqlserver', host: 'h', port: 1433, tls: { cifrar: true, confiarCertificado: true } },
    // MongoDB y Redis SIN usuario ni base (los dos opcionales en su
    // motor), y un MongoDB con cifrado, `srv` y `opcionesUri`. La huella es la misma fórmula
    // (`srv` y `opcionesUri` no entran en ella: el contrato no la cambia), así que
    // lo que se fija es que las dos copias den lo mismo también con los campos AUSENTES.
    { ...BASE, id: 'f9', alias: 'F9', motor: 'mongodb', host: 'mongo.lan', port: 27017, database: undefined, user: undefined },
    { ...BASE, id: 'f10', alias: 'F10', motor: 'redis', host: 'redis.lan', port: 6379, database: undefined, user: undefined },
    {
      ...BASE,
      id: 'f11',
      alias: 'F11',
      motor: 'mongodb',
      host: 'cluster0.mongo.lan',
      port: 27017,
      database: undefined,
      user: 'lector',
      tls: { cifrar: true, confiarCertificado: false },
      srv: true,
      opcionesUri: 'authSource=admin'
    }
  ]
  const rutaFormas = path.join(dir, 'db-connections-formas.json')
  writeFileSync(rutaFormas, JSON.stringify({ version: 1, connections: FORMAS }))
  const conHuellas = (huella: (c: Record<string, unknown>) => string): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...entorno, TESSERA_DB_REGISTRY: rutaFormas, TESSERA_DB_SCOPE: undefined, TESSERA_DB_MODE: 'env' }
    for (const c of FORMAS) {
      const id = String(c.id).toUpperCase()
      env[`TESSERA_DB_SECRET_${id}`] = 'x'
      env[`TESSERA_DB_DESTINO_${id}`] = huella(c)
    }
    return env
  }
  const destinoDe = (c: Record<string, unknown>): Parameters<typeof huellaDestino>[0] => ({
    motor: c.motor,
    host: c.host,
    port: c.port,
    database: c.database,
    sid: c.sid,
    user: c.user,
    // solo si la entrada los trae (una clave ausente no es un `undefined` explícito
    // para la huella: `huellaDestino` mira `!== undefined`, y el JSON no la tiene).
    ...(c.instancia !== undefined ? { instancia: c.instancia } : {}),
    ...(c.autenticacion !== undefined ? { autenticacion: c.autenticacion } : {}),
    ...(c.dominio !== undefined ? { dominio: c.dominio } : {}),
    ...(c.tls !== undefined ? { tls: c.tls } : {})
  })
  // Puro: la huella de un destino de red SIN los campos de SQL Server es la de antes al
  // byte (la fórmula de seis valores), y con ellos cambia si cambia cualquiera, también solo
  // «Confiar en el certificado».
  const deSeis = (c: Record<string, unknown>): string =>
    createHash('sha256')
      .update(JSON.stringify([c.motor, c.host, c.port, c.database, c.sid, c.user].map((v) => (v === undefined ? null : v))), 'utf8')
      .digest('hex')
      .slice(0, 32)
  comprobar(
    'huella: un destino de red sin los campos de SQL Server da la de antes al byte',
    FORMAS.slice(0, 6).every((c) => huellaDestino(destinoDe(c)) === deSeis(c)),
    ''
  )
  // Un MongoDB o un Redis sin usuario ni base, y sin cifrado guardado,
  // tampoco cambia la fórmula: sus ausentes cuentan como `null`, igual que en los SQL.
  const sinUsuario = FORMAS.filter((c) => c.id === 'f9' || c.id === 'f10')
  comprobar(
    'huella: MongoDB y Redis sin usuario ni base dan la fórmula de seis valores (ausentes = null)',
    sinUsuario.length === 2 && sinUsuario.every((c) => huellaDestino(destinoDe(c)) === deSeis(c)),
    ''
  )
  const f7 = FORMAS[6]
  const variantes = [
    { ...f7, instancia: 'OTRA' },
    { ...f7, autenticacion: 'sql' },
    { ...f7, dominio: 'OTRO' },
    { ...f7, tls: { cifrar: true, confiarCertificado: true } },
    { ...f7, tls: undefined }
  ]
  comprobar(
    'huella: cambiar la instancia, la autenticación, el dominio o el cifrado (o quitarlo) la cambia',
    variantes.every((v) => huellaDestino(destinoDe(v)) !== huellaDestino(destinoDe(f7))),
    ''
  )
  const paridad = jsonDe(correr(shellTextos, 'tdb doctor --json', undefined, conHuellas((c) => huellaDestino(destinoDe(c)))).out)
  comprobar(
    `${shellTextos}: paridad: \`tdb\` acepta la huella del main en las ${FORMAS.length} formas (0 de otro destino)`,
    paridad?.conexionesVisibles === FORMAS.length && paridad?.secretosDeOtroDestino === 0,
    JSON.stringify(paridad)
  )
  const campos = ['motor', 'host', 'port', 'database', 'sid', 'user'] as const
  const cambiada = jsonDe(
    correr(
      shellTextos,
      'tdb doctor --json',
      undefined,
      conHuellas((c) => {
        const i = FORMAS.indexOf(c)
        const campo = campos[i % campos.length]
        return huellaDestino({ ...destinoDe(c), [campo]: `${String(c[campo] ?? '')}-otro` })
      })
    ).out
  )
  comprobar(
    `${shellTextos}: paridad, la otra mitad: con un campo del destino distinto en cada una, las ${FORMAS.length} cuentan`,
    cambiada?.secretosDeOtroDestino === FORMAS.length,
    JSON.stringify(cambiada)
  )

  // CON PUENTE. Un puente REAL en este proceso, servido desde una memoria que el test controla:
  // lo que Tessera haría desde la app (se cambia la memoria y se escribe el disco) o lo que
  // haría una edición a mano (solo el disco).
  let memoria = leerMemoria()
  const puente = new DbBridge({
    conexionesDelPerfil: (p) => conocidas(memoria).filter((c) => c.profileId === p),
    secretoDe: (id) => secretoEn(memoria, id)
  })
  puente.start()
  if (!(await esperarPuente(puente))) {
    comprobar('el puente de prueba levanta', false, 'no escucha')
  } else {
    const RUTA = path.join(dir, 'proyecto-destino-puente')
    const terminalConPuente = (): NodeJS.ProcessEnv =>
      ({
        ...entorno,
        TESSERA_DB_REGISTRY: rutaReg,
        TESSERA_PROFILE: 'p1',
        TESSERA_DB_SCOPE: undefined,
        TESSERA_DB_MODE: 'pipe',
        TESSERA_DB_PIPE: puente.pipe,
        TESSERA_DB_SESSION: puente.mint('p1', RUTA)
      }) as NodeJS.ProcessEnv

    escribirReg([BUENA])
    memoria = leerMemoria()
    puente.setScope('p1', RUTA, ['d0'])
    const buenaP = await probar('Buena', terminalConPuente())
    comprobar(
      `${shellTextos}: con puente, la contraseña que sirve llega a su servidor (mitad positiva)`,
      JSON.stringify(buenaP.recibidas) === JSON.stringify([SECRETOS.Buena]),
      `recibidas=${JSON.stringify(buenaP.recibidas)} ${buenaP.out.slice(0, 200)}`
    )

    // La EVIDENCIA de que el caso no pasaba con puente: borrar desde Tessera cambia
    // la memoria, y en ella la copia sigue AJENA por id repetido (hasta reiniciar), así que el
    // puente no tiene nada que servir para ese id: ni lo pone en el ámbito (lo cruza con las
    // conocidas, `DbBridge.resolver`) ni tiene su contraseña. `tdb` ni siquiera la ve.
    escribirReg([ORIGINAL, COPIA])
    memoria = leerMemoria()
    puente.setScope('p1', RUTA, ['d1'])
    const envP = terminalConPuente()
    memoria = { ...memoria, entradas: quitarPorId(memoria.entradas, 'd1', 'conocida').entradas }
    writeFileSync(rutaReg, serializarRegistro(memoria))
    const borradaP = await probar('Copia', envP)
    comprobar(
      `${shellTextos}: con puente, eliminar la original DESDE TESSERA no deja contraseña que servir: nada llega al servidor de la copia`,
      borradaP.code === 1 && borradaP.recibidas.length === 0 && borradaP.conexiones === 0 && borradaP.out.includes('No hay ninguna conexión llamada "Copia"'),
      `recibidas=${JSON.stringify(borradaP.recibidas)} conexiones=${borradaP.conexiones} ${borradaP.out.slice(0, 200)}`
    )

    // El análogo con puente: la original eliminada A MANO del archivo con Tessera abierta. La
    // memoria (y el puente) siguen con la original; `tdb` lee el disco, donde la copia es ya la
    // primera de su id.
    escribirReg([ORIGINAL, COPIA])
    memoria = leerMemoria()
    const envMano = terminalConPuente()
    escribirReg([COPIA])
    const aMano = await probar('Copia', envMano)
    comprobar(
      `${shellTextos}: con puente, eliminar la original A MANO con Tessera abierta tampoco manda su contraseña al servidor de la copia`,
      aMano.recibidas.length === 0 && aMano.conexiones === 0,
      `recibidas=${JSON.stringify(aMano.recibidas)} conexiones=${aMano.conexiones} ${aMano.out.slice(0, 200)}`
    )
    comprobar(
      `${shellTextos}: y lo dice con su remedio (reiniciar Tessera, que relee el archivo), no «recarga la terminal»`,
      aMano.code === 1 &&
        /La conexión "Copia" del registro no es la que tiene cargada Tessera[\s\S]*reinicia Tessera/.test(aMano.out) &&
        !aMano.out.includes('Recarga la terminal'),
      `code=${aMano.code} ${aMano.out.slice(0, 400)}`
    )
  }
  puente.stop()
  await pg.cerrar()
}

// --- Registro de formato ajeno, y el `.bak` --------------
// El main (`leerRegistro`) no interpreta un registro LEGIBLE cuyo formato no reconoce
// —una `version` que no es un número, una raíz que no es un objeto y no está vacía, un
// `connections` que no es una lista— y recurre al `.bak` si el principal no es JSON.
// `tdb` lee el mismo archivo por su cuenta, y si no aplica la misma regla ve lo que la
// app no enseña, o al revés. Con el código de antes: `version: "2"` listaba «base-pg»,
// el ámbito vacío decía «El perfil tiene 1: móntalas…», consultarla pedía guardar la
// contraseña con «Editar conexión…» (que la app no ofrecía), y un principal corrupto
// con su `.bak` bueno daba «No hay conexiones configuradas».
console.log('\nRegistro de formato ajeno y .bak\n')
if (!shellTextos) {
  saltar('el formato ajeno del registro en `tdb`', 'no hay ningún shell disponible')
} else {
  const K1 = {
    id: 'k1',
    profileId: 'p1',
    alias: 'base-pg',
    motor: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'demo',
    user: 'u',
    readonly: true
  }
  const escribir = (nombre: string, texto: string): string => {
    const ruta = path.join(dir, nombre)
    writeFileSync(ruta, texto)
    return ruta
  }
  // Consola SIN ámbito (la que ve todas las del perfil): es donde `tdb` listaba lo que
  // la app no. Con secreto para `k1`, para que el único motivo de fallar sea el formato.
  const envDe = (ruta: string): NodeJS.ProcessEnv =>
    ({
      ...entorno,
      TESSERA_DB_REGISTRY: ruta,
      TESSERA_DB_SCOPE: undefined,
      TESSERA_DB_MODE: 'env',
      TESSERA_DB_SECRET_K1: 'x',
      TESSERA_DB_DESTINO_K1: HUELLA_K1
    }) as NodeJS.ProcessEnv
  const avisoFormato =
    /no reconoce el formato del registro de conexiones \(db-connections\.json\),\s+así que no ve ninguna\. Puede venir de una versión más nueva de Tessera \(actualiza\s+para usarlas\) o de una edición a mano del archivo; Tessera no lo toca\./
  // Los consejos de los vacíos de siempre, que con este archivo mandan a donde no se puede.
  const mandaAHacer = /Añádelas|móntalas|Guárdala|El perfil tiene/

  const ajenos: Array<[string, string]> = [
    ['una `version` que no es un número ("2")', JSON.stringify({ version: '2', connections: [K1] })],
    ['una raíz que es una lista con entradas', JSON.stringify([K1])],
    ['un `connections` que no es una lista', JSON.stringify({ version: 1, connections: { k1: K1 } })]
  ]
  ajenos.forEach(([que, texto], i) => {
    const ls = correr(shellTextos, 'tdb ls', undefined, envDe(escribir(`ajeno-${i}.json`, texto)))
    comprobar(
      `${shellTextos}: ${que}: \`ls\` dice que no reconoce el formato, con sus dos orígenes`,
      ls.code === 0 && avisoFormato.test(ls.out),
      `code=${ls.code} ${ls.out.slice(0, 400)}`
    )
    comprobar(
      `${shellTextos}: ${que}: NEGATIVO: no lista la conexión ni manda a añadir, montar o guardar`,
      !ls.out.includes('base-pg') && !mandaAHacer.test(ls.out),
      ls.out.slice(0, 400)
    )
  })

  const v2texto = envDe(path.join(dir, 'ajeno-0.json'))
  // Ámbito DEFINIDO que no casa (un id inexistente, como el resto de este test: una
  // variable vacía no sobrevive igual en todos los shells): es la terminal de un
  // proyecto, donde salía «El perfil tiene 1: móntalas…».
  const acotado = correr(shellTextos, 'tdb ls', undefined, { ...v2texto, TESSERA_DB_SCOPE: 'zzz' } as NodeJS.ProcessEnv)
  comprobar(
    `${shellTextos}: en un proyecto, el formato ajeno se dice en vez de «no tiene ninguna base montada»`,
    avisoFormato.test(acotado.out) && !acotado.out.includes('ninguna base montada') && !mandaAHacer.test(acotado.out),
    acotado.out.slice(0, 400)
  )
  const lsJson = jsonDe(correr(shellTextos, 'tdb ls --json', undefined, v2texto).out)
  comprobar(
    `${shellTextos}: \`ls --json\` lo marca (\`formatoAjeno: true\` y el aviso), sin conexiones`,
    lsJson?.ok === true &&
      lsJson?.formatoAjeno === true &&
      avisoFormato.test(String(lsJson?.aviso)) &&
      Array.isArray(lsJson?.conexiones) &&
      (lsJson?.conexiones as unknown[]).length === 0 &&
      lsJson?.enElPerfil === 0,
    JSON.stringify(lsJson)
  )
  const q = correr(shellTextos, 'tdb query base-pg --stdin', 'SELECT 1', v2texto)
  comprobar(
    `${shellTextos}: consultarla falla con el aviso del formato, y NO con «no hay contraseña» ni «Disponibles»`,
    q.code === 1 && avisoFormato.test(q.out) && !q.out.includes('contraseña') && !q.out.includes('Disponibles'),
    `code=${q.code} ${q.out.slice(0, 400)}`
  )
  const qJson = jsonDe(correr(shellTextos, 'tdb test base-pg --json', undefined, v2texto).out)
  comprobar(
    `${shellTextos}: con --json, el error lleva \`formatoAjeno: true\``,
    qJson?.ok === false && qJson?.formatoAjeno === true && avisoFormato.test(String(qJson?.error)),
    JSON.stringify(qJson)
  )
  const doctor = correr(shellTextos, 'tdb doctor', undefined, v2texto)
  const doctorJson = jsonDe(correr(shellTextos, 'tdb doctor --json', undefined, v2texto).out)
  comprobar(
    `${shellTextos}: \`doctor\` lo da como veredicto (y \`formatoAjeno: true\` en --json)`,
    avisoFormato.test(doctor.out) && !doctor.out.includes('Todo en orden') && doctorJson?.formatoAjeno === true,
    `${doctor.out.slice(-400)} json=${JSON.stringify(doctorJson?.formatoAjeno)}`
  )

  // NEGATIVOS: lo que el main SÍ lee no se vuelve ajeno por esto.
  const lsNum = correr(
    shellTextos,
    'tdb ls',
    undefined,
    envDe(escribir('v2-numerica.json', JSON.stringify({ version: 2, connections: [K1] })))
  )
  comprobar(
    `${shellTextos}: NEGATIVO: una \`version\` NUMÉRICA más nueva sí se lee (la lista, sin aviso)`,
    lsNum.out.includes('base-pg') && !avisoFormato.test(lsNum.out),
    lsNum.out.slice(0, 400)
  )
  const lsVacio = correr(shellTextos, 'tdb ls', undefined, envDe(escribir('vacio-lista.json', '[]')))
  comprobar(
    `${shellTextos}: NEGATIVO: \`[]\` es un registro VACÍO (el vacío de siempre, sin aviso)`,
    lsVacio.out.includes('No hay conexiones configuradas') && !avisoFormato.test(lsVacio.out),
    lsVacio.out.slice(0, 400)
  )

  // El `.bak`: el main recurre a él si el principal no es JSON (`ConnectionStore.read`).
  const conBak = JSON.stringify({ version: 1, connections: [K1] })
  const corrupto = escribir('corrupto.json', '{ esto no es JSON')
  writeFileSync(`${corrupto}.bak`, conBak)
  const lsBak = correr(shellTextos, 'tdb ls', undefined, envDe(corrupto))
  comprobar(
    `${shellTextos}: un principal que no es JSON recurre al \`.bak\`, como la app`,
    lsBak.out.includes('base-pg') && !lsBak.out.includes('No hay conexiones configuradas'),
    lsBak.out.slice(0, 400)
  )
  const nulo = escribir('nulo.json', 'null')
  writeFileSync(`${nulo}.bak`, conBak)
  const lsNulo = correr(shellTextos, 'tdb ls', undefined, envDe(nulo))
  comprobar(
    `${shellTextos}: NEGATIVO: un principal LEGIBLE manda aunque esté vacío (no resucita el \`.bak\`)`,
    !lsNulo.out.includes('base-pg') && lsNulo.out.includes('No hay conexiones configuradas'),
    lsNulo.out.slice(0, 400)
  )

  // UN PRINCIPAL QUE NO SE PUEDE LEER y sin `.bak` que sirva. El
  // main lo tomaba por VACÍO —y la primera escritura lo sobrescribía entero—; ahora lo
  // bloquea con su propio aviso, y `tdb` tiene que decir lo mismo en vez de «No hay
  // conexiones configuradas: añádelas», que es falso y manda a crear justo lo que la app
  // rechaza. Sin el arreglo, `ls` daba ese vacío. El aviso lo parte `envolver`, así que se
  // compara con los espacios aplanados.
  const plano = (s: string): string => s.replace(/\s+/g, ' ')
  const ROTO = '{ "version": 1, "connections": [ ' + JSON.stringify(K1) + ', ] }'
  const rotoSolo = envDe(escribir('roto-solo.json', ROTO))
  const lsRoto = correr(shellTextos, 'tdb ls', undefined, rotoSolo)
  comprobar(
    `${shellTextos}: JSON roto y sin .bak: \`ls\` dice que no lo puede leer, y qué hacer`,
    plano(lsRoto.out).includes('no puede leer el registro de conexiones (db-connections.json): no es JSON válido') &&
      /corrígelo .* reinicia Tessera/.test(plano(lsRoto.out)),
    lsRoto.out.slice(0, 500)
  )
  comprobar(
    `${shellTextos}: JSON roto: NEGATIVO: ni la lista, ni «No hay conexiones configuradas», ni el aviso del formato ajeno`,
    !lsRoto.out.includes('base-pg') &&
      !lsRoto.out.includes('No hay conexiones configuradas') &&
      !mandaAHacer.test(lsRoto.out) &&
      !avisoFormato.test(lsRoto.out) &&
      !plano(lsRoto.out).includes('.bak'),
    lsRoto.out.slice(0, 500)
  )
  const lsRotoJson = jsonDe(correr(shellTextos, 'tdb ls --json', undefined, rotoSolo).out)
  comprobar(
    `${shellTextos}: JSON roto: \`ls --json\` lleva la marca de siempre (\`formatoAjeno: true\`) con SU aviso`,
    lsRotoJson?.formatoAjeno === true &&
      plano(String(lsRotoJson?.aviso)).includes('no es JSON válido') &&
      (lsRotoJson?.conexiones as unknown[] | undefined)?.length === 0,
    JSON.stringify(lsRotoJson)
  )
  const qRoto = correr(shellTextos, 'tdb query base-pg --stdin', 'SELECT 1', rotoSolo)
  comprobar(
    `${shellTextos}: JSON roto: consultar falla con el aviso, no con «Disponibles: (ninguna)»`,
    qRoto.code === 1 && plano(qRoto.out).includes('no es JSON válido') && !qRoto.out.includes('Disponibles'),
    `code=${qRoto.code} ${qRoto.out.slice(0, 400)}`
  )
  const doctorRoto = correr(shellTextos, 'tdb doctor', undefined, rotoSolo)
  const doctorRotoJson = jsonDe(correr(shellTextos, 'tdb doctor --json', undefined, rotoSolo).out)
  comprobar(
    `${shellTextos}: JSON roto: \`doctor\` lo da como veredicto, y --json lleva la marca y el aviso`,
    plano(doctorRoto.out).includes('no es JSON válido') &&
      !doctorRoto.out.includes('Todo en orden') &&
      doctorRotoJson?.formatoAjeno === true &&
      plano(String(doctorRotoJson?.aviso)).includes('no es JSON válido'),
    `${doctorRoto.out.slice(-400)} json=${JSON.stringify({ f: doctorRotoJson?.formatoAjeno, a: doctorRotoJson?.aviso })}`
  )
  const rotoConBak = escribir('roto-bak.json', ROTO)
  writeFileSync(`${rotoConBak}.bak`, '{ tampoco')
  const lsRotoBak = correr(shellTextos, 'tdb ls', undefined, envDe(rotoConBak))
  comprobar(
    `${shellTextos}: JSON roto con un .bak que tampoco sirve: lo dice`,
    plano(lsRotoBak.out).includes('y su copia de respaldo (db-connections.json.bak) tampoco sirve') && !lsRotoBak.out.includes('base-pg'),
    lsRotoBak.out.slice(0, 500)
  )
  // Uno que EXISTE y no se deja abrir (una carpeta con su nombre: EISDIR en las dos
  // plataformas). Como el main: no se sabe qué tiene, no es un registro vacío.
  const carpeta = path.join(dir, 'carpeta.json')
  mkdirSync(carpeta)
  const lsCarpeta = correr(shellTextos, 'tdb ls', undefined, envDe(carpeta))
  comprobar(
    `${shellTextos}: un registro que no se deja abrir: lo dice con su código, no «No hay conexiones configuradas»`,
    plano(lsCarpeta.out).includes('no se pudo abrir (EISDIR)') && !lsCarpeta.out.includes('No hay conexiones configuradas'),
    lsCarpeta.out.slice(0, 400)
  )
  const lsCero = correr(shellTextos, 'tdb ls', undefined, envDe(escribir('cero.json', '')))
  comprobar(
    `${shellTextos}: NEGATIVO: cero bytes y sin .bak sigue siendo un registro VACÍO (nada que perder)`,
    lsCero.out.includes('No hay conexiones configuradas') && !plano(lsCero.out).includes('no puede leer'),
    lsCero.out.slice(0, 400)
  )
  // Lo decidido: uno que NO SE DEJA ABRIR se bloquea AUNQUE su
  // `.bak` se lea (el main no puede guardarlo aparte antes de sustituirlo, así que no lo
  // usa), y el aviso dice que la copia se lee pero no se usa. Antes `tdb` listaba el `.bak`.
  const carpetaConBak = path.join(dir, 'carpeta-bak.json')
  mkdirSync(carpetaConBak)
  writeFileSync(`${carpetaConBak}.bak`, conBak)
  const lsCarpetaBak = correr(shellTextos, 'tdb ls', undefined, envDe(carpetaConBak))
  comprobar(
    `${shellTextos}: no se deja abrir y su .bak SÍ se lee: bloqueado igual, y dice que la copia no se usa y qué hacer`,
    plano(lsCarpetaBak.out).includes('no se pudo abrir (EISDIR), y su copia de respaldo (db-connections.json.bak), aunque se lee, no se usa') &&
      /revisa sus permisos.* reinicia Tessera/.test(plano(lsCarpetaBak.out)) &&
      !lsCarpetaBak.out.includes('base-pg') &&
      !lsCarpetaBak.out.includes('No hay conexiones configuradas'),
    lsCarpetaBak.out.slice(0, 500)
  )

  // `doctor` con el principal AUSENTE: si hay un `.bak` que se lee,
  // las conexiones salen de ahí, como en la app, y el veredicto «apunta a un archivo que no
  // existe» mandaba a buscar otra instalación de Tessera. Tiene que decir la verdad: que se
  // usa la copia y que Tessera recreará el principal. Y las mitades negativas: sin `.bak`, o
  // con uno que no sirve, el principal que falta sigue siendo el veredicto.
  const sinPrincipal = (nombre: string, bak: string | undefined): string => {
    const ruta = path.join(dir, nombre)
    if (bak !== undefined) writeFileSync(`${ruta}.bak`, bak)
    return ruta
  }
  const noExiste = 'El registro apunta a un archivo que no existe.'
  const conCopia = sinPrincipal('ausente-bak.json', conBak)
  const doctorCopia = correr(shellTextos, 'tdb doctor', undefined, envDe(conCopia))
  const doctorCopiaJson = jsonDe(correr(shellTextos, 'tdb doctor --json', undefined, envDe(conCopia)).out)
  comprobar(
    `${shellTextos}: \`doctor\` con el principal ausente y un .bak legible: dice que usa la copia y que se recreará, no que no existe`,
    plano(doctorCopia.out).includes(
      'El registro (db-connections.json) no existe: se usa su copia de respaldo (db-connections.json.bak), y Tessera lo recreará en su próxima escritura.'
    ) &&
      doctorCopia.out.includes('<-- NO EXISTE (se usa su copia de respaldo, .bak)') &&
      !doctorCopia.out.includes(noExiste) &&
      doctorCopia.out.includes('1 visibles de 1 en el perfil'),
    doctorCopia.out.slice(-700)
  )
  comprobar(
    `${shellTextos}: \`doctor --json\` lo dice con un campo nuevo (registroDesdeRespaldo) sin cambiar registroExiste`,
    doctorCopiaJson?.registroExiste === false && doctorCopiaJson?.registroDesdeRespaldo === true,
    JSON.stringify({ existe: doctorCopiaJson?.registroExiste, respaldo: doctorCopiaJson?.registroDesdeRespaldo })
  )
  const conCopiaAjena = sinPrincipal('ausente-bak-ajeno.json', JSON.stringify({ version: '2', connections: [K1] }))
  const doctorCopiaAjena = correr(shellTextos, 'tdb doctor', undefined, envDe(conCopiaAjena))
  comprobar(
    `${shellTextos}: \`doctor\` con la copia en un formato ajeno: dice que la usa, NO que se recreará (la app no escribe), y el veredicto es el del formato`,
    plano(doctorCopiaAjena.out).includes('no existe: se usa su copia de respaldo (db-connections.json.bak).') &&
      !doctorCopiaAjena.out.includes('recreará') &&
      avisoFormato.test(doctorCopiaAjena.out) &&
      !doctorCopiaAjena.out.includes(noExiste),
    doctorCopiaAjena.out.slice(-700)
  )
  for (const [que, bak] of [
    ['sin .bak', undefined],
    ['con un .bak roto', '{ roto'],
    ['con un .bak de cero bytes', '']
  ] as const) {
    const ruta = sinPrincipal(`ausente-${que.replace(/\W+/g, '-')}.json`, bak)
    const d = correr(shellTextos, 'tdb doctor', undefined, envDe(ruta))
    const j = jsonDe(correr(shellTextos, 'tdb doctor --json', undefined, envDe(ruta)).out)
    comprobar(
      `${shellTextos}: NEGATIVO: \`doctor\` con el principal ausente ${que}: el veredicto de siempre, sin hablar de la copia`,
      d.out.includes(noExiste) && !d.out.includes('se usa su copia') && j?.registroDesdeRespaldo === false,
      d.out.slice(-500)
    )
  }

  // PARIDAD con el main: para el mismo PRINCIPAL y el mismo `.bak`, la decisión de
  // `leerRegistroConRespaldo` y la de `tdb` (qué se ve, o por qué no se ve nada). Se
  // invoca el `.cjs` directo y no por un shell: lo que se compara es la regla de lectura,
  // no el atajo (ya probado arriba), y así la tabla no cuesta un shell por fila.
  // `null` = el principal NO EXISTE (el primer arranque, o borrado a mano). Antes
  // la tabla escribía siempre el principal, así que un `tdb` que no fuera al `.bak`
  // con el principal ausente —el main sí va— pasaba la tabla entera en verde (medido).
  const textos: Array<string | null> = [
    null,
    '{"version":"2","connections":[]}',
    '{"version":2,"connections":[]}',
    '{"version":null}',
    '{"version":1e400}',
    '{"version":[2]}',
    '{"version":true}',
    '[]',
    'null',
    '{}',
    '[{"id":"x"}]',
    '[null]',
    '7',
    '0',
    '"db"',
    'true',
    '{"connections":{}}',
    '{"connections":null}',
    '{"connections":"x"}',
    '',
    'no es JSON',
    // Lo que no es JSON y lo que no tiene nada que perder.
    '   \n\t',
    '\uFEFF',
    '{"version":1,"connections":[' + JSON.stringify(K1) + ',]}',
    '{"version":1,"connections":[' + JSON.stringify(K1) + ']}'
  ]
  // `undefined` = sin `.bak`. Con él, un registro legible con una conexión (lo que se
  // rescata), uno roto, uno de cero bytes y uno de formato ajeno; y `CARPETA`, un `.bak`
  // que EXISTE y no se deja abrir (una carpeta con su nombre: EISDIR en las dos
  // plataformas), que tampoco sirve y el aviso lo tiene que decir.
  const CARPETA = { carpeta: true } as const
  const respaldos: Array<string | undefined | typeof CARPETA> = [
    undefined,
    JSON.stringify({ version: 1, connections: [K1] }),
    '{ roto',
    '',
    '{"version":"2","connections":[]}',
    CARPETA
  ]
  const EISDIR = (): never => {
    throw Object.assign(new Error('es una carpeta'), { code: 'EISDIR' })
  }
  /**
   * La decisión en una palabra: qué se ve (cuántas del perfil) o por qué no se ve nada. Con
   * el registro ilegible distingue también la CAUSA (no es JSON / no se pudo abrir), que es
   * lo que cambia el remedio, y qué dice del `.bak`: que tampoco sirve (`+bak`) o que se lee
   * pero no se usa (`+bak-legible`, el principal que no se deja abrir).
   */
  const decisionDe = (aviso: string | null, enElPerfil: number): string => {
    if (aviso === null) return `lista:${enElPerfil}`
    if (/no reconoce el formato/.test(aviso)) return 'formato-ajeno'
    const texto = plano(aviso)
    if (!/no puede leer|No se puede leer/.test(texto)) return `aviso-desconocido: ${aviso}`
    const causa = texto.includes('no se pudo abrir (') ? 'inaccesible' : texto.includes('no es JSON válido') ? 'ilegible' : '¿causa?'
    const copia = texto.includes('db-connections.json.bak) tampoco sirve')
      ? '+bak'
      : texto.includes('db-connections.json.bak), aunque se lee, no se usa')
        ? '+bak-legible'
        : ''
    return `${causa}${copia}`
  }
  const discrepancias: string[] = []
  const vistas = new Set<string>()
  let filas = 0
  // De DÓNDE sale lo que se ve (el `origen` de `lecturaConRespaldo` frente al
  // `registroDesdeRespaldo` de `doctor --json`), en las filas donde el principal falta, está
  // vacío o no es JSON, que son las que pueden tirar del `.bak`. Es lo que `doctor` usa para
  // no dar por inexistente un registro que se lee de la copia.
  let filasOrigen = 0
  const conOrigen = new Set<string | null>([null, '', 'no es JSON'])
  textos.forEach((texto, i) => {
    respaldos.forEach((bak, j) => {
      filas++
      const ruta = path.join(dir, `paridad-${i}-${j}.json`)
      const disco: Record<string, string | (() => never)> = {}
      if (texto !== null) {
        escribir(`paridad-${i}-${j}.json`, texto)
        disco[ruta] = texto
      }
      if (typeof bak === 'object') {
        mkdirSync(`${ruta}.bak`)
        disco[`${ruta}.bak`] = EISDIR
      } else if (bak !== undefined) {
        writeFileSync(`${ruta}.bak`, bak)
        disco[`${ruta}.bak`] = bak
      }
      const lectura = lecturaConRespaldo((r) => {
        const v = disco[r]
        return typeof v === 'function' ? v() : (v ?? null)
      }, ruta)
      const reg = lectura.reg
      const main = decisionDe(reg.aviso, reg.entradas.filter((e) => perfilDeEntrada(e) === 'p1').length)
      const r = spawnSync(process.execPath, [tdbCjs, 'ls', '--json'], { env: envDe(ruta), encoding: 'utf-8', timeout: PLAZO_HIJO_MS })
      const j2 = jsonDe(r.stdout ?? '')
      const tdb = decisionDe(j2?.formatoAjeno === true ? String(j2?.aviso) : null, Number(j2?.enElPerfil))
      vistas.add(main)
      if (main !== tdb) discrepancias.push(`${JSON.stringify(texto)} + .bak ${JSON.stringify(bak)}: main=${main} tdb=${tdb}`)
      if (conOrigen.has(texto)) {
        filasOrigen++
        const d = spawnSync(process.execPath, [tdbCjs, 'doctor', '--json'], { env: envDe(ruta), encoding: 'utf-8', timeout: PLAZO_HIJO_MS })
        const dj = jsonDe(d.stdout ?? '')
        const deMain = lectura.origen === 'respaldo'
        if (dj?.registroDesdeRespaldo !== deMain) {
          discrepancias.push(
            `origen de ${JSON.stringify(texto)} + .bak ${JSON.stringify(bak)}: main=${lectura.origen} doctor=${JSON.stringify(dj?.registroDesdeRespaldo)}`
          )
        }
      }
    })
  })
  // Y un principal que EXISTE y no se deja abrir: en disco, una carpeta con su nombre
  // (EISDIR); para el main, el lector que LANZA con ese código, que es lo que hace
  // `ConnectionStore.read` con todo lo que no sea «no existe».
  respaldos.forEach((bak, j) => {
    filas++
    const ruta = path.join(dir, `paridad-carpeta-${j}.json`)
    mkdirSync(ruta)
    if (typeof bak === 'object') mkdirSync(`${ruta}.bak`)
    else if (bak !== undefined) writeFileSync(`${ruta}.bak`, bak)
    const { reg } = lecturaConRespaldo((r) => {
      if (r === ruta) return EISDIR()
      if (r !== `${ruta}.bak` || bak === undefined) return null
      return typeof bak === 'object' ? EISDIR() : bak
    }, ruta)
    const main = decisionDe(reg.aviso, reg.entradas.filter((e) => perfilDeEntrada(e) === 'p1').length)
    const r = spawnSync(process.execPath, [tdbCjs, 'ls', '--json'], { env: envDe(ruta), encoding: 'utf-8', timeout: PLAZO_HIJO_MS })
    const j2 = jsonDe(r.stdout ?? '')
    const tdb = decisionDe(j2?.formatoAjeno === true ? String(j2?.aviso) : null, Number(j2?.enElPerfil))
    vistas.add(main)
    if (main !== tdb) discrepancias.push(`carpeta + .bak ${JSON.stringify(bak)}: main=${main} tdb=${tdb}`)
  })
  comprobar(
    `paridad: \`tdb\` y \`lecturaConRespaldo\` deciden lo mismo en ${filas} pares principal/.bak ` +
      `(${[...vistas].sort().join(', ')}), y el origen en ${filasOrigen}`,
    discrepancias.length === 0 &&
      [
        'formato-ajeno',
        'ilegible',
        'ilegible+bak',
        'inaccesible',
        'inaccesible+bak',
        'inaccesible+bak-legible',
        'lista:0',
        'lista:1'
      ].every((d) => vistas.has(d)),
    discrepancias.join('; ') || [...vistas].join(', ')
  )
}

rmSync(dir, { recursive: true, force: true })

console.log(
  `\n${fallos === 0 ? '✓ TODO VERDE' : `✗ ${fallos} FALLO(S)`}` +
    `${saltados ? ` (${saltados} saltado(s))` : ''}\n`
)
process.exit(fallos === 0 ? 0 : 1)
