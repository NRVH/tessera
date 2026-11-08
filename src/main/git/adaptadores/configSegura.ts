// =============================================================================
// Lo que un repo no puede hacer que git ejecute en el host: el `.git/config` del proyecto (y su `config.worktree`)
// lo puede escribir el contenedor del agente, y git ejecuta programas definidos ahí (fsmonitor, filtros, drivers de
// diff y de merge, la firma). Antes de cada git del main se leen las claves de los ámbitos del repo que ejecutan
// algo y se anulan por el entorno (`GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`, que manda sobre el repo y no parte la clave
// en un `=` como `-c`) con el valor del ámbito global o del sistema, que el contenedor no alcanza, o con uno inocuo.
// `textconv` y el diff externo se apagan además con banderas. Los hooks se autorizan por petición de la interfaz.
// Decisiones: docs/decisiones/sandbox/proyecto-montado-no-confiable.md
// =============================================================================

import { execFile as execFileCb } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { carpetaSinHooks } from './carpetasHooks'

const execFile = promisify(execFileCb)

/** Una entrada de `git config --list --show-scope --show-origin -z`. */
export interface EntradaConfig {
  ambito: string
  origen: string
  clave: string
  valor: string
}

/**
 * Parte la salida de `git config --list --show-scope --show-origin -z`: `<ámbito>\0<origen>\0<clave>\n<valor>\0` por
 * entrada, o `<ámbito>\0<origen>\0<clave>\0` para una clave sin valor (un booleano a secas).
 */
export function parsearListaConfig(salida: string): EntradaConfig[] {
  const partes = salida.split('\0')
  const entradas: EntradaConfig[] = []
  for (let i = 0; i + 2 < partes.length; i += 3) {
    const kv = partes[i + 2]
    if (kv === '') continue
    const nl = kv.indexOf('\n')
    entradas.push({ ambito: partes[i], origen: partes[i + 1], clave: nl < 0 ? kv : kv.slice(0, nl), valor: nl < 0 ? 'true' : kv.slice(nl + 1) })
  }
  return entradas
}

/** Los ámbitos que puede escribir el contenedor: los archivos de configuración que viven dentro del repo. */
const AMBITOS_DEL_REPO = new Set(['local', 'worktree'])
/** Los que escribe el usuario fuera del proyecto. */
const AMBITOS_DEL_USUARIO = new Set(['system', 'global'])

/** La clave con la sección y la variable en minúsculas (git no las distingue) y la subsección tal cual. */
export function claveNormalizada(clave: string): string {
  const primero = clave.indexOf('.')
  const ultimo = clave.lastIndexOf('.')
  if (primero < 0) return clave.toLowerCase()
  const seccion = clave.slice(0, primero).toLowerCase()
  const variable = clave.slice(ultimo + 1).toLowerCase()
  return primero === ultimo ? `${seccion}.${variable}` : `${seccion}.${clave.slice(primero + 1, ultimo)}.${variable}`
}

const PROGRAMA_FIRMA: Record<string, string> = { openpgp: 'gpg', ssh: 'ssh-keygen', x509: 'gpgsm' }

/** Claves sin subsección que hacen ejecutar algo (o eligen qué se ejecuta), con su valor inocuo. */
const SIN_SUBSECCION: Record<string, string> = {
  'core.fsmonitor': 'false',
  'diff.external': '',
  'gpg.program': 'gpg',
  'gpg.format': 'openpgp',
  'commit.gpgsign': 'false',
  'tag.gpgsign': 'false',
  'log.showsignature': 'false'
}

/** Variables de `<sección>.<nombre que elige el repo>.<variable>` que hacen ejecutar algo, con su valor inocuo. */
const CON_SUBSECCION: Record<string, string> = {
  'filter.clean': '',
  'filter.smudge': '',
  'filter.process': '',
  'filter.required': 'false',
  'diff.command': '',
  'merge.driver': '',
  'gpg.defaultkeycommand': ''
}

/**
 * El valor inocuo de una clave que hace a git ejecutar algo, o null si la clave no ejecuta nada. `textconv` no
 * está: vacía rompe el diff («cannot spawn»), y se apaga con `--no-textconv` en las órdenes que lo usan.
 */
export function valorInocuo(clave: string): string | null {
  const c = claveNormalizada(clave)
  const partes = c.split('.')
  if (partes.length < 3) return SIN_SUBSECCION[c] ?? null
  const seccion = partes[0]
  const variable = partes[partes.length - 1]
  if (seccion === 'gpg' && variable === 'program') return PROGRAMA_FIRMA[partes.slice(1, -1).join('.').toLowerCase()] ?? 'gpg'
  return CON_SUBSECCION[`${seccion}.${variable}`] ?? null
}

/**
 * Los pares clave→valor que anulan lo que el repo define y ejecuta algo: el valor del usuario si lo hay (así un
 * `git-lfs` suyo sigue funcionando aunque el repo redefina su filtro), si no el inocuo. Un filtro del repo lleva
 * además su `required` a falso: sin programa, uno obligatorio haría fallar la orden.
 */
export function neutralizaciones(entradas: readonly EntradaConfig[]): [string, string][] {
  const delUsuario = new Map<string, string>()
  for (const e of entradas) if (AMBITOS_DEL_USUARIO.has(e.ambito)) delUsuario.set(claveNormalizada(e.clave), e.valor)
  const claves = new Map<string, string>()
  for (const e of entradas) {
    if (!AMBITOS_DEL_REPO.has(e.ambito)) continue
    const c = claveNormalizada(e.clave)
    if (valorInocuo(c) !== null) claves.set(c, e.clave)
    const filtro = /^filter\.(.+)\.(clean|smudge|process)$/.exec(c)
    if (filtro) claves.set(`filter.${filtro[1]}.required`, `filter.${filtro[1]}.required`)
  }
  return [...claves].map(([c, original]) => [original, delUsuario.get(c) ?? valorInocuo(c) ?? ''])
}

/**
 * `base` con los pares añadidos a la configuración por entorno de git, detrás de la que ya trajera (un
 * `GIT_CONFIG_COUNT` del usuario se respeta y se amplía).
 */
export function entornoCon(base: NodeJS.ProcessEnv, pares: readonly [string, string][]): NodeJS.ProcessEnv {
  if (pares.length === 0) return base
  const previos = Number.parseInt(base.GIT_CONFIG_COUNT ?? '0', 10)
  const inicio = Number.isFinite(previos) && previos > 0 ? previos : 0
  const env: NodeJS.ProcessEnv = { ...base, GIT_CONFIG_COUNT: String(inicio + pares.length) }
  pares.forEach(([clave, valor], i) => {
    env[`GIT_CONFIG_KEY_${inicio + i}`] = clave
    env[`GIT_CONFIG_VALUE_${inicio + i}`] = valor
  })
  return env
}

/** Las órdenes que pueden pasar el contenido por `textconv` o por un diff externo, y las banderas que lo apagan. */
const CON_DIFF = new Set(['diff', 'diff-tree', 'log', 'show'])

/** `args` con `--no-textconv --no-ext-diff` justo detrás de la suborden si es de las que hacen diff. */
export function conDiffSeguro(args: readonly string[]): string[] {
  if (!CON_DIFF.has(args[0] ?? '')) return [...args]
  return [args[0], '--no-textconv', '--no-ext-diff', ...args.slice(1)]
}

/** Si la configuración no se puede leer: lo que no depende de nombres que elige el repo. */
const SIN_LECTURA: [string, string][] = [
  ['core.fsmonitor', 'false'],
  ['diff.external', '']
]

/** `ctime` además de `mtime`: el contenedor puede devolver un `mtime` a su valor con `touch -d`, el `ctime` no. */
async function huella(archivo: string): Promise<string> {
  try {
    const s = await stat(archivo)
    return `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`
  } catch {
    return 'ausente'
  }
}

/** Los archivos de los que salió la configuración, más los que incluye: si cambia uno, se vuelve a leer. */
function archivosDe(entradas: readonly EntradaConfig[], cwd: string): string[] {
  const archivos = new Set<string>()
  for (const e of entradas) {
    if (!e.origen.startsWith('file:')) continue
    const origen = path.resolve(cwd, e.origen.slice(5))
    archivos.add(origen)
    const c = claveNormalizada(e.clave)
    if (c === 'include.path' || (c.startsWith('includeif.') && c.endsWith('.path'))) {
      archivos.add(path.resolve(path.dirname(origen), e.valor.replace(/^~(?=\/|$)/, homedir())))
    }
  }
  return [...archivos]
}

interface Cacheado {
  huellas: Map<string, string>
  pares: [string, string][]
}
const porRepo = new Map<string, Cacheado>()
/** La lectura en curso por carpeta: varios git a la vez en el mismo repo esperan la misma. */
const enCurso = new Map<string, Promise<[string, string][]>>()

async function sigueVigente(c: Cacheado): Promise<boolean> {
  for (const [archivo, h] of c.huellas) if ((await huella(archivo)) !== h) return false
  return true
}

async function leer(cwd: string): Promise<[string, string][]> {
  let entradas: EntradaConfig[]
  try {
    const { stdout } = await execFile('git', ['config', '--list', '--show-scope', '--show-origin', '--includes', '-z'], {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 20_000,
      killSignal: 'SIGKILL',
      encoding: 'utf8'
    })
    entradas = parsearListaConfig(stdout)
  } catch {
    porRepo.delete(cwd)
    return SIN_LECTURA
  }
  const pares = neutralizaciones(entradas)
  // Sin configuración del repo (la carpeta no lo es todavía) no se cachea: el día que lo sea, su archivo no estaría
  // entre los vigilados.
  if (!entradas.some((e) => AMBITOS_DEL_REPO.has(e.ambito))) {
    porRepo.delete(cwd)
    return pares
  }
  const huellas = new Map<string, string>()
  for (const a of archivosDe(entradas, cwd)) huellas.set(a, await huella(a))
  porRepo.set(cwd, { huellas, pares })
  return pares
}

/** Los pares que anulan lo que el repo de `cwd` podría hacer ejecutar (ver la cabecera). */
export async function neutralizacionGit(cwd: string): Promise<[string, string][]> {
  const previo = porRepo.get(cwd)
  if (previo && (await sigueVigente(previo))) return previo.pares
  const pendiente = enCurso.get(cwd)
  if (pendiente) return pendiente
  const lectura = leer(cwd).finally(() => enCurso.delete(cwd))
  enCurso.set(cwd, lectura)
  return lectura
}

/** El entorno con el que lanzar git en `cwd`: el del proceso más la neutralización de su repo. */
export async function entornoGit(cwd: string): Promise<NodeJS.ProcessEnv> {
  return entornoCon(process.env, [...await neutralizacionGit(cwd), ['core.hooksPath', await carpetaSinHooks()]])
}
