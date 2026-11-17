#!/usr/bin/env node
// =============================================================================
// Prueba de la búsqueda en el historial (npm run test:buscar-historial): la coincidencia (tildes, mayúsculas,
// palabras, comillas), el trozo, la lectura por líneas (imagen en base64, línea enorme, `.zst`, topes), la
// búsqueda sobre transcripts falsos con las formas reales, el alcance por modo y la operación del puente con
// el perfil, el proyecto y quién pregunta sacados del token.
// Decisiones: docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { LectorConversaciones } from '../conversaciones/LectorConversaciones.ts'
import { PuenteBd, type SesionDelPuente } from '../db/puenteBd.ts'
import { ANCHO_TROZO, MAX_TEXTO_BUSQUEDA, analizarConsulta, coincide, normalizarBusqueda, trozoAlrededor, type Consulta } from './coincidencia.ts'
import { TOPES_DEFECTO, buscarEnHistorial, fechaLocalDe, type FuenteHistorial, type TopesBusqueda } from './buscarHistorial.ts'
import { claveSesionAgente, idDeClaveSesionAgente } from '../../shared/db-ipc.ts'
import { fijarIdioma } from '../../shared/i18n.ts'
import { nombreVisibleCuenta } from '../agentes/textos.ts'
import { recorrerLineas } from './lineasTranscripcion.ts'
import { MAX_BUSQUEDAS_EN_CURSO, OP_BUSCAR, OperacionBuscarHistorial, alcanceDe, type DependenciasOperacionBuscar } from './operacionBuscar.ts'

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

const temporales: string[] = []
function temporal(prefijo: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), prefijo))
  temporales.push(d)
  return d
}

const consulta = (t: string, exacta = false): Consulta => analizarConsulta(t, exacta) as Consulta
const casa = (t: string, texto: string, exacta = false): boolean => coincide(normalizarBusqueda(texto), consulta(t, exacta))

/** Escribe un JSONL (comprimido si acaba en `.zst`) y fija su fecha de última escritura. */
function escribir(ruta: string, objetos: unknown[], mtime: Date): void {
  mkdirSync(path.dirname(ruta), { recursive: true })
  const texto = objetos.map((o) => (typeof o === 'string' ? o : JSON.stringify(o))).join('\n') + '\n'
  writeFileSync(ruta, ruta.endsWith('.zst') ? zstdCompressSync(Buffer.from(texto, 'utf8')) : texto)
  utimesSync(ruta, mtime, mtime)
}

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ts = (min: number): string => new Date(Date.UTC(2026, 9, 1, 10, min)).toISOString()

/** Un transcript de Claude Code: usuario, agente con razonamiento y herramienta, y un resultado de herramienta. */
function claude(cwd: string, id: string, mensajes: Array<['u' | 'a', string]>, extra: unknown[] = []): unknown[] {
  const lineas: unknown[] = [{ type: 'ai-title', aiTitle: `Título ${id.slice(-2)}`, sessionId: id }]
  mensajes.forEach(([quien, texto], i) => {
    if (quien === 'u') lineas.push({ type: 'user', timestamp: ts(i), cwd, sessionId: id, message: { role: 'user', content: texto } })
    else
      lineas.push({
        type: 'assistant',
        timestamp: ts(i),
        cwd,
        sessionId: id,
        message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'razonamiento secreto' }, { type: 'text', text: texto }, { type: 'tool_use', name: 'Bash', input: { command: 'grep herramienta' } }] }
      })
  })
  return [...lineas, ...extra]
}

/** Un rollout de Codex con mensajes en las dos formas que escribe y una llamada a herramienta. */
function codex(cwd: string, id: string, mensajes: Array<['u' | 'a', string]>): unknown[] {
  const lineas: unknown[] = [{ type: 'session_meta', timestamp: ts(0), payload: { session_id: id, cwd } }]
  mensajes.forEach(([quien, texto], i) => {
    lineas.push({ type: 'event_msg', timestamp: ts(i), payload: { type: quien === 'u' ? 'user_message' : 'agent_message', message: texto } })
    lineas.push({ type: 'response_item', timestamp: ts(i), payload: { type: 'function_call_output', output: 'salida de herramienta con la palabra herramienta' } })
  })
  return lineas
}

try {
  hr('A - La coincidencia: sin mayúsculas ni tildes, todas las palabras, o la frase entre comillas')
  {
    check('(a1) tildes y mayúsculas, en los dos lados', casa('MIGRACION', 'la migración de la base') && casa('migración', 'MIGRACION hecha') && casa('Pingüino', 'pinguino'), '')
    check('(a2) todas las palabras, en cualquier orden', casa('base migración', 'la migración de la base') && !casa('base tabla', 'la migración de la base'), '')
    check('(a3) también dentro de otra palabra', casa('migra', 'migraciones'), '')
    check('(a4) entre comillas: la frase tal cual (el orden cuenta)', casa('"de la base"', 'migración de la base') && !casa('"base la de"', 'migración de la base'), '')
    check('(a5) comillas tipográficas y angulares también', consulta('“no subir”').frase && consulta('«no subir»').frase && casa('«no  subir»', 'Que no\nsubir a main'), '')
    check('(a6) --exacta sin comillas', consulta('no subir', true).frase && !casa('subir no', 'no subir', true), '')
    check('(a7) los blancos seguidos cuentan como uno', casa('"a b"', 'a \n\t b'), '')
    check('(a8) nada que buscar: null', analizarConsulta('   ') === null && analizarConsulta('""') === null, '')
    check('(a9) un carácter de expresión regular es texto', casa('a.c', 'a.c') && !casa('a.c', 'abc') && casa('(x)*', 'es (x)* aquí'), '')
    check('(a10) palabras repetidas cuentan una vez', j(consulta('base base').terminos) === j(['base']), j(consulta('base base')))
    check('(a11) la sigma griega, final o no, en mayúscula o minúscula, es la misma', casa('ΟΔΟΣ', 'ο δρόμος οδός') && casa('οδοσ', 'ΟΔΟΣ') && casa('ΟΔΟΣ', 'οδοσ') && normalizarBusqueda('ΟΔΟΣ') === normalizarBusqueda('οδος'), normalizarBusqueda('ΟΔΟΣ'))
  }

  hr('B - El trozo: alrededor de lo encontrado, en una línea y con su tope')
  {
    const corto = 'Hola,\nmigramos   la base.'
    check('(b1) un mensaje corto va entero, en una línea', trozoAlrededor(corto, consulta('base')) === 'Hola, migramos la base.', trozoAlrededor(corto, consulta('base')))
    const largo = `${'antes '.repeat(200)}AQUÍ está la migración${' después'.repeat(200)}`
    const t = trozoAlrededor(largo, consulta('migracion'))
    check('(b2) un mensaje largo: el trozo tiene lo encontrado, «…» a los dos lados y su tope', t.includes('migración') && t.startsWith('…') && t.endsWith('…') && t.length <= ANCHO_TROZO + 2, `${t.length} ${t.slice(0, 40)}`)
    const palabras = t.slice(1, -1).split(' ')
    check('(b3) no parte palabras', ['antes', 'AQUÍ'].includes(palabras[0]) && ['después', 'migración'].includes(palabras[palabras.length - 1]), `${palabras[0]} … ${palabras[palabras.length - 1]}`)
    const alFinal = `${'x '.repeat(400)}fin con clave`
    const tf = trozoAlrededor(alFinal, consulta('clave'))
    check('(b4) cerca del final: llega hasta el final sin «…» detrás', tf.endsWith('clave') && tf.startsWith('…'), tf.slice(-20))
    const emojis = `${'😀'.repeat(400)} clave`
    const te = trozoAlrededor(emojis, consulta('clave'))
    check('(b5) no parte un emoji en dos', !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(te), `${te.length}`)
    const tilde = `${'z '.repeat(300)}ÁRBOL grande${' w'.repeat(300)}`
    check('(b6) con tildes, el trozo se centra en el original', trozoAlrededor(tilde, consulta('arbol')).includes('ÁRBOL grande'), '')
    const griego = `${'z '.repeat(300)}ΟΔΟΣ del pueblo${' w'.repeat(300)}`
    check('(b7) con la sigma final, el trozo tiene lo encontrado (no sale del principio)', trozoAlrededor(griego, consulta('ΟΔΟΣ')).includes('ΟΔΟΣ del pueblo'), trozoAlrededor(griego, consulta('ΟΔΟΣ')).slice(0, 40))
  }

  hr('C - La lectura por líneas: imágenes, líneas enormes, .zst y topes')
  {
    const dir = temporal('tessera-historial-lineas-')
    const imagen = 'A'.repeat(3 * 1024 * 1024)
    const conImagen = path.join(dir, 'imagen.jsonl')
    escribir(conImagen, [
      { type: 'user', message: { content: [{ type: 'image', source: { data: imagen } }, { type: 'text', text: 'mira la captura del botón' }] } },
      { type: 'user', message: { content: 'texto '.repeat(900_000) + ' enorme' } },
      { type: 'assistant', message: { content: 'después de la enorme' } },
      '{"type":"user","message":{"content":"a medio escribir'
    ], new Date())
    const vistas: string[] = []
    const p = { bytes: 64 * 1024 * 1024, limite: Date.now() + 60_000, ahora: Date.now }
    const fin = await recorrerLineas(conImagen, p, (l) => {
      vistas.push(JSON.stringify(l).slice(-60))
    })
    check('(c1) la línea con imagen en base64 se lee (compactada) con su texto', vistas.some((v) => v.includes('captura del botón')), vistas.join(' | ').slice(0, 120))
    check('(c2) una línea de texto enorme se salta y lo de detrás sigue', !vistas.some((v) => v.includes('texto texto')) && vistas.some((v) => v.includes('después de la enorme')), `${vistas.length} líneas`)
    check('(c3) la última a medio escribir no rompe nada; termina en «fin»', fin === 'fin' && vistas.length === 2, fin)
    const zst = path.join(dir, 'rollout.jsonl.zst')
    escribir(zst, [{ type: 'event_msg', payload: { type: 'user_message', message: 'comprimido con ñ' } }], new Date())
    const deComprimido: string[] = []
    await recorrerLineas(zst, { bytes: 1024 * 1024, limite: Date.now() + 60_000, ahora: Date.now }, (l) => {
      deComprimido.push(JSON.stringify(l))
    })
    check('(c4) un .zst se descomprime al vuelo', deComprimido.length === 1 && deComprimido[0].includes('comprimido con ñ'), deComprimido.join(''))
    const pBytes = { bytes: 100, limite: Date.now() + 60_000, ahora: Date.now }
    const cortado = await recorrerLineas(conImagen, pBytes, () => {})
    check('(c5) sin bytes de presupuesto: «bytes» y el presupuesto a cero', cortado === 'bytes' && pBytes.bytes === 0, `${cortado} ${pBytes.bytes}`)
    const tarde = await recorrerLineas(conImagen, { bytes: 1e9, limite: 0, ahora: Date.now }, () => {})
    check('(c6) pasada la hora: «tiempo» sin leer', tarde === 'tiempo', tarde)
  }

  hr('D - La búsqueda sobre transcripts falsos: solo texto, el proyecto, las más recientes y los topes')
  const raiz = temporal('tessera-historial-')
  const PROYECTO = path.join(raiz, 'trabajo', 'web')
  const OTRO = path.join(raiz, 'trabajo', 'otro')
  const nativaClaude = path.join(raiz, 'nativa', '.claude')
  const nativaCodex = path.join(raiz, 'nativa', '.codex')
  const cuentaA = path.join(raiz, 'perfiles', 'pa', 'claude-cuentas', 'A')
  const cuentaB = path.join(raiz, 'perfiles', 'pa', 'codex-cuentas', 'B')
  const slug = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-')
  const dia = (base: string, id: string, n: number): string => path.join(base, 'sessions', '2026', '10', '01', `rollout-2026-10-01T10-0${n}-00-${id}.jsonl`)
  {
    escribir(path.join(nativaClaude, 'projects', slug(PROYECTO), `${uuid(1)}.jsonl`), claude(PROYECTO, uuid(1), [
      ['u', 'Decidimos no subir a main sin revisión'],
      ['a', 'Entendido: la migración de la base va en una rama aparte']
    ], [{ type: 'user', timestamp: ts(5), message: { content: [{ type: 'tool_result', content: 'resultado de herramienta: migración' }] } }]), new Date(Date.UTC(2026, 9, 1, 12)))
    escribir(path.join(nativaClaude, 'projects', slug(OTRO), `${uuid(2)}.jsonl`), claude(OTRO, uuid(2), [['u', 'migración del otro proyecto']]), new Date(Date.UTC(2026, 9, 1, 13)))
    escribir(dia(nativaCodex, uuid(3), 1), codex(PROYECTO, uuid(3), [['u', 'repasa la MIGRACION'], ['a', 'La migración está lista']]), new Date(Date.UTC(2026, 9, 1, 11)))
    escribir(`${dia(nativaCodex, uuid(4), 2)}.zst`, codex(PROYECTO, uuid(4), [['u', 'migración antigua comprimida']]), new Date(Date.UTC(2026, 8, 1)))
    escribir(path.join(cuentaA, 'projects', '-workspace-web', `${uuid(5)}.jsonl`), claude('/workspace/web', uuid(5), [['u', 'migración desde la cuenta A en Docker']]), new Date(Date.UTC(2026, 9, 1, 9)))
    escribir(dia(cuentaB, uuid(6), 3), codex('/workspace/web', uuid(6), [['a', 'migración desde la cuenta B']]), new Date(Date.UTC(2026, 9, 1, 8)))
  }
  const fuentesNativas: FuenteHistorial[] = [
    { agente: 'claude-code', base: nativaClaude, cuenta: null },
    { agente: 'codex', base: nativaCodex, cuenta: null },
    { agente: 'claude-code', base: cuentaA, cuenta: 'Trabajo' },
    { agente: 'codex', base: cuentaB, cuenta: 'Personal' }
  ]
  const lector = new LectorConversaciones()
  const deps = { resumenDe: (a: string, ag: 'claude-code' | 'codex') => lector.resumenDe(a, ag), ahora: Date.now }
  function topes(extra: Partial<TopesBusqueda> = {}): TopesBusqueda {
    return { ...TOPES_DEFECTO, max: 20, ...extra }
  }
  {
    const r = await buscarEnHistorial(fuentesNativas, PROYECTO, consulta('migracion'), topes(), deps)
    const trozos = r.coincidencias.map((c) => c.trozo)
    check('(d1) las del proyecto en todas las bases, también la comprimida y las de Docker', r.coincidencias.length === 6 && trozos.some((t) => t.includes('comprimida')) && trozos.some((t) => t.includes('cuenta A')) && trozos.some((t) => t.includes('cuenta B')), j(trozos))
    check('(d2) nunca las de otro proyecto', !trozos.some((t) => t.includes('otro proyecto')), '')
    check('(d3) ni herramientas, ni sus resultados, ni el razonamiento', !trozos.some((t) => /herramienta|secreto/.test(t)), '')
    const fechas = r.coincidencias.map((c) => c.fecha)
    check('(d4) las más recientes primero', fechas.every((f, i) => i === 0 || fechas[i - 1] >= f), j(fechas))
    const deA = r.coincidencias.find((c) => c.trozo.includes('cuenta A'))
    check('(d5) cada una con agente, cuenta, rol y el título del panel', deA?.agente === 'claude-code' && deA.cuenta === 'Trabajo' && deA.rol === 'usuario' && deA.titulo === 'Título 05' && r.coincidencias.find((c) => c.trozo.includes('está lista'))?.rol === 'agente' && r.coincidencias.find((c) => c.trozo.includes('lista'))?.cuenta === null, j(deA))
    check('(d6) sin más ni corte', r.hayMas === false && r.corte === null, j({ hayMas: r.hayMas, corte: r.corte }))
    const conMax = await buscarEnHistorial(fuentesNativas, PROYECTO, consulta('migracion'), topes({ max: 2 }), deps)
    check('(d7) con --max 2: dos, y dice que hay más', conMax.coincidencias.length === 2 && conMax.hayMas === true, `${conMax.coincidencias.length} hayMas=${conMax.hayMas}`)
    const frase = await buscarEnHistorial(fuentesNativas, PROYECTO, consulta('"no subir a main"'), topes(), deps)
    check('(d8) la frase exacta', frase.coincidencias.length === 1 && frase.coincidencias[0].titulo === 'Título 01', j(frase.coincidencias.map((c) => c.trozo)))
    const propio = await buscarEnHistorial(fuentesNativas, PROYECTO, consulta('no subir'), topes(), { ...deps, tituloPropio: (_a, id) => (id === uuid(1) ? 'Mi nombre' : undefined) })
    check('(d9) el nombre propio de la conversación, como el panel', propio.coincidencias[0]?.titulo === 'Mi nombre', j(propio.coincidencias[0]))
    const porBytes = await buscarEnHistorial(fuentesNativas, PROYECTO, consulta('migracion'), topes({ bytes: 300 }), deps)
    check('(d10) con el tope de bytes: lo dice', porBytes.corte === 'bytes', j({ n: porBytes.coincidencias.length, corte: porBytes.corte }))
    const porArchivos = await buscarEnHistorial(fuentesNativas, PROYECTO, consulta('migracion'), topes({ archivos: 1 }), deps)
    check('(d11) con el tope de archivos: solo la conversación más reciente, y lo dice', porArchivos.corte === 'archivos' && porArchivos.coincidencias.length === 1, j({ n: porArchivos.coincidencias.length, corte: porArchivos.corte }))
    const porTiempo = await buscarEnHistorial(fuentesNativas, PROYECTO, consulta('migracion'), topes({ ms: 0 }), deps)
    check('(d12) con el tope de tiempo: lo dice', porTiempo.corte === 'tiempo' && porTiempo.coincidencias.length === 0, j(porTiempo))
    const soloA = await buscarEnHistorial(fuentesNativas.slice(2, 3), PROYECTO, consulta('migracion'), topes(), deps)
    check('(d13) con solo la base de una cuenta: solo lo suyo', soloA.coincidencias.length === 1 && soloA.coincidencias[0].cuenta === 'Trabajo', j(soloA.coincidencias.map((c) => c.cuenta)))
    const repetida = await buscarEnHistorial([...fuentesNativas, fuentesNativas[0]], PROYECTO, consulta('migracion'), topes(), deps)
    check('(d14) una base repetida no duplica', repetida.coincidencias.length === 6, `${repetida.coincidencias.length}`)

    // Un archivo escrito hoy con mensajes de hace meses, y otro de ayer con uno de ayer.
    const baseRec = path.join(raiz, 'recientes', '.claude')
    const lineaUsuario = (id: string, cuando: string, texto: string): unknown => ({ type: 'user', timestamp: cuando, cwd: PROYECTO, sessionId: id, message: { role: 'user', content: texto } })
    escribir(path.join(baseRec, 'projects', slug(PROYECTO), `${uuid(11)}.jsonl`), [
      lineaUsuario(uuid(11), '2026-05-01T10:00:00.000Z', 'ruta vieja uno'),
      lineaUsuario(uuid(11), '2026-05-02T10:00:00.000Z', 'ruta vieja dos'),
      lineaUsuario(uuid(11), '2026-05-03T10:00:00.000Z', 'ruta vieja tres')
    ], new Date(Date.UTC(2026, 9, 20)))
    escribir(path.join(baseRec, 'projects', slug(PROYECTO), `${uuid(12)}.jsonl`), [lineaUsuario(uuid(12), '2026-10-18T10:00:00.000Z', 'ruta nueva de ayer')], new Date(Date.UTC(2026, 9, 19)))
    const fuenteRec: FuenteHistorial[] = [{ agente: 'claude-code', base: baseRec, cuenta: null }]
    const uno = await buscarEnHistorial(fuenteRec, PROYECTO, consulta('ruta'), topes({ max: 1 }), deps)
    check('(d15) con --max 1, la del mensaje más reciente aunque su archivo sea más viejo, y hay más', uno.coincidencias.length === 1 && uno.coincidencias[0].trozo === 'ruta nueva de ayer' && uno.hayMas === true && uno.corte === null, j(uno.coincidencias.map((c) => c.trozo)))
    const dos = await buscarEnHistorial(fuenteRec, PROYECTO, consulta('ruta'), topes({ max: 2 }), deps)
    check('(d16) con --max 2: la nueva y la más reciente de las viejas, por fecha del mensaje', j(dos.coincidencias.map((c) => c.trozo)) === j(['ruta nueva de ayer', 'ruta vieja tres']) && dos.hayMas === true, j(dos.coincidencias.map((c) => c.trozo)))
    const todasRec = await buscarEnHistorial(fuenteRec, PROYECTO, consulta('ruta'), topes({ max: 4 }), deps)
    check('(d17) si caben todas: sin «hay más»', todasRec.coincidencias.length === 4 && todasRec.hayMas === false, `${todasRec.coincidencias.length} hayMas=${todasRec.hayMas}`)
    const baseAjena = path.join(raiz, 'ajena', '.claude')
    escribir(path.join(baseAjena, 'projects', slug(OTRO), `${uuid(13)}.jsonl`), [lineaUsuario(uuid(13), '2026-10-01T10:00:00.000Z', 'ruta de otro proyecto')], new Date(Date.UTC(2026, 9, 1)))
    let resumidos = 0
    const sinCarpeta = await buscarEnHistorial([{ agente: 'claude-code', base: baseAjena, cuenta: null }], PROYECTO, consulta('ruta'), topes(), {
      ...deps,
      resumenDe: (a, ag) => {
        resumidos++
        return lector.resumenDe(a, ag)
      }
    })
    check('(d18) NEGATIVO: una base sin carpeta de este proyecto no lee las de los demás', sinCarpeta.coincidencias.length === 0 && resumidos === 0, `${sinCarpeta.coincidencias.length} resumidos=${resumidos}`)
    check('(d19) la fecha local acompaña a cada coincidencia', r.coincidencias.every((c) => c.fechaLocal === fechaLocalDe(c.fecha)), j(r.coincidencias[0]))
    const tzAntes = process.env.TZ
    process.env.TZ = 'America/Mexico_City'
    const enMexico = fechaLocalDe(Date.UTC(2026, 9, 1, 10, 0))
    process.env.TZ = 'Asia/Tokyo'
    const enTokio = fechaLocalDe(Date.UTC(2026, 9, 1, 10, 0))
    if (tzAntes === undefined) delete process.env.TZ
    else process.env.TZ = tzAntes
    check('(d20) la fecha se escribe en la hora del equipo (zona del proceso), sin segundos', enMexico === '2026-10-01 04:00' && enTokio === '2026-10-01 19:00', `${enMexico} ${enTokio}`)
  }

  hr('E - El alcance: nativa ve todas las cuentas del perfil; Docker, solo la suya; nunca otro perfil')
  {
    const cuentas: Record<string, { profileId: string; agente: string; nombre: string }> = {
      A: { profileId: 'pa', agente: 'claude-code', nombre: 'Trabajo' },
      B: { profileId: 'pa', agente: 'codex', nombre: 'Personal' },
      Z: { profileId: 'pz', agente: 'claude-code', nombre: 'Ajena' }
    }
    const d: Pick<DependenciasOperacionBuscar, 'cuentasDelPerfil' | 'cuenta' | 'baseDe'> = {
      cuentasDelPerfil: (pid, ag) => Object.entries(cuentas).filter(([, c]) => c.profileId === pid && c.agente === ag).map(([id, c]) => ({ id, nombre: c.nombre })),
      cuenta: (id) => cuentas[id] ?? null,
      baseDe: (ag, id, host) => (host ? `nativa-${ag}` : cuentas[id] ? `base-${id}` : null)
    }
    const bases = (a: ReturnType<typeof alcanceDe>): string => a.fuentes.map((f) => `${f.base}:${f.cuenta ?? 'nativa'}`).join(',')
    const nativa = alcanceDe('pa', { profileId: 'pa', agente: 'codex', accountId: '', host: true }, d)
    check('(e1) nativa: las dos del sistema y todas las cuentas de Docker del perfil', bases(nativa) === 'nativa-claude-code:nativa,base-A:Trabajo,nativa-codex:nativa,base-B:Personal' && nativa.soloSuCuenta === null, bases(nativa))
    check('(e2) la terminal (no es un agente): como nativa', bases(alcanceDe('pa', null, d)) === bases(nativa), '')
    const docker = alcanceDe('pa', { profileId: 'pa', agente: 'claude-code', accountId: 'A', host: false }, d)
    check('(e3) Docker: solo su cuenta, y lo dice', bases(docker) === 'base-A:Trabajo' && j(docker.soloSuCuenta) === j({ agente: 'claude-code', cuenta: 'Trabajo' }), bases(docker))
    check('(e4) Docker con la cuenta de otro perfil: nada', alcanceDe('pa', { profileId: 'pa', agente: 'claude-code', accountId: 'Z', host: false }, d).fuentes.length === 0, '')
    check('(e5) Docker con una cuenta de otro agente: nada', alcanceDe('pa', { profileId: 'pa', agente: 'claude-code', accountId: 'B', host: false }, d).fuentes.length === 0, '')
    check('(e6) un agente manual en Docker: nada', alcanceDe('pa', { profileId: 'pa', agente: 'mi-agente', accountId: 'A', host: false }, d).fuentes.length === 0, '')
    check('(e7) nativa nunca lista cuentas de otro perfil', !bases(alcanceDe('pa', null, d)).includes('base-Z'), '')
  }

  hr('F - La operación: perfil, proyecto y quién pregunta salen del token, no de la petición')
  {
    const puente = new PuenteBd({ conexionesDelPerfil: () => [], secretoDe: () => null, log: () => {} })
    const op = new OperacionBuscarHistorial()
    puente.registrarOperacion(OP_BUSCAR, { token: 'sesion', manejar: (p, s) => op.atender(p, s) })
    const sinConectar = await op.atender({ texto: 'x' }, { profileId: 'pa', projectHostPath: PROYECTO, espacioDatos: false, sesion: 'term-1' })
    check('(f1) sin conectar aún: error interno', sinConectar.error === 'error interno', j(sinConectar))
    const llamadas: Array<{ fuentes: readonly FuenteHistorial[]; proyecto: string; max: number }> = []
    const retenidas: Array<() => void> = []
    let retener = false
    const sesiones: Record<string, { profileId: string; agente: string; accountId: string; host: boolean }> = {
      nat: { profileId: 'pa', agente: 'claude-code', accountId: '', host: true },
      dock: { profileId: 'pa', agente: 'codex', accountId: 'B', host: false },
      ajena: { profileId: 'pz', agente: 'claude-code', accountId: '', host: true }
    }
    op.conectar({
      sesionAgente: (id) => sesiones[id] ?? null,
      cuentasDelPerfil: (pid, ag) => (pid === 'pa' && ag === 'codex' ? [{ id: 'B', nombre: 'Personal' }] : []),
      cuenta: (id) => (id === 'B' ? { profileId: 'pa', agente: 'codex', nombre: 'Personal' } : null),
      baseDe: (ag, id, host) => (host ? `nativa-${ag}` : id === 'B' ? cuentaB : null),
      buscar: async (fuentes, proyecto, _c, max) => {
        llamadas.push({ fuentes, proyecto, max })
        if (retener) await new Promise<void>((r) => retenidas.push(r))
        return { coincidencias: [], hayMas: false, corte: null }
      }
    })
    const token = (sesion: string | null, perfil = 'pa'): string => {
      const t = puente.emitir(perfil, PROYECTO)
      if (sesion) puente.bind(t, sesion)
      return t
    }
    const pedir = async (t: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
      (await puente.resolver({ v: 1, token: t, op: OP_BUSCAR, texto: 'migración', ...extra })) as Record<string, unknown>
    const r1 = puente.resolver({ v: 1, token: token('agent:nat'), op: OP_BUSCAR, texto: 'x' })
    check('(f2) por el puente, la operación de sesión contesta con una promesa', r1 instanceof Promise, typeof r1)
    await r1
    const nativo = await pedir(token('agent:nat'), { profileId: 'pz', projectHostPath: OTRO, cuenta: 'Z', sesion: 'agent:dock' })
    check('(f3) nativa: todas las bases del perfil, con el proyecto del token aunque la petición diga otro', nativo.ok === true && llamadas.at(-1)?.proyecto === PROYECTO && llamadas.at(-1)?.fuentes.length === 3 && nativo.soloSuCuenta === null, j(llamadas.at(-1)))
    const dock = await pedir(token('agent:dock'))
    check('(f4) Docker: solo su cuenta, y la respuesta lo dice', dock.ok === true && llamadas.at(-1)?.fuentes.length === 1 && llamadas.at(-1)?.fuentes[0].base === cuentaB && j(dock.soloSuCuenta) === j({ agente: 'codex', cuenta: 'Personal' }), j(dock))
    const term = await pedir(token('term-1'))
    check('(f5) la terminal del proyecto: como nativa', term.ok === true && llamadas.at(-1)?.fuentes.length === 3, '')
    const sinAtar = await pedir(token(null))
    check('(f6) un token aún sin sesión: no busca', sinAtar.rechazo === 'sin-sesion', j(sinAtar))
    const ajena = await pedir(token('agent:ajena'))
    check('(f7) una sesión de agente de otro perfil que el del token: no busca', ajena.rechazo === 'sin-sesion', j(ajena))
    const muerta = await pedir(token('agent:cerrada'))
    check('(f8) una sesión de agente que ya no vive: no busca', muerta.rechazo === 'sin-sesion', j(muerta))
    const n = llamadas.length
    check('(f9) texto vacío, largo o de otro tipo: rechazos sin buscar', (await pedir(token('term-1'), { texto: '  ' })).rechazo === 'busqueda-vacia' &&
      (await pedir(token('term-1'), { texto: 'x'.repeat(MAX_TEXTO_BUSQUEDA + 1) })).rechazo === 'busqueda-larga' &&
      (await pedir(token('term-1'), { texto: 3 })).rechazo === 'peticion' &&
      (await pedir(token('term-1'), { max: 0 })).rechazo === 'peticion' && llamadas.length === n, `${llamadas.length - n}`)
    await pedir(token('term-1'), { max: 999 })
    check('(f10) --max: por defecto 8, y nunca más de 20', llamadas.at(-1)?.max === 20 && (await pedir(token('term-1')), llamadas.at(-1)?.max === 8), `${llamadas.at(-1)?.max}`)
    check('(f11) un token inventado: no autorizado', (await pedir('inventado')).error === 'no autorizado', '')
    retener = true
    const enVuelo = [pedir(token('term-1')), pedir(token('term-1'))]
    await new Promise((r) => setTimeout(r, 20))
    retener = false
    const tercera = await pedir(token('term-1'))
    check(`(f12) más de ${MAX_BUSQUEDAS_EN_CURSO} a la vez: «ocupado»`, tercera.rechazo === 'ocupado', j(tercera))
    for (const soltar of retenidas.splice(0)) soltar()
    await Promise.race([Promise.all(enVuelo), new Promise((r) => setTimeout(r, 2000))])
    const sesion: SesionDelPuente = { profileId: 'pa', projectHostPath: PROYECTO, espacioDatos: false, sesion: 'term-1' }
    const tras = await op.atender({ texto: 'x' }, sesion)
    check('(f13) acabadas, se puede volver a buscar', tras.ok === true, j(tras))
    check('(f14) la clave de sesión de agente se hace y se deshace con el mismo formato; la de la terminal no es de agente', idDeClaveSesionAgente(claveSesionAgente('s-1')) === 's-1' && idDeClaveSesionAgente('term-1') === null, claveSesionAgente('s-1'))
  }

  hr('G - El nombre de la cuenta predeterminada sale en el idioma de la app')
  {
    const defecto = { nombre: 'Predeterminada', isDefault: true }
    const propia = { nombre: 'Trabajo' }
    fijarIdioma('es')
    const enEs = nombreVisibleCuenta(defecto)
    fijarIdioma('en')
    const enEn = nombreVisibleCuenta(defecto)
    const propiaEn = nombreVisibleCuenta(propia)
    fijarIdioma('es')
    check('(g1) la predeterminada: «Predeterminada» en español y «Default» en inglés', enEs === 'Predeterminada' && enEn === 'Default', `${enEs} ${enEn}`)
    check('(g2) una creada conserva el nombre que le puso el usuario', propiaEn === 'Trabajo', propiaEn)
  }
} finally {
  for (const d of temporales) rmSync(d, { recursive: true, force: true })
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
