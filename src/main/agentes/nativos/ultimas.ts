// =============================================================================
// La última versión publicada de cada CLI según su canal y su método: dist-tags de npm,
// el servidor de versiones de Claude o el cask de Homebrew. Todo lo que llega de la red
// pasa por `esVersionExacta`; si no la cumple, la última queda null con su porqué.
// Decisiones: docs/decisiones/agentes/nativos-actualizacion-del-host.md
// =============================================================================

import type { MetodoInstalacion } from '../../../shared/agentes-nativos-ipc.ts'
import { esVersionExacta } from '../../../shared/versionesCli.ts'
import {
  binarioCodexPublicado,
  documentoVersionServido,
  PAQUETE_CLAUDE,
  PAQUETE_CODEX,
  versionBinarioCodex
} from '../comandoActualizacion.ts'
import {
  API_BREW_POR_DEFECTO,
  REGISTRO_NPM_POR_DEFECTO,
  URL_VERSIONES_CLAUDE_PREDETERMINADA,
  TOPE_RESPUESTA,
  baseUrl,
  analizarEtiquetasDistribucion,
  urlEtiquetasDistribucion,
  urlVersionNpm,
  versionCaskBrew
} from './urls.ts'
import { errMsg, type NucleoNativos } from './tipos.ts'
import { txAgentes } from '../textos.ts'

/** Última de Codex y si su binario de esta plataforma ya está publicado. */
export type UltimaCodex = { ultima: string | null; binarioPublicado: boolean; error: string | null }

async function pedirTexto(e: NucleoNativos, url: string): Promise<string> {
  const texto = await e.deps.traerTexto(url, e.t.topeRedMs)
  if (texto.length > TOPE_RESPUESTA) throw new Error('respuesta demasiado grande')
  return texto
}

function registroNpm(e: NucleoNativos): string {
  return baseUrl(e.deps.env.TESSERA_REGISTRO_NPM, REGISTRO_NPM_POR_DEFECTO)
}

async function etiquetasDistribucion(e: NucleoNativos, paquete: string): Promise<Record<string, string>> {
  const etiquetas = analizarEtiquetasDistribucion(await pedirTexto(e, urlEtiquetasDistribucion(registroNpm(e), paquete)))
  if (etiquetas === null) throw new Error(txAgentes().ultimas.sinEtiquetasDistribucion)
  return etiquetas
}

/** Lo que instala la imagen de Docker: el `latest` de npm de cada CLI, sea cual sea el canal del equipo. */
export async function ultimasDeNpm(e: NucleoNativos): Promise<{ claude: string | null; codex: string | null }> {
  const ultimaDelPaquete = async (paquete: string): Promise<string | null> => {
    const v = (await etiquetasDistribucion(e, paquete).catch(() => ({}) as Record<string, string>)).latest
    return esVersionExacta(v) ? v : null
  }
  const [claude, codex] = await Promise.all([ultimaDelPaquete(PAQUETE_CLAUDE), ultimaDelPaquete(PAQUETE_CODEX)])
  return { claude, codex }
}

/**
 * ¿Sirve ya el registro el binario de Codex de esta plataforma para `version`? El dist-tag
 * puede apuntar a él antes de que su documento responda; cualquier fallo (un 404 incluido)
 * cuenta como «aún no».
 */
async function binarioCodexServido(e: NucleoNativos, etiquetas: Record<string, string>, version: string): Promise<boolean> {
  const { plataforma, arquitectura } = e.deps
  if (!binarioCodexPublicado(etiquetas, version, plataforma, arquitectura)) return false
  const delBinario = versionBinarioCodex(version, plataforma, arquitectura)
  try {
    const texto = await pedirTexto(e, urlVersionNpm(registroNpm(e), PAQUETE_CODEX, delBinario))
    return documentoVersionServido(texto, delBinario)
  } catch (err) {
    e.deps.log(`agentes nativos: el registro aún no sirve Codex ${delBinario}: ${errMsg(err)}`)
    return false
  }
}

/** Codex por npm: `latest`, y «publicado» solo si el registro ya sirve su binario de `<so>-<arch>`. */
export async function ultimaCodex(e: NucleoNativos): Promise<UltimaCodex> {
  try {
    const etiquetas = await etiquetasDistribucion(e, PAQUETE_CODEX)
    const versionUltima = etiquetas.latest
    if (!esVersionExacta(versionUltima)) {
      return { ultima: null, binarioPublicado: false, error: txAgentes().ultimas.codexNpmSinVersion }
    }
    return { ultima: versionUltima, binarioPublicado: await binarioCodexServido(e, etiquetas, versionUltima), error: null }
  } catch (err) {
    return {
      ultima: null,
      binarioPublicado: false,
      error: txAgentes().ultimas.codexNpmError(errMsg(err))
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
      error: txAgentes().ultimas.codexFormula
    }
  }
  try {
    const base = baseUrl(e.deps.env.TESSERA_API_BREW, API_BREW_POR_DEFECTO)
    const v = versionCaskBrew(await pedirTexto(e, `${base}/cask/codex.json`))
    if (v === null) {
      return { ultima: null, binarioPublicado: false, error: txAgentes().ultimas.codexBrewSinVersion }
    }
    // El cask apunta a un binario ya publicado: no hay la ventana de npm.
    return { ultima: v, binarioPublicado: true, error: null }
  } catch (err) {
    return {
      ultima: null,
      binarioPublicado: false,
      error: txAgentes().ultimas.codexBrewError(errMsg(err))
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
      const v = (await etiquetasDistribucion(e, PAQUETE_CLAUDE))[canal]
      if (!esVersionExacta(v)) {
        return { ultima: null, error: txAgentes().ultimas.claudeNpmSinVersion(canal) }
      }
      return { ultima: v, error: null }
    }
    const base = baseUrl(e.deps.env.TESSERA_RELEASES_CLAUDE, URL_VERSIONES_CLAUDE_PREDETERMINADA)
    const v = (await pedirTexto(e, `${base}/${canal}`)).trim()
    if (!esVersionExacta(v)) {
      return { ultima: null, error: txAgentes().ultimas.claudeServidorSinVersion }
    }
    return { ultima: v, error: null }
  } catch (err) {
    return { ultima: null, error: txAgentes().ultimas.claudeError(errMsg(err)) }
  }
}
