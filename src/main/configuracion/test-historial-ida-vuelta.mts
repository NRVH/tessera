// =============================================================================
// Ida y vuelta del historial en carpetas temporales: un equipo con dos cuentas de Docker y el historial nativo
// exporta con frase; otro, con el proyecto en otra ruta, una conversación más corta y otra distinta, importa.
// Qué llega y adónde, sin credenciales ni pisar nada (tampoco lo que un agente puede estar escribiendo), dos
// veces igual, nada fuera de la cuenta, sin temporales, un archivo que desaparece al exportar y dos proyectos
// de origen con el mismo nombre.
// Uso: node src/main/configuracion/test-historial-ida-vuelta.mts
// =============================================================================

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentAccount, CreateAccountRequest } from '../../shared/agent-accounts-ipc.ts'
import type { AgenteHistorial, ResumenHistorialImportado } from '../../shared/copia-configuracion-ipc.ts'
import { descifrarCopia, prepararCopia } from './cifradoFrase.ts'
import { leerContenido } from './contenido.ts'
import { txConfiguracion } from './textos.ts'
import { ImportadorHistorial, cuentasDelHistorial, escribirHistorial, recogerHistorial, type DepsHistorial } from './historialCopia.ts'
import { EscritorCopia, leerCabeceraCopia, leerTrozos, selloDe } from './trozosCopia.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

const TMP = mkdtempSync(path.join(os.tmpdir(), 'tessera-prueba-ida-vuelta-'))
const FRASE = 'una frase de prueba'
const SUB: Record<AgenteHistorial, string> = { 'claude-code': 'claude', codex: 'codex' }

function poner(base: string, rel: string, texto: string): void {
  const abs = path.join(base, ...rel.split('/'))
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, texto)
}
const leer = (base: string, rel: string): string | null => {
  const abs = path.join(base, ...rel.split('/'))
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null
}
function todos(dir: string, rel = ''): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? todos(path.join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]
  )
}

/** El registro de cuentas de un equipo, con las carpetas como las pone `AccountStore`. */
function registro(raiz: string, iniciales: AgentAccount[]) {
  const cuentas = [...iniciales]
  const creadas: string[] = []
  const rutaDe = (a: AgentAccount): string =>
    a.isDefault ? path.join(raiz, 'perfiles', a.profileId, SUB[a.agente as AgenteHistorial]) : path.join(raiz, 'perfiles', a.profileId, `${SUB[a.agente as AgenteHistorial]}-cuentas`, a.id)
  return {
    creadas,
    list: (perfil: string, agente: string) => cuentas.filter((a) => a.profileId === perfil && a.agente === agente),
    rutaDe,
    hostDirFor: (a: AgentAccount) => {
      mkdirSync(rutaDe(a), { recursive: true })
      return rutaDe(a)
    },
    defaultFor: (perfil: string, agente: string) => {
      let a = cuentas.find((x) => x.profileId === perfil && x.agente === agente && x.isDefault)
      if (!a) cuentas.push((a = { id: `default-${perfil}-${agente}`, nombre: 'Predeterminada', agente: agente as AgenteHistorial, profileId: perfil, isDefault: true }))
      return a
    },
    create: (req: CreateAccountRequest) => {
      const a: AgentAccount = { id: `nueva-${cuentas.length}`, nombre: req.nombre, agente: req.agente, profileId: req.profileId }
      cuentas.push(a)
      creadas.push(`${req.agente}:${req.nombre}`)
      return a
    }
  }
}

function equipo(raiz: string, cuentas: AgentAccount[], proyectos: Array<{ profileId: string; projectHostPath: string }>) {
  const r = registro(path.join(raiz, 'datos'), cuentas)
  const nativa = (agente: AgenteHistorial): string => path.join(raiz, 'home', agente === 'codex' ? '.codex' : '.claude')
  /** Las conversaciones en las que hay una sesión de agente abierta en este equipo. */
  const abiertas = new Set<string>()
  const deps: DepsHistorial = { ...cuentasDelHistorial(r as never), baseNativa: nativa, proyectos: () => proyectos, conversacionesAbiertas: () => abiertas }
  return { r, deps, nativa, abiertas, datos: path.join(raiz, 'datos') }
}

/** Un archivo como si nadie lo tocara desde hace una hora. */
function viejo(base: string, rel: string): void {
  const hace = new Date(Date.now() - 60 * 60_000)
  utimesSync(path.join(base, ...rel.split('/')), hace, hace)
}

const linea = (cwd: string, texto: string): string => `${JSON.stringify({ type: 'user', cwd, sessionId: 's', message: { content: texto } })}\n`
const RUTA_ORIGEN = 'C:\\origen\\tessera-demo'
const RUTA_AQUI = 'D:\\nuevo\\tessera-demo'
const SLUG_ORIGEN = 'C--origen-tessera-demo'
const SLUG_AQUI = 'D--nuevo-tessera-demo'
const S1 = linea(RUTA_ORIGEN, 'primero') + linea(RUTA_ORIGEN, 'segundo')

/** El equipo de origen: la predeterminada de Claude Code y «Trabajo» de Codex en el perfil, y lo nativo. */
function origen() {
  const e = equipo(path.join(TMP, 'a'), [
    { id: 'default-p1-claude-code', nombre: 'Predeterminada', agente: 'claude-code', profileId: 'p1', isDefault: true },
    { id: 'c-trabajo', nombre: 'Trabajo', agente: 'codex', profileId: 'p1' }
  ], [])
  const claude = path.join(e.datos, 'perfiles', 'p1', 'claude')
  poner(claude, '.credentials.json', '{"token":"secreto-claude"}')
  poner(claude, 'settings.json', '{}')
  poner(claude, 'file-history/s/x.jsonl', '{}\n')
  poner(claude, 'projects/-workspace-demo/d1.jsonl', linea('/workspace/demo', 'en docker'))
  poner(claude, 'projects/-workspace-demo/d1/subagents/agent-1.jsonl', linea('/workspace/demo', 'sub'))
  const codex = path.join(e.datos, 'perfiles', 'p1', 'codex-cuentas', 'c-trabajo')
  poner(codex, 'auth.json', '{"token":"secreto-codex"}')
  poner(codex, 'sessions/2026/01/02/rollout-2026-a.jsonl', '{"a":1}\n')
  poner(codex, 'sessions/2026/01/03/rollout-2026-b.jsonl', '{"b":"de origen"}\n')
  const nClaude = e.nativa('claude-code')
  poner(nClaude, '.credentials.json', '{"token":"secreto-nativo"}')
  poner(nClaude, `projects/${SLUG_ORIGEN}/s1.jsonl`, S1)
  poner(nClaude, `projects/${SLUG_ORIGEN}/s1/subagents/agent-2.jsonl`, linea(RUTA_ORIGEN, 'sub nativo'))
  poner(nClaude, 'projects/C--origen-nadie/s3.jsonl', linea('C:\\origen\\nadie', 'sin proyecto aquí'))
  poner(nClaude, `projects/${SLUG_ORIGEN}/s4.jsonl`, linea(RUTA_ORIGEN, 'versión de origen'))
  poner(e.nativa('codex'), 'auth.json', '{"token":"secreto-codex-nativo"}')
  poner(e.nativa('codex'), 'sessions/2026/02/01/rollout-2026-n.jsonl.zst', 'comprimido')
  return e
}

/** El equipo de destino: el proyecto en otra ruta, S1 a medias, S4 distinta y solo la predeterminada de Codex. */
function destino(nombre = 'b') {
  const e = equipo(path.join(TMP, nombre), [{ id: 'default-p1-codex', nombre: 'Predeterminada', agente: 'codex', profileId: 'p1', isDefault: true }], [
    { profileId: 'p1', projectHostPath: RUTA_AQUI }
  ])
  const nClaude = e.nativa('claude-code')
  poner(nClaude, `projects/${SLUG_AQUI}/s1.jsonl`, linea(RUTA_ORIGEN, 'primero'))
  viejo(nClaude, `projects/${SLUG_AQUI}/s1.jsonl`)
  poner(nClaude, `projects/${SLUG_AQUI}/s4.jsonl`, linea(RUTA_AQUI, 'otra cosa de aquí'))
  return e
}

/** Exporta como el IPC: devuelve cuántos archivos se saltaron. `antes` corre entre el listado y la escritura. */
async function exportar(deps: DepsHistorial, ruta: string, antes?: () => void): Promise<number> {
  const fuentes = await recogerHistorial(deps, ['p1'], true, true)
  const contenido = { perfiles: [], historial: { fuentes: fuentes.map((f) => f.fuente) } }
  const { archivo, clave } = await prepararCopia(JSON.stringify(contenido), FRASE, { plataforma: 'windows', app: '9.9.9' }, true)
  const e = await EscritorCopia.abrir(ruta, archivo, clave)
  antes?.()
  const saltados = await escribirHistorial(e, fuentes)
  await e.cerrar()
  return saltados
}

/** Lo mismo que el IPC de importar con todo el historial elegido. */
async function importar(deps: DepsHistorial, ruta: string): Promise<ResumenHistorialImportado> {
  const leido = await leerCabeceraCopia(ruta)
  if (!leido.ok || leido.hash === null) throw new Error(leido.ok ? 'versión 1' : leido.error)
  const d = await descifrarCopia(leido.archivo, FRASE)
  if (!d.ok) throw new Error(d.error)
  const c = leerContenido(d.contenido)
  const imp = new ImportadorHistorial(deps)
  const fuentes = c?.contenido.historial?.fuentes ?? []
  imp.preparar(fuentes)
  try {
    const sello = selloDe(leido.hash, d.clave, leido.archivo.cifrado?.sal ?? null)
    for await (const t of leerTrozos(ruta, leido.hash, sello, new Set(fuentes.map((f) => f.id)))) await imp.trozo(t)
    return imp.cerrar(null)
  } catch (err) {
    await imp.soltar()
    return imp.cerrar(String(err))
  }
}

async function idaYVuelta(): Promise<void> {
  hr('(1) Exportar dos cuentas de Docker y lo nativo; importar en otro equipo')
  const a = origen()
  const b = destino()
  const copia = path.join(TMP, 'copia.tessera')
  await exportar(a.deps, copia)
  const texto = readFileSync(copia, 'utf8')
  check('ningún secreto ni conversación en claro en el archivo', !/secreto|primero|en docker/.test(texto), `${texto.length} bytes`)
  const r = await importar(b.deps, copia)
  console.log(JSON.stringify(r, null, 1))
  const nClaude = b.nativa('claude-code')
  check('la conversación del proyecto va bajo la carpeta de la ruta de aquí, puesta al día', leer(nClaude, `projects/${SLUG_AQUI}/s1.jsonl`) === S1, String(leer(nClaude, `projects/${SLUG_AQUI}/s1.jsonl`)))
  check('y su subagente con ella', leer(nClaude, `projects/${SLUG_AQUI}/s1/subagents/agent-2.jsonl`) !== null, '')
  check('NEGATIVO: no se dejó también bajo la ruta de origen', !existsSync(path.join(nClaude, 'projects', SLUG_ORIGEN)), '')
  check('la distinta de aquí se conserva intacta', leer(nClaude, `projects/${SLUG_AQUI}/s4.jsonl`) === linea(RUTA_AQUI, 'otra cosa de aquí'), '')
  check('la de un proyecto que aquí no está se queda con su ruta', leer(nClaude, 'projects/C--origen-nadie/s3.jsonl') !== null, '')
  check('el historial nativo de Codex llega a la carpeta nativa', leer(b.nativa('codex'), 'sessions/2026/02/01/rollout-2026-n.jsonl.zst') === 'comprimido', '')
  const docker = path.join(b.datos, 'perfiles', 'p1', 'claude')
  check('la predeterminada de Claude Code del perfil recibe lo de Docker, ruta del contenedor intacta', leer(docker, 'projects/-workspace-demo/d1.jsonl') !== null && leer(docker, 'projects/-workspace-demo/d1/subagents/agent-1.jsonl') !== null, todos(docker).join(', '))
  check('la cuenta «Trabajo» de Codex se crea (sin sesión)', JSON.stringify(b.r.creadas) === JSON.stringify(['codex:Trabajo']), b.r.creadas.join(', '))
  const trabajo = path.join(b.datos, 'perfiles', 'p1', 'codex-cuentas')
  const enTrabajo = todos(trabajo)
  check('y recibe sus dos rollouts y nada más', enTrabajo.length === 2 && enTrabajo.every((x) => /rollout-2026-[ab]\.jsonl$/.test(x)), enTrabajo.join(', '))
  const todoB = todos(path.join(TMP, 'b'))
  check('NEGATIVO: ninguna credencial, ajuste ni instantánea viajó', !todoB.some((x) => /credentials|auth\.json|settings|file-history/.test(x)), todoB.join(', '))
  check('NEGATIVO: ningún temporal a medias', !todoB.some((x) => /tessera-importando/.test(x)), '')
  check('resumen: nuevas, al día, conservadas y ruta cambiada',
    r.importadas === 5 && r.actualizadas === 1 && r.alDia === 0 && r.conservadas.length === 1 && r.rutaCambiada === 1 && r.error === null,
    `importadas ${r.importadas}, actualizadas ${r.actualizadas}, conservadas ${r.conservadas.length}, rutaCambiada ${r.rutaCambiada}`)
  check('resumen: la carpeta sin proyecto se cuenta con su motivo', r.rutaOriginal.length === 1 && r.rutaOriginal[0].carpeta === 'C--origen-nadie' && r.rutaOriginal[0].conversaciones === 1, JSON.stringify(r.rutaOriginal))
  const otra = await importar(b.deps, copia)
  check('importar otra vez no cambia nada: todo al día', otra.importadas === 0 && otra.actualizadas === 0 && otra.alDia === 6 && otra.conservadas.length === 1 && b.r.creadas.length === 1,
    `alDia ${otra.alDia}, importadas ${otra.importadas}, cuentas creadas ${b.r.creadas.length}`)
}

async function malicioso(): Promise<void> {
  hr('(2) Una copia con rutas malas y un enlace en el destino no escribe fuera de la cuenta')
  const b = equipo(path.join(TMP, 'c'), [], [])
  const fuera = path.join(TMP, 'c', 'fuera')
  mkdirSync(fuera, { recursive: true })
  const cuenta = path.join(b.datos, 'perfiles', 'p1', 'claude')
  mkdirSync(path.join(cuenta, 'projects'), { recursive: true })
  const conEnlace = (() => {
    try {
      symlinkSync(fuera, path.join(cuenta, 'projects', '-enlazado'), 'junction')
      return true
    } catch {
      return false
    }
  })()
  const origenMalo = path.join(TMP, 'malo.jsonl')
  writeFileSync(origenMalo, '{"x":1}\n')
  const fuente = { id: 0, agente: 'claude-code' as const, perfil: 'p1', cuenta: 'Predeterminada', predeterminada: true, conversaciones: 1, bytes: 8 }
  // Un perfil cuyo id sube de carpeta: su cuenta quedaría fuera de los datos.
  const sube = { ...fuente, id: 1, perfil: '..' }
  const { archivo, clave } = await prepararCopia(JSON.stringify({ perfiles: [], historial: { fuentes: [fuente, sube] } }), FRASE, { plataforma: 'windows', app: '9.9.9' }, true)
  const copia = path.join(TMP, 'mala.tessera')
  const e = await EscritorCopia.abrir(copia, archivo, clave)
  for (const rel of ['.credentials.json', 'settings.json', 'projects/../.credentials.json', '../../fuera/x.jsonl', 'projects/-enlazado/s.jsonl', 'projects/-bien/s.jsonl']) {
    await e.archivo(0, rel, origenMalo, 8)
  }
  await e.archivo(1, 'projects/-subido/s.jsonl', origenMalo, 8)
  await e.cerrar()
  const r = await importar(b.deps, copia)
  check('solo entra la buena', r.importadas === 1 && leer(cuenta, 'projects/-bien/s.jsonl') !== null, JSON.stringify(r.saltadas.map((s) => s.ruta)))
  check('NEGATIVO: lo demás se salta con su motivo (también el perfil que sube)', r.saltadas.length === (conEnlace ? 6 : 5), r.saltadas.map((s) => `${s.ruta}: ${s.motivo}`).join(' | '))
  check(`NEGATIVO: nada fuera de la cuenta${conEnlace ? ', tampoco por el enlace' : ' (sin permiso para crear el enlace)'}`, todos(fuera).length === 0 && !existsSync(path.join(cuenta, '.credentials.json')) && !existsSync(path.join(b.datos, '.credentials.json')), todos(fuera).join(', '))
  check('NEGATIVO: el perfil que sube no escribe nada', JSON.stringify(todos(path.join(TMP, 'c'))).indexOf('subido') === -1, '')
}

async function abierta(): Promise<void> {
  hr('(3) Una conversación que un agente puede estar escribiendo aquí no se sustituye')
  const copia = path.join(TMP, 'copia-abierta.tessera')
  await exportar(origen().deps, copia)
  const rel = `projects/${SLUG_AQUI}/s1.jsonl`
  const antes = linea(RUTA_ORIGEN, 'primero')
  const reciente = destino('d1')
  const ahora = new Date()
  utimesSync(path.join(reciente.nativa('claude-code'), ...rel.split('/')), ahora, ahora)
  const r1 = await importar(reciente.deps, copia)
  check('tocada hace un momento (un CLI fuera de Tessera): se conserva la de aquí, intacta',
    leer(reciente.nativa('claude-code'), rel) === antes && r1.actualizadas === 0 && r1.conservadas.some((c) => c.ruta === rel && c.motivo === txConfiguracion().historial.abierta),
    JSON.stringify(r1.conservadas))
  const conSesion = destino('d2')
  conSesion.abiertas.add('s1')
  const r2 = await importar(conSesion.deps, copia)
  check('con una sesión de Tessera en ella (aunque lleve rato sin escribir): se conserva',
    leer(conSesion.nativa('claude-code'), rel) === antes && r2.actualizadas === 0 && r2.conservadas.some((c) => c.ruta === rel && c.motivo === txConfiguracion().historial.abierta),
    JSON.stringify(r2.conservadas))
  const libre = destino('d3')
  const r3 = await importar(libre.deps, copia)
  check('sin nadie en ella: se pone al día', leer(libre.nativa('claude-code'), rel) === S1 && r3.actualizadas === 1, `actualizadas ${r3.actualizadas}`)
}

async function temporal(): Promise<void> {
  hr('(4) Si poner en su sitio falla, el temporal no se queda')
  const copia = path.join(TMP, 'copia-temporal.tessera')
  await exportar(origen().deps, copia)
  const b = destino('t1')
  const ocupado = path.join(b.nativa('claude-code'), 'projects', 'C--origen-nadie', 's3.jsonl')
  mkdirSync(ocupado, { recursive: true })
  viejo(b.nativa('claude-code'), 'projects/C--origen-nadie/s3.jsonl')
  const r = await importar(b.deps, copia)
  const restos = todos(path.join(TMP, 't1')).filter((x) => /tessera-importando/.test(x))
  check('NEGATIVO: ningún .tessera-importando tras el fallo', restos.length === 0, restos.join(', ') || 'ninguno')
  check('y el archivo se cuenta como saltado, sin cortar el resto', r.saltadas.some((s) => s.ruta === 'projects/C--origen-nadie/s3.jsonl') && r.importadas > 0, JSON.stringify(r.saltadas))
}

async function desaparece(): Promise<void> {
  hr('(5) Un archivo que desaparece mientras se exporta se salta; el resto sigue')
  const a = origen()
  // Uno comprimido: no pasa por buscar su última línea, se abre directamente al escribirlo.
  const comprimido = path.join(a.nativa('codex'), 'sessions', '2026', '02', '01', 'rollout-2026-n.jsonl.zst')
  const plano = path.join(a.datos, 'perfiles', 'p1', 'codex-cuentas', 'c-trabajo', 'sessions', '2026', '01', '03', 'rollout-2026-b.jsonl')
  const copia = path.join(TMP, 'copia-desaparece.tessera')
  const saltados = await exportar(a.deps, copia, () => {
    rmSync(comprimido)
    rmSync(plano)
  })
  check('la copia se escribe y cuenta los dos saltados', saltados === 2 && existsSync(copia), `saltados ${saltados}`)
  const b = destino('x1')
  const r = await importar(b.deps, copia)
  const enTrabajo = todos(path.join(b.datos, 'perfiles', 'p1', 'codex-cuentas'))
  check('y se importa sin ellos', r.error === null && enTrabajo.length === 1 && enTrabajo[0].endsWith('rollout-2026-a.jsonl') && todos(b.nativa('codex')).length === 0,
    `${enTrabajo.join(', ')} | nativa: ${todos(b.nativa('codex')).join(', ')}`)
}

async function mismoNombre(): Promise<void> {
  hr('(6) Dos proyectos del otro equipo con el mismo nombre no se mezclan en el de aquí')
  const o = equipo(path.join(TMP, 'o2'), [], [])
  poner(o.nativa('claude-code'), 'projects/D--a-app/x.jsonl', linea('D:\\a\\app', 'uno'))
  poner(o.nativa('claude-code'), 'projects/D--b-app/y.jsonl', linea('D:\\b\\app', 'otro'))
  const copia = path.join(TMP, 'copia-mismo-nombre.tessera')
  await exportar(o.deps, copia)
  const b = equipo(path.join(TMP, 'm1'), [], [{ profileId: 'p1', projectHostPath: 'E:\\aqui\\app' }])
  const r = await importar(b.deps, copia)
  const n = b.nativa('claude-code')
  check('ninguno se reasigna: cada uno con su ruta de origen',
    leer(n, 'projects/D--a-app/x.jsonl') !== null && leer(n, 'projects/D--b-app/y.jsonl') !== null && !existsSync(path.join(n, 'projects', 'E--aqui-app')) && r.rutaCambiada === 0,
    todos(n).join(', '))
  check('y se dice por qué', r.rutaOriginal.length === 2 && r.rutaOriginal.every((x) => x.motivo === txConfiguracion().historial.variosOrigen('app')), JSON.stringify(r.rutaOriginal))
}

try {
  await idaYVuelta()
  await malicioso()
  await abierta()
  await temporal()
  await desaparece()
  await mismoNombre()
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

const pasan = resultados.filter((r) => r.pasa).length
console.log(`\nVEREDICTO: ${pasan}/${resultados.length} PASS`)
process.exit(pasan === resultados.length ? 0 : 1)
