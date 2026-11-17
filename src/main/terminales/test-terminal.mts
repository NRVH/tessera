#!/usr/bin/env node
// =============================================================================
// Prueba de aceptación de `ServicioTerminal` sobre el contenedor de un perfil (npm run
// test:terminal).
// Reutiliza el GestorSandbox (ensureContainer + addProject) y abre terminales interactivas con
// `docker exec -it`.
// Verifica el cwd neutro, la salida por onData, el reload que recoge el entorno nuevo, dos sesiones
// simultáneas y cerrarSesion sin parar el contenedor; limpia al final.
// Solo Node core + GestorSandbox + ServicioTerminal + node-pty.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { GestorSandbox, nombreContenedorPara } from '../sandbox/GestorSandbox.ts'
import { tramosDelHost } from '../sandbox/centinelaHost.ts'
import { ServicioTerminal } from './ServicioTerminal.ts'
import type { Perfil } from '../perfiles/types.ts'

const DIR_MODULO = path.dirname(fileURLToPath(import.meta.url))
const RAIZ_REPO = path.resolve(DIR_MODULO, '../../..')
const RUTA_HOST_PROYECTO = path.join(RAIZ_REPO, 'docker', 'sandbox', 'proyecto-demo')
// Id PROPIO del test: el nombre del contenedor y el `configDir` se derivan del id,
// así que con uno real este test mataba el contenedor de ese perfil del usuario.
const NOMBRE_CONTENEDOR = nombreContenedorPara({ id: 'termqa' } as Parameters<typeof nombreContenedorPara>[0])

const PERFIL_QA: Perfil = {
  id: 'termqa',
  nombre: 'TerminalQA',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/termqa/claude' }],
  sandbox: { habilitado: true }
}

// ---- utilidades de reporte --------------------------------------------------
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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

// ---- utilidades de pty ------------------------------------------------------
const ESC = String.fromCharCode(27)
const CSI = new RegExp(ESC + '\\[[0-9;?]*[ -/]*[@-~]', 'g')
const OSC = new RegExp(ESC + '\\][^\\u0007]*(?:\\u0007|' + ESC + '\\\\)', 'g')
const OTRAS = new RegExp(ESC + '[=>()][0-9A-Za-z]?', 'g')
/** Quita las secuencias de escape que ConPTY inyecta, para poder leer texto plano. */
function quitarAnsi(s: string): string {
  return s.replace(OSC, '').replace(CSI, '').replace(OTRAS, '')
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Tramos del host por encima del proyecto montado, más el usuario (sin `tessera`, que puede
// salir en el prompt por el nombre del contenedor).
const PROHIBIDOS = tramosDelHost(path.dirname(RUTA_HOST_PROYECTO), ['tessera'])
const reUnidad = /(?:^|[^a-z])[a-z]:[\\/]/i
function detectarFuga(valor: string): string | null {
  const minusculas = valor.toLowerCase()
  for (const t of PROHIBIDOS) if (minusculas.includes(t)) return `contiene "${t}"`
  if (reUnidad.test(valor)) return 'contiene una letra de unidad de Windows'
  if (valor.includes('\\')) return 'contiene backslash de Windows'
  return null
}

/**
 * Envuelve una sesión con un buffer acumulado y un `run(cmd)` que delimita la
 * salida con marcadores únicos y espera a leerla completa por onData.
 */
function conectar(term: ServicioTerminal, sesionId: string): {
  buffer: () => string
  ejecutar: (cmd: string, topeMs?: number) => Promise<string>
  dispose: () => void
} {
  let buf = ''
  const unsub = term.onData(sesionId, (d) => {
    buf += d
  })
  let numeroMarca = 0
  async function ejecutar(cmd: string, topeMs = 12000): Promise<string> {
    const n = ++numeroMarca
    const INICIO = `TSSA_${n}_S`
    const FIN = `TSSA_${n}_E`
    term.write(sesionId, `echo ${INICIO}; ${cmd}; echo ${FIN}\n`)
    const plazo = Date.now() + topeMs
    for (;;) {
      const extracted = extractBetween(buf, INICIO, FIN)
      if (extracted !== null) return extracted
      if (Date.now() > plazo) {
        throw new Error(`Timeout esperando salida de "${cmd}".\n---buffer---\n${quitarAnsi(buf)}`)
      }
      await dormir(40)
    }
  }
  return { buffer: () => quitarAnsi(buf), ejecutar, dispose: unsub }
}

/** Extrae las líneas ejecutadas entre la línea == START y la línea == END. */
function extractBetween(bufCrudo: string, INICIO: string, FIN: string): string | null {
  const lineas = quitarAnsi(bufCrudo)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/g, ''))
  const si = lineas.findIndex((l) => l.trim() === INICIO)
  if (si < 0) return null
  const ei = lineas.findIndex((l, i) => i > si && l.trim() === FIN)
  if (ei < 0) return null
  return lineas
    .slice(si + 1, ei)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
}

function contenedorEnMarcha(nombre: string): boolean {
  const r = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', nombre], {
    encoding: 'utf8'
  })
  return r.status === 0 && r.stdout.trim() === 'true'
}

// =============================================================================
async function main(): Promise<void> {
  const sandbox = new GestorSandbox()

  hr('PASO 0 - checkDocker()')
  const comprobacionDocker = await sandbox.checkDocker()
  if (!comprobacionDocker.ok) {
    console.error('[FAIL] Docker no está disponible.\n')
    console.error(comprobacionDocker.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker responde ->', comprobacionDocker.detalle)

  hr('PASO 1 - ensureContainer(QA) + addProject(QA, proyecto-demo)')
  console.log('Proyecto host:', RUTA_HOST_PROYECTO)
  await sandbox.ensureContainer(PERFIL_QA)
  const montaje = await sandbox.addProject(PERFIL_QA, RUTA_HOST_PROYECTO)
  const WORKSPACE = montaje.rutaWorkspace
  console.log('MontajeProyecto:', JSON.stringify(montaje, null, 2))

  const term = new ServicioTerminal(sandbox)
  let codigoSalidaTrasCerrar: number | null = null

  try {
    // --- Sesión principal ----------------------------------------------------
    hr('PASO 2 - crearSesion(QA, { proyecto }) + esperar arranque del shell')
    const s1 = await term.crearSesion(PERFIL_QA, { proyecto: RUTA_HOST_PROYECTO })
    console.log('Sesión creada:', { id: s1.id, perfilId: s1.perfilId, rutaWorkspace: s1.rutaWorkspace })
    const a1 = conectar(term, s1.id)
    await dormir(900) // deja que `bash -il` termine su arranque

    // (a) pwd == /workspace/<x>
    hr('PASO 3 (a) - pwd por el pty')
    const salidaPwd = await a1.ejecutar('pwd')
    console.log('pwd ->', JSON.stringify(salidaPwd))
    const leak = detectarFuga(salidaPwd)
    check(
      '(a) pwd devuelve el cwd neutro /workspace/<x> sin filtrar la ruta de Windows',
      salidaPwd === WORKSPACE && leak === null,
      `pwd="${salidaPwd}" esperado="${WORKSPACE}"${leak ? ` ;; FUGA: ${leak}` : ''}`
    )

    // (b) escribir comando + leer salida
    hr('PASO 4 (b) - export VAR + echo, leer por onData')
    const salidaEco = await a1.ejecutar('export GREETING=hola_mundo; echo got:$GREETING')
    console.log('echo ->', JSON.stringify(salidaEco))
    check(
      '(b) Se escribe un comando y se lee su salida por onData',
      salidaEco === 'got:hola_mundo',
      `salida="${salidaEco}" esperado="got:hola_mundo"`
    )

    // (c) RELOAD ROBUSTO -------------------------------------------------------
    hr('PASO 5 (c) - RELOAD ROBUSTO: el shell nuevo ve una VAR del contenedor sin reiniciarlo')
    const antes = await a1.ejecutar('echo RVAR=[$TESSERA_RELOAD_VAR]')
    console.log('shell VIEJO ->', JSON.stringify(antes))

    // Set de la VAR en el ENTORNO del contenedor (docker exec APARTE, como root):
    // se escribe en /etc/profile.d, que TODO shell de login re-lee al arrancar.
    const VALOR_RECARGA = 'reloaded_ok_42'
    const setEnv = spawnSync(
      'docker',
      [
        'exec',
        '-u',
        'root',
        NOMBRE_CONTENEDOR,
        'sh',
        '-c',
        `echo 'export TESSERA_RELOAD_VAR=${VALOR_RECARGA}' > /etc/profile.d/tessera-reload.sh`
      ],
      { encoding: 'utf8' }
    )
    console.log('docker exec (set VAR en /etc/profile.d) status:', setEnv.status, setEnv.stderr.trim())

    // El shell VIEJO (aún vivo) NO debería verla: su entorno ya estaba fijado.
    const sigueViejo = await a1.ejecutar('echo RVAR=[$TESSERA_RELOAD_VAR]')
    console.log('shell VIEJO tras set (sigue sin verla) ->', JSON.stringify(sigueViejo))

    // recargarSesion: mismo contenedor, mismo cwd, MISMO sessionId, entorno recomputado.
    const s1Recargada = await term.recargarSesion(s1.id)
    await dormir(900)
    const tras = await a1.ejecutar('echo RVAR=[$TESSERA_RELOAD_VAR]')
    console.log('shell NUEVO tras reload ->', JSON.stringify(tras))

    const mismoId = s1Recargada.id === s1.id
    const viejoCiego = antes.includes('RVAR=[]') && sigueViejo.includes('RVAR=[]')
    const nuevoVe = tras.includes(`RVAR=[${VALOR_RECARGA}]`)
    const sigueVivo = contenedorEnMarcha(NOMBRE_CONTENEDOR)
    check(
      '(c) recargarSesion refresca el entorno: el shell nuevo VE la VAR sin reiniciar el contenedor',
      mismoId && viejoCiego && nuevoVe && sigueVivo,
      `sessionId conservado=${mismoId} ; viejo_ciego="${antes.trim()}"/"${sigueViejo.trim()}" ; ` +
        `nuevo_ve="${tras.trim()}" ; contenedor_vivo=${sigueVivo}`
    )

    // (d) dos sesiones simultáneas, mismo proyecto, sin interferencia ----------
    hr('PASO 6 (d) - dos sesiones simultáneas en el mismo proyecto, independientes')
    const s2 = await term.crearSesion(PERFIL_QA, { proyecto: RUTA_HOST_PROYECTO })
    const a2 = conectar(term, s2.id)
    await dormir(900)

    await a1.ejecutar('export ONLY_IN_1=alpha')
    await a2.ejecutar('export ONLY_IN_2=beta')
    const s1Ve = await a1.ejecutar('echo A=[$ONLY_IN_1] B=[$ONLY_IN_2]')
    const s2Ve = await a2.ejecutar('echo A=[$ONLY_IN_1] B=[$ONLY_IN_2]')
    console.log('sesión1 ve ->', JSON.stringify(s1Ve))
    console.log('sesión2 ve ->', JSON.stringify(s2Ve))
    const s1Independent = s1Ve.includes('A=[alpha]') && s1Ve.includes('B=[]')
    const s2Independent = s2Ve.includes('A=[]') && s2Ve.includes('B=[beta]')
    check(
      '(d) Dos sesiones en el mismo contenedor/proyecto no se pisan (entornos independientes)',
      s1Independent && s2Independent,
      `s1="${s1Ve.trim()}" (espera A=[alpha] B=[]) ; s2="${s2Ve.trim()}" (espera A=[] B=[beta])`
    )

    // (e) cerrarSesion termina el shell y sale de listarSesiones; contenedor vivo -
    hr('PASO 7 (e) - cerrarSesion termina el shell; listarSesiones lo excluye; contenedor vivo')
    const antesDeCerrar = term.listarSesiones(PERFIL_QA).map((s) => s.id)
    a2.dispose()
    await term.cerrarSesion(s2.id)
    codigoSalidaTrasCerrar = s2.codigoSalida
    const trasCerrar = term.listarSesiones(PERFIL_QA).map((s) => s.id)
    const contenedorVivo = contenedorEnMarcha(NOMBRE_CONTENEDOR)
    console.log('listarSesiones antes:', antesDeCerrar, '-> después:', trasCerrar)
    console.log('código de salida del shell cerrado:', codigoSalidaTrasCerrar)
    check(
      '(e) cerrarSesion termina el shell y listarSesiones ya no lo incluye; el contenedor sigue vivo',
      antesDeCerrar.includes(s2.id) &&
        !trasCerrar.includes(s2.id) &&
        trasCerrar.includes(s1.id) &&
        contenedorVivo &&
        codigoSalidaTrasCerrar !== null,
      `antes=[${antesDeCerrar.join(',')}] despues=[${trasCerrar.join(',')}] ; ` +
        `exitCode=${codigoSalidaTrasCerrar} ; contenedor_vivo=${contenedorVivo}`
    )

    // (f) el pty nace con el tamaño pedido, también dentro del contenedor ------
    hr('PASO 7b (f) - crearSesion con tamano: el proceso del contenedor lo ve al arrancar')
    const s3 = await term.crearSesion(PERFIL_QA, { proyecto: RUTA_HOST_PROYECTO, tamano: { cols: 137, rows: 41 } })
    const a3 = conectar(term, s3.id)
    await dormir(900)
    const tam = await a3.ejecutar('stty size')
    a3.dispose()
    await term.cerrarSesion(s3.id)
    check('(f) el pty nace con el tamaño pedido, sin esperar a un resize', tam === '41 137', `stty size="${tam}" esperado="41 137"`)
    const s4 = await term.crearSesion(PERFIL_QA, { proyecto: RUTA_HOST_PROYECTO, tamano: { cols: 0, rows: 99999 } })
    const tam4 = `${s4.pty.cols}x${s4.pty.rows}`
    await term.cerrarSesion(s4.id)
    check('(f2) un tamaño fuera de rango cae al de siempre', tam4 === '80x24', `pty=${tam4}`)

    a1.dispose()
  } finally {
    // --- Limpieza: cerrar sesiones vivas + detenerContenedor -----------------
    hr('PASO 8 - limpieza (cerrar sesiones + detenerContenedor), sin huérfanos')
    for (const s of term.listarSesiones()) {
      await term.cerrarSesion(s.id)
      console.log('cerrada sesión huérfana:', s.id)
    }
    await sandbox.detenerContenedor(PERFIL_QA)

    const ps = spawnSync(
      'docker',
      ['ps', '-a', '--filter', `name=^${NOMBRE_CONTENEDOR}$`, '--format', '{{.Names}}'],
      { encoding: 'utf8' }
    )
    const sigueExistiendo = ps.stdout.trim().length > 0
    check(
      '(limpieza) contenedor detenido y eliminado; sin sesiones vivas',
      !sigueExistiendo && term.listarSesiones().length === 0,
      sigueExistiendo
        ? `"docker ps -a" todavía lista ${NOMBRE_CONTENEDOR}`
        : `sin contenedor y ${term.listarSesiones().length} sesiones vivas`
    )
  }

  // --- Reporte final -----------------------------------------------------------
  hr('RESULTADO DE VERIFICACIONES (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const allPass = results.every((r) => r.pass)
  hr(`VEREDICTO: ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado en la prueba:', err)
  process.exit(1)
})
