// =============================================================================
// Qué hay instalado en el host: la versión de cada CLI (sonda `--version` por la misma
// shell que las sesiones, una en vuelo por agente y sin caché de tiempo), su método de
// instalación y, en Windows, las raíces que una reinstalación sustituye.
// Decisiones: docs/decisiones/agentes/nativos-actualizacion-del-host.md
// =============================================================================

import path from 'node:path'
import type { AgentKind } from '../../../shared/agent-terminal-ipc.ts'
import type { MetodoInstalacion } from '../../../shared/agentes-nativos-ipc.ts'
import { ETIQUETA_AGENTE } from '../../../shared/etiquetasAgente.ts'
import { nombresSistema } from '../../../shared/nombresSistema.ts'
import { extraerVersion } from '../../../shared/versionesCli.ts'
import { detectarMetodoClaude, detectarMetodoCodex } from '../comandoActualizacion.ts'
import type { ResultadoEjecucion } from '../ejecutorShell.ts'
import {
  BINARIO,
  PAQUETE_NPM,
  candidatosPaquetePlataforma,
  candidatosRaizCodexWindows,
  canalClaude,
  installMethodDe,
  primeraLinea,
  raizCodexDesdeRuta
} from './urls.ts'
import { errMsg, type NucleoNativos } from './tipos.ts'

function errorDeSonda(e: NucleoNativos, agente: AgentKind, r: ResultadoEjecucion): string {
  const { tuEquipo } = nombresSistema(e.deps.plataforma)
  if (r.tope) return `${ETIQUETA_AGENTE[agente]} no respondió a «${BINARIO[agente]} --version» a tiempo.`
  return `No se encontró ${ETIQUETA_AGENTE[agente]} en ${tuEquipo}, o no respondió a «${BINARIO[agente]} --version».`
}

/** Sonda de versión sin mirar el candado; quien llega con una en vuelo espera ESA promesa. */
export function sondear(e: NucleoNativos, agente: AgentKind): Promise<string | null> {
  const s = e.sondas[agente]
  if (s.enVuelo) return s.enVuelo
  const promesa = (async (): Promise<string | null> => {
    try {
      const r = await e.deps.ejecutar(`${BINARIO[agente]} --version`, {
        plataforma: e.deps.plataforma,
        timeoutMs: e.t.topeSondaMs,
        modo: 'sonda'
      })
      const v = r.ok ? extraerVersion(r.salida) : null
      s.valor = v
      s.error = v !== null ? null : errorDeSonda(e, agente, r)
      return v
    } catch (err) {
      // El ejecutor no rechaza; esto es la red de un falso o de un bug.
      s.valor = null
      s.error = `No se pudo leer la versión de ${ETIQUETA_AGENTE[agente]}: ${errMsg(err)}`
      return null
    } finally {
      s.enVuelo = null
    }
  })()
  s.enVuelo = promesa
  return promesa
}

/** Versión instalada medida ahora; con el candado de ese agente tomado, la última medida. */
export function instalada(e: NucleoNativos, agente: AgentKind): Promise<string | null> {
  if (e.candados.has(agente)) return Promise.resolve(e.sondas[agente].valor)
  return sondear(e, agente)
}

/** Primera línea útil de una sonda, o null si falló. */
export async function sondaTexto(e: NucleoNativos, cmd: string): Promise<string | null> {
  try {
    const r = await e.deps.ejecutar(cmd, {
      plataforma: e.deps.plataforma,
      timeoutMs: e.t.topeSondaMs,
      modo: 'sonda'
    })
    return r.ok ? primeraLinea(r.salida) : null
  } catch {
    return null
  }
}

/** Ruta del ejecutable que la shell de las sesiones encontraría para `bin`. */
async function rutaDeComando(e: NucleoNativos, bin: string): Promise<string | null> {
  const windows = e.deps.plataforma === 'windows'
  const r = await sondaTexto(e, windows ? `(Get-Command ${bin} -ErrorAction Stop).Source` : `command -v ${bin}`)
  if (r === null) return null
  // Un alias o una función de la shell no son una ruta (`command -v` los imprime).
  const esRuta = windows ? /^(?:[A-Za-z]:[\\/]|\\\\)/.test(r) : r.startsWith('/')
  return esRuta ? r : null
}

async function resolver(e: NucleoNativos, ruta: string): Promise<string | null> {
  try {
    return await e.resolverRuta(ruta)
  } catch {
    return null
  }
}

async function leer(e: NucleoNativos, ruta: string): Promise<string | null> {
  try {
    return await e.deps.leerTexto(ruta)
  } catch {
    return null
  }
}

function rutas(e: NucleoNativos): typeof path.win32 {
  return e.deps.plataforma === 'windows' ? path.win32 : path.posix
}

function dirConfigClaude(e: NucleoNativos): string | null {
  const d = e.deps.env.CLAUDE_CONFIG_DIR?.trim()
  return d ? d : null
}

/** Canal de Claude, de `<CLAUDE_CONFIG_DIR o ~/.claude>/settings.json`. */
export async function leerCanalClaude(e: NucleoNativos): Promise<'latest' | 'stable'> {
  const p = rutas(e)
  const base = dirConfigClaude(e) ?? p.join(e.deps.homedir, '.claude')
  return canalClaude(await leer(e, p.join(base, 'settings.json')))
}

async function leerInstallMethod(e: NucleoNativos): Promise<string | null> {
  const p = rutas(e)
  const dir = dirConfigClaude(e)
  // En el HOME (`~/.claude.json`), NO dentro de `~/.claude/`; con CLAUDE_CONFIG_DIR, dentro de él.
  const ruta = dir ? p.join(dir, '.claude.json') : p.join(e.deps.homedir, '.claude.json')
  return installMethodDe(await leer(e, ruta))
}

/** Windows: la raíz más la de su binario de plataforma (la primera candidata que existe). */
async function raicesBloqueoDe(e: NucleoNativos, agente: AgentKind, raiz: string): Promise<string[]> {
  const { scope, nombre } = PAQUETE_NPM[agente]
  for (const c of candidatosPaquetePlataforma(raiz, scope, nombre, e.deps.arch)) {
    const real = await resolver(e, c)
    if (real !== null) return [...new Set([raiz, real])]
  }
  return [raiz]
}

async function raizCodexWindows(e: NucleoNativos, ruta: string): Promise<{ raiz: string; raicesBloqueo: string[] }> {
  const texto = /\.(?:ps1|cmd)$/i.test(ruta) ? await leer(e, ruta) : null
  let raiz: string | null = null
  for (const c of candidatosRaizCodexWindows(ruta, texto)) {
    raiz = await resolver(e, c)
    if (raiz !== null) break
  }
  if (raiz !== null) return { raiz, raicesBloqueo: await raicesBloqueoDe(e, 'codex', raiz) }
  // Sin paquete (winget, scoop, un `.exe` suelto): la ruta del ejecutable y sin raíces de bloqueo.
  return { raiz: (await resolver(e, ruta)) ?? ruta, raicesBloqueo: [] }
}

/** Método de Codex por su raíz real de paquete, la raíz y sus raíces de bloqueo. */
export async function detectarCodex(e: NucleoNativos): Promise<{
  metodo: MetodoInstalacion
  raiz: string | null
  raicesBloqueo: string[]
}> {
  const { plataforma } = e.deps
  const [ruta, prefijo] = await Promise.all([rutaDeComando(e, 'codex'), sondaTexto(e, 'npm prefix -g')])
  let raiz: string | null = null
  let raicesBloqueo: string[] = []
  if (ruta !== null) {
    if (plataforma === 'windows') {
      ;({ raiz, raicesBloqueo } = await raizCodexWindows(e, ruta))
    } else {
      const real = (await resolver(e, ruta)) ?? ruta
      raiz = raizCodexDesdeRuta(real) ?? real
    }
  }
  // El prefijo también resuelto: la raíz lo está, y compararlas exige la misma forma.
  const prefijoNpm = prefijo !== null ? ((await resolver(e, prefijo)) ?? prefijo) : null
  return { metodo: detectarMetodoCodex({ raizPaquete: raiz, prefijoNpm, plataforma }), raiz, raicesBloqueo }
}

/**
 * Método de Claude y, solo por npm en Windows (donde la orden exige parar), sus raíces:
 * la carpeta del prefijo de npm, resuelta y también sin resolver (así la lleva la línea
 * de comandos del `node.exe <raiz>\cli.js`).
 */
export async function detectarClaude(e: NucleoNativos): Promise<{ metodo: MetodoInstalacion; raicesBloqueo: string[] }> {
  const { plataforma } = e.deps
  const [ruta, installMethod] = await Promise.all([rutaDeComando(e, 'claude'), leerInstallMethod(e)])
  const real = ruta !== null ? ((await resolver(e, ruta)) ?? ruta) : null
  const metodo = detectarMetodoClaude({ installMethod, rutaBinario: real, plataforma })
  if (plataforma !== 'windows' || metodo !== 'npm') return { metodo, raicesBloqueo: [] }
  const prefijo = await sondaTexto(e, 'npm prefix -g')
  if (prefijo === null) return { metodo, raicesBloqueo: [] }
  const { scope, nombre } = PAQUETE_NPM['claude-code']
  const tal = path.win32.join(prefijo, 'node_modules', scope, nombre)
  const raiz = await resolver(e, tal)
  if (raiz === null) return { metodo, raicesBloqueo: [] }
  return { metodo, raicesBloqueo: [...new Set([...(await raicesBloqueoDe(e, 'claude-code', raiz)), tal])] }
}
