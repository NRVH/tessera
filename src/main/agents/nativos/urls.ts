// =============================================================================
// Piezas puras del servicio de los agentes nativos: bases y URLs de las fuentes de
// versiones, lectura de dist-tags, del canal y del método de Claude, y dónde buscar la
// raíz real del paquete de un CLI y la de su binario de plataforma.
// Las prueba `test-agentes-nativos.mts` (bloque 1), reexportadas por `agentesNativos.ts`.
// Decisiones: docs/decisiones/agentes/nativos-actualizacion-del-host.md
// =============================================================================

import path from 'node:path'
import type { AgentKind } from '../../../shared/agent-terminal-ipc.ts'
import { esVersionExacta } from '../../../shared/versionesCli.ts'

export const REGISTRO_NPM_POR_DEFECTO = 'https://registry.npmjs.org'
export const RELEASES_CLAUDE_POR_DEFECTO = 'https://downloads.claude.ai/claude-code-releases'
export const API_BREW_POR_DEFECTO = 'https://formulae.brew.sh/api'

export const AGENTES: readonly AgentKind[] = ['claude-code', 'codex']
export const BINARIO: Readonly<Record<AgentKind, string>> = { 'claude-code': 'claude', codex: 'codex' }

/** Paquete de npm de cada CLI partido en scope y nombre (su paquete de plataforma es `<nombre>-win32-<arch>`). */
export const PAQUETE_NPM: Readonly<Record<AgentKind, { scope: string; nombre: string }>> = {
  'claude-code': { scope: '@anthropic-ai', nombre: 'claude-code' },
  codex: { scope: '@openai', nombre: 'codex' }
}

/** Tope de una respuesta de red: dist-tags y el servidor de versiones son diminutos. */
export const TOPE_RESPUESTA = 256 * 1024

/** Base de una URL de diagnóstico (`TESSERA_*`): solo http(s) y sin barras finales; si no, el defecto. */
export function baseUrl(valor: string | undefined, defecto: string): string {
  const v = (valor ?? '').trim()
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(v)) return defecto
  return v.replace(/\/+$/, '')
}

/** URL de los dist-tags de un paquete (el registro acepta el `@scope/nombre` tal cual). */
export function urlDistTags(registro: string, paquete: string): string {
  return `${registro}/-/package/${paquete}/dist-tags`
}

/** dist-tags de npm: sólo las entradas de texto; null si no es un objeto JSON. */
export function parsearDistTags(texto: string): Record<string, string> | null {
  let datos: unknown
  try {
    datos = JSON.parse(texto)
  } catch {
    return null
  }
  if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(datos as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

/**
 * Canal de actualización de Claude Code (`autoUpdatesChannel` de su `settings.json`):
 * `stable` o, con cualquier otro valor o ninguno, `latest`. Va dentro de una URL.
 */
export function canalClaude(textoSettings: string | null): 'latest' | 'stable' {
  if (!textoSettings) return 'latest'
  try {
    const s = JSON.parse(textoSettings) as { autoUpdatesChannel?: unknown }
    return s?.autoUpdatesChannel === 'stable' ? 'stable' : 'latest'
  } catch {
    return 'latest'
  }
}

/** `installMethod` de `.claude.json` (`native`, `npm-global`…), o null. */
export function installMethodDe(textoClaudeJson: string | null): string | null {
  if (!textoClaudeJson) return null
  try {
    const j = JSON.parse(textoClaudeJson) as { installMethod?: unknown }
    return typeof j?.installMethod === 'string' && j.installMethod.trim() ? j.installMethod.trim() : null
  } catch {
    return null
  }
}

/**
 * La raíz del paquete de Codex que escribe un shim de npm/pnpm de Windows (`$basedir` en
 * el `.ps1`, `%dp0%` en el `.cmd`), resuelta contra la carpeta del shim; null si no aparece.
 */
export function raizCodexDesdeShim(textoShim: string, carpetaShim: string): string | null {
  const m = /(?:\$basedir|%~?dp0%?)[\\/]*((?:[^"'\s%$]*?[\\/])?node_modules[\\/]@openai[\\/]codex)[\\/]bin[\\/]codex\.js/i.exec(
    textoShim
  )
  if (!m) return null
  return path.win32.resolve(carpetaShim, m[1])
}

/**
 * Candidatas a raíz del paquete de Codex en Windows, de más a menos fiable: la que
 * escribe el shim, la de npm (`<carpeta>\node_modules\@openai\codex`) y la de bun.
 */
export function candidatosRaizCodexWindows(rutaShim: string, textoShim: string | null): string[] {
  const p = path.win32
  const carpeta = p.dirname(rutaShim)
  const out: string[] = []
  const desdeShim = textoShim ? raizCodexDesdeShim(textoShim, carpeta) : null
  if (desdeShim) out.push(desdeShim)
  out.push(p.join(carpeta, 'node_modules', '@openai', 'codex'))
  if (/[\\/]\.bun[\\/]bin$/i.test(carpeta)) {
    out.push(p.join(carpeta, '..', 'install', 'global', 'node_modules', '@openai', 'codex'))
  }
  return [...new Set(out)]
}

/** POSIX: sube desde la ruta REAL del binario hasta `@openai/codex`; null si no cuelga de un paquete. */
export function raizCodexDesdeRuta(rutaReal: string): string | null {
  const p = path.posix
  let actual = rutaReal
  for (let i = 0; i < 64; i++) {
    if (p.basename(actual) === 'codex' && p.basename(p.dirname(actual)) === '@openai') return actual
    const padre = p.dirname(actual)
    if (padre === actual) break
    actual = padre
  }
  return null
}

/**
 * Windows: dónde puede estar el paquete del binario de la plataforma de un CLI con raíz
 * `raiz`, en el orden de `require.resolve` desde `<raiz>/bin`: anidado (npm) y hermano
 * dentro del scope (bun, pnpm). Quien llama pasa cada una por `realpath`.
 */
export function candidatosPaquetePlataforma(raiz: string, scope: string, nombre: string, arch: string): string[] {
  const p = path.win32
  const plataforma = `${nombre}-win32-${arch}`
  return [p.join(raiz, 'node_modules', scope, plataforma), p.join(raiz, '..', plataforma)]
}

/**
 * Versión del cask `codex` del API de Homebrew, o null si no es JSON, no la trae o no es
 * EXACTA (un cask puede versionar como `"1.2.3,build"`).
 */
export function versionCaskBrew(texto: string): string | null {
  let datos: unknown
  try {
    datos = JSON.parse(texto)
  } catch {
    return null
  }
  if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) return null
  const v = (datos as { version?: unknown }).version
  return typeof v === 'string' && esVersionExacta(v) ? v : null
}

/** Primera línea con contenido de una salida. */
export function primeraLinea(texto: string): string | null {
  for (const l of texto.split(/\r?\n/)) {
    const t = l.trim()
    if (t) return t
  }
  return null
}
