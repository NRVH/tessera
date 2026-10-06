#!/usr/bin/env node
// =============================================================================
// Prueba de `tssh` por el buzón de Docker (npm run test:tssh-buzon): el cliente del contenedor corre aquí
// mismo contra el buzón y el `DockerBridge` reales, con un `tssh` del host FALSO que dice lo que recibió. Fija
// el protocolo (salida binaria intacta, códigos, el tope de `run`), las copias en los dos sentidos con su
// carpeta temporal, los nombres que el host no admite, los enlaces que no se siguen y que `tdb` sigue igual.
// Lo REAL (contenedor y servidor SSH) está en `test-tssh.mts`, sección H.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { DockerBridge } from '../db/dockerBridge.ts'
import { ejecutorTssh, programaTssh, topeDe, type EjecutarTssh } from './controlador/buzonTssh.ts'
import { escribirSubida, leerBajada, nombreRemoto, nombreValido } from './transferenciaBuzon.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DIR_TSSH = path.join(RAIZ_REPO, 'src', 'tssh')
const plataforma = plataformaActual()
const temporales: string[] = []
function temporal(prefijo: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), prefijo))
  temporales.push(d)
  return d
}

/** Lo que vio el `tssh` falso en cada llamada. */
interface Llamada {
  argv: string[]
  token: string
  entrada: Buffer | undefined
  topeMs: number
  /** En una subida: el contenido de la ruta local, leído durante la llamada. */
  subido?: Record<string, string>
  rutaLocal?: string
}
const llamadas: Llamada[] = []

/** Lee un árbol a un mapa ruta relativa -> contenido (o `<carpeta>`). */
function arbol(raiz: string): Record<string, string> {
  const r: Record<string, string> = {}
  const ir = (abs: string, rel: string): void => {
    const st = statSync(abs)
    if (st.isFile()) {
      r[rel || '.'] = readFileSync(abs).toString('hex')
      return
    }
    r[rel || '.'] = '<carpeta>'
    for (const h of readdirSync(abs).sort()) ir(path.join(abs, h), rel ? `${rel}/${h}` : h)
  }
  ir(raiz, '')
  return r
}

const BINARIO = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
let fueraDelTemporal = ''

/** El `tssh` del host, falso: `ls` lista, `run` repite su entrada o sale con `exit N`, y `cp` copia de mentira. */
const tsshFalso: EjecutarTssh = async (argv, { token, entrada, topeMs }) => {
  const llamada: Llamada = { argv, token, entrada, topeMs }
  llamadas.push(llamada)
  if (argv[0] === 'ls') return { exitCode: 0, salida: Buffer.from('ALIAS web\n'), stderr: '' }
  if (argv[0] === 'run') {
    // Sin «--», la orden es lo último (aquí siempre una sola palabra entre comillas).
    const orden = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1).join(' ') : (argv.at(-1) ?? '')
    const m = /^exit (\d+)$/.exec(orden)
    if (m) return { exitCode: Number(m[1]), salida: Buffer.alloc(0), stderr: 'remoto: adiós\n' }
    return { exitCode: 0, salida: entrada ?? Buffer.from(orden), stderr: '' }
  }
  if (argv[0] === 'cp') {
    const libres = argv.slice(1).filter((a) => a !== '-r')
    const [origen, destino] = libres
    if (destino.startsWith('srv:')) {
      llamada.rutaLocal = origen
      llamada.subido = arbol(origen)
      return { exitCode: 0, salida: Buffer.alloc(0), stderr: '' }
    }
    llamada.rutaLocal = destino
    if (origen === 'srv:/datos/informe.bin') writeFileSync(destino, BINARIO)
    else if (origen === 'srv:/carpeta/') {
      mkdirSync(path.join(destino, 'sub', 'vacia'), { recursive: true })
      writeFileSync(path.join(destino, 'raiz.txt'), 'raíz ñ\n')
      writeFileSync(path.join(destino, 'sub', 'b.bin'), BINARIO)
      try {
        symlinkSync(fueraDelTemporal, path.join(destino, 'enlace'))
      } catch {
        // Sin permiso para enlaces (Windows sin modo desarrollador): el caso se mira donde se pueda.
      }
    } else return { exitCode: 1, salida: Buffer.alloc(0), stderr: `scp: ${origen}: No such file\n` }
    return { exitCode: 0, salida: Buffer.alloc(0), stderr: '' }
  }
  return { exitCode: 2, salida: Buffer.alloc(0), stderr: 'tssh: no\n' }
}

interface Salida {
  codigo: number | null
  salida: Buffer
  errores: string
}

/** Corre el cliente del contenedor (aquí, con el node de esta prueba) sin bloquear el bucle del puente. */
function cliente(buzon: string, args: string[], o: { cwd: string; entrada?: Buffer; token?: string }): Promise<Salida> {
  return new Promise((resolve) => {
    const env = { ...process.env, TESSERA_DB_BRIDGE: buzon, TESSERA_DB_SESSION: o.token ?? 'tok-buzon' }
    const hijo = spawn(process.execPath, [path.join(buzon, 'tssh-cliente.cjs'), ...args], { env, cwd: o.cwd, windowsHide: true })
    const salida: Buffer[] = []
    let errores = ''
    const tope = setTimeout(() => hijo.kill(), 60_000)
    hijo.stdout.on('data', (d: Buffer) => salida.push(d))
    hijo.stderr.on('data', (d: Buffer) => (errores += d.toString('utf-8')))
    hijo.stdin.end(o.entrada ?? Buffer.alloc(0))
    hijo.on('close', (codigo) => {
      clearTimeout(tope)
      resolve({ codigo, salida: Buffer.concat(salida), errores })
    })
  })
}

/** Espera la respuesta de una petición dejada a mano en el buzón. */
async function respuestaDe(buzon: string, id: string): Promise<Record<string, unknown> | null> {
  const ruta = path.join(buzon, `${id}.res.json`)
  for (let i = 0; i < 100; i++) {
    if (existsSync(ruta)) {
      try {
        return JSON.parse(readFileSync(ruta, 'utf-8')) as Record<string, unknown>
      } catch {
        // Todavía no está entera.
      }
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  return null
}

const temporalesHostAntes = (): string[] => readdirSync(os.tmpdir()).filter((n) => n.startsWith('tessera-tssh-'))

try {
  hr('A - Lo puro: nombres que admite el host, la ruta remota y el tope de run')
  {
    const casos: Array<[string, Plataforma, boolean]> = [
      ['informe.txt', 'windows', true],
      ['a:b', 'windows', false],
      ['a:b', 'mac', true],
      ['..', 'mac', false],
      ['CON', 'windows', false],
      ['nul.txt', 'windows', false],
      ['acaba.', 'windows', false],
      ['a/b', 'mac', false],
      ['ñandú ☃', 'windows', true]
    ]
    const mal = casos.filter(([n, p, esperado]) => nombreValido(n, p) !== esperado)
    check('(a1) nombreValido: separadores, «..», dispositivos y caracteres de Windows', mal.length === 0, j(mal))
    check('(a2) nombreRemoto: el último tramo, o «descarga» si no tiene', nombreRemoto('/var/log/app.log') === 'app.log' && nombreRemoto('/carpeta/') === 'carpeta' && nombreRemoto('~') === 'descarga' && nombreRemoto('') === 'descarga', 'ok')
    check('(a3) topeDe: run con su --timeout más margen; el resto, 90 s', topeDe(['run', '--timeout', '5', 'x', '--', 'y']) === 35_000 && topeDe(['run', 'x', '--timeout=2', 'y']) === 32_000 && topeDe(['ls']) === 90_000, `${topeDe(['run', '--timeout', '5', 'x'])}`)
    const raiz = temporal('tessera-subida-')
    const escapa = escribirSubida(raiz, { tipo: 'carpeta', nombre: 'c', carpetas: ['../fuera'], archivos: [] }, plataforma)
    const escapaArchivo = escribirSubida(raiz, { tipo: 'carpeta', nombre: 'c', carpetas: [], archivos: [{ ruta: 'a/../../x', datos: '' }] }, plataforma)
    const raizNombre = escribirSubida(raiz, { tipo: 'archivo', nombre: '..', datos: '' }, plataforma)
    check('(a4) una subida con «..» en una ruta o en el nombre no escribe nada', !escapa.ok && !escapaArchivo.ok && !raizNombre.ok && readdirSync(raiz).length === 0 && !existsSync(path.join(path.dirname(raiz), 'fuera')), j([escapa, escapaArchivo, raizNombre]))
    const bajada = temporal('tessera-bajada-')
    mkdirSync(path.join(bajada, 'b', 'c'), { recursive: true })
    writeFileSync(path.join(bajada, 'b', 'c', 'x.txt'), 'x')
    const leida = leerBajada(path.join(bajada, 'b'), 'b')
    check('(a5) leerBajada: la carpeta con sus subcarpetas y archivos', leida.ok && leida.contenido.tipo === 'carpeta' && j(leida.contenido.carpetas) === j(['c']) && leida.contenido.archivos[0]?.ruta === 'c/x.txt', j(leida))
  }

  hr('B - Por el buzón: ls, run (binario, códigos y tope), y el cliente sin token')
  const raiz = temporal('tessera-buzon-tssh-')
  const puente = new DockerBridge({
    raiz,
    clienteOrigen: path.join(RAIZ_REPO, 'src', 'tdb', 'tdb-container.cjs'),
    ejecutar: async (token, argv) => ({ exitCode: 0, stdout: `tdb ${token} ${argv.join(' ')}\n`, stderr: '' }),
    log: () => {}
  })
  puente.registrarPrograma(programaTssh({ dirTssh: DIR_TSSH, plataforma, ejecutar: tsshFalso }))
  const buzon = puente.prepararPerfil('pa')
  const lanzador = existsSync(path.join(buzon, 'tssh')) ? readFileSync(path.join(buzon, 'tssh'), 'utf-8') : ''
  check('(b1) el buzón trae el cliente, sus módulos y un lanzador sh con LF', ['tssh-cliente.cjs', 'tsshArgumentos.cjs', 'tsshRutas.cjs', 'tsshSalida.cjs'].every((n) => existsSync(path.join(buzon, n))) && lanzador.startsWith('#!/bin/sh\n') && !lanzador.includes('\r') && lanzador.includes('/tssh-cliente.cjs" "$@"'), lanzador.split('\n').at(-2) ?? '')
  const trabajo = temporal('tessera-contenedor-')
  const ls = await cliente(buzon, ['ls'], { cwd: trabajo })
  check('(b2) ls: la salida del host y su token', ls.codigo === 0 && ls.salida.toString() === 'ALIAS web\n' && llamadas.at(-1)?.token === 'tok-buzon', `codigo=${ls.codigo} ${j(ls.salida.toString())} ${ls.errores}`)
  const conEntrada = await cliente(buzon, ['run', 'web', '--stdin', '--', 'cat'], { cwd: trabajo, entrada: BINARIO })
  check('(b3) run --stdin: 256 bytes de ida y vuelta, intactos', conEntrada.codigo === 0 && conEntrada.salida.equals(BINARIO) && llamadas.at(-1)?.entrada?.equals(BINARIO) === true, `codigo=${conEntrada.codigo} ${conEntrada.salida.length} bytes ${conEntrada.errores}`)
  check('(b4) sin --timeout, el cliente pone el de 10 min y el host espera más', j(llamadas.at(-1)?.argv.slice(0, 3)) === j(['run', '--timeout', '600']) && llamadas.at(-1)?.topeMs === 630_000, j(llamadas.at(-1)?.argv))
  const codigo = await cliente(buzon, ['run', '--timeout', '5', 'web', 'exit 7'], { cwd: trabajo })
  check('(b5) el código remoto y su salida de errores llegan; un --timeout propio se respeta', codigo.codigo === 7 && codigo.errores === 'remoto: adiós\n' && llamadas.at(-1)?.topeMs === 35_000 && llamadas.at(-1)?.argv.filter((a) => a === '--timeout').length === 1, `codigo=${codigo.codigo} ${j(codigo.errores)}`)
  const uso = await cliente(buzon, ['run', 'web'], { cwd: trabajo })
  check('(b6) un error de uso sale aquí, con 2, sin ir al host', uso.codigo === 2 && uso.errores.includes('Falta la orden') && llamadas.length === 3, `codigo=${uso.codigo} llamadas=${llamadas.length}`)
  const sinToken = await cliente(buzon, ['ls'], { cwd: trabajo, token: '' })
  check('(b7) sin token de sesión: código 3 y qué hacer', sinToken.codigo === 3 && sinToken.errores.includes('recarga la terminal'), `codigo=${sinToken.codigo} ${sinToken.errores.trim()}`)

  hr('C - cp de subida: el contenido viaja en la petición y el host lo deja en un temporal suyo')
  {
    writeFileSync(path.join(trabajo, 'nota ñ.bin'), BINARIO)
    const antes = temporalesHostAntes()
    const r = await cliente(buzon, ['cp', 'nota ñ.bin', 'srv:/tmp/'], { cwd: trabajo })
    const vista = llamadas.at(-1)!
    check('(c1) subida de un archivo: el host recibe los mismos bytes con su nombre', r.codigo === 0 && vista.subido?.['.'] === BINARIO.toString('hex') && path.basename(vista.rutaLocal ?? '') === 'nota ñ.bin', `codigo=${r.codigo} ${r.errores}`)
    check('(c2) la ruta local del host es un temporal suyo (no la del contenedor) y se borra al acabar', !(vista.rutaLocal ?? '').startsWith(trabajo) && !existsSync(vista.rutaLocal ?? '') && j(temporalesHostAntes()) === j(antes), vista.rutaLocal ?? '')
    mkdirSync(path.join(trabajo, 'proy', 'src', 'vacia'), { recursive: true })
    writeFileSync(path.join(trabajo, 'proy', 'src', 'a.txt'), 'a')
    writeFileSync(path.join(trabajo, 'proy', 'b.txt'), 'b')
    const sinR = await cliente(buzon, ['cp', 'proy', 'srv:/tmp/'], { cwd: trabajo })
    check('(c3) una carpeta sin -r: código 2, sin ir al host', sinR.codigo === 2 && sinR.errores.includes('usa tssh cp -r'), `codigo=${sinR.codigo}`)
    const conR = await cliente(buzon, ['cp', '-r', 'proy', 'srv:/tmp/'], { cwd: trabajo })
    const subido = llamadas.at(-1)!.subido ?? {}
    check('(c4) cp -r: la carpeta entera, con la vacía, y -r llega al host', conR.codigo === 0 && subido['src/vacia'] === '<carpeta>' && subido['src/a.txt'] === Buffer.from('a').toString('hex') && subido['b.txt'] !== undefined && llamadas.at(-1)!.argv[1] === '-r', j(Object.keys(subido)))
  }

  hr('D - cp de bajada: el host copia a un temporal suyo y el contenido vuelve en la respuesta')
  {
    fueraDelTemporal = temporal('tessera-fuera-')
    writeFileSync(path.join(fueraDelTemporal, 'secreto.txt'), 'no debe salir')
    const r = await cliente(buzon, ['cp', 'srv:/datos/informe.bin', '.'], { cwd: trabajo })
    check('(d1) a una carpeta que existe: dentro, con el nombre remoto y los bytes intactos', r.codigo === 0 && existsSync(path.join(trabajo, 'informe.bin')) && readFileSync(path.join(trabajo, 'informe.bin')).equals(BINARIO), `codigo=${r.codigo} ${r.errores}`)
    const r2 = await cliente(buzon, ['cp', 'srv:/datos/informe.bin', 'otro nombre.bin'], { cwd: trabajo })
    check('(d2) a una ruta que no existe: con ese nombre', r2.codigo === 0 && existsSync(path.join(trabajo, 'otro nombre.bin')), `codigo=${r2.codigo}`)
    const r3 = await cliente(buzon, ['cp', '-r', 'srv:/carpeta/', 'bajada'], { cwd: trabajo })
    const t = existsSync(path.join(trabajo, 'bajada')) ? arbol(path.join(trabajo, 'bajada')) : {}
    check('(d3) cp -r: la carpeta con su vacía y sus archivos', r3.codigo === 0 && t['sub/vacia'] === '<carpeta>' && t['sub/b.bin'] === BINARIO.toString('hex') && t['raiz.txt'] !== undefined, `codigo=${r3.codigo} ${j(Object.keys(t))} ${r3.errores}`)
    check('(d4) un enlace de lo bajado no se sigue: lo de fuera del temporal no llega', !Object.keys(t).some((k) => k.startsWith('enlace')) && !JSON.stringify(t).includes(Buffer.from('no debe salir').toString('hex')), j(Object.keys(t)))
    const falla = await cliente(buzon, ['cp', 'srv:/no/existe', '.'], { cwd: trabajo })
    check('(d5) un fallo de scp: su código y su mensaje, sin escribir nada', falla.codigo === 1 && falla.errores.includes('No such file') && !existsSync(path.join(trabajo, 'existe')), `codigo=${falla.codigo}`)
  }

  hr('E - El host no se fía de la petición: ruta remota, programa desconocido y tdb como siempre')
  {
    const pedir = async (cuerpo: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      const id = `prueba-${results.length}`
      writeFileSync(path.join(buzon, `${id}.req.json`), JSON.stringify(cuerpo))
      return respuestaDe(buzon, id)
    }
    const antes = llamadas.length
    const local = await pedir({ v: 1, prog: 'tssh', token: 't', argv: ['cp'], cp: { subida: false, recursivo: false, remoto: plataforma === 'windows' ? 'C:\\Windows\\win.ini' : '/etc/passwd' } })
    check('(e1) una «ruta remota» que es del host: se rechaza sin lanzar tssh', local?.exitCode === 2 && llamadas.length === antes, j(local))
    const raro = await pedir({ v: 1, prog: 'otro', token: 't', argv: [] })
    check('(e2) un programa que no está registrado: código 2 y que se reinicie Tessera', raro?.exitCode === 2 && String(raro?.stderr).includes('no sabe atender'), j(raro))
    const tdb = await pedir({ v: 1, token: 'tok-tdb', argv: ['ls'] })
    check('(e3) una petición de tdb (sin prog) sigue yendo a tdb, con su forma de siempre', tdb?.exitCode === 0 && tdb?.stdout === 'tdb tok-tdb ls\n', j(tdb))
  }
  hr('F - El contenedor no puede hacer que el host escriba fuera del buzón, ni dejar colgada una orden')
  {
    const victima = path.join(temporal('tessera-victima-'), 'perfil.txt')
    writeFileSync(victima, 'original')
    const nombres = ['tssh', 'tdb-cliente.cjs', 'tsshSalida.cjs', '.alive']
    let enlazados = 0
    for (const n of nombres) {
      rmSync(path.join(buzon, n), { force: true })
      try {
        symlinkSync(victima, path.join(buzon, n))
        enlazados++
      } catch {
        // Sin permiso para crear enlaces aquí (Windows sin modo desarrollador).
      }
    }
    if (enlazados === 0) console.log('  (este sistema no deja crear enlaces: f1 no se puede montar)')
    else {
      puente.prepararPerfil('pa')
      const tmp = path.join(buzon, 'enlazada.res.json.tmp')
      try {
        symlinkSync(victima, tmp)
      } catch {
        // Mismo caso.
      }
      const intacto = readFileSync(victima, 'utf-8') === 'original'
      const reales = nombres.every((n) => existsSync(path.join(buzon, n)) && statSync(path.join(buzon, n)).isFile())
      check('(f1) enlaces del contenedor en el buzón (lanzador, clientes, centinela): se sustituyen sin tocar su destino', intacto && reales, `intacto=${intacto} reales=${reales} enlazados=${enlazados}`)
    }
    const nieto = path.join(temporal('tessera-nieto-'), 'colgado.cjs')
    writeFileSync(nieto, "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => process.stdout.write(\"x\"), 20)'], { stdio: 'inherit' }); setInterval(() => {}, 1000)\n")
    const t0 = Date.now()
    const cortado = await ejecutorTssh({ exe: process.execPath, script: nieto, pipe: () => 'sin-puente', plataforma })(['run'], { token: 't', topeMs: 1500 })
    const ms = Date.now() - t0
    check('(f2) un tssh cortado cuyo hijo hereda la salida: la orden acaba con 124 y no se queda colgada', cortado.exitCode === 124 && ms < 10_000 && cortado.stderr.includes('se cortó'), `codigo=${cortado.exitCode} ${ms} ms`)
  }
  puente.stop()
} finally {
  for (const d of temporales) rmSync(d, { recursive: true, force: true })
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
