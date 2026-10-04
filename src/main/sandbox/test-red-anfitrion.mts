#!/usr/bin/env node
// =============================================================================
// Prueba de `redAnfitrion.ts` (npm run test:red-anfitrion): rutas y lectura de los ajustes
// de Docker Desktop, versión, cada fila del prevuelo en ok/falla/desconocido (sin confundir
// «apagado» con «no se pudo saber»), el remedio por plataforma y la nota del egress.
// La plataforma entra por parámetro: se fijan las dos desde cualquier máquina.
// Decisiones: docs/decisiones/sandbox/red-del-anfitrion.md
// =============================================================================

import {
  evaluarPrevuelo,
  leerAjustesDocker,
  modoRedWsl,
  notaEgress,
  rutasAjustesDocker,
  versionDockerDesktop,
  type EntradasPrevuelo
} from './redAnfitrion.ts'
import type { FilaPrevuelo } from '../../shared/sandbox-red-ipc.ts'

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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

/** Todo en verde: la base sobre la que cada caso rompe UNA cosa. */
const FELIZ: EntradasPrevuelo = {
  motorVivo: true,
  tipoContenedores: 'linux',
  nombrePlataformaDocker: 'Docker Desktop 4.90.0 (238679)',
  hostNetworking: true,
  aislamientoReforzado: false,
  traficoLlega: true
}

function fila(filas: FilaPrevuelo[], id: FilaPrevuelo['id']): FilaPrevuelo {
  const f = filas.find((x) => x.id === id)
  if (!f) throw new Error(`no hay fila "${id}"`)
  return f
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Rutas del fichero de ajustes de Docker Desktop, por plataforma')
  const rw = rutasAjustesDocker('windows', 'C:\\Users\\x', 'C:\\Users\\x\\AppData\\Roaming')
  const rm = rutasAjustesDocker('mac', '/Users/x', '')
  check(
    'Windows apunta a %APPDATA%\\Docker',
    rw[0].endsWith('AppData\\Roaming\\Docker\\settings-store.json'),
    rw[0]
  )
  check(
    'macOS apunta al Group Container de Docker',
    rm[0] === '/Users/x/Library/Group Containers/group.com.docker/settings-store.json',
    rm[0]
  )
  check(
    'las dos son LISTA con el nombre viejo detrás (Docker lo renombró en la 4.35)',
    rw.length === 2 && rw[1].endsWith('settings.json') && rm.length === 2 && rm[1].endsWith('settings.json'),
    `windows=${rw.length} mac=${rm.length}`
  )
  check(
    'las rutas de las dos plataformas se fijan desde ESTA máquina, sea cual sea',
    rw[0] !== rm[0],
    'ninguna llamada mira process.platform'
  )

  // -------------------------------------------------------------------------
  hr('(2-3) Lectura del fichero: capitalización, y null != false')
  check(
    'acepta HostNetworkingEnabled (el del fichero de Windows)',
    leerAjustesDocker('{"HostNetworkingEnabled":true}').hostNetworking === true,
    'true'
  )
  check(
    'acepta hostNetworkingEnabled (la capitalización del esquema interno)',
    leerAjustesDocker('{"hostNetworkingEnabled":true}').hostNetworking === true,
    'true'
  )
  check(
    'fichero ausente => null ("no se pudo saber"), no false',
    leerAjustesDocker(null).hostNetworking === null,
    'null'
  )
  check(
    'JSON roto => null, no false',
    leerAjustesDocker('{esto no es json').hostNetworking === null,
    'null'
  )
  check(
    'fichero legible SIN la clave => false (es el defecto real de Docker)',
    leerAjustesDocker('{"Cpus":32}').hostNetworking === false,
    'false'
  )
  check(
    'lee TAMBIÉN el aislamiento reforzado del mismo fichero',
    leerAjustesDocker('{"EnhancedContainerIsolation":true}').aislamientoReforzado === true,
    'true'
  )

  // -------------------------------------------------------------------------
  hr('(4) Versión de Docker Desktop')
  const v = versionDockerDesktop('Docker Desktop 4.90.0 (238679)')
  check('parsea mayor.menor', v?.mayor === 4 && v?.menor === 90, JSON.stringify(v))
  check(
    'lo que NO es Docker Desktop devuelve null (no "versión vieja")',
    versionDockerDesktop('Docker Engine - Community') === null && versionDockerDesktop(null) === null,
    'null'
  )

  // -------------------------------------------------------------------------
  hr('(5) Camino feliz')
  const feliz = evaluarPrevuelo(FELIZ, 'windows', 'tu Windows')
  check('ninguna fila en falla', !feliz.hayFallas, `${feliz.filas.length} filas, 0 fallas`)
  check(
    'las cinco comprobaciones están',
    feliz.filas.length === 5,
    feliz.filas.map((f) => f.id).join(', ')
  )
  check(
    'una fila en ok no lleva remedio (no hay nada que hacer)',
    feliz.filas.every((f) => f.estado !== 'ok' || f.remedio === undefined),
    'sin remedios'
  )

  // -------------------------------------------------------------------------
  hr('(6) La casilla apagada')
  const apagada = evaluarPrevuelo({ ...FELIZ, hostNetworking: false }, 'mac', 'tu Mac')
  const fAjuste = fila(apagada.filas, 'ajuste')
  check('falla', fAjuste.estado === 'falla', fAjuste.estado)
  check(
    'el remedio nombra el menú REAL de Docker Desktop, en su idioma',
    /Settings › Resources › Network/.test(fAjuste.remedio ?? '') &&
      /Apply and restart/.test(fAjuste.remedio ?? ''),
    fAjuste.remedio ?? ''
  )

  // -------------------------------------------------------------------------
  hr('(7) Enhanced Container Isolation: el falso verde')
  const eci = evaluarPrevuelo({ ...FELIZ, aislamientoReforzado: true }, 'windows', 'tu Windows')
  check(
    'con la casilla MARCADA y ECI encendido, sigue habiendo falla',
    eci.hayFallas && fila(eci.filas, 'ajuste').estado === 'ok',
    'una sonda de una sola clave habría dado verde'
  )
  check(
    'el remedio nombra tuEquipo y no el sistema a mano',
    (fila(eci.filas, 'aislamiento').remedio ?? '').includes('tu Windows'),
    fila(eci.filas, 'aislamiento').remedio ?? ''
  )

  // -------------------------------------------------------------------------
  hr('(8-9) Contenedores Windows y versión insuficiente')
  const win = evaluarPrevuelo({ ...FELIZ, tipoContenedores: 'windows' }, 'windows', 'tu Windows')
  check(
    'contenedores Windows: falla y lo explica',
    fila(win.filas, 'motor').estado === 'falla' &&
      /contenedores Linux/.test(fila(win.filas, 'motor').remedio ?? ''),
    fila(win.filas, 'motor').remedio ?? ''
  )
  const vieja = evaluarPrevuelo(
    { ...FELIZ, nombrePlataformaDocker: 'Docker Desktop 4.30.0 (1234)' },
    'mac',
    'tu Mac'
  )
  check(
    'versión por debajo de la 4.34: falla y dice cuál tiene',
    fila(vieja.filas, 'version').estado === 'falla' &&
      /4\.30/.test(fila(vieja.filas, 'version').remedio ?? ''),
    fila(vieja.filas, 'version').remedio ?? ''
  )

  // -------------------------------------------------------------------------
  hr('(10) Ilegible NO es apagado')
  const nose = evaluarPrevuelo(
    { ...FELIZ, hostNetworking: null, aislamientoReforzado: null },
    'mac',
    'tu Mac'
  )
  check(
    'las dos filas quedan en desconocido, no en falla',
    fila(nose.filas, 'ajuste').estado === 'desconocido' &&
      fila(nose.filas, 'aislamiento').estado === 'desconocido',
    'desconocido'
  )
  check(
    'y el prevuelo NO declara fallas por no haber podido leer',
    !nose.hayFallas,
    'hayFallas=false'
  )
  check(
    'el texto remite a la comprobación que sí decide',
    /comprobación del tráfico/.test(fila(nose.filas, 'ajuste').remedio ?? ''),
    fila(nose.filas, 'ajuste').remedio ?? ''
  )

  // -------------------------------------------------------------------------
  hr('(11) La fila del tráfico bifurca el REMEDIO, no la palabra')
  const sinTraficoWin = fila(
    evaluarPrevuelo({ ...FELIZ, traficoLlega: false }, 'windows', 'tu Windows').filas,
    'trafico'
  )
  const sinTraficoMac = fila(
    evaluarPrevuelo({ ...FELIZ, traficoLlega: false }, 'mac', 'tu Mac').filas,
    'trafico'
  )
  check(
    'Windows habla de WSL 2 (Docker documenta la incompatibilidad de kernel)',
    /WSL 2/.test(sinTraficoWin.remedio ?? ''),
    sinTraficoWin.remedio ?? ''
  )
  check(
    'macOS NO habla de WSL: allí no existe',
    !/WSL/i.test(sinTraficoMac.remedio ?? ''),
    sinTraficoMac.remedio ?? ''
  )
  check(
    'los dos títulos son el MISMO y sólo cambian por tuEquipo',
    sinTraficoWin.titulo.replace('tu Windows', '_') === sinTraficoMac.titulo.replace('tu Mac', '_'),
    sinTraficoWin.titulo
  )

  // -------------------------------------------------------------------------
  hr('(12) Vocabulario: ni sesión de Docker, ni nombres de sistema a mano')
  const todos = [
    ...evaluarPrevuelo(FELIZ, 'windows', 'tu Windows').filas,
    ...evaluarPrevuelo({ ...FELIZ, hostNetworking: false, aislamientoReforzado: true, traficoLlega: false, tipoContenedores: 'windows', nombrePlataformaDocker: null }, 'mac', 'tu Mac').filas
  ]
    .flatMap((f) => [f.titulo, f.remedio ?? ''])
    .join(' | ')
  check(
    'ningún texto pide iniciar sesión en Docker Desktop (dejó de hacer falta en la 4.35)',
    !/inicia sesión|sign in|iniciar sesión/i.test(todos),
    'sin mención a la sesión'
  )
  check(
    'ningún texto escribe macOS/Mac a mano en el caso de Windows',
    !/mac/i.test(evaluarPrevuelo(FELIZ, 'windows', 'tu Windows').filas.map((f) => f.titulo + (f.remedio ?? '')).join(' ')),
    'limpio'
  )

  // -------------------------------------------------------------------------
  hr('(13) La nota del EGRESS: sólo Windows, y nunca una comprobación')
  check(
    'en macOS no hay nota de egress (no hay WSL que configurar)',
    notaEgress('mac', null) === null && notaEgress('mac', 'nat') === null,
    'null'
  )
  check(
    'en Windows con NAT avisa y da el remedio del .wslconfig',
    /networkingMode=mirrored/.test(notaEgress('windows', 'nat') ?? ''),
    notaEgress('windows', 'nat') ?? ''
  )
  check(
    'con espejo dice que NO depende de esta opción',
    /No depende de esta opción/.test(notaEgress('windows', 'mirrored') ?? ''),
    notaEgress('windows', 'mirrored') ?? ''
  )
  check(
    'sin poder medir el modo, no se inventa nada',
    notaEgress('windows', null) === null,
    'null'
  )
  check(
    'modoRedWsl lee la salida de wslinfo y descarta lo que no reconoce',
    modoRedWsl('nat\n') === 'nat' && modoRedWsl('mirrored') === 'mirrored' && modoRedWsl('vaya') === null,
    'nat / mirrored / null'
  )

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
