// =============================================================================
// Lee y guarda los archivos de configuración de un agente en su carpeta real. El CLI también escribe
// en ellos, así que guardar compara con lo leído en vez de pisar. La carpeta de una cuenta de Docker
// está montada con escritura dentro de su contenedor: se desconfía de lo que haya en ella y no se lee
// ni se escribe a través de un enlace. En la nativa, en cambio, un enlace es del usuario y se respeta.
// Decisiones: docs/decisiones/agentes/configuracion-editable.md
// =============================================================================

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ARCHIVOS_CONFIG_AGENTE,
  MAX_BYTES_CONFIG_AGENTE,
  TIPOS_ARCHIVO_CONFIG,
  type AgenteConConfig,
  type ArchivoConfigLeido,
  type BloqueoArchivoConfig,
  type ConfigAgenteLeida,
  type GuardarConfigRequest,
  type ClaveFijada,
  type RefConfigAgente,
  type ResultadoGuardarConfig,
  type TipoArchivoConfig
} from '../../../shared/configAgente-ipc.ts'
import { escribirSinSeguirEnlaces } from '../../util/atomicWrite.ts'
import { avisosConfig, errorSintaxisConfig } from './validarConfigAgente.ts'

/** Solo para quien lo crea: estos archivos pueden llevar tokens de servidores MCP. */
const MODO_ARCHIVO_NUEVO = 0o600

/** La copia de lo que había antes de la última vez que se guardó desde Tessera. */
export const SUFIJO_ANTERIOR = '.tessera-anterior'

export interface DepsConfigAgente {
  /** La carpeta del agente o la cuenta; null si no existe o es de otro agente. `crear` solo al guardar. */
  carpetaDe: (ref: RefConfigAgente, opciones: { crear: boolean }) => string | null
  sesionesAbiertas: (ref: RefConfigAgente) => number
  /** Las claves que la configuración compartida fija en esa cuenta; vacío si no es de Docker o su perfil no la usa. */
  fijadas?: (ref: RefConfigAgente) => Promise<ClaveFijada[]>
}

export interface LecturaDisco {
  contenido: string
  version: string | null
  modo: number | null
  bloqueo: BloqueoArchivoConfig | null
}

const huella = (contenido: string): string => createHash('sha256').update(contenido, 'utf8').digest('hex')

const bloqueado = (bloqueo: BloqueoArchivoConfig): LecturaDisco => ({ contenido: '', version: null, modo: null, bloqueo })

/** Un texto que no es UTF-8 no se abre: decodificarlo y guardarlo destruiría el original sin remedio. */
function decodificar(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Lee sin seguir enlaces: uno plantado desde el contenedor podría señalar a cualquier archivo del equipo.
 * `lstat` solo no basta, porque el archivo puede cambiar antes de abrirlo: `O_NOFOLLOW` lo impide y, donde no
 * existe, se compara lo abierto con lo mirado. `O_NONBLOCK` evita quedarse colgado si lo cambian por una tubería.
 */
export async function leerDeDisco(ruta: string): Promise<LecturaDisco> {
  let info
  try {
    info = await lstat(ruta)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { contenido: '', version: null, modo: null, bloqueo: null }
    throw err
  }
  if (!info.isFile()) return bloqueado('no-regular')
  if (info.size > MAX_BYTES_CONFIG_AGENTE) return bloqueado('demasiado-grande')
  let archivo
  try {
    archivo = await open(ruta, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ELOOP') return bloqueado('no-regular')
    throw err
  }
  try {
    const abierto = await archivo.stat()
    if (!abierto.isFile() || abierto.ino !== info.ino || abierto.dev !== info.dev) return bloqueado('no-regular')
    if (abierto.size > MAX_BYTES_CONFIG_AGENTE) return bloqueado('demasiado-grande')
    const contenido = decodificar(await archivo.readFile())
    if (contenido === null) return bloqueado('no-utf8')
    return { contenido, version: huella(contenido), modo: abierto.mode & 0o777, bloqueo: null }
  } finally {
    await archivo.close()
  }
}

/** En la carpeta nativa un enlace es del usuario (dotfiles, una carpeta sincronizada): se trabaja con su destino. */
async function rutaEfectiva(ruta: string, ref: RefConfigAgente): Promise<string> {
  return ref.accountId === null ? realpath(ruta).catch(() => ruta) : ruta
}

function esAgenteConConfig(valor: unknown): valor is AgenteConConfig {
  return valor === 'claude-code' || valor === 'codex'
}

function esCapa(valor: unknown): boolean {
  const c = valor as { tipo?: unknown; profileId?: unknown } | null
  return c?.tipo === 'global' || (c?.tipo === 'perfil' && typeof c.profileId === 'string' && c.profileId !== '')
}

function esRef(valor: unknown): valor is RefConfigAgente {
  const ref = valor as Partial<RefConfigAgente> | null
  if (!esAgenteConConfig(ref?.agente)) return false
  if (ref?.capa !== undefined) return esCapa(ref.capa)
  return ref?.accountId === null || typeof ref?.accountId === 'string'
}

function esTipo(valor: unknown): valor is TipoArchivoConfig {
  return TIPOS_ARCHIVO_CONFIG.includes(valor as TipoArchivoConfig)
}

/** Lo que se rechaza sin tocar el disco: una petición mal formada, un texto demasiado grande o con errores. */
function rechazoDeEntrada(req: GuardarConfigRequest): ResultadoGuardarConfig | null {
  if (!esRef(req?.ref) || !esTipo(req?.tipo) || typeof req?.contenido !== 'string') return { estado: 'cuenta-no-disponible' }
  // Una capa compartida solo tiene configuración técnica: las reglas son parte del contexto.
  if (req.ref.capa !== undefined && req.tipo !== 'configuracion') return { estado: 'cuenta-no-disponible' }
  if (Buffer.byteLength(req.contenido, 'utf8') > MAX_BYTES_CONFIG_AGENTE) return { estado: 'demasiado-grande' }
  const sintaxis = errorSintaxisConfig(req.ref.agente, req.tipo, req.contenido)
  if (sintaxis === 'raiz-json') return { estado: 'raiz-json' }
  return sintaxis ? { estado: 'sintaxis', ...sintaxis } : null
}

export class ServicioConfigAgente {
  private readonly deps: DepsConfigAgente

  constructor(deps: DepsConfigAgente) {
    this.deps = deps
  }

  async leer(ref: unknown): Promise<ConfigAgenteLeida | null> {
    if (!esRef(ref)) return null
    const carpeta = this.deps.carpetaDe(ref, { crear: false })
    if (carpeta === null) return null
    const [configuracion, instrucciones] = await Promise.all(TIPOS_ARCHIVO_CONFIG.map((tipo) => this.archivo(carpeta, ref, tipo)))
    const fijadas = ref.capa === undefined && this.deps.fijadas ? await this.deps.fijadas(ref) : []
    const sesionesAbiertas = ref.capa === undefined ? this.deps.sesionesAbiertas(ref) : 0
    return { carpeta, archivos: { configuracion, instrucciones }, sesionesAbiertas, fijadas }
  }

  async leerAnterior(ref: unknown, tipo: unknown): Promise<string | null> {
    if (!esRef(ref) || !esTipo(tipo)) return null
    const carpeta = this.deps.carpetaDe(ref, { crear: false })
    if (carpeta === null) return null
    const anterior = await leerDeDisco(this.rutaAnterior(carpeta, ref.agente, tipo))
    return anterior.version === null ? null : anterior.contenido
  }

  async guardar(req: GuardarConfigRequest): Promise<ResultadoGuardarConfig> {
    const rechazo = rechazoDeEntrada(req)
    if (rechazo) return rechazo
    const { ref, tipo, contenido } = req
    const carpeta = this.deps.carpetaDe(ref, { crear: true })
    if (carpeta === null) return { estado: 'cuenta-no-disponible' }

    const ruta = await rutaEfectiva(join(carpeta, ARCHIVOS_CONFIG_AGENTE[ref.agente][tipo]), ref)
    const actual = await leerDeDisco(ruta)
    if (actual.bloqueo) return { estado: actual.bloqueo }
    if (!req.sobrescribir && actual.version !== req.versionLeida) return { estado: 'cambio-externo' }
    if (actual.version === null || actual.contenido !== contenido) {
      if (actual.version !== null) await escribirSinSeguirEnlaces(this.rutaAnterior(carpeta, ref.agente, tipo), actual.contenido, actual.modo ?? undefined)
      await escribirSinSeguirEnlaces(ruta, contenido, actual.modo ?? MODO_ARCHIVO_NUEVO)
    }
    return { estado: 'guardado', archivo: await this.archivo(carpeta, ref, tipo) }
  }

  private rutaAnterior(carpeta: string, agente: AgenteConConfig, tipo: TipoArchivoConfig): string {
    return join(carpeta, `${ARCHIVOS_CONFIG_AGENTE[agente][tipo]}${SUFIJO_ANTERIOR}`)
  }

  private async archivo(carpeta: string, ref: RefConfigAgente, tipo: TipoArchivoConfig): Promise<ArchivoConfigLeido> {
    const { agente } = ref
    const nombre = ARCHIVOS_CONFIG_AGENTE[agente][tipo]
    const { contenido, version, bloqueo } = await leerDeDisco(await rutaEfectiva(join(carpeta, nombre), ref))
    const anterior = await leerDeDisco(this.rutaAnterior(carpeta, agente, tipo))
    return { tipo, nombre, contenido, version, bloqueo, hayAnterior: anterior.version !== null, avisos: avisosConfig(agente, tipo, contenido) }
  }
}
