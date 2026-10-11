#!/usr/bin/env node
// =============================================================================
// El túnel SSH de las bases contra servidores de verdad (npm run test:tunel-real), con el servidor de
// `scripts/pruebas/ssh.sh` y un PostgreSQL que escucha en la red de ese contenedor (127.0.0.1:5432 visto
// desde el servidor SSH): `tdb query` por el puente (`db.tunel`), el driver directo, un bastión, la huella
// sin confirmar, el ssh que muere y el destino que no escucha. Se corre con
// `bash scripts/pruebas/ssh.sh correr npm run -s test:tunel-real`; sin TESSERA_TEST_SSH, se salta.
// Decisiones: docs/decisiones/bd/conexiones-tunel-ssh.md
// =============================================================================

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esWindows, plataformaActual } from '../../../shared/plataforma.ts'
import { DbBridge } from '../dbBridge.ts'
import { crearConfigSaltos } from '../../ssh/adaptadores/configSaltos.ts'
import { escribirLanzadorAskpass } from '../../ssh/adaptadores/lanzadorAskpass.ts'
import { ejecutarCorto } from '../../ssh/adaptadores/permisosClave.ts'
import { ConexionesSsh } from '../../ssh/ConexionesSsh.ts'
import { ControladorSsh } from '../../ssh/ControladorSsh.ts'
import { AskpassSsh } from '../../ssh/controlador/askpassSsh.ts'
import { FichasAskpass } from '../../ssh/fichasAskpass.ts'
import { lanzadorAskpassSh, rutaGuionAskpass, rutaProgramaAskpass } from '../../ssh/programaAskpass.ts'
import { GestorTuneles } from './GestorTuneles.ts'
import { escucha, lanzarTunel, puertoLibre } from './sistemaTuneles.ts'

const results: boolean[] = []
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const TDB = path.join(RAIZ_REPO, 'src', 'tdb', 'tdb.cjs')
const requerir = createRequire(import.meta.url)
const plataforma = plataformaActual()
const CONTENEDOR_PG = 'pruebas-tunel-pg'
const cifradoFalso = {
  disponible: (): boolean => true,
  cifrar: (p: string): Buffer => Buffer.from(`ENC:${p}`),
  descifrar: (b: Buffer): string => b.toString('utf-8').slice(4)
}

function docker(args: string[], topeMs = 120_000): { codigo: number | null; salida: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: topeMs, windowsHide: true })
  return { codigo: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function correr(args: string[], env: NodeJS.ProcessEnv, topeMs = 90_000): Promise<{ codigo: number | null; salida: string; errores: string }> {
  return new Promise((resolve) => {
    let salida = ''
    let errores = ''
    const hijo = spawn(process.execPath, [TDB, ...args], { env, windowsHide: true })
    const tope = setTimeout(() => hijo.kill(), topeMs)
    hijo.stdout.on('data', (t: Buffer) => (salida += t.toString('utf8')))
    hijo.stderr.on('data', (t: Buffer) => (errores += t.toString('utf8')))
    hijo.on('close', (codigo) => {
      clearTimeout(tope)
      resolve({ codigo, salida, errores })
    })
  })
}

async function main(): Promise<void> {
  const destino = process.env.TESSERA_TEST_SSH
  const secretos = process.env.TESSERA_TEST_SSH_DIR
  if (!destino || !secretos) {
    console.log('SALTA: sin TESSERA_TEST_SSH (bash scripts/pruebas/ssh.sh correr npm run -s test:tunel-real).')
    return
  }
  const [hostSsh, puertoTexto] = destino.split(':')
  const puertoSsh = Number(puertoTexto)
  const contrasenaSsh = readFileSync(path.join(secretos, 'ssh-pw.txt'), 'utf8').trim()

  hr('(0) PostgreSQL en la red del servidor SSH (solo se llega a él por el túnel)')
  const clavePg = randomBytes(12).toString('hex')
  docker(['rm', '-f', CONTENEDOR_PG])
  const alta = docker(['run', '-d', '--name', CONTENEDOR_PG, '--network', 'container:pruebas-ssh', '-e', `POSTGRES_PASSWORD=${clavePg}`, 'postgres:16-alpine'])
  check('(0a) el contenedor arranca', alta.codigo === 0, alta.salida.slice(0, 80).replace(clavePg, '<clave>'))
  let listo = false
  for (let i = 0; i < 60 && !listo; i++) {
    listo = docker(['exec', CONTENEDOR_PG, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], 10_000).codigo === 0
    if (!listo) await new Promise((r) => setTimeout(r, 1000))
  }
  check('(0b) PostgreSQL acepta conexiones', listo, '')
  if (!listo) return

  const raiz = mkdtempSync(path.join(esWindows() ? (process.env.APPDATA ?? os.tmpdir()) : os.tmpdir(), 'tessera-tunel-real-'))
  try {
    const dirHuellas = path.join(raiz, 'ssh', 'huellas')
    mkdirSync(dirHuellas, { recursive: true })
    let programa = rutaProgramaAskpass('windows', { appDir: RAIZ_REPO, userData: '' })
    if (!esWindows()) {
      programa = path.join(raiz, 'askpass', 'askpass')
      escribirLanzadorAskpass(programa, lanzadorAskpassSh(process.execPath, rutaGuionAskpass(plataforma, RAIZ_REPO)))
    }
    check('(0c) hay programa de contraseñas', existsSync(programa), programa)

    // El registro de bases que lee `tdb`, y el puente que sirve su secreto y su túnel.
    const conexionesBd: Record<string, unknown>[] = []
    const rutaRegistro = path.join(raiz, 'db-connections.json')
    const guardarRegistro = (): void => writeFileSync(rutaRegistro, JSON.stringify({ version: 1, connections: conexionesBd }))
    let gestor: GestorTuneles | null = null
    const puente = new DbBridge({
      conexionesDelPerfil: () => conexionesBd as never,
      secretoDe: () => clavePg,
      tunelDe: (c) => gestor!.destino(c as never),
      log: () => {}
    })
    puente.start()
    for (let i = 0; i < 60 && !puente.listo; i++) await new Promise((r) => setTimeout(r, 50))

    const conexiones = new ConexionesSsh({ storePath: path.join(raiz, 'ssh-connections.json'), dirHuellas, dirClaves: path.join(raiz, 'ssh', 'claves'), cifrado: cifradoFalso, log: () => {} })
    const askpass = new AskpassSsh({ puerta: puente, conexion: (id) => conexiones.conexion(id), secretoDe: (id) => conexiones.secretoDe(id), rutaClave: (id) => conexiones.rutaClave(id), programa, existe: existsSync, exe: process.execPath, plataforma, fichas: new FichasAskpass(), log: () => {} })
    const ctrl = new ControladorSsh({
      conexiones,
      eventos: { emitir: () => {}, hayDestino: () => true },
      askpass,
      ejecutar: ejecutarCorto,
      configSaltos: crearConfigSaltos(path.join(raiz, 'ssh', 'saltos')),
      plataforma,
      log: () => {}
    })
    gestor = new GestorTuneles({
      preparar: (p, id, d, local) => ctrl.prepararTunelBd(p, id, d, local),
      aliasSsh: (id) => ctrl.aliasDe(id),
      lanzar: lanzarTunel,
      puertoLibre,
      escucha,
      esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
      ahora: () => Date.now(),
      log: () => {}
    })
    const altaSsh = (alias: string, extra: Record<string, unknown> = {}): string =>
      ctrl.crear({ profileId: 'pa', alias, grupoId: null, host: hostSsh, puerto: puertoSsh, usuario: 'pruebas', metodo: 'contrasena', disponibleAgentes: false, secreto: contrasenaSsh, ...extra } as never).id
    const idSsh = altaSsh('servidor')
    const idSinHuella = altaSsh('sin huella')
    // El bastión salta a sí mismo: el destino es el sshd del contenedor visto desde dentro.
    const idTras = altaSsh('tras el bastion', { host: '127.0.0.1', puerto: 22, saltoId: idSsh })
    await ctrl.probar({ id: idSsh })
    const pruebaTras = await ctrl.probar({ id: idTras })
    check('(0d) una persona confirma las huellas («Probar»), también tras el bastión', pruebaTras.ok === true, JSON.stringify(pruebaTras).slice(0, 160))

    hr('(1) tdb por el puente')
    const base = { profileId: 'pa', motor: 'postgres', host: '127.0.0.1', port: 5432, database: 'postgres', user: 'postgres', readonly: true }
    conexionesBd.push({ ...base, id: 'bd-tunel', alias: 'Por tunel', tunelSsh: { conexionId: idSsh } })
    conexionesBd.push({ ...base, id: 'bd-bastion', alias: 'Por bastion', tunelSsh: { conexionId: idTras } })
    conexionesBd.push({ ...base, id: 'bd-sin-huella', alias: 'Sin huella', tunelSsh: { conexionId: idSinHuella } })
    conexionesBd.push({ ...base, id: 'bd-cerrado', alias: 'Puerto cerrado', port: 5999, tunelSsh: { conexionId: idSsh } })
    guardarRegistro()
    puente.setScope('pa', raiz, conexionesBd.map((c) => String(c.id)))
    const limpio = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('TESSERA_')))
    const env = { ...limpio, TESSERA_DB_REGISTRY: rutaRegistro, TESSERA_PROFILE: 'pa', TESSERA_DB_MODE: 'pipe', TESSERA_DB_PIPE: puente.pipe, TESSERA_DB_SESSION: puente.mint('pa', raiz) }
    const q = await correr(['query', 'Por tunel', "select inet_server_addr()::text as ip, 'ok' as r", '--json'], env)
    check('(1a) tdb query llega a la base por el túnel', q.codigo === 0 && q.salida.includes('"ok"') && q.salida.includes('127.0.0.1'), `codigo=${q.codigo} ${q.salida.slice(0, 120)} ${q.errores.slice(0, 200)}`)
    check('(1b) el túnel queda abierto para la siguiente', gestor.abiertos === 1, `abiertos=${gestor.abiertos}`)
    const b = await correr(['query', 'Por bastion', "select 'bastion' as r", '--json'], env)
    check('(1c) por un bastión', b.codigo === 0 && b.salida.includes('"bastion"'), `codigo=${b.codigo} ${b.errores.slice(0, 200)}`)
    const sh = await correr(['query', 'Sin huella', 'select 1', '--json'], env)
    check('(1d) sin la huella confirmada: no conecta y dice qué hacer', sh.codigo !== 0 && /huella del servidor SSH .* no está confirmada/.test(sh.salida + sh.errores), (sh.salida + sh.errores).slice(0, 220))
    const cerrado = await correr(['query', 'Puerto cerrado', 'select 1', '--json'], env, 60_000)
    check('(1e) un destino que no escucha falla (no se cuelga)', cerrado.codigo !== 0, `codigo=${cerrado.codigo} ${(cerrado.salida + cerrado.errores).slice(0, 160)}`)
    const unaVez = puente.mintUnaVez('bd-tunel', 'pa')
    const probar = await correr(['test', 'Por tunel', '--json'], { ...env, TESSERA_DB_SESSION: unaVez })
    check('(1f) «Probar» (token de un solo uso) pide el túnel con su ficha', probar.codigo === 0, `codigo=${probar.codigo} ${(probar.salida + probar.errores).slice(0, 200)}`)
    const fuera = await correr(['query', 'Por tunel', 'select 1', '--json'], { ...env, TESSERA_DB_SESSION: puente.mint('pb', raiz) })
    check('(1g) NEGATIVO: una sesión de otro perfil no abre el túnel', fuera.codigo !== 0, `codigo=${fuera.codigo}`)

    hr('(2) El driver directo y el ciclo de vida')
    const { Client } = requerir('pg') as { Client: new (o: object) => { connect(): Promise<void>; query(s: string): Promise<{ rows: Array<Record<string, string>> }>; end(): Promise<void> } }
    const d = await gestor.destino({ id: 'bd-tunel', profileId: 'pa', alias: 'Por tunel', host: '127.0.0.1', port: 5432, tunelSsh: { conexionId: idSsh } })!
    const cliente = new Client({ host: d.host, port: d.port, user: 'postgres', password: clavePg, database: 'postgres' })
    await cliente.connect()
    const r = await cliente.query("select 'directo' as r")
    await cliente.end()
    check('(2a) el driver conecta al extremo local', r.rows[0]?.r === 'directo', JSON.stringify(r.rows))
    // El ssh muere: la siguiente petición abre otro.
    gestor.cerrar('bd-tunel')
    const otra = await correr(['query', 'Por tunel', "select 'otra vez' as r", '--json'], env)
    check('(2b) tras cerrarse, la siguiente lo reabre', otra.codigo === 0 && otra.salida.includes('otra vez'), `codigo=${otra.codigo} ${otra.errores.slice(0, 160)}`)
    gestor.cerrarTodos()
    check('(2c) cerrarTodos no deja túneles', gestor.abiertos === 0, `abiertos=${gestor.abiertos}`)
    puente.stop()
  } finally {
    docker(['rm', '-f', CONTENEDOR_PG])
    rmSync(raiz, { recursive: true, force: true })
  }
}

main()
  .catch((e) => check('sin excepciones', false, String(e?.stack ?? e)))
  .finally(() => {
    const ok = results.filter(Boolean).length
    hr(`VEREDICTO: ${ok}/${results.length} PASS — ${ok === results.length ? 'TODO PASS' : 'HAY FAIL'}`)
    process.exit(ok === results.length ? 0 : 1)
  })
