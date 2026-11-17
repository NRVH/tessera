#!/usr/bin/env node
// =============================================================================
// Prueba de `tctx` (npm run test:tctx): los argumentos, la lectura del texto (marcas de orden de bytes y
// rutas del shell de Git), los códigos y topes iguales a los del main, los textos en los dos idiomas, el
// `tctx` real contra el puente de verdad (reglas, proponer de las tres formas, rechazos, la petición más
// larga), los atajos ejecutados en cada shell, el cliente del contenedor contra el buzón, sin Docker,
// `tctx traspaso` (solo la sesión del token) y `tctx buscar` (su alcance por modo) por los dos caminos.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md, docs/decisiones/agentes/traspaso-entre-agentes.md,
// docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { esWindows, plataformaActual } from '../../shared/plataforma.ts'
import { MAX_MOTIVO_PROPUESTA, MAX_REGLAS_PERFIL } from '../../shared/reglasPerfil.ts'
import { PuenteBd, type RespuestaOperacion, type SesionDelPuente } from '../db/puenteBd.ts'
import { OP_TRASPASO, atenderTraspaso } from '../traspaso/operacionTraspaso.ts'
import { RegistroTraspasos } from '../traspaso/RegistroTraspasos.ts'
import { PuenteDocker } from '../db/puenteDocker.ts'
import { SHIM_DIR } from '../db/shims.ts'
import { generarAtajosPrograma } from '../util/atajosPrograma.ts'
import { escribirArchivosDeAtajo } from '../util/escrituraAtajos.ts'
import { programaTctx } from './buzonTctx.ts'
import { CODIGOS_TCTX, OperacionesReglas } from './operacionesReglas.ts'
import { PropuestasReglas } from './propuestasReglas.ts'
import { LectorConversaciones } from '../conversaciones/LectorConversaciones.ts'
import { MAX_TEXTO_BUSQUEDA } from '../historial/coincidencia.ts'
import { MAX_RESULTADOS_TOPE, TOPES_DEFECTO, buscarEnHistorial, fechaLocalDe } from '../historial/buscarHistorial.ts'
import { OP_BUSCAR, OperacionBuscarHistorial } from '../historial/operacionBuscar.ts'
import { MAX_ORDEN_BYTES, type VistaTareaConResultado } from '../../shared/delegacion-ipc.ts'

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

/** Las operaciones de las reglas sin reglas globales. */
const SIN_GLOBALES = { reglasGlobales: (): string => '', usaGlobales: (): boolean => true }

const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DIR_TCTX = path.join(RAIZ_REPO, 'src', 'tctx')
const TCTX = path.join(DIR_TCTX, 'tctx.cjs')
const requerir = createRequire(import.meta.url)
const argumentos = requerir(path.join(DIR_TCTX, 'tctxArgumentos.cjs')) as { analizar: (argv: string[]) => Record<string, unknown>; MAX_TEXTO_BUSCAR: number; MAX_RESULTADOS: number }
const { analizar } = argumentos
const { CODIGOS } = requerir(path.join(DIR_TCTX, 'tctxSalida.cjs')) as { CODIGOS: Record<string, number> }
const ordenes = requerir(path.join(DIR_TCTX, 'tctxOrdenes.cjs')) as { MAX_REGLAS: number; MAX_MOTIVO: number; MAX_PETICION: number; TOPE_BUSCAR_MS: number }
const entrada = requerir(path.join(DIR_TCTX, 'tctxEntrada.cjs')) as {
  decodificar: (b: Buffer) => string
  rutaDeArchivo: (t: string, o: Record<string, unknown>) => string
  leerEntrada: (flujo: NodeJS.ReadableStream & { isTTY?: boolean }, topeMs?: number) => Promise<string>
}
const { es, en } = requerir(path.join(DIR_TCTX, 'textosTctx.cjs')) as { es: Record<string, unknown>; en: Record<string, unknown> }

const plataforma = plataformaActual()
const temporales: string[] = []
function temporal(prefijo: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), prefijo))
  temporales.push(d)
  return d
}

/** Lo que devuelve el error de `f`, o null si no lanza. */
function codigoDe(f: () => unknown): number | null {
  try {
    f()
    return null
  } catch (e) {
    return (e as { codigo?: number }).codigo ?? -1
  }
}

/** Las diferencias de forma entre dos árboles de textos: claves, tipos y aridad. */
function diferencias(a: unknown, b: unknown, ruta: string): string[] {
  if (typeof a !== typeof b) return [`${ruta}: ${typeof a} frente a ${typeof b}`]
  if (typeof a === 'function') return (a as () => void).length === (b as () => void).length ? [] : [`${ruta}: aridad`]
  if (a !== null && typeof a === 'object') {
    const oa = a as Record<string, unknown>
    const ob = b as Record<string, unknown>
    return [...new Set([...Object.keys(oa), ...Object.keys(ob)])].flatMap((k) => (!(k in oa) || !(k in ob) ? [`${ruta}.${k}: solo en uno`] : diferencias(oa[k], ob[k], `${ruta}.${k}`)))
  }
  return []
}

/** El entorno de este proceso sin las TESSERA_* heredadas (dentro de Tessera apuntarían al puente vivo). */
function entornoLimpio(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('TESSERA_')))
  return { ...base, ...extra }
}

interface Salida {
  codigo: number | null
  salida: string
  errores: string
}

/** Corre un programa SIN bloquear el bucle: el puente de esta misma prueba tiene que contestar. */
function correr(exe: string, args: string[], o: { env: NodeJS.ProcessEnv; cwd?: string; entrada?: string | Buffer }): Promise<Salida> {
  return new Promise((resolver) => {
    let salida = ''
    let errores = ''
    const hijo = spawn(exe, args, { env: o.env, cwd: o.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const tope = setTimeout(() => hijo.kill(), 60_000)
    hijo.stdout.on('data', (d) => (salida += d.toString('utf-8')))
    hijo.stderr.on('data', (d) => (errores += d.toString('utf-8')))
    hijo.stdin.end(o.entrada ?? '')
    hijo.on('error', () => {
      clearTimeout(tope)
      resolver({ codigo: null, salida, errores })
    })
    hijo.on('close', (codigo) => {
      clearTimeout(tope)
      resolver({ codigo, salida, errores })
    })
  })
}

/** El bash del shell de Git en Windows (en el PATH de Windows, `bash` es el de WSL); en macOS y Linux, el del sistema. */
function bashDelAgente(): string | null {
  if (!esWindows()) return spawnSync('bash', ['-c', 'exit 0']).status === 0 ? 'bash' : null
  const candidato = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  return existsSync(candidato) ? candidato : null
}

/** Un puente que escucha con las operaciones de `tctx`, perfiles `pa` (con reglas) y `pb`. */
async function puenteConReglas(): Promise<{ puente: PuenteBd; almacen: PropuestasReglas; perfiles: Map<string, string>; avisos: string[] }> {
  const dir = temporal('tessera-tctx-almacen-')
  const perfiles = new Map([
    ['pa', 'Regla A'],
    ['pb', '']
  ])
  const almacen = new PropuestasReglas({ ruta: path.join(dir, 'reglas-propuestas.json'), idsVivos: () => [...perfiles.keys()], log: () => {} })
  const avisos: string[] = []
  const puente = new PuenteBd({ conexionesDelPerfil: () => [], secretoDe: () => null, log: () => {} })
  new OperacionesReglas({ reglasDe: (id) => perfiles.get(id) ?? null, ...SIN_GLOBALES, propuestas: almacen, alProponer: (id) => avisos.push(id) }).registrar(puente)
  puente.iniciar()
  const limite = Date.now() + 3000
  while (!puente.listo && Date.now() < limite) await new Promise((r) => setTimeout(r, 50))
  return { puente, almacen, perfiles, avisos }
}

try {
  hr('A - Los argumentos: el vocabulario cerrado y una sola fuente del texto')
  {
    check('(a1) sin nada, help', analizar([]).sub === 'help' && analizar(['--help']).sub === 'help', j(analizar([])))
    check('(a2) reglas', j(analizar(['reglas'])) === j({ sub: 'reglas' }), j(analizar(['reglas'])))
    const archivo = analizar(['proponer', '--archivo', 'r.md', '--motivo', 'dos veces'])
    check('(a3) proponer --archivo con motivo', j(archivo.fuente) === j({ tipo: 'archivo', ruta: 'r.md' }) && archivo.motivo === 'dos veces', j(archivo))
    const texto = analizar(['proponer', '--motivo=m', '--texto=Una regla con = y "comillas"'])
    check('(a4) --texto=… y --motivo=…, en cualquier orden', j(texto.fuente) === j({ tipo: 'texto', texto: 'Una regla con = y "comillas"' }) && texto.motivo === 'm', j(texto))
    check('(a5) «-» es la entrada estándar', j(analizar(['proponer', '-']).fuente) === j({ tipo: 'entrada' }), j(analizar(['proponer', '-'])))
    check('(a5b) traspaso', j(analizar(['traspaso'])) === j({ sub: 'traspaso' }), j(analizar(['traspaso'])))
    check('(a5c) docs sin nombre lista', j(analizar(['docs'])) === j({ sub: 'docs' }), j(analizar(['docs'])))
    check('(a5e) config sin opciones', j(analizar(['config'])) === j({ sub: 'config' }), j(analizar(['config'])))
    const propuesta = analizar(['config', 'proponer', '--nivel', 'global', '--texto', 'a = 1', '--motivo', 'm'])
    check('(a5f) config proponer con nivel y motivo', propuesta.sub === 'config-proponer' && propuesta.nivel === 'global' && propuesta.motivo === 'm' && (propuesta.fuente as { tipo?: string } | null)?.tipo === 'texto', j(propuesta))
    let sinNivel = ''
    try {
      analizar(['config', 'proponer', '--texto', 'a'])
    } catch (e) {
      sinNivel = String((e as Error).message)
    }
    check('(a5g) config proponer sin --nivel es un error de uso', sinNivel.includes('--nivel'), sinNivel)
    const global = analizar(['proponer', '--global', '--texto', 'Regla para todos'])
    check('(a5h) proponer --global propone las reglas globales', global.sub === 'proponer' && global.nivel === 'global', j(global))
    check('(a5i) sin --global, las del perfil', analizar(['proponer', '-']).nivel === undefined, '')
    check('(a5j) reglas --perfil y --global piden un solo nivel', analizar(['reglas', '--perfil']).nivel === 'perfil' && analizar(['reglas', '--global']).nivel === 'global', '')
    check('(a5d) docs con un nombre con espacios', j(analizar(['docs', 'guia', 'final.md'])) === j({ sub: 'docs', nombre: 'guia final.md' }), j(analizar(['docs', 'guia', 'final.md'])))
    const malos: Array<[string, string[]]> = [
      ['subcomando desconocido', ['borrar']],
      ['reglas con argumentos', ['reglas', 'x']],
      ['traspaso con argumentos (no se pide el de otra sesión)', ['traspaso', 'agent:otra']],
      ['proponer sin texto', ['proponer']],
      ['proponer con dos fuentes', ['proponer', '-', '--texto', 'x']],
      ['una opción ajena', ['proponer', '--perfil', 'pb', '-']],
      ['un argumento suelto', ['proponer', 'texto suelto']],
      ['--archivo sin valor', ['proponer', '--archivo']]
    ]
    for (const [nombre, argv] of malos) check(`(a6) ${nombre}: código 2`, codigoDe(() => analizar(argv)) === CODIGOS.uso, j(argv))
    check('(a7) buscar: las palabras sueltas se unen, sin comillas', j(analizar(['buscar', 'migración', 'de', 'la', 'base'])) === j({ sub: 'buscar', texto: 'migración de la base', exacta: false }), j(analizar(['buscar', 'migración', 'base'])))
    check('(a8) buscar --exacta y --max N / --max=N, en cualquier sitio', j(analizar(['buscar', '--max', '3', 'no', 'subir', '--exacta'])) === j({ sub: 'buscar', texto: 'no subir', exacta: true, max: 3 }) && analizar(['buscar', 'x', '--max=20']).max === 20, j(analizar(['buscar', '--max', '3', 'no', '--exacta'])))
    check('(a9) buscar: tras --, todo es texto', analizar(['buscar', '--', '--max', 'x']).texto === '--max x', j(analizar(['buscar', '--', '--max', 'x'])))
    const malosBuscar: Array<[string, string[]]> = [
      ['buscar sin texto', ['buscar']],
      ['buscar con --max fuera de rango', ['buscar', 'x', '--max', '21']],
      ['buscar con --max que no es un número', ['buscar', 'x', '--max=tres']],
      ['buscar con --max sin valor', ['buscar', 'x', '--max']],
      ['buscar con una opción ajena', ['buscar', 'x', '--perfil', 'pb']],
      ['buscar con más de 200 caracteres', ['buscar', 'x'.repeat(201)]]
    ]
    for (const [nombre, argv] of malosBuscar) check(`(a10) ${nombre}: código 2`, codigoDe(() => analizar(argv)) === CODIGOS.uso, j(argv).slice(0, 60))
  }

  hr('B - Los mismos códigos, topes y textos en los dos lados')
  {
    check('(b1) los códigos compartidos de tctx son los del main', Object.entries(CODIGOS_TCTX).every(([clave, valor]) => CODIGOS[clave] === valor), `${j(CODIGOS)} ${j(CODIGOS_TCTX)}`)
    check('(b2) los topes de tctx son los de shared/reglasPerfil', ordenes.MAX_REGLAS === MAX_REGLAS_PERFIL && ordenes.MAX_MOTIVO === MAX_MOTIVO_PROPUESTA, `${ordenes.MAX_REGLAS} ${ordenes.MAX_MOTIVO}`)
    const dif = diferencias(es, en, 'textos')
    check('(b3) español e inglés con las mismas claves y aridad', dif.length === 0, dif.join('; ') || `${Object.keys(es).length} claves`)
    check('(b4) los topes de buscar son los del main', argumentos.MAX_TEXTO_BUSCAR === MAX_TEXTO_BUSQUEDA && argumentos.MAX_RESULTADOS === MAX_RESULTADOS_TOPE, `${argumentos.MAX_TEXTO_BUSCAR} ${argumentos.MAX_RESULTADOS}`)
    check('(b5) tctx espera a buscar más que el tope de tiempo de la búsqueda', ordenes.TOPE_BUSCAR_MS > TOPES_DEFECTO.ms + 5000, `${ordenes.TOPE_BUSCAR_MS} > ${TOPES_DEFECTO.ms}`)
  }

  hr('C - El texto: marcas de orden de bytes y rutas (Windows y macOS por parámetro)')
  {
    const t = 'Regla ñ\nDos'
    check('(c1) UTF-8 sin marca y con ella', entrada.decodificar(Buffer.from(t)) === t && entrada.decodificar(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(t)])) === t, 'utf-8')
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')])
    const bytesOrdenMayorPrimero = Buffer.from(le)
    bytesOrdenMayorPrimero.swap16()
    check('(c2) UTF-16 de Out-File (LE) y BE, por su marca', entrada.decodificar(le) === t && entrada.decodificar(bytesOrdenMayorPrimero) === t, j(entrada.decodificar(bytesOrdenMayorPrimero)))
    const w = { plataforma: 'windows', cwd: 'C:\\proy', casa: 'C:\\Users\\u' }
    check('(c3) Windows: /c/… del shell de Git, ~ y relativa', entrada.rutaDeArchivo('/c/Users/u/r.md', w) === 'C:\\Users\\u\\r.md' && entrada.rutaDeArchivo('~/r.md', w) === 'C:\\Users\\u\\r.md' && entrada.rutaDeArchivo('r.md', w) === 'C:\\proy\\r.md', entrada.rutaDeArchivo('/c/Users/u/r.md', w))
    check('(c4) Windows: otra ruta que empieza por / no se adivina (código 2)', codigoDe(() => entrada.rutaDeArchivo('/tmp/r.md', w)) === CODIGOS.uso, '/tmp')
    check('(c5) macOS: /tmp es /tmp', entrada.rutaDeArchivo('/tmp/r.md', { plataforma: 'mac', cwd: '/x', casa: '/Users/u' }) === '/tmp/r.md', 'mac')
    // `tctx proponer -` en una terminal o con una tubería que nadie cierra no se queda esperando para siempre.
    const terminal = Object.assign(new PassThrough(), { isTTY: true })
    const sinTuberia = await entrada.leerEntrada(terminal).catch((e: { codigo?: number; message?: string }) => e)
    check('(c6) entrada que es una terminal: código 2 y dice que hace falta una tubería', (sinTuberia as { codigo?: number }).codigo === CODIGOS.uso && String((sinTuberia as Error).message).includes('--archivo'), String((sinTuberia as Error).message))
    const abierta = new PassThrough()
    abierta.write('algo')
    const t0 = Date.now()
    const sinFin = await entrada.leerEntrada(abierta, 150).catch((e: { codigo?: number }) => e)
    check('(c7) tubería que no se cierra: código 2 al agotar el tope de tiempo', (sinFin as { codigo?: number }).codigo === CODIGOS.uso && Date.now() - t0 < 5000, String((sinFin as Error).message))
    const cerrada = new PassThrough()
    cerrada.end('Regla ñ')
    check('(c8) tubería normal: el texto entero', (await entrada.leerEntrada(cerrada)) === 'Regla ñ', 'tubería')
  }

  hr('D - tctx de verdad contra el puente: reglas, proponer de las tres formas y los rechazos')
  {
    const { puente, almacen, avisos } = await puenteConReglas()
    const env = (perfil: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => entornoLimpio({ TESSERA_DB_PIPE: puente.pipe, TESSERA_DB_SESSION: puente.emitir(perfil, path.join(os.tmpdir(), 'web')), ...extra })
    const tctx = (args: string[], e: NodeJS.ProcessEnv, entradaStd?: string | Buffer): Promise<Salida> => correr(process.execPath, [TCTX, ...args], { env: e, entrada: entradaStd })
    const reglas = await tctx(['reglas'], env('pa'))
    check('(d1) reglas: las del perfil, tal cual', reglas.codigo === 0 && reglas.salida === 'Regla A\n', `codigo=${reglas.codigo} ${j(reglas.salida)} ${reglas.errores}`)
    const sin = await tctx(['reglas'], env('pb'))
    check('(d2) un perfil sin reglas lo dice', sin.codigo === 0 && sin.salida.includes('no tiene reglas'), j(sin.salida))
    const enIngles = await tctx(['reglas'], env('pb', { TESSERA_IDIOMA: 'en' }))
    check('(d3) en inglés con TESSERA_IDIOMA=en', enIngles.salida.includes('has no rules'), j(enIngles.salida))
    const porTexto = await tctx(['proponer', '--texto', 'Regla A\nRegla B', '--motivo', 'prueba'], env('pa'))
    check('(d4) proponer --texto: código 0, queda pendiente y avisa', porTexto.codigo === 0 && almacen.obtener('pa')?.texto === 'Regla A\nRegla B' && almacen.obtener('pa')?.motivo === 'prueba' && avisos.at(-1) === 'pa', `codigo=${porTexto.codigo} ${porTexto.errores}`)
    const dir = temporal('tessera-tctx-archivo ñ-')
    const archivo = path.join(dir, 'reglas ñ.md')
    writeFileSync(archivo, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Desde un archivo UTF-16\r\ncon "comillas" y ñ\r\n', 'utf16le')]))
    const porArchivo = await tctx(['proponer', '--archivo', archivo], env('pa'))
    check('(d5) proponer --archivo (UTF-16 con CRLF): el texto exacto, normalizado', porArchivo.codigo === 0 && almacen.obtener('pa')?.texto === 'Desde un archivo UTF-16\ncon "comillas" y ñ', `codigo=${porArchivo.codigo} ${j(almacen.obtener('pa')?.texto)} ${porArchivo.errores}`)
    const porEntrada = await tctx(['proponer', '-'], env('pa'), 'Por la entrada\n- con `comillas` \'simples\' y "dobles"\n')
    check('(d6) proponer -: lo que llega por la entrada estándar', porEntrada.codigo === 0 && almacen.obtener('pa')?.texto === 'Por la entrada\n- con `comillas` \'simples\' y "dobles"', `codigo=${porEntrada.codigo} ${porEntrada.errores}`)
    const igual = await tctx(['proponer', '--texto', 'Regla A'], env('pa'))
    check('(d7) igual a las vigentes: código 4 y por qué', igual.codigo === CODIGOS.rechazo && igual.errores.includes('igual a las reglas vigentes'), `codigo=${igual.codigo} ${igual.errores.trim()}`)
    const vacia = await tctx(['proponer', '-'], env('pa'), '\n  \n')
    check('(d8) vacía: código 4', vacia.codigo === CODIGOS.rechazo && vacia.errores.includes('vacía'), `codigo=${vacia.codigo} ${vacia.errores.trim()}`)
    const larga = await tctx(['proponer', '-'], env('pa'), 'x'.repeat(MAX_REGLAS_PERFIL + 1))
    check('(d9) pasa del tope: código 4 con el largo y el máximo, dicho por Tessera', larga.codigo === CODIGOS.rechazo && larga.errores.includes(`${MAX_REGLAS_PERFIL + 1} caracteres`) && larga.errores.includes(`${MAX_REGLAS_PERFIL} como mucho`), larga.errores.trim())
    // La petición más larga que manda: texto en el tope de envío, con saltos y comillas que doblan su JSON.
    const enElTope = ('ñ"\n'.repeat(3000) + 'x'.repeat(3000)).slice(0, MAX_REGLAS_PERFIL * 2)
    const grande = await tctx(['proponer', '-'], env('pa'), enElTope)
    check('(d10) la petición más larga que manda tctx cabe en el puente: contesta Tessera, no el corte', grande.codigo === CODIGOS.rechazo && !grande.errores.includes('no contesta'), `codigo=${grande.codigo} ${grande.errores.trim().slice(0, 120)}`)
    const enorme = await tctx(['proponer', '-'], env('pa'), '"\n'.repeat(MAX_REGLAS_PERFIL * 3))
    check('(d11) una que no cabría se rechaza aquí (código 4), sin mandarla', enorme.codigo === CODIGOS.rechazo && enorme.errores.includes('como mucho'), `codigo=${enorme.codigo} ${enorme.errores.trim().slice(0, 120)}`)
    const ajena = await tctx(['reglas'], entornoLimpio({}))
    check('(d12) una terminal que no abrió Tessera: código 3', ajena.codigo === CODIGOS.puente && ajena.errores.includes('TESSERA_DB_PIPE'), ajena.errores.trim())
    const tokenFalso = await tctx(['reglas'], entornoLimpio({ TESSERA_DB_PIPE: puente.pipe, TESSERA_DB_SESSION: 'inventado' }))
    check('(d13) un token que no es de ninguna sesión: código 3', tokenFalso.codigo === CODIGOS.puente && tokenFalso.errores.includes('no reconoce'), tokenFalso.errores.trim())
    const ayuda = await tctx(['help'], entornoLimpio({}))
    check('(d14) help: código 0 y las tres formas de dar el texto', ayuda.codigo === 0 && ['--archivo', '--texto', 'proponer -'].every((s) => ayuda.salida.includes(s)), String(ayuda.codigo))
    puente.detener()
  }

  hr('E - Los atajos: generados para cada sistema y ejecutados de verdad en cada shell')
  {
    const { puente, almacen } = await puenteConReglas()
    const raiz = temporal('tessera-tctx-atajos-')
    const dirBin = path.join(raiz, 'bin ñ', SHIM_DIR)
    const programa = { nombre: 'tctx', variable: 'TESSERA_TCTX' }
    const enMac = generarAtajosPrograma(programa, { exe: '/Applications/Tessera.app/Contents/MacOS/Tessera', script: '/x/tctx.cjs', sello: 's' }, 'mac')
    const enWindows = generarAtajosPrograma(programa, { exe: 'e', script: 's', sello: 's' }, 'windows')
    check('(e1) Windows: sh, ps1 y cmd; macOS y Linux: solo sh', j(enWindows.map((g) => g.nombre)) === j(['tctx', 'tctx.ps1', 'tctx.cmd']) && j(enMac.map((g) => g.nombre)) === j(['tctx']), j(enWindows.map((g) => g.nombre)))
    check('(e2) el sh lanza tctx con su variable y "$@"', enMac[0].contenido.includes('exec "$TESSERA_EXE" "$TESSERA_TCTX" "$@"') && !enMac[0].contenido.includes('\r'), 'sh')
    escribirArchivosDeAtajo(dirBin, generarAtajosPrograma(programa, { exe: process.execPath, script: TCTX, sello: 'prueba' }, plataforma))
    const env = entornoLimpio({
      PATH: `${dirBin}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}`,
      Path: undefined,
      TESSERA_DB_PIPE: puente.pipe,
      TESSERA_DB_SESSION: puente.emitir('pa', raiz)
    })
    writeFileSync(path.join(raiz, 'reglas.md'), 'Desde el archivo\ncon ñ\n')
    const bash = bashDelAgente()
    if (bash !== null) {
      const r = await correr(bash, ['-lc', 'tctx reglas'], { env, cwd: raiz })
      check('(e3) sh: el atajo se resuelve por el PATH', r.codigo === 0 && r.salida.trim() === 'Regla A', `codigo=${r.codigo} ${r.salida.trim()} ${r.errores.slice(0, 160)}`)
      const doc = await correr(bash, ['-lc', "tctx proponer - --motivo 'desde sh' <<'FIN'\nUna /ruta que MSYS no toca\ny \"comillas\" ñ\nFIN"], { env, cwd: raiz })
      check('(e4) sh: un documento por la entrada, sin convertir /ruta', doc.codigo === 0 && almacen.obtener('pa')?.texto === 'Una /ruta que MSYS no toca\ny "comillas" ñ' && almacen.obtener('pa')?.motivo === 'desde sh', `codigo=${doc.codigo} ${j(almacen.obtener('pa')?.texto)} ${doc.errores.slice(0, 160)}`)
      const resultadoArchivo = await correr(bash, ['-lc', 'tctx proponer --archivo reglas.md'], { env, cwd: raiz })
      check('(e5) sh: --archivo relativo', resultadoArchivo.codigo === 0 && almacen.obtener('pa')?.texto === 'Desde el archivo\ncon ñ', `codigo=${resultadoArchivo.codigo} ${resultadoArchivo.errores.slice(0, 160)}`)
    } else {
      check('(e3) hay un sh para el atajo del agente (el shell de Git en Windows)', false, 'sin bash')
    }
    if (esWindows()) {
      const ps = (linea: string): Promise<Salida> => correr('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', linea], { env, cwd: raiz })
      const leer = await ps('tctx reglas; exit $LASTEXITCODE')
      check('(e6) PowerShell: el ps1 lee las reglas', leer.codigo === 0 && leer.salida.trim() === 'Regla A', `codigo=${leer.codigo} ${leer.salida.trim()} ${leer.errores.slice(0, 160)}`)
      const aqui = await ps("@'\nDesde PowerShell con \"comillas\" y ñ\nSegunda línea\n'@ | tctx proponer - --motivo 'desde ps'; exit $LASTEXITCODE")
      check('(e7) PowerShell: un here-string canalizado llega exacto (comillas y ñ)', aqui.codigo === 0 && almacen.obtener('pa')?.texto === 'Desde PowerShell con "comillas" y ñ\nSegunda línea', `codigo=${aqui.codigo} ${j(almacen.obtener('pa')?.texto)} ${aqui.errores.slice(0, 160)}`)
      const archivoSalida = await ps("'Escrito con Out-File','y ñ' | Out-File reglas-ps.md; tctx proponer --archivo reglas-ps.md; exit $LASTEXITCODE")
      check('(e8) PowerShell: --archivo de un Out-File sin -Encoding (UTF-16)', archivoSalida.codigo === 0 && almacen.obtener('pa')?.texto === 'Escrito con Out-File\ny ñ', `codigo=${archivoSalida.codigo} ${j(almacen.obtener('pa')?.texto)} ${archivoSalida.errores.slice(0, 160)}`)
      const texto = await ps("tctx proponer --texto 'Una regla corta' --motivo 'prueba'; exit $LASTEXITCODE")
      check('(e9) PowerShell: --texto con una línea', texto.codigo === 0 && almacen.obtener('pa')?.texto === 'Una regla corta', `codigo=${texto.codigo} ${texto.errores.slice(0, 160)}`)
      const igual = await ps("tctx proponer --texto 'Regla A'; exit $LASTEXITCODE")
      check('(e10) PowerShell: el rechazo llega a $LASTEXITCODE', igual.codigo === CODIGOS.rechazo, `codigo=${igual.codigo}`)
      const cmd = await correr('cmd.exe', ['/d', '/c', 'tctx proponer --archivo reglas.md'], { env, cwd: raiz })
      check('(e11) cmd: el .cmd con --archivo', cmd.codigo === 0 && almacen.obtener('pa')?.texto === 'Desde el archivo\ncon ñ', `codigo=${cmd.codigo} ${cmd.errores.slice(0, 160)}`)
      const cmdEntrada = await correr('cmd.exe', ['/d', '/c', 'tctx proponer - < reglas-ps.md'], { env, cwd: raiz })
      check('(e12) cmd: por la entrada con <', cmdEntrada.codigo === 0 && almacen.obtener('pa')?.texto === 'Escrito con Out-File\ny ñ', `codigo=${cmdEntrada.codigo} ${cmdEntrada.errores.slice(0, 160)}`)
    } else {
      console.log('  (no es Windows: PowerShell y cmd no aplican; el atajo es solo el sh)')
    }
    puente.detener()
  }

  hr('F - El cliente del contenedor contra el buzón de verdad (sin Docker: el mismo sistema de archivos)')
  {
    const { puente, almacen } = await puenteConReglas()
    const raiz = temporal('tessera-tctx-buzon-')
    const buzonDocker = new PuenteDocker({
      raiz,
      clienteOrigen: path.join(RAIZ_REPO, 'src', 'tdb', 'tdb-container.cjs'),
      ejecutar: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      log: () => {}
    })
    buzonDocker.registrarPrograma(programaTctx({ dirTctx: DIR_TCTX, sesionDeToken: (t) => puente.sesionDeToken(t), operaciones: new OperacionesReglas({ reglasDe: (id) => (id === 'pa' ? 'Regla A' : null), ...SIN_GLOBALES, propuestas: almacen, alProponer: () => {} }) }))
    const buzon = buzonDocker.prepararPerfil('pa')
    const lanzador = existsSync(path.join(buzon, 'tctx')) ? readFileSync(path.join(buzon, 'tctx'), 'utf-8') : ''
    check('(f1) el buzón trae el cliente, sus módulos y un lanzador sh con LF', ['tctx-cliente.cjs', 'tctxEntrada.cjs', 'tctxOrdenes.cjs', 'textosTctx.cjs'].every((n) => existsSync(path.join(buzon, n))) && lanzador.startsWith('#!/bin/sh\n') && !lanzador.includes('\r'), lanzador.split('\n').at(-2) ?? '')
    const trabajo = temporal('tessera-tctx-contenedor-')
    mkdirSync(path.join(trabajo, 'docs'))
    writeFileSync(path.join(trabajo, 'docs', 'reglas.md'), 'Desde el contenedor\n')
    const cliente = (args: string[], token: string, entradaStd?: string): Promise<Salida> =>
      correr(process.execPath, [path.join(buzon, 'tctx-cliente.cjs'), ...args], { env: entornoLimpio({ TESSERA_DB_BRIDGE: buzon, TESSERA_DB_SESSION: token }), cwd: trabajo, entrada: entradaStd })
    const token = puente.emitir('pa', '/workspace/web')
    const reglas = await cliente(['reglas'], token)
    check('(f2) reglas por el buzón', reglas.codigo === 0 && reglas.salida === 'Regla A\n', `codigo=${reglas.codigo} ${j(reglas.salida)} ${reglas.errores}`)
    const propuesta = await cliente(['proponer', '--archivo', 'docs/reglas.md', '--motivo', 'docker'], token)
    check('(f3) proponer --archivo: el archivo se lee DENTRO y el perfil sale del token', propuesta.codigo === 0 && almacen.obtener('pa')?.texto === 'Desde el contenedor' && almacen.obtener('pa')?.proyecto === 'web', `codigo=${propuesta.codigo} ${propuesta.errores}`)
    const igual = await cliente(['proponer', '-'], token, 'Regla A\n')
    check('(f4) un rechazo: código 4 con su texto, igual que en nativo', igual.codigo === CODIGOS.rechazo && igual.errores.includes('igual a las reglas vigentes'), `codigo=${igual.codigo} ${igual.errores.trim()}`)
    const ajeno = await cliente(['reglas'], 'inventado')
    check('(f5) un token que no es de ninguna sesión: código 3, sin reglas', ajeno.codigo === CODIGOS.puente && !ajeno.salida.includes('Regla'), `codigo=${ajeno.codigo} ${ajeno.errores.trim()}`)
    const sinToken = await cliente(['reglas'], '')
    check('(f6) sin token: código 3 y qué hacer, sin escribir en el buzón', sinToken.codigo === CODIGOS.puente && sinToken.errores.includes('recarga la terminal'), sinToken.errores.trim())
    buzonDocker.detener()
    puente.detener()
  }

  hr('G - tctx traspaso: el de la sesión del token, por el puente y por el buzón, y nada para otra sesión')
  {
    const { puente, almacen } = await puenteConReglas()
    const registro = new RegistroTraspasos()
    puente.registrarOperacion(OP_TRASPASO, { token: 'sesion', manejar: (_p, s) => atenderTraspaso(registro, s) })
    const proyecto = path.join(os.tmpdir(), 'web')
    const contenido = "# Traspaso desde Claude Code (cuenta del sistema)\n\n## Conversación reciente\n\n**Usuario:**\nArregla O'Brien y ñ\n"
    const id = registro.preparar({ profileId: 'pa', projectHostPath: proyecto, agente: 'codex', aviso: null, promptInicial: 'p', contenido })
    const tokenA = puente.emitir('pa', proyecto)
    const tokenB = puente.emitir('pa', proyecto)
    puente.bind(tokenA, 'agent:sA')
    puente.bind(tokenB, 'agent:sB')
    registro.consumir(id, 'agent:sA')
    const tctx = (token: string, extra: Record<string, string> = {}): Promise<Salida> =>
      correr(process.execPath, [TCTX, 'traspaso'], { env: entornoLimpio({ TESSERA_DB_PIPE: puente.pipe, TESSERA_DB_SESSION: token, ...extra }) })
    const leido = await tctx(tokenA)
    check('(g1) la sesión del traspaso lo imprime tal cual: código 0', leido.codigo === 0 && leido.salida === contenido, `codigo=${leido.codigo} ${j(leido.salida.slice(0, 60))} ${leido.errores}`)
    const otra = await tctx(tokenB)
    check('(g2) otra sesión del mismo perfil y proyecto: código 4 y que no tiene traspaso', otra.codigo === CODIGOS.rechazo && otra.errores.includes('no tiene ningún traspaso') && otra.salida === '', `codigo=${otra.codigo} ${otra.errores.trim()}`)
    const enIngles = await tctx(tokenB, { TESSERA_IDIOMA: 'en' })
    check('(g3) en inglés', enIngles.errores.includes('has no handoff'), enIngles.errores.trim())
    const ayuda = await correr(process.execPath, [TCTX, 'help'], { env: entornoLimpio({}) })
    check('(g4) la ayuda lo cuenta', ayuda.salida.includes('tctx traspaso'), '')

    const raiz = temporal('tessera-tctx-buzon-traspaso-')
    const buzonDocker = new PuenteDocker({ raiz, clienteOrigen: path.join(RAIZ_REPO, 'src', 'tdb', 'tdb-container.cjs'), ejecutar: async () => ({ exitCode: 0, stdout: '', stderr: '' }), log: () => {} })
    const reglas = new OperacionesReglas({ reglasDe: (pid) => (pid === 'pa' ? 'Regla A' : null), ...SIN_GLOBALES, propuestas: almacen, alProponer: () => {} })
    // Como en `reglas/componer.ts`: el programa del buzón atiende las de las reglas y las de otros dominios.
    const operaciones = { atender: (op: unknown, p: Readonly<Record<string, unknown>>, s: SesionDelPuente): RespuestaOperacion => (op === OP_TRASPASO ? atenderTraspaso(registro, s) : reglas.atender(op, p, s)) }
    buzonDocker.registrarPrograma(programaTctx({ dirTctx: DIR_TCTX, sesionDeToken: (t) => puente.sesionDeToken(t), operaciones }))
    const buzon = buzonDocker.prepararPerfil('pa')
    const cliente = (token: string): Promise<Salida> =>
      correr(process.execPath, [path.join(buzon, 'tctx-cliente.cjs'), 'traspaso'], { env: entornoLimpio({ TESSERA_DB_BRIDGE: buzon, TESSERA_DB_SESSION: token }) })
    const porBuzon = await cliente(tokenA)
    check('(g5) por el buzón de Docker, el mismo texto', porBuzon.codigo === 0 && porBuzon.salida === contenido, `codigo=${porBuzon.codigo} ${porBuzon.errores}`)
    const otraPorBuzon = await cliente(tokenB)
    check('(g6) y otra sesión tampoco lo lee por ahí', otraPorBuzon.codigo === CODIGOS.rechazo, `codigo=${otraPorBuzon.codigo}`)
    puente.revocar('agent:sA')
    const cerrada = await tctx(tokenA)
    check('(g7) cerrada la sesión (token revocado), código 3', cerrada.codigo === CODIGOS.puente, `codigo=${cerrada.codigo}`)
    buzonDocker.detener()
    puente.detener()
  }

  hr('H - tctx buscar: por el pipe (nativa: todas las cuentas) y por el buzón (Docker: solo la suya), en texto')
  {
    const { puente, almacen } = await puenteConReglas()
    const raiz = temporal('tessera-tctx-historial-')
    const proyecto = path.join(raiz, 'trabajo', 'web')
    const nativa = path.join(raiz, 'nativa-claude')
    const cuentaB = path.join(raiz, 'codex-cuentas', 'B')
    const linea = (o: unknown): string => JSON.stringify(o)
    const escribir = (ruta: string, objetos: unknown[], fecha: Date): void => {
      mkdirSync(path.dirname(ruta), { recursive: true })
      writeFileSync(ruta, objetos.map(linea).join('\n') + '\n')
      utimesSync(ruta, fecha, fecha)
    }
    escribir(path.join(nativa, 'projects', proyecto.replace(/[^A-Za-z0-9]/g, '-'), '00000000-0000-4000-8000-000000000001.jsonl'), [
      { type: 'user', timestamp: '2026-10-01T10:00:00Z', cwd: proyecto, message: { content: 'Acordamos no subir a main: la migración de la base va en una rama' } },
      { type: 'assistant', timestamp: '2026-10-01T10:01:00Z', cwd: proyecto, message: { content: [{ type: 'text', text: 'Hecho, la MIGRACION queda en la rama de O\'Brien' }] } }
    ], new Date('2026-10-01T10:01:00Z'))
    escribir(path.join(cuentaB, 'sessions', '2026', '10', '01', 'rollout-2026-10-01T09-00-00-00000000-0000-4000-8000-000000000002.jsonl'), [
      { type: 'session_meta', timestamp: '2026-10-01T09:00:00Z', payload: { session_id: '00000000-0000-4000-8000-000000000002', cwd: '/workspace/web' } },
      { type: 'event_msg', timestamp: '2026-10-01T09:00:01Z', payload: { type: 'user_message', message: 'la migración desde Docker' } }
    ], new Date('2026-10-01T09:00:01Z'))
    const lector = new LectorConversaciones()
    const operacion = new OperacionBuscarHistorial()
    operacion.conectar({
      sesionAgente: (id) => (id === 'nat' ? { profileId: 'pa', agente: 'claude-code', accountId: '', host: true } : id === 'dock' ? { profileId: 'pa', agente: 'codex', accountId: 'B', host: false } : null),
      cuentasDelPerfil: (pid, agente) => (pid === 'pa' && agente === 'codex' ? [{ id: 'B', nombre: 'Personal' }] : []),
      cuenta: (id) => (id === 'B' ? { profileId: 'pa', agente: 'codex', nombre: 'Personal' } : null),
      baseDe: (agente, id, host) => (host ? (agente === 'claude-code' ? nativa : path.join(raiz, 'nativa-codex')) : id === 'B' ? cuentaB : null),
      buscar: (fuentes, proy, consulta, max) => buscarEnHistorial(fuentes, proy, consulta, { ...TOPES_DEFECTO, max }, { resumenDe: (a, ag) => lector.resumenDe(a, ag) })
    })
    puente.registrarOperacion(OP_BUSCAR, { token: 'sesion', manejar: (p, s) => operacion.atender(p, s) })
    const tokenNativo = puente.emitir('pa', proyecto)
    const tokenDocker = puente.emitir('pa', proyecto)
    puente.bind(tokenNativo, 'agent:nat')
    puente.bind(tokenDocker, 'agent:dock')
    const tctx = (args: string[], token: string, extra: Record<string, string> = {}): Promise<Salida> =>
      correr(process.execPath, [TCTX, 'buscar', ...args], { env: entornoLimpio({ TESSERA_DB_PIPE: puente.pipe, TESSERA_DB_SESSION: token, ...extra }) })
    const todas = await tctx(['migracion'], tokenNativo)
    check('(h1) nativa: código 0 y las tres, en texto, de todas las cuentas', todas.codigo === 0 && todas.salida.startsWith('3 coincidencias') && todas.salida.includes('Claude Code · Nativa · «') && todas.salida.includes('Codex · Personal · «') && todas.salida.includes('   Usuario: Acordamos no subir') && todas.salida.includes("   Agente: Hecho, la MIGRACION queda en la rama de O'Brien") && !todas.salida.trimStart().startsWith('{'), `codigo=${todas.codigo} ${j(todas.salida.slice(0, 200))} ${todas.errores}`)
    check('(h2) nativa no dice que solo buscó en su cuenta', !todas.salida.includes('Desde Docker solo'), '')
    const una = await tctx(['migracion', '--max', '1'], tokenNativo)
    check('(h3) --max 1: una y que hay más', una.codigo === 0 && una.salida.startsWith('1 coincidencia ') && una.salida.includes('Hay más coincidencias'), j(una.salida.slice(-120)))
    const frase = await tctx(['--exacta', 'no', 'subir', 'a', 'main'], tokenNativo)
    check('(h4) --exacta: la frase tal cual', frase.codigo === 0 && frase.salida.startsWith('1 coincidencia ') && frase.salida.includes('Acordamos'), j(frase.salida.slice(0, 120)))
    const nada = await tctx(['inexistente'], tokenNativo)
    check('(h5) sin coincidencias: código 0 y lo dice', nada.codigo === 0 && nada.salida.trim() === 'Sin coincidencias en las conversaciones de este proyecto.', j(nada.salida))
    const ingles = await tctx(['migracion'], tokenNativo, { TESSERA_IDIOMA: 'en' })
    check('(h6) en inglés', ingles.salida.startsWith('3 matches') && ingles.salida.includes('· Native ·') && ingles.salida.includes('   User: '), j(ingles.salida.slice(0, 120)))
    const enOtraZona = await tctx(['migracion'], tokenNativo, { TZ: 'Pacific/Kiritimati' })
    const horaDelEquipo = fechaLocalDe(Date.parse('2026-10-01T10:01:00Z'))
    check('(h6b) la hora es la del equipo de Tessera aunque `tctx` corra en otra zona', enOtraZona.salida.includes(`${horaDelEquipo} · Claude Code`), `${horaDelEquipo} ${j(enOtraZona.salida.slice(0, 120))}`)
    const sinSesion = await tctx(['migracion'], puente.emitir('pa', proyecto))
    check('(h7) un token sin sesión: código 3', sinSesion.codigo === CODIGOS.puente && sinSesion.salida === '', `codigo=${sinSesion.codigo} ${sinSesion.errores.trim()}`)
    const ayuda = await correr(process.execPath, [TCTX, 'help'], { env: entornoLimpio({}) })
    check('(h8) la ayuda lo cuenta, con --exacta y --max', ayuda.salida.includes('tctx buscar <palabras> [--exacta] [--max N]'), '')

    const raizBuzon = temporal('tessera-tctx-buzon-buscar-')
    const buzonDocker = new PuenteDocker({ raiz: raizBuzon, clienteOrigen: path.join(RAIZ_REPO, 'src', 'tdb', 'tdb-container.cjs'), ejecutar: async () => ({ exitCode: 0, stdout: '', stderr: '' }), log: () => {} })
    const reglas = new OperacionesReglas({ reglasDe: (pid) => (pid === 'pa' ? 'Regla A' : null), ...SIN_GLOBALES, propuestas: almacen, alProponer: () => {} })
    // Como en `reglas/componer.ts`: el programa del buzón atiende también las de otros dominios, con promesa.
    const operaciones = { atender: (op: unknown, p: Readonly<Record<string, unknown>>, s: SesionDelPuente): RespuestaOperacion | Promise<RespuestaOperacion> => (op === OP_BUSCAR ? operacion.atender(p, s) : reglas.atender(op, p, s)) }
    buzonDocker.registrarPrograma(programaTctx({ dirTctx: DIR_TCTX, sesionDeToken: (t) => puente.sesionDeToken(t), operaciones }))
    const buzon = buzonDocker.prepararPerfil('pa')
    const cliente = (args: string[], token: string): Promise<Salida> =>
      correr(process.execPath, [path.join(buzon, 'tctx-cliente.cjs'), 'buscar', ...args], { env: entornoLimpio({ TESSERA_DB_BRIDGE: buzon, TESSERA_DB_SESSION: token }) })
    const deDocker = await cliente(['migracion'], tokenDocker)
    check('(h9) por el buzón, un agente en Docker: solo su cuenta, y lo dice', deDocker.codigo === 0 && deDocker.salida.startsWith('1 coincidencia ') && deDocker.salida.includes('Codex · Personal') && !deDocker.salida.includes('Nativa') && deDocker.salida.includes('Desde Docker solo se busca en su cuenta (Codex · Personal)'), `codigo=${deDocker.codigo} ${j(deDocker.salida)} ${deDocker.errores}`)
    const nativaPorBuzon = await cliente(['migracion'], tokenNativo)
    check('(h10) por el buzón, el mismo token nativo ve lo mismo que por el pipe', nativaPorBuzon.codigo === 0 && nativaPorBuzon.salida === todas.salida, j(nativaPorBuzon.salida.slice(0, 80)))
    buzonDocker.detener()

    if (esWindows()) {
      const dirBin = path.join(raiz, 'bin', SHIM_DIR)
      escribirArchivosDeAtajo(dirBin, generarAtajosPrograma({ nombre: 'tctx', variable: 'TESSERA_TCTX' }, { exe: process.execPath, script: TCTX, sello: 'prueba' }, plataforma))
      const env = entornoLimpio({ PATH: `${dirBin}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}`, Path: undefined, TESSERA_DB_PIPE: puente.pipe, TESSERA_DB_SESSION: tokenNativo })
      const ps = await correr('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'tctx buscar migración base; exit $LASTEXITCODE'], { env, cwd: raiz })
      check('(h11) PowerShell 5.1: palabras sueltas con tilde, sin comillas', ps.codigo === 0 && ps.salida.includes('1 coincidencia') && ps.salida.includes('Acordamos'), `codigo=${ps.codigo} ${j(ps.salida.slice(0, 120))} ${ps.errores.slice(0, 160)}`)
      const psFrase = await correr('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'tctx buscar --exacta no subir a main; exit $LASTEXITCODE'], { env, cwd: raiz })
      check('(h12) PowerShell 5.1: --exacta sin comillas', psFrase.codigo === 0 && psFrase.salida.includes('1 coincidencia'), `codigo=${psFrase.codigo} ${psFrase.errores.slice(0, 160)}`)
    } else {
      console.log('  (no es Windows: PowerShell no aplica)')
    }
    puente.detener()
  }
  hr('I - Delegación: argumentos, campos, estados, espera e interrupción del cliente')
  {
    const clienteOrdenes = requerir(path.join(DIR_TCTX, 'tctxOrdenes.cjs')) as {
      peticionDe: (a: Record<string, unknown>, texto: string) => { op: string; campos: Record<string, unknown> }
      errorDeRechazo: (r: Record<string, unknown>) => Error & { codigo: number }
    }
    const clienteSalida = requerir(path.join(DIR_TCTX, 'tctxOrdenes.cjs')) as {
      MAX_ORDEN_BYTES: number
      horaLocal: (marcaTiempo: number, ahora?: number) => string
      esperarTarea: (t: VistaTareaConResultado, consultar: (op: string, campos: Record<string, unknown>) => Promise<unknown>, reloj: { dormir: (ms: number) => Promise<void>; ahora: () => number }) => Promise<number>
    }
    check('(i1) cuentas sin campos', j(clienteOrdenes.peticionDe(analizar(['cuentas']), '')) === j({ op: 'ctx.cuentas', campos: {} }), '')
    const delegar = analizar(['delegar', '--agente', 'codex', '--solo-lectura', '--sin-esperar'])
    check('(i2) delegar: auto y campos exactos, sin opciones locales', j(clienteOrdenes.peticionDe(delegar, 'Revise ñ\n')) === j({ op: 'ctx.delegar', campos: { agente: 'codex', cuenta: 'auto', soloLectura: true, orden: 'Revise ñ\n' } }), '')
    check('(i3) cuenta explícita y entrada con guion', analizar(['delegar', '-', '--cuenta=Personal', '--agente=claude-code']).cuenta === 'Personal', '')
    for (const argv of [
      ['cuentas', 'x'], ['delegar'], ['delegar', '--agente', 'otro'], ['delegar', '--agente', 'codex', '--archivo'],
      ['delegar', '--agente', 'codex', '--cuenta='], ['delegar', '--agente', 'codex', '--archivo', 'x', '-'],
      ['delegar', '--agente', 'codex', '--texto', 'x'], ['delegar', '--agente', 'codex', '--agente', 'codex'],
      ['tarea'], ['tarea', 'id', '--cancelar', '--continuar'], ['tarea', 'id', '--archivo', 'x'],
      ['tarea', 'id', '--sin-esperar'], ['tarea', 'id', '--cancelar', '-'], ['tarea', 'id', '--continuar', '--solo-lectura'],
      ['tarea', 'id', '--continuar', '--archivo=x', '-']
    ]) check('(i4) combinación incorrecta: código 2', codigoDe(() => analizar(argv)) === 2, j(argv))
    for (const sub of [['delegar', '--agente=codex'], ['tarea', 'id', '--continuar']]) {
      const peticion = clienteOrdenes.peticionDe(analizar([...sub, '--archivo', 'no-existe.md']), '')
      const esperado = sub[0] === 'delegar' ? { agente: 'codex', cuenta: 'auto', archivo: path.resolve('no-existe.md') } : { id: 'id', accion: 'continuar', archivo: path.resolve('no-existe.md') }
      check('(i5) --archivo: ruta absoluta, sin leer el archivo ni mandar orden', j(peticion.campos) === j(esperado), j(peticion))
    }
    check('(i6) tope idéntico al contrato y medido en bytes UTF-8', clienteSalida.MAX_ORDEN_BYTES === MAX_ORDEN_BYTES && codigoDe(() => clienteOrdenes.peticionDe(delegar, 'ñ'.repeat(MAX_ORDEN_BYTES / 2 + 1))) === 4 && codigoDe(() => clienteOrdenes.peticionDe(delegar, 'ñ'.repeat(MAX_ORDEN_BYTES / 2))) === null, '')
    check('(i7) orden vacía rechazada', codigoDe(() => clienteOrdenes.peticionDe(delegar, ' \n')) === 4, '')
    const hoy = new Date(2026, 10, 6, 9, 5).getTime()
    check('(i8) reinicios en hora local: hora hoy y fecha otro día', clienteSalida.horaLocal(hoy, hoy) === '09:05' && clienteSalida.horaLocal(hoy, hoy + 86400000) === '2026-11-06 09:05', '')
    const { puente } = await puenteConReglas()
    const token = puente.emitir('pa', RAIZ_REPO)
    const env = entornoLimpio({ TESSERA_DB_PIPE: puente.pipe, TESSERA_DB_SESSION: token })
    let tarea: VistaTareaConResultado = { id: 't-1', origen: 'agent:prueba', profileId: 'pa', agente: 'codex', cuenta: 'Personal', soloLectura: true, estado: 'en-marcha', resumen: 'Revise', inicio: Date.now() - 32000, ultimaActividad: Date.now() - 2000, actividad: ['leyendo', 'última línea'] }
    const peticiones: Array<{ op: string; campos: Record<string, unknown> }> = []
    let sinCuentas = false
    let rechazo = ''
    let escribiendo = 0
    for (const op of ['ctx.cuentas', 'ctx.delegar', 'ctx.tarea', 'ctx.tareas', 'ctx.modelos']) puente.registrarOperacion(op, { token: 'sesion', manejar: (p) => {
      peticiones.push({ op, campos: Object.fromEntries(Object.entries(p).filter(([k]) => !['op', 'token', 'v'].includes(k))) })
      if (rechazo) return { ok: false, rechazo }
      if (op === 'ctx.tareas') return { ok: true, tareas: [{ ...tarea, estado: 'interrumpida', modelo: 'gpt-6.1-sol', esfuerzo: 'high' }] }
      if (op === 'ctx.modelos') return { ok: true, agente: 'codex', cuenta: 'Personal', leido: hoy, modelos: [{ id: 'gpt-6.1-sol', nombre: 'GPT-6.1-Sol', esfuerzos: ['low', 'high'], porDefecto: true }, { id: 'viejo', nombre: 'Viejo', esfuerzos: [], porDefecto: false }] }
      if (op === 'ctx.delegar' && escribiendo) return { ok: true, tarea, escribiendo }
      if (op === 'ctx.cuentas') return { ok: true, cuentas: sinCuentas ? [] : [{ agente: 'codex', nombre: 'Personal', estado: 'lista', ventanas: [{ etiqueta: '5 h', porcentaje: 34, reinicio: hoy }], enMarcha: 2 }] }
      return { ok: true, tarea: p.accion === 'cancelar' ? { ...tarea, estado: 'cancelada' } : tarea }
    } })
    const tctx = (args: string[], texto = '', extra: Record<string, string> = {}): Promise<Salida> => correr(process.execPath, [TCTX, ...args], { env: { ...env, ...extra }, entrada: texto })
    const cuentas = await tctx(['cuentas'])
    check('(i9) cuentas: agente, nombre, uso, tareas y cómo delegar', cuentas.codigo === 0 && ['Codex · Personal · lista', '34 %', '2 tareas en marcha', 'tctx delegar'].every((s) => cuentas.salida.includes(s)), cuentas.salida.trim())
    sinCuentas = true
    const vacias = await tctx(['cuentas'])
    check('(i10) sin cuentas: perfil y ambos agentes', vacias.salida.includes('no tiene cuentas de Docker de Claude Code ni de Codex'), vacias.salida.trim())
    const lanzada = await tctx(['delegar', '--agente=codex', '--sin-esperar'], 'Revise')
    check('(i11) sin esperar: id solo en stdout y anuncio primero en stderr', lanzada.codigo === 0 && lanzada.salida === 't-1\n' && lanzada.errores.startsWith('tctx: Tarea t-1 · Codex · Personal.') && lanzada.errores.includes('tctx tarea t-1'), j(lanzada))
    const porArchivo = await tctx(['delegar', '--agente=codex', '--archivo=no-existe.md', '--sin-esperar'])
    check('(i12) archivo inexistente enviado sin lectura local', porArchivo.codigo === 0 && peticiones.at(-1)?.campos.archivo === path.resolve('no-existe.md'), j(peticiones.at(-1)))
    const antes = peticiones.length
    const dos = await tctx(['delegar', '--agente=codex', '--archivo=x'], 'otra fuente')
    const larga = await tctx(['delegar', '--agente=codex'], 'ñ'.repeat(MAX_ORDEN_BYTES))
    const vacia = await tctx(['delegar', '--agente=codex'])
    check('(i13) dos fuentes, exceso y vacío rechazados antes del puente', dos.codigo === 2 && larga.codigo === 4 && vacia.codigo === 4 && peticiones.length === antes, `${dos.codigo}, ${larga.codigo}, ${vacia.codigo}`)
    for (const [estado, codigo] of [['en-marcha', 7], ['hecha', 0], ['fallida', 5], ['cancelada', 6]] as const) {
      tarea = { ...tarea, estado, resultado: 'Resultado final', motivo: 'agente', detalle: 'detalle del fallo' }
      const vista = await tctx(['tarea', 't-1'])
      check('(i14) consulta del estado y código', vista.codigo === codigo && vista.salida.includes(`Codex · Personal · ${estado === 'en-marcha' ? 'en marcha' : estado}`) && vista.salida.includes('solo lectura') && vista.salida.includes('última actividad hace') && (estado !== 'hecha' || vista.salida.endsWith('Resultado final\n')) && (estado !== 'fallida' || vista.errores.includes('detalle del fallo') && vista.errores.includes('última línea')), `${estado}: ${j(vista)}`)
      if (estado === 'fallida' || estado === 'cancelada') {
        const final = await tctx(['delegar', '--agente=codex'], 'Revise')
        check('(i14b) final inmediato al delegar: anuncio, código y sin consulta innecesaria', final.codigo === codigo && final.salida === '' && final.errores.startsWith('tctx: Tarea t-1') && peticiones.at(-1)?.op === 'ctx.delegar', j(final))
      }
    }
    const cancelar = await tctx(['tarea', 't-1', '--cancelar'])
    check('(i15) cancelación explícita: código 0 y campos exactos', cancelar.codigo === 0 && cancelar.salida.includes('cancelada') && j(peticiones.at(-1)?.campos) === j({ id: 't-1', accion: 'cancelar' }), j(cancelar))
    const continuar = await tctx(['tarea', 't-1', '--continuar', '--sin-esperar'], 'Continúe')
    check('(i16) continuar: orden nueva, espera opcional e id', continuar.codigo === 0 && continuar.salida === 't-1\n' && j(peticiones.at(-1)?.campos) === j({ id: 't-1', accion: 'continuar', orden: 'Continúe' }), j(continuar))
    check('(i16b) delegar: modelo y esfuerzo en campos exactos', j(clienteOrdenes.peticionDe(analizar(['delegar', '--agente=codex', '--modelo', 'gpt-6.1-sol', '--esfuerzo=high']), 'x').campos) === j({ agente: 'codex', cuenta: 'auto', modelo: 'gpt-6.1-sol', esfuerzo: 'high', orden: 'x' }), '')
    check('(i16c) continuar admite otro modelo', j(clienteOrdenes.peticionDe(analizar(['tarea', 't-1', '--continuar', '--modelo=opus']), 'x').campos) === j({ id: 't-1', accion: 'continuar', modelo: 'opus', orden: 'x' }), '')
    check('(i16d) modelos: cuenta auto por defecto y actualizar', j(clienteOrdenes.peticionDe(analizar(['modelos', '--agente', 'codex', '--actualizar']), '').campos) === j({ agente: 'codex', cuenta: 'auto', actualizar: true }), '')
    for (const argv of [
      ['modelos'], ['modelos', '--agente', 'otro'], ['tareas', 'x'], ['tarea', 'id', '--modelo', 'x'], ['tarea', 'id', '--esperar', '--cancelar'],
      ['tarea', 'id', '--esperar', '--continuar'], ['tarea', 'id', '--max-segundos', '5'], ['tarea', 'id', '--esperar', '--max-segundos', '0'],
      ['tarea', 'id', '--esperar', '--max-segundos', 'x'], ['tarea', 'id', '--esperar', '--max-segundos', '86401'], ['delegar', '--agente=codex', '--modelo', '--esfuerzo']
    ]) check('(i16e) combinación incorrecta: código 2', codigoDe(() => analizar(argv)) === 2, j(argv))
    const modelos = await tctx(['modelos', '--agente=codex'])
    check('(i16f) modelos: id, esfuerzos, predeterminado y cómo usarlo', modelos.codigo === 0 && ['gpt-6.1-sol (GPT-6.1-Sol)', 'low, high', 'predeterminado', 'no admite niveles', '--modelo'].every((s) => modelos.salida.includes(s)), modelos.salida)
    const listado = await tctx(['tareas'])
    check('(i16g) tareas: id, estado, modelo y cómo reanudar', listado.codigo === 0 && ['t-1', 'interrumpida', 'gpt-6.1-sol · high', '--continuar'].every((s) => listado.salida.includes(s)), listado.salida)
    const tareaPrevia = tarea
    tarea = { ...tarea, estado: 'interrumpida', conversacion: 'c-1', resultado: undefined, motivo: undefined, detalle: undefined }
    const interrumpida = await tctx(['tarea', 't-1'])
    check('(i16h) interrumpida: código propio y cómo reanudarla', interrumpida.codigo === 8 && interrumpida.errores.includes('--continuar'), `${interrumpida.codigo} ${interrumpida.errores}`)
    tarea = { ...tarea, estado: 'hecha', resultado: 'Resultado final' }
    const yaHecha = await tctx(['tarea', 't-1', '--esperar'])
    check('(i16i) esperar una tarea ya hecha entrega el resultado', yaHecha.codigo === 0 && yaHecha.salida === 'Resultado final\n', j(yaHecha))
    let reloj = 0
    const conTope = await clienteSalida.esperarTarea({ ...tarea, estado: 'en-marcha' }, async () => ({ ok: true, tarea: { ...tarea, estado: 'en-marcha', actividad: [] } }), { dormir: async () => { reloj += 2000 }, ahora: () => reloj, maxMs: 4000 } as never)
    check('(i16j) el tope de espera devuelve «en marcha» sin cancelar nada', conTope === 7 && reloj === 4000, `${conTope} ${reloj}`)
    tarea = { ...tarea, estado: 'en-marcha', resultado: undefined }
    escribiendo = 2
    const conOtras = await tctx(['delegar', '--agente=codex', '--sin-esperar'], 'Revise')
    check('(i16k) delegar avisa si hay otras tareas que escriben en el proyecto', conOtras.errores.includes('mismos archivos') && conOtras.salida === 't-1\n', conOtras.errores)
    escribiendo = 0
    tarea = tareaPrevia
    for (const codigo of Object.keys(es.rechazosDelegacion as object)) {
      rechazo = codigo
      const rechazada = await tctx(['cuentas'])
      check('(i17) cada rechazo del contrato tiene texto y código 4', rechazada.codigo === 4 && rechazada.errores.length > 30, `${codigo}: ${rechazada.errores.trim()}`)
    }
    rechazo = ''
    const datosRechazo = clienteOrdenes.errorDeRechazo({ rechazo: 'ninguna-cuenta', agente: 'codex', reinicio: hoy }).message
    check('(i18) datos del rechazo: agente, reinicio y orientación', datosRechazo.includes('Codex') && datosRechazo.includes('09:05') && datosRechazo.includes('tctx cuentas') && clienteOrdenes.errorDeRechazo({ rechazo: 'cuenta-ambigua', candidatos: ['A', 'B'] }).message.includes('A, B') && clienteOrdenes.errorDeRechazo({ rechazo: 'cuenta-no-existe', disponibles: ['C'] }).message.includes('C'), datosRechazo)
    const ingles = await tctx(['tarea', 't-1'], '', { TESSERA_IDIOMA: 'en' })
    check('(i19) estado en inglés', ingles.salida.includes('cancelled') && ingles.salida.includes('read only'), j(ingles))
    const ayuda = await tctx(['help'])
    check('(i20) ayuda: órdenes, espera, interrupción y códigos', ['tctx cuentas', 'tctx delegar', 'tctx tarea', '--sin-esperar', 'se interrumpe', 'tarea fallida', 'tarea cancelada', 'tarea en marcha'].every((s) => ayuda.salida.includes(s)), '')
    for (const motivo of ['sin-credencial', 'sin-uso', 'docker', 'agente', 'origen-cerrado', 'cancelada-por-usuario'] as const) {
      tarea = { ...tarea, estado: 'fallida', motivo, detalle: undefined }
      const fallo = await tctx(['tarea', 't-1'])
      check('(i20b) cada motivo de fallo tiene explicación y actividad', fallo.codigo === 5 && fallo.errores.includes((es.motivosFallo as Record<string, string>)[motivo]) && fallo.errores.includes('última línea'), motivo)
    }

    tarea = { ...tarea, estado: 'en-marcha' }
    const salidaOriginal = process.stdout.write
    const erroresOriginal = process.stderr.write
    let capturada = ''
    let avisos = ''
    process.stdout.write = ((texto: string) => { capturada += texto; return true }) as typeof process.stdout.write
    process.stderr.write = ((texto: string) => { avisos += texto; return true }) as typeof process.stderr.write
    const evidencias: Array<[string, boolean, string]> = []
    try {
      for (const fallosPrevios of [0, 1, 5]) {
        let vueltas = 0
        let tiempo = tarea.inicio
        const consultas: string[] = []
        let codigo = -1
        capturada = ''
        avisos = ''
        try {
          codigo = await clienteSalida.esperarTarea(tarea, async (op, campos) => {
            consultas.push(`${op}:${j(campos)}`)
            vueltas++
            if (vueltas <= fallosPrevios) return null
            return { ok: true, tarea: { ...tarea, estado: vueltas === fallosPrevios + 1 ? 'en-marcha' : 'hecha', resultado: 'Listo' } }
          }, { dormir: async (ms) => { if (ms !== 2000) throw new Error('Sondeo incorrecto'); tiempo += 30000 }, ahora: () => tiempo })
        } catch (e) {
          codigo = (e as { codigo: number }).codigo
          avisos += (e as Error).message
        }
        evidencias.push(['(i21) espera y reintentos con puente falso', codigo === (fallosPrevios === 5 ? 3 : 0) && vueltas === (fallosPrevios === 5 ? 5 : fallosPrevios + 2) && consultas.every((s) => s === 'ctx.tarea:{"id":"t-1"}') && (fallosPrevios === 5 ? avisos.includes('puede seguir en marcha') && avisos.includes('tctx tarea t-1') : capturada === 'Listo\n' && avisos.includes('última línea')), `fallos=${fallosPrevios}, vueltas=${vueltas}, código=${codigo}`])
      }
      for (const [estado, esperado] of [['fallida', 5], ['cancelada', 6]] as const) {
        capturada = ''
        avisos = ''
        const codigo = await clienteSalida.esperarTarea(tarea, async () => ({ ok: true, tarea: { ...tarea, estado, motivo: 'docker', detalle: 'Detalle' } }), { dormir: async () => {}, ahora: Date.now })
        evidencias.push(['(i21b) espera: fallo o cancelación por stderr', codigo === esperado && capturada === '' && (estado === 'fallida' ? avisos.includes('Detalle') && avisos.includes('última línea') : avisos.includes('cancelada')), `${estado}: ${codigo}`])
      }
      let vueltas = 0
      const codigo = await clienteSalida.esperarTarea(tarea, async () => {
        vueltas++
        if (![5, 10].includes(vueltas)) return null
        return { ok: true, tarea: { ...tarea, estado: vueltas === 10 ? 'hecha' : 'en-marcha', resultado: 'Recuperada' } }
      }, { dormir: async () => {}, ahora: Date.now })
      evidencias.push(['(i21c) una consulta buena reinicia el contador de fallos consecutivos', codigo === 0 && vueltas === 10, `vueltas=${vueltas}, código=${codigo}`])
    } finally {
      process.stdout.write = salidaOriginal
      process.stderr.write = erroresOriginal
    }
    for (const evidencia of evidencias) check(...evidencia)
    for (const senal of ['SIGINT', 'SIGTERM'] as const) {
      const inicioCorte = peticiones.length
      await new Promise<void>((resolver, rechazar) => {
        const hijo = spawn(process.execPath, [TCTX, 'delegar', '--agente=codex'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
        const tope = setTimeout(() => { hijo.kill(); rechazar(new Error('No llegó el anuncio de delegación')) }, 5000)
        hijo.stdin.end('Una tarea larga')
        hijo.stderr.once('data', () => hijo.kill(senal))
        hijo.on('error', rechazar)
        hijo.on('close', () => { clearTimeout(tope); resolver() })
      })
      check('(i22) interrumpir el cliente no manda cancelación', peticiones.length > inicioCorte && peticiones.slice(inicioCorte).every((p) => p.campos.accion !== 'cancelar'), `${senal}: ${j(peticiones.slice(inicioCorte))}`)
    }
    tarea = { ...tarea, estado: 'hecha', resultado: 'Resultado consultado' }
    const esperada = await tctx(['delegar', '--agente=codex'], 'Termine')
    check('(i22b) delegar espera y consulta el resultado aunque la respuesta inicial ya diga hecha', esperada.codigo === 0 && esperada.salida === 'Resultado consultado\n' && j(peticiones.at(-1)) === j({ op: 'ctx.tarea', campos: { id: 't-1' } }), j(esperada))

    const raiz = temporal('tessera-tctx-buzon-delegar-')
    const buzonDocker = new PuenteDocker({ raiz, clienteOrigen: path.join(RAIZ_REPO, 'src', 'tdb', 'tdb-container.cjs'), ejecutar: async () => ({ exitCode: 0, stdout: '', stderr: '' }), log: () => {} })
    buzonDocker.registrarPrograma(programaTctx({ dirTctx: DIR_TCTX, sesionDeToken: (t) => puente.sesionDeToken(t), operaciones: { atender: () => ({ ok: true, tarea: { ...tarea, estado: 'hecha', resultado: 'Por buzón' } }) } }))
    const buzon = buzonDocker.prepararPerfil('pa')
    const porBuzon = await correr(process.execPath, [path.join(buzon, 'tctx-cliente.cjs'), 'tarea', 't-1', '--continuar'], { env: entornoLimpio({ TESSERA_DB_BRIDGE: buzon, TESSERA_DB_SESSION: token }), entrada: 'Continúe' })
    check('(i23) continuar por el buzón espera y obtiene el resultado', porBuzon.codigo === 0 && porBuzon.salida === 'Por buzón\n' && porBuzon.errores.includes('tctx tarea t-1'), j(porBuzon))
    buzonDocker.detener()
    puente.detener()
  }
} finally {
  for (const d of temporales) rmSync(d, { recursive: true, force: true })
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
