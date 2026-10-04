// =============================================================================
// De dónde sale el token OAuth de Claude Code para leer el uso: el fichero `.credentials.json`
// o, solo en macOS y en modo host, el llavero (`security`). Puro y con la plataforma y el lector
// del llavero como parámetros, para probar las dos plataformas desde cualquiera.
// Lo usa `UsageReader`. Nunca escribe en el llavero ni toca el refresh token.
// Decisiones: docs/decisiones/agentes/uso-token-de-claude-en-mac.md
// =============================================================================
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import type { UsageRunMode } from '../../shared/usage-ipc.ts'

/** Servicio con el que Claude Code guarda su bloque OAuth en el llavero de macOS. */
export const SERVICIO_LLAVERO = 'Claude Code-credentials'

/** Nombre del fichero equivalente en Windows y Linux. */
export const FICHERO_CREDENCIALES = '.credentials.json'

/**
 * Tope de la consulta al llavero. Generoso para una lectura autorizada (instantánea) y
 * corto para no dejar el footer esperando si un día sale un diálogo.
 */
const TIMEOUT_LLAVERO_MS = 10_000

/** Qué fuentes se consultan, y en qué orden. */
export type OrigenCredenciales = 'llavero-luego-fichero' | 'fichero-luego-llavero' | 'solo-fichero'

/**
 * Resultado de buscar las credenciales. Las cuatro ramas existen porque cada una acaba
 * en un mensaje distinto —y, sobre todo, porque `fallo` es TRANSITORIO y las otras no:
 * de eso depende que `UsageReader` conserve el último dato bueno o lo tire.
 */
export type LecturaCredenciales =
  | { clase: 'token'; token: string }
  /** JSON legible pero sin bloque OAuth: es una cuenta por API key. */
  | { clase: 'sin-oauth' }
  /** No hay nada que leer, o lo que hay no se entiende. Es un ESTADO de la cuenta. */
  | { clase: 'ausente' }
  /** Había algo que leer y no se pudo. Es un accidente, no un estado. */
  | { clase: 'fallo'; detalle: string }

/** Lo que interesa del bloque que escribe el CLI (en fichero o en el llavero). */
interface CredencialesClaude {
  claudeAiOauth?: { accessToken?: unknown }
}

/**
 * ¿Es `base` la carpeta de Claude Code por defecto (`~/.claude`)? Lo que la distingue es
 * que el ítem del llavero SÍ le corresponde; una carpeta puesta a mano con
 * `CLAUDE_CONFIG_DIR` no tiene por qué. Comparación sin caja porque APFS no la distingue
 * y `CLAUDE_CONFIG_DIR` lo escribe una persona.
 */
export function esBaseNativaClaude(base: string, home: string): boolean {
  const norm = (p: string): string => path.resolve(p).replace(/[/\\]+$/, '').toLowerCase()
  return norm(base) === norm(path.join(home, '.claude'))
}

/**
 * Dónde hay que mirar y en qué orden. El llavero SÓLO entra en juego en macOS y en modo
 * host; ver la cabecera para por qué una cuenta de contenedor no puede consultarlo, y
 * por qué con una base propia el fichero va primero.
 */
export function origenCredenciales(
  modo: UsageRunMode,
  baseNativa: boolean,
  plataforma: Plataforma = plataformaActual()
): OrigenCredenciales {
  if (plataforma !== 'mac' || modo !== 'host') return 'solo-fichero'
  return baseNativa ? 'llavero-luego-fichero' : 'fichero-luego-llavero'
}

/**
 * Interpreta el JSON de credenciales. Nunca lanza: un texto que no se entiende es un
 * «no hay credenciales», igual que un fichero que no está. Es la misma tolerancia que
 * tenía el `try` que envolvía al `readFile` original.
 */
export function tokenDeCredenciales(texto: string | null): LecturaCredenciales {
  if (texto === null || texto.trim() === '') return { clase: 'ausente' }
  let datos: CredencialesClaude
  try {
    datos = JSON.parse(texto) as CredencialesClaude
  } catch {
    return { clase: 'ausente' }
  }
  if (!datos || typeof datos !== 'object') return { clase: 'ausente' }
  const token = datos.claudeAiOauth?.accessToken
  if (typeof token !== 'string' || token === '') return { clase: 'sin-oauth' }
  return { clase: 'token', token }
}

/**
 * Lo que devuelve el llavero. `ausente` y `fallo` NO son lo mismo: el primero es un
 * estado de la cuenta y el segundo un accidente del que hay que poder recuperarse sin
 * borrar de la pantalla unas barras que estaban bien.
 */
export type ResultadoLlavero =
  | { clase: 'ok'; texto: string }
  | { clase: 'ausente' }
  | { clase: 'fallo'; detalle: string }

/** Lee el secreto del llavero. Nunca lanza. */
export type LectorLlavero = () => Promise<ResultadoLlavero>

/**
 * Código con el que `security` dice «ese ítem no está en el llavero»
 * (`errSecItemNotFound`). Medido en esta máquina: 44 si no existe, 0 si lo encuentra, y
 * cualquier otro valor para el resto de problemas. Es lo único que permite distinguir
 * «no has iniciado sesión» de «no se ha podido leer».
 */
const SALIDA_NO_ENCONTRADO = 44

/** El de verdad: `security` por RUTA ABSOLUTA, que es lo único que no depende del PATH. */
export const lectorLlaveroMac: LectorLlavero = () =>
  new Promise((resolve) => {
    try {
      execFile(
        '/usr/bin/security',
        ['find-generic-password', '-s', SERVICIO_LLAVERO, '-w'],
        { timeout: TIMEOUT_LLAVERO_MS, encoding: 'utf8' },
        (err, stdout) => {
          if (!err) {
            const texto = stdout.trim()
            // Encontrado pero vacío: no hay secreto que usar, y tampoco es un fallo.
            resolve(texto ? { clase: 'ok', texto } : { clase: 'ausente' })
            return
          }
          // `code` viene tipado como `string` pero en un fallo por CÓDIGO DE SALIDA
          // Node deja ahí el número. Se lee sin el tipo de `ErrnoException` (que lo
          // estrecha a `string` y haría imposible la comparación) y se admiten los dos.
          const codigo = (err as unknown as { code?: number | string }).code
          if (codigo === SALIDA_NO_ENCONTRADO || codigo === String(SALIDA_NO_ENCONTRADO)) {
            resolve({ clase: 'ausente' })
            return
          }
          // El timeout mata el proceso: `err.killed` es lo que lo distingue de un
          // código de salida, y merece un texto propio porque su causa más probable
          // es un diálogo de autorización esperando al usuario.
          resolve({
            clase: 'fallo',
            detalle: err.killed
              ? `el llavero no respondió en ${Math.round(TIMEOUT_LLAVERO_MS / 1000)} s`
              : `el llavero no dejó leer la credencial (${String(codigo ?? 'sin código')})`
          })
        }
      )
    } catch (e) {
      // `execFile` puede lanzar en el acto (EMFILE, por ejemplo). Es un accidente.
      resolve({ clase: 'fallo', detalle: `no se pudo consultar el llavero: ${String(e)}` })
    }
  })

/** Las fuentes a consultar, en el orden que dice `orden`. */
function fuentesEnOrden(
  orden: OrigenCredenciales,
  llavero: LectorLlavero,
  desdeFichero: LectorLlavero
): LectorLlavero[] {
  if (orden === 'llavero-luego-fichero') return [llavero, desdeFichero]
  if (orden === 'fichero-luego-llavero') return [desdeFichero, llavero]
  return [desdeFichero]
}

/**
 * Consulta una fuente sin dejar que una excepción se propague: que una reviente no puede
 * impedir mirar la otra, y desde el sondeo del footer sería un fallo genérico con otro texto.
 */
async function leerFuenteSegura(fuente: LectorLlavero): Promise<ResultadoLlavero> {
  try {
    return await fuente()
  } catch (e) {
    return { clase: 'fallo', detalle: String(e) }
  }
}

/**
 * Busca las credenciales de Claude Code para esa base. Nunca lanza.
 *
 * @param modo       `host` = la cuenta del Mac (permite el llavero); `container` = una
 *                   cuenta con su carpeta montada, que SIEMPRE sale del fichero.
 * @param plataforma La actual por defecto; parámetro para poder probar la ajena.
 * @param llavero    Lector inyectable, por el mismo motivo.
 */
export async function leerCredencialesClaude(
  base: string,
  modo: UsageRunMode = 'container',
  plataforma: Plataforma = plataformaActual(),
  llavero: LectorLlavero = lectorLlaveroMac,
  home: string = homedir()
): Promise<LecturaCredenciales> {
  const desdeFichero = async (): Promise<ResultadoLlavero> => {
    const texto = await readFile(path.join(base, FICHERO_CREDENCIALES), 'utf8').catch(() => null)
    return texto === null ? { clase: 'ausente' } : { clase: 'ok', texto }
  }
  const orden = origenCredenciales(modo, esBaseNativaClaude(base, home), plataforma)
  const fuentes = fuentesEnOrden(orden, llavero, desdeFichero)

  // La primera fuente que dé un token gana. Lo demás se recuerda por prioridad para elegir un
  // solo mensaje: `sin-oauth` (cuenta por API key), `fallo` (un accidente: conserva el último
  // dato bueno) y `ausente` (nada en ninguna parte).
  let sinOauth = false
  let fallo: string | null = null
  for (const fuente of fuentes) {
    const res = await leerFuenteSegura(fuente)
    if (res.clase === 'fallo') {
      fallo ??= res.detalle
      continue
    }
    if (res.clase === 'ausente') continue
    const leido = tokenDeCredenciales(res.texto)
    if (leido.clase === 'token') return leido
    if (leido.clase === 'sin-oauth') sinOauth = true
  }
  if (sinOauth) return { clase: 'sin-oauth' }
  if (fallo !== null) return { clase: 'fallo', detalle: fallo }
  return { clase: 'ausente' }
}
