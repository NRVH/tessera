// =============================================================================
// La última versión publicada de cada CLI según su canal y su método: dist-tags de npm,
// el servidor de versiones de Claude o el cask de Homebrew. Todo lo que llega de la red
// pasa por `esVersionExacta`; si no la cumple, la última queda null con su porqué.
// Decisiones: docs/decisiones/agentes/nativos-actualizacion-del-host.md
// =============================================================================

import type { MetodoInstalacion } from '../../../shared/agentes-nativos-ipc.ts'
import { esVersionExacta } from '../../../shared/versionesCli.ts'
import { binarioCodexPublicado, PAQUETE_CLAUDE, PAQUETE_CODEX } from '../comandoActualizacion.ts'
import {
  API_BREW_POR_DEFECTO,
  REGISTRO_NPM_POR_DEFECTO,
  RELEASES_CLAUDE_POR_DEFECTO,
  TOPE_RESPUESTA,
  baseUrl,
  parsearDistTags,
  urlDistTags,
  versionCaskBrew
} from './urls.ts'
import { errMsg, type NucleoNativos } from './tipos.ts'

/** Última de Codex y si su binario de esta plataforma ya está publicado. */
export type UltimaCodex = { ultima: string | null; binarioPublicado: boolean; error: string | null }

async function pedirTexto(e: NucleoNativos, url: string): Promise<string> {
  const texto = await e.deps.fetchTexto(url, e.t.topeRedMs)
  if (texto.length > TOPE_RESPUESTA) throw new Error('respuesta demasiado grande')
  return texto
}

async function distTags(e: NucleoNativos, paquete: string): Promise<Record<string, string>> {
  const registro = baseUrl(e.deps.env.TESSERA_REGISTRO_NPM, REGISTRO_NPM_POR_DEFECTO)
  const tags = parsearDistTags(await pedirTexto(e, urlDistTags(registro, paquete)))
  if (tags === null) throw new Error('el registro de npm no devolvió dist-tags legibles')
  return tags
}

/** Codex por npm: `latest`, y «publicado» solo si el dist-tag de `<so>-<arch>` ya apunta a ella. */
export async function ultimaCodex(e: NucleoNativos): Promise<UltimaCodex> {
  try {
    const tags = await distTags(e, PAQUETE_CODEX)
    const latest = tags.latest
    if (!esVersionExacta(latest)) {
      return { ultima: null, binarioPublicado: false, error: 'El registro de npm no da una versión exacta de Codex.' }
    }
    return {
      ultima: latest,
      binarioPublicado: binarioCodexPublicado(tags, latest, e.deps.plataforma, e.deps.arch),
      error: null
    }
  } catch (err) {
    return {
      ultima: null,
      binarioPublicado: false,
      error: `No se pudo consultar la última versión de Codex: ${errMsg(err)}.`
    }
  }
}

/**
 * Codex por Homebrew: la del CASK (no la de npm, que va por delante). Una fórmula solo
 * puede venir de un tap ajeno sin API: última null, con el porqué.
 *
 * @param raiz  La ruta real del binario, que dice cask o fórmula.
 */
export async function ultimaCodexBrew(e: NucleoNativos, raiz: string | null): Promise<UltimaCodex> {
  if (raiz === null || !raiz.includes('/Caskroom/codex/')) {
    return {
      ultima: null,
      binarioPublicado: false,
      error:
        'Codex está instalado con una fórmula de Homebrew que no es la oficial: no se puede saber cuál es ' +
        'su última versión. Actualízalo con «brew upgrade codex».'
    }
  }
  try {
    const base = baseUrl(e.deps.env.TESSERA_API_BREW, API_BREW_POR_DEFECTO)
    const v = versionCaskBrew(await pedirTexto(e, `${base}/cask/codex.json`))
    if (v === null) {
      return { ultima: null, binarioPublicado: false, error: 'Homebrew no da una versión exacta de Codex.' }
    }
    // El cask apunta a un binario ya publicado: no hay la ventana de npm.
    return { ultima: v, binarioPublicado: true, error: null }
  } catch (err) {
    return {
      ultima: null,
      binarioPublicado: false,
      error: `No se pudo consultar la última versión de Codex en Homebrew: ${errMsg(err)}.`
    }
  }
}

/** Claude: la del canal en npm si se instaló por npm; si no, la del servidor de versiones. */
export async function ultimaClaude(
  e: NucleoNativos,
  metodo: MetodoInstalacion,
  canal: 'latest' | 'stable'
): Promise<{ ultima: string | null; error: string | null }> {
  try {
    if (metodo === 'npm') {
      const v = (await distTags(e, PAQUETE_CLAUDE))[canal]
      if (!esVersionExacta(v)) {
        return { ultima: null, error: `El registro de npm no da una versión exacta de Claude Code (${canal}).` }
      }
      return { ultima: v, error: null }
    }
    const base = baseUrl(e.deps.env.TESSERA_RELEASES_CLAUDE, RELEASES_CLAUDE_POR_DEFECTO)
    const v = (await pedirTexto(e, `${base}/${canal}`)).trim()
    if (!esVersionExacta(v)) {
      return { ultima: null, error: 'El servidor de versiones de Claude Code no dio una versión exacta.' }
    }
    return { ultima: v, error: null }
  } catch (err) {
    return { ultima: null, error: `No se pudo consultar la última versión de Claude Code: ${errMsg(err)}.` }
  }
}
