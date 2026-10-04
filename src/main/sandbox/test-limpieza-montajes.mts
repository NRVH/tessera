#!/usr/bin/env node
// =============================================================================
// Prueba de `limpiezaMontajes.ts` (npm run test:limpieza-montajes): EJECUTA el fragmento con
// `sh` sobre un fixture de mountinfo real y `umount`/`rm`/`readlink` de mentira. Fija la VM
// de Mac (symlink y espacio), el orden y la decodificación, que sin `libre` no se borra, la
// forma de Windows, varias bases, `readlink` que falla y la base inexistente.
// En Windows corre dentro de un contenedor Linux (`correrEnLinux`).
// Decisiones: docs/decisiones/sandbox/limpieza-de-montajes.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esWindows } from '../../shared/plataforma.ts'
import { fragmentoDesmontarYBorrar, fragmentoDesmontarYBorrarVarias } from './limpiezaMontajes.ts'

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
function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Escapa un punto de montaje como lo escribe el kernel en mountinfo (proc(5)). */
function escaparMountinfo(ruta: string): string {
  // La barra invertida PRIMERO, para no re-escapar las que introducen las otras tres.
  return ruta.replace(/\\/g, '\\134').replace(/ /g, '\\040').replace(/\t/g, '\\011').replace(/\n/g, '\\012')
}

let siguienteId = 100
/** Una línea de mountinfo con el formato real (11 campos) y el campo 5 escapado. */
function lineaMountinfo(puntoMontaje: string): string {
  const id = siguienteId++
  return `${id} 50 0:60 / ${escaparMountinfo(puntoMontaje)} rw,relatime shared:${id} - virtiofs share rw`
}
const LINEAS_SISTEMA = [
  '22 1 0:20 / / rw,relatime - overlay overlay rw',
  '25 22 0:23 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw'
]

/** Separador de argumentos en el log de los stubs: no aparece en ninguna ruta. */
const SEP = '\x1f'

interface Ejecucion {
  status: number | null
  stdout: string
  stderr: string
  llamadas: string[][]
}

/**
 * Imagen en la que se corre la prueba cuando el equipo es Windows. Alpine (busybox:
 * `sh`, `awk`, `readlink`) es lo más parecido a donde corre el fragmento de verdad,
 * la VM de Docker Desktop; con Node 22 para ejecutar este mismo archivo.
 */
const IMAGEN_LINUX = 'node:22-alpine'

/**
 * EN WINDOWS LA PRUEBA SE EJECUTA EN LINUX. El fragmento nunca corre en el equipo: va
 * por `runPrivileged` (`nsenter … sh -c`) a la VM Linux de Docker. Con el `sh` de Git
 * para Windows las rutas cambian de forma por el camino (`C:\…\bin` sale como
 * `/tmp/…/bin`) y la prueba fallaba en su primer paso sin haber probado nada; y aunque
 * se tradujeran, lo que se probaría sería MSYS, no la VM. Así que aquí se vuelve a
 * lanzar ESTE archivo dentro de un contenedor con `src` montado en solo lectura. Sin
 * Docker, se SALTA y lo dice (código 0, veredicto SALTADO), como `test:db-postgres`.
 * En macOS y Linux corre tal cual, con el `sh` del sistema.
 */
function correrEnLinux(): never {
  const docker = spawnSync('docker', ['version', '--format', '{{.Server.Os}}'], { encoding: 'utf8', timeout: 20_000 })
  if (docker.status !== 0 || docker.stdout.trim() !== 'linux') {
    hr('VEREDICTO: 0/0 PASS — SALTADO (en Windows hace falta Docker con motor Linux: el fragmento corre en su VM)')
    process.exit(0)
  }
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  console.log(`Windows: la prueba se ejecuta en ${IMAGEN_LINUX} (el fragmento corre en la VM Linux de Docker)`)
  const r = spawnSync(
    'docker',
    ['run', '--rm', '-v', `${src}:/repo/src:ro`, '-w', '/repo', IMAGEN_LINUX, 'node', 'src/main/sandbox/test-limpieza-montajes.mts'],
    { stdio: 'inherit', timeout: 600_000 }
  )
  process.exit(r.status ?? 1)
}

function main(): void {
  if (esWindows()) correrEnLinux()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-limpieza-'))
  let todoPass = false
  try {
    todoPass = correr(tmp)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  process.exit(todoPass ? 0 : 1)
}

/** Ejecuta todas las comprobaciones dentro de `tmp` y devuelve si TODAS pasaron. */
function correr(tmp: string): boolean {
  // En macOS el temporal cuelga de `/var/folders`, que es `/private/var/folders`.
  const tmpReal = fs.realpathSync(tmp)
  const binDir = path.join(tmp, 'bin')
  const log = path.join(tmp, 'llamadas.log')
  fs.mkdirSync(binDir)
  for (const nombre of ['umount', 'rm']) {
    fs.writeFileSync(
      path.join(binDir, nombre),
      `#!/bin/sh\n` +
        `{ printf '%s' '${nombre}'; for a in "$@"; do printf '\\037%s' "$a"; done; printf '\\n'; } >> "$TESSERA_LOG_STUB"\n` +
        `exit 0\n`,
      { mode: 0o755 }
    )
  }
  const entorno = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    TESSERA_LOG_STUB: log
  }
  /**
   * `dirDelante` antepone otro directorio al PATH (por delante de los stubs). Se usa
   * sólo en (9), para colar un `readlink` que falla sin afectar a las demás.
   */
  function ejecutar(fragmento: string, dirDelante?: string): Ejecucion {
    fs.writeFileSync(log, '')
    const env = dirDelante === undefined ? entorno : { ...entorno, PATH: `${dirDelante}${path.delimiter}${entorno.PATH}` }
    const r = spawnSync('sh', ['-c', fragmento], { encoding: 'utf8', env })
    const llamadas = fs
      .readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split(SEP))
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, llamadas }
  }
  const umounts = (e: Ejecucion): string[][] => e.llamadas.filter((c) => c[0] === 'umount').map((c) => c.slice(1))
  const rms = (e: Ejecucion): string[][] => e.llamadas.filter((c) => c[0] === 'rm').map((c) => c.slice(1))
  const escribirFixture = (nombre: string, lineas: string[]): string => {
    const ruta = path.join(tmp, nombre)
    fs.writeFileSync(ruta, lineas.join('\n') + '\n')
    return ruta
  }

  // -------------------------------------------------------------------------
  hr('(0) Los stubs van primero en el PATH (si no, el resto no significa nada)')
  // -------------------------------------------------------------------------
  const quien = spawnSync('sh', ['-c', 'command -v umount; command -v rm'], { encoding: 'utf8', env: entorno })
  const stubsDelante = quien.stdout.trim() === `${binDir}/umount\n${binDir}/rm`
  check('(0) `umount` y `rm` resuelven a los stubs', stubsDelante, quien.stdout.trim().replace('\n', ' | '))
  if (!stubsDelante) {
    hr('VEREDICTO: 0/1 PASS — HAY FAIL (sin stubs no se ejecuta nada más)')
    return false
  }

  // -------------------------------------------------------------------------
  hr('(1) macOS: symlink /Users -> /host_mnt/Users + espacio en la base')
  // -------------------------------------------------------------------------
  const hostMnt = path.join(tmp, 'host_mnt', 'Users')
  const relBase = path.join('x', 'Library', 'Application Support', 'Tessera')
  fs.mkdirSync(path.join(hostMnt, relBase, 'sandbox-mm', 'perfil', 'proyecto'), { recursive: true })
  fs.mkdirSync(path.join(hostMnt, relBase, 'sandbox-agentcfg', 'perfil'), { recursive: true })
  // Base cuyo nombre acaba en una barra invertida seguida de `t` (nombre LITERAL:
  // `sandbox-mm\t`). Es el fixture que fija por qué la base entra en awk por ENVIRON.
  fs.mkdirSync(path.join(hostMnt, relBase, 'sandbox-mm\\t', 'perfil'), { recursive: true })
  fs.symlinkSync(path.join('host_mnt', 'Users'), path.join(tmp, 'Users'))
  // Como la interpola SandboxManager (por el symlink) y como la registra mountinfo.
  const baseMac = path.join(tmp, 'Users', relBase, 'sandbox-mm')
  const baseMacResuelta = fs.realpathSync(baseMac)
  const agentcfgMac = path.join(tmp, 'Users', relBase, 'sandbox-agentcfg')
  const agentcfgMacResuelta = fs.realpathSync(agentcfgMac)
  const baseEscape = path.join(tmp, 'Users', relBase, 'sandbox-mm\\t')
  const baseEscapeResuelta = fs.realpathSync(baseEscape)
  const ancestro = path.join(tmpReal, 'host_mnt', 'Users')
  check(
    '(1·fixture) la ruta resuelta pasa por host_mnt, no es la interpolada, y lleva espacio',
    baseMacResuelta !== baseMac && baseMacResuelta.includes('/host_mnt/Users/') && baseMacResuelta.includes(' '),
    baseMacResuelta
  )

  const bajoBaseMac = {
    proyecto: `${baseMacResuelta}/perfil/proyecto`,
    perfil: `${baseMacResuelta}/perfil`,
    conTab: `${baseMacResuelta}/perfil/con\ttab`,
    conBarra: `${baseMacResuelta}/perfil/a\\b`,
    // ACABA en espacio: es lo único que distingue `IFS= read -r` de `read -r` a
    // secas (éste recorta el blanco inicial y final, no el de en medio).
    finEspacio: `${baseMacResuelta}/perfil/acaba en espacio `
  }
  const vecinoMac = `${baseMacResuelta}2/perfil/proyecto`
  const fixtureMacCon = escribirFixture('mountinfo-mac-con', [
    ...LINEAS_SISTEMA,
    lineaMountinfo(ancestro),
    lineaMountinfo(bajoBaseMac.perfil),
    lineaMountinfo(bajoBaseMac.proyecto),
    lineaMountinfo(bajoBaseMac.conTab),
    lineaMountinfo(bajoBaseMac.conBarra),
    lineaMountinfo(bajoBaseMac.finEspacio),
    lineaMountinfo(vecinoMac),
    lineaMountinfo(`${agentcfgMacResuelta}/perfil`)
  ])
  const textoMacCon = fs.readFileSync(fixtureMacCon, 'utf8')
  check(
    '(1·fixture) el campo 5 va ESCAPADO como en el kernel (\\040, \\011, \\134)',
    textoMacCon.includes('Application\\040Support') &&
      textoMacCon.includes('con\\011tab') &&
      textoMacCon.includes('a\\134b') &&
      !textoMacCon.includes('Application Support'),
    textoMacCon.split('\n')[4]
  )

  const e1 = ejecutar(fragmentoDesmontarYBorrar(baseMac, { mountinfo: fixtureMacCon }))
  // Orden de bytes invertido: `…/perfil/proyecto` > `…/perfil/con<TAB>tab` >
  // `…/perfil/acaba en espacio ` > `…/perfil/a\b` > `…/perfil`. El más profundo
  // primero; la base (self-bind) la última. (`a\b` va DETRÁS de `acaba…` porque tras
  // la `a` común vienen `\` = 0x5c y `c` = 0x63.)
  const esperadoMac = [
    bajoBaseMac.proyecto,
    bajoBaseMac.conTab,
    bajoBaseMac.finEspacio,
    bajoBaseMac.conBarra,
    bajoBaseMac.perfil
  ].map((p) => ['-l', p])
  check(
    '(1a) umount -l con las rutas DECODIFICADAS, de más profunda a menos',
    igual(umounts(e1), esperadoMac),
    JSON.stringify(umounts(e1))
  )
  check(
    '(1b) todas las rutas desmontadas llevan el espacio real (ya no `\\040`)',
    umounts(e1).length > 0 && umounts(e1).every((u) => u[1].includes('Application Support')),
    umounts(e1).map((u) => u[1]).join(' | ')
  )
  // El tercero es el que fija el `IFS=` del `while read`: sin él, `read` recorta el
  // blanco INICIAL y FINAL de la línea y el `umount` recibiría la ruta sin su último
  // espacio. Los otros dos llevan el blanco en medio, donde `read` con una sola
  // variable lo conserva igual, así que no probaban nada de eso.
  check(
    '(1c) el tab y la barra invertida se decodifican, y una ruta que ACABA en espacio llega entera (`IFS=`)',
    umounts(e1).some((u) => u[1] === bajoBaseMac.conTab) &&
      umounts(e1).some((u) => u[1] === bajoBaseMac.conBarra) &&
      umounts(e1).some((u) => u[1] === bajoBaseMac.finEspacio),
    JSON.stringify([bajoBaseMac.conTab, bajoBaseMac.conBarra, bajoBaseMac.finEspacio])
  )
  check(
    '(1d) NI el vecino `sandbox-mm2` NI el ancestro `/host_mnt/Users` se tocan',
    umounts(e1).every((u) => !u[1].includes('sandbox-mm2') && u[1] !== ancestro),
    `vecino=${vecinoMac}`
  )
  check('(1e) el fragmento sale con 0', e1.status === 0, `status=${e1.status} stderr=${e1.stderr.trim()}`)

  // La base entra en awk por ENVIRON y NUNCA por `-v`, porque `-v` procesa las
  // secuencias de escape del VALOR. Con una base llamada `sandbox-mm\t` (barra
  // invertida + `t`, nombre legal en POSIX), `-v b="$b"` le dejaría a awk un
  // tabulador donde el nombre tiene dos caracteres, la comparación no casaría con
  // nada y no se desmontaría NADA. Medido en esta máquina: `awk -v b='/a\tb'` da
  // `/a<TAB>b` y `b='/a\tb' awk` da `/a\tb`.
  const bajoBaseEscape = `${baseEscapeResuelta}/perfil`
  const fixtureMacEscape = escribirFixture('mountinfo-mac-escape', [
    ...LINEAS_SISTEMA,
    lineaMountinfo(ancestro),
    lineaMountinfo(bajoBaseEscape)
  ])
  const eEscape = ejecutar(fragmentoDesmontarYBorrar(baseEscape, { mountinfo: fixtureMacEscape }))
  check(
    '(1f) la base entra por ENVIRON, no por -v: un `\\t` del nombre NO se convierte en tabulador',
    igual(umounts(eEscape), [['-l', bajoBaseEscape]]),
    JSON.stringify(umounts(eEscape))
  )

  // -------------------------------------------------------------------------
  hr('(2) Fixture estático = "siguen montados": NO se borra y se AVISA')
  // -------------------------------------------------------------------------
  check('(2a) rm NO se invocó', rms(e1).length === 0, JSON.stringify(rms(e1)))
  check(
    '(2b) sale el AVISO con la ruta canónica',
    e1.stdout.includes(`AVISO: montajes residuales bajo ${baseMacResuelta}, no se borra`),
    e1.stdout.trim()
  )

  // -------------------------------------------------------------------------
  hr('(3) Fixture sin montajes bajo la base: rm -rf de la ruta CANÓNICA')
  // -------------------------------------------------------------------------
  const fixtureMacSin = escribirFixture('mountinfo-mac-sin', [
    ...LINEAS_SISTEMA,
    lineaMountinfo(ancestro),
    lineaMountinfo(vecinoMac),
    lineaMountinfo(`${agentcfgMacResuelta}/perfil`)
  ])
  const e2 = ejecutar(fragmentoDesmontarYBorrar(baseMac, { mountinfo: fixtureMacSin }))
  check('(3a) no hay nada que desmontar: umount no se invocó', umounts(e2).length === 0, JSON.stringify(umounts(e2)))
  check(
    '(3b) rm -rf UNA vez, con la ruta resuelta (/host_mnt/…), no con la del symlink',
    igual(rms(e2), [['-rf', baseMacResuelta]]),
    JSON.stringify(rms(e2))
  )
  check('(3c) sin AVISO', !e2.stdout.includes('AVISO'), JSON.stringify(e2.stdout))

  // -------------------------------------------------------------------------
  hr('(4) Evidencia: la guarda antigua `grep -q " $base"` no casaba con este fixture')
  // -------------------------------------------------------------------------
  // Esto es lo que hacía `grep -q " $base" /proc/self/mountinfo || rm -rf "$base"`.
  const grepViejo = (base: string): number | null => spawnSync('grep', ['-q', ` ${base}`, fixtureMacCon]).status
  check(
    '(4a) con la base SIN resolver (la que interpolaba SandboxManager): sin coincidencia',
    grepViejo(baseMac) === 1,
    `grep -q " ${baseMac}" -> ${grepViejo(baseMac)}`
  )
  check(
    '(4b) ni siquiera con la base RESUELTA, por el `\\040` del espacio',
    grepViejo(baseMacResuelta) === 1,
    `grep -q " ${baseMacResuelta}" -> ${grepViejo(baseMacResuelta)}`
  )
  check(
    '(4c) …y sin embargo el fixture SÍ lista montajes bajo la base: el rm -rf habría corrido',
    textoMacCon.includes(escaparMountinfo(baseMacResuelta) + '/perfil'),
    escaparMountinfo(baseMacResuelta)
  )

  // -------------------------------------------------------------------------
  hr('(5) La forma de Windows: /mnt/wsl/tessera-mm, sin symlink ni espacios')
  // -------------------------------------------------------------------------
  // Se CREAN de verdad, bajo el temporal ya resuelto: `readlink -f` tiene que poder
  // canonizarlas (y devolverlas idénticas, que es la gracia de la forma de Windows).
  // Con el literal `/mnt/wsl/…` —inexistente en este Mac— el caso no probaba a
  // Windows sino al respaldo de `readlink`, que ya no existe.
  const raizWsl = path.join(tmpReal, 'mnt', 'wsl')
  const baseWin = path.join(raizWsl, 'tessera-mm')
  const agentcfgWin = path.join(raizWsl, 'tessera-agentcfg')
  fs.mkdirSync(path.join(baseWin, 'perfil', 'proyecto'), { recursive: true })
  fs.mkdirSync(path.join(agentcfgWin, 'perfil'), { recursive: true })
  check(
    '(5·fixture) la base con forma de Windows se canoniza a sí misma (sin symlinks)',
    fs.realpathSync(baseWin) === baseWin && !baseWin.includes(' '),
    baseWin
  )
  const fixtureWinCon = escribirFixture('mountinfo-win-con', [
    ...LINEAS_SISTEMA,
    lineaMountinfo(raizWsl),
    lineaMountinfo('/mnt/host/d'),
    lineaMountinfo(`${baseWin}/perfil`),
    lineaMountinfo(`${baseWin}/perfil/proyecto`),
    lineaMountinfo(`${baseWin}2/perfil/x`),
    lineaMountinfo(`${agentcfgWin}/perfil/claude/cuenta`)
  ])
  const e5 = ejecutar(fragmentoDesmontarYBorrar(baseWin, { mountinfo: fixtureWinCon }))
  check(
    '(5a) desmonta proyecto y perfil, en ese orden, y ni la raíz wsl ni tessera-mm2',
    igual(umounts(e5), [
      ['-l', `${baseWin}/perfil/proyecto`],
      ['-l', `${baseWin}/perfil`]
    ]),
    JSON.stringify(umounts(e5))
  )
  check(
    '(5b) fixture estático: no borra y avisa con la ruta canónica',
    rms(e5).length === 0 && e5.stdout.includes(`AVISO: montajes residuales bajo ${baseWin}, no se borra`),
    e5.stdout.trim()
  )
  const fixtureWinSin = escribirFixture('mountinfo-win-sin', [
    ...LINEAS_SISTEMA,
    lineaMountinfo(raizWsl),
    lineaMountinfo('/mnt/host/d'),
    lineaMountinfo(`${baseWin}2/perfil/x`),
    lineaMountinfo(`${agentcfgWin}/perfil/claude/cuenta`)
  ])
  const e6 = ejecutar(fragmentoDesmontarYBorrar(baseWin, { mountinfo: fixtureWinSin }))
  check(
    '(5c) sin montajes bajo la base: rm -rf de la base y ningún umount',
    umounts(e6).length === 0 && igual(rms(e6), [['-rf', baseWin]]),
    JSON.stringify({ umount: umounts(e6), rm: rms(e6) })
  )

  // -------------------------------------------------------------------------
  hr('(6) Varias bases con `set --` (lo que corre al cerrar la app)')
  // -------------------------------------------------------------------------
  const variasMac = fragmentoDesmontarYBorrarVarias([baseMac, agentcfgMac], { mountinfo: fixtureMacCon })
  check('(6·forma) empieza por `set --` con los argumentos entrecomillados', variasMac.startsWith("set -- '"), variasMac.slice(0, 60))
  const e7 = ejecutar(variasMac)
  check(
    '(6a) macOS: desmonta lo de las DOS bases (con espacio) y no borra ninguna',
    // Lo de la primera base (el mismo fixture que en (1)) más el `perfil` de la segunda.
    umounts(e7).length === esperadoMac.length + 1 &&
      umounts(e7).some((u) => u[1] === `${agentcfgMacResuelta}/perfil`) &&
      rms(e7).length === 0 &&
      e7.stdout.split('\n').filter((l) => l.startsWith('AVISO')).length === 2,
    JSON.stringify({ umount: umounts(e7).map((u) => u[1]), avisos: e7.stdout.trim().split('\n') })
  )
  check('(6b) termina en `true`: sale con 0', e7.status === 0, `status=${e7.status}`)
  const fixtureMacVacio = escribirFixture('mountinfo-mac-vacio', [...LINEAS_SISTEMA, lineaMountinfo(ancestro), lineaMountinfo(vecinoMac)])
  const e8 = ejecutar(fragmentoDesmontarYBorrarVarias([baseMac, agentcfgMac], { mountinfo: fixtureMacVacio }))
  check(
    '(6c) macOS sin montajes: rm -rf de las dos rutas canónicas, cada una entera',
    igual(rms(e8), [
      ['-rf', baseMacResuelta],
      ['-rf', agentcfgMacResuelta]
    ]),
    JSON.stringify(rms(e8))
  )
  const e9 = ejecutar(fragmentoDesmontarYBorrarVarias([baseWin, agentcfgWin], { mountinfo: fixtureWinCon }))
  check(
    '(6d) Windows: desmonta lo de las dos bases y no borra',
    igual(
      umounts(e9).map((u) => u[1]),
      [`${baseWin}/perfil/proyecto`, `${baseWin}/perfil`, `${agentcfgWin}/perfil/claude/cuenta`]
    ) && rms(e9).length === 0,
    JSON.stringify(umounts(e9).map((u) => u[1]))
  )
  const fixtureWinVacio = escribirFixture('mountinfo-win-vacio', [
    ...LINEAS_SISTEMA,
    lineaMountinfo(raizWsl),
    lineaMountinfo('/mnt/host/d'),
    lineaMountinfo(`${baseWin}2/perfil/x`)
  ])
  const e10 = ejecutar(fragmentoDesmontarYBorrarVarias([baseWin, agentcfgWin], { mountinfo: fixtureWinVacio }))
  check(
    '(6e) Windows sin montajes: rm -rf de las dos bases, idéntico al efecto anterior',
    igual(rms(e10), [
      ['-rf', baseWin],
      ['-rf', agentcfgWin]
    ]) && umounts(e10).length === 0,
    JSON.stringify(rms(e10))
  )

  // -------------------------------------------------------------------------
  hr('(7) Una tabla de montajes ilegible NUNCA acaba en rm -rf')
  // -------------------------------------------------------------------------
  const e11 = ejecutar(fragmentoDesmontarYBorrar(baseMac, { mountinfo: path.join(tmp, 'no-existe') }))
  check(
    '(7) sin tabla: ni umount ni rm, y el AVISO lo dice',
    umounts(e11).length === 0 &&
      rms(e11).length === 0 &&
      e11.stdout.includes(`AVISO: no se pudo leer la tabla de montajes, no se borra ${baseMacResuelta}`),
    e11.stdout.trim()
  )

  // -------------------------------------------------------------------------
  hr('(8) Comillas simples en la base y en la ruta de la tabla')
  // -------------------------------------------------------------------------
  fs.mkdirSync(path.join(hostMnt, relBase, "sandbox-o'brien", 'perfil'), { recursive: true })
  const baseComilla = path.join(tmp, 'Users', relBase, "sandbox-o'brien")
  const baseComillaResuelta = fs.realpathSync(baseComilla)
  const fixtureComilla = escribirFixture("tabla o'brien", [...LINEAS_SISTEMA, lineaMountinfo(`${baseComillaResuelta}/perfil`)])
  const e12 = ejecutar(fragmentoDesmontarYBorrar(baseComilla, { mountinfo: fixtureComilla }))
  check(
    '(8a) desmonta bajo una base con comilla, leyendo una tabla con espacio y comilla',
    igual(umounts(e12), [['-l', `${baseComillaResuelta}/perfil`]]) && rms(e12).length === 0,
    JSON.stringify(umounts(e12))
  )
  const fixtureComillaVacio = escribirFixture("tabla o'brien vacia", LINEAS_SISTEMA)
  const e13 = ejecutar(fragmentoDesmontarYBorrar(baseComilla, { mountinfo: fixtureComillaVacio }))
  check('(8b) …y la borra con la ruta canónica', igual(rms(e13), [['-rf', baseComillaResuelta]]), JSON.stringify(rms(e13)))

  // -------------------------------------------------------------------------
  hr('(9) Si no se puede canonizar una base que EXISTE, no se borra (la regresión)')
  // -------------------------------------------------------------------------
  // Un `readlink` que falla es lo que se encontraría en un `sh` sin la utilidad o con
  // un `-f` que no soporta. Con el respaldo viejo ("la ruta tal cual"), `$b` sería la
  // ruta CON el symlink sin resolver, no casaría con el `/host_mnt/…` de la tabla, el
  // estado saldría `libre` y el `rm -rf` correría con los binds vivos: exactamente el
  // borrado de archivos reales que motivó este módulo.
  const binFallo = path.join(tmp, 'bin-readlink-roto')
  fs.mkdirSync(binFallo)
  fs.writeFileSync(path.join(binFallo, 'readlink'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  const e14 = ejecutar(fragmentoDesmontarYBorrar(baseMac, { mountinfo: fixtureMacCon }), binFallo)
  check(
    '(9a) readlink roto + base existente: ni rm ni umount, y el AVISO nombra la ruta',
    rms(e14).length === 0 &&
      umounts(e14).length === 0 &&
      e14.stdout.includes(`AVISO: no se pudo canonicalizar ${baseMac}, no se desmonta ni se borra`),
    e14.stdout.trim()
  )
  // La prueba de que el peligro era real, sobre la MISMA tabla: los puntos de montaje
  // decodificados SÍ cuelgan de la ruta canónica y NINGUNO de la ruta sin resolver.
  // O sea que con el respaldo viejo el estado habría salido `libre` y se habría
  // borrado una raíz con binds rw vivos debajo.
  const montajes = textoMacCon
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(' ')[4] ?? '')
    .map((mp) => mp.replace(/\\040/g, ' ').replace(/\\011/g, '\t').replace(/\\012/g, '\n').replace(/\\134/g, '\\'))
  const cuelgaDe = (base: string): number => montajes.filter((mp) => mp === base || mp.startsWith(base + '/')).length
  check(
    '(9b) …y era peligroso: con la base SIN resolver la tabla no lista nada bajo ella',
    cuelgaDe(baseMac) === 0 && cuelgaDe(baseMacResuelta) > 0,
    `sin resolver=${cuelgaDe(baseMac)} | resuelta=${cuelgaDe(baseMacResuelta)}`
  )
  const e15 = ejecutar(fragmentoDesmontarYBorrarVarias([baseMac, agentcfgMac], { mountinfo: fixtureMacVacio }), binFallo)
  check(
    '(9c) lo mismo en la forma de varias bases: no se borra ninguna de las dos',
    rms(e15).length === 0 && e15.stdout.split('\n').filter((l) => l.includes('no se pudo canonicalizar')).length === 2,
    e15.stdout.trim()
  )

  // -------------------------------------------------------------------------
  hr('(10) Una base que NO existe: no se borra, no se avisa, no se hace ruido')
  // -------------------------------------------------------------------------
  const baseFantasma = path.join(tmp, 'Users', relBase, 'sandbox-que-ya-no-esta')
  const e16 = ejecutar(fragmentoDesmontarYBorrar(baseFantasma, { mountinfo: fixtureMacCon }))
  check(
    '(10) ni rm ni umount ni AVISO: una raíz ya limpiada es el caso normal',
    rms(e16).length === 0 && umounts(e16).length === 0 && !e16.stdout.includes('AVISO') && e16.status === 0,
    JSON.stringify({ status: e16.status, stdout: e16.stdout, rm: rms(e16) })
  )

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  return allPass
}

main()
