// =============================================================================
// El historial de conversaciones en la copia. Al exportar, recoge las conversaciones de las cuentas de
// Docker de los perfiles elegidos (y, si se pide, las nativas) con la ruta de cada proyecto de Claude Code.
// Al importar, lleva cada una a su cuenta (la crea sin sesión si falta), cambia la carpeta del proyecto si
// aquí está en otra ruta y fusiona sin pisar: igual, se salta; su principio, se pone al día (salvo si un agente
// la tiene abierta); distinto, se conserva el de aquí. Nada se escribe fuera de su cuenta ni por un enlace.
// Decisiones: docs/decisiones/configuracion/historial-en-la-copia.md
// =============================================================================

import { randomBytes } from 'node:crypto'
import { lstat, mkdir, open, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import type { AgenteHistorial, FuenteHistorial, ResumenHistorialImportado } from '../../shared/copia-configuracion-ipc.ts'
import type { AlmacenCuentas } from '../agentes/AlmacenCuentas.ts'
import { leerCabezaParseada } from '../transcripts/cabezaJsonl.ts'
import { metaDeCabecera } from '../transcripts/formatoTranscripcion.ts'
import { bytesHastaLineaCompleta, compararConDestino } from '../traspaso/copiaTranscripcion.ts'
import { pasaPorEnlace } from '../util/enlaces.ts'
import { carpetaDe, conCarpeta, destinoProyecto, type DestinoProyecto } from './emparejarProyectos.ts'
import { esConversacion, esPrincipal, listarConversaciones, tramoSeguro, type ArchivoHistorial } from './inclusionHistorial.ts'
import { txConfiguracion } from './textos.ts'
import { archivoQueSeFue, type EscritorCopia, type TrozoArchivo } from './trozosCopia.ts'

/** Una fuente tal como va dentro del contenido: con la ruta de origen de cada proyecto de Claude Code. */
export interface FuenteHistorialCopia extends FuenteHistorial {
  /** Carpeta de `projects/` → el `cwd` de sus conversaciones. */
  proyectos?: Record<string, string>
}

/** Una cuenta de Docker de un perfil, con su carpeta (sin crearla). */
export interface CuentaHistorial {
  id: string
  agente: AgenteHistorial
  nombre: string
  predeterminada: boolean
  base: string
}

/** Lo que necesita del resto del main. */
export interface DepsHistorial {
  cuentasDe: (perfil: string) => CuentaHistorial[]
  baseNativa: (agente: AgenteHistorial) => string
  /** La carpeta de la cuenta del perfil con ese agente y nombre; la crea (sin sesión) si no existe. Lanza si no puede. */
  carpetaDestino: (perfil: string, agente: AgenteHistorial, nombre: string, predeterminada: boolean) => string
  /** Los proyectos abiertos en este equipo, por perfil. */
  proyectos: () => Array<{ profileId: string; projectHostPath: string }>
  /** Los ids de las conversaciones en las que está ahora una sesión de agente de Tessera (las que se saben). */
  conversacionesAbiertas: () => ReadonlySet<string>
}

/**
 * Un transcript tocado hace menos de esto puede tener un CLI escribiendo en él, también uno lanzado fuera de
 * Tessera: no se sustituye. Sustituirlo dejaría al CLI escribiendo en el archivo viejo ya desenlazado (macOS
 * y Linux) y esos turnos se perderían.
 */
export const VENTANA_EN_USO_MS = 10 * 60_000

const AGENTES: readonly AgenteHistorial[] = ['claude-code', 'codex']

type Cuentas = Pick<AlmacenCuentas, 'listar' | 'rutaDe' | 'dirHostDe' | 'predeterminadaDe' | 'crear'>

/** Las cuentas del historial sobre el registro de cuentas: se lee con `rutaDe` (sin tocar el disco) y se crea al importar. */
export function cuentasDelHistorial(cuentas: Cuentas): Pick<DepsHistorial, 'cuentasDe' | 'carpetaDestino'> {
  return {
    cuentasDe: (perfil) =>
      AGENTES.flatMap((agente) =>
        cuentas.listar(perfil, agente).map((a) => ({ id: a.id, agente, nombre: a.nombre, predeterminada: a.isDefault === true, base: cuentas.rutaDe(a) }))
      ),
    carpetaDestino: (perfil, agente, nombre, predeterminada) => {
      if (predeterminada) return cuentas.dirHostDe(cuentas.predeterminadaDe(perfil, agente))
      const clave = nombre.trim().toLocaleLowerCase()
      const hay = cuentas.listar(perfil, agente).find((a) => !a.isDefault && a.nombre.trim().toLocaleLowerCase() === clave)
      return cuentas.dirHostDe(hay ?? cuentas.crear({ nombre, agente, profileId: perfil }))
    }
  }
}

/** Una fuente con sus archivos, lista para escribir. */
export interface FuenteRecogida {
  fuente: FuenteHistorialCopia
  archivos: ArchivoHistorial[]
}

async function cwdDe(archivo: string): Promise<string | null> {
  try {
    const lineas = await leerCabezaParseada(archivo, { presupuesto: 64 * 1024, lecturaMax: 32 * 1024 * 1024, trozo: 16 * 1024 })
    return metaDeCabecera('claude-code', lineas).cwd
  } catch {
    return null
  }
}

/** La ruta de cada carpeta de proyecto, por el `cwd` de la primera conversación que lo diga. */
async function proyectosDe(archivos: readonly ArchivoHistorial[]): Promise<Record<string, string>> {
  const fuera: Record<string, string> = {}
  for (const a of archivos) {
    const carpeta = carpetaDe(a.rel)
    if (carpeta === null || carpeta in fuera || !esPrincipal('claude-code', a.rel)) continue
    const cwd = await cwdDe(a.abs)
    if (cwd) fuera[carpeta] = cwd
  }
  return fuera
}

/**
 * Lo que llevaría el historial: las cuentas de Docker de los perfiles y, con `nativo`, la carpeta nativa de
 * cada agente. Sin `conRutas` no abre ninguna conversación (es la vista previa, que lista con caché: `listar`).
 */
export async function recogerHistorial(
  d: DepsHistorial,
  perfiles: readonly string[],
  nativo: boolean,
  conRutas: boolean,
  listar: typeof listarConversaciones = listarConversaciones
): Promise<FuenteRecogida[]> {
  const fuentes: FuenteRecogida[] = []
  const anadir = async (agente: AgenteHistorial, base: string, perfil: string | null, cuenta: string | null, predeterminada: boolean): Promise<void> => {
    const archivos = await listar(agente, base)
    if (archivos.length === 0) return
    const fuente: FuenteHistorialCopia = {
      id: fuentes.length,
      agente,
      perfil,
      cuenta,
      predeterminada,
      conversaciones: archivos.filter((a) => esPrincipal(agente, a.rel)).length,
      bytes: archivos.reduce((n, a) => n + a.bytes, 0)
    }
    if (conRutas && agente === 'claude-code') fuente.proyectos = await proyectosDe(archivos)
    fuentes.push({ fuente, archivos })
  }
  for (const perfil of perfiles) {
    for (const c of d.cuentasDe(perfil)) await anadir(c.agente, c.base, perfil, c.nombre, c.predeterminada)
  }
  if (nativo) for (const agente of AGENTES) await anadir(agente, d.baseNativa(agente), null, null, false)
  return fuentes
}

/**
 * Escribe las conversaciones recogidas; un `.jsonl` solo hasta su última línea completa (el CLI puede seguir
 * escribiendo). Un archivo que desaparece o se bloquea desde el listado (Codex comprime los rollouts fríos y
 * borra el `.jsonl`) se salta; cualquier otro fallo (el disco lleno) corta. Devuelve cuántos se saltaron.
 */
export async function escribirHistorial(e: EscritorCopia, fuentes: readonly FuenteRecogida[]): Promise<number> {
  let saltados = 0
  for (const { fuente, archivos } of fuentes) {
    for (const a of archivos) {
      let bytes: number
      try {
        bytes = a.rel.endsWith('.jsonl') ? await bytesHastaLineaCompleta(a.abs) : a.bytes
      } catch (err) {
        if (!archivoQueSeFue(err)) throw err
        saltados++
        continue
      }
      if (!(await e.archivo(fuente.id, a.rel, a.abs, bytes))) saltados++
    }
  }
  return saltados
}

/** Qué hacer con un archivo que llega frente a lo que hay en su sitio. */
export type AccionImportar = 'escribir' | 'actualizar' | 'alDia' | 'conservar'

/**
 * La regla de no pisar. `alReves` dice si lo de aquí empieza por lo que llega (aquí siguió la conversación):
 * entonces lo de aquí ya está al día.
 */
export function accionImportar(estado: 'falta' | 'igual' | 'prefijo' | 'distinto', alReves: boolean): AccionImportar {
  if (estado === 'falta') return 'escribir'
  if (estado === 'prefijo') return 'actualizar'
  if (estado === 'igual' || alReves) return 'alDia'
  return 'conservar'
}

/**
 * La ruta absoluta de `rel` dentro de `base`, o null si no es una conversación de ese agente o quedaría
 * fuera. No mira el disco.
 */
export function rutaDentro(agente: AgenteHistorial, base: string, rel: string): string | null {
  if (!esConversacion(agente, rel)) return null
  const abs = path.resolve(base, ...rel.split('/'))
  const r = path.relative(path.resolve(base), abs)
  return r === '' || r.startsWith('..') || path.isAbsolute(r) ? null : abs
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await lstat(ruta)
    return true
  } catch {
    return false
  }
}

/** La otra forma de un rollout de Codex (con o sin `.zst`), que Codex trata como la misma conversación. */
function otraForma(abs: string): string | null {
  if (abs.endsWith('.jsonl.zst')) return abs.slice(0, -4)
  if (abs.endsWith('.jsonl')) return `${abs}.zst`
  return null
}

interface Destino {
  agente: AgenteHistorial
  base: string
  /** Carpeta de proyecto que llega → su destino aquí. */
  carpetas: Map<string, DestinoProyecto>
}

interface EnCurso {
  agente: AgenteHistorial
  rel: string
  abs: string
  tmp: string
  f: FileHandle
  principal: boolean
  cambiada: boolean
}

/** Importa el historial, un trozo tras otro. */
export class ImportadorHistorial {
  readonly resumen: ResumenHistorialImportado = {
    importadas: 0,
    actualizadas: 0,
    alDia: 0,
    conservadas: [],
    rutaCambiada: 0,
    rutaOriginal: [],
    saltadas: [],
    error: null
  }
  private readonly destinos = new Map<number, Destino>()
  private readonly original = new Map<string, { carpeta: string; conversaciones: number; motivo: string }>()
  private actual: EnCurso | null = null
  /** El archivo en curso no se escribe (no es elegido o no pasó la guarda): se ignoran sus partes. */
  private ignorando = false

  private readonly d: DepsHistorial

  constructor(d: DepsHistorial) {
    this.d = d
  }

  /** Prepara las fuentes elegidas: su carpeta de destino y adónde va cada proyecto de Claude Code. */
  preparar(fuentes: readonly FuenteHistorialCopia[]): void {
    const t = txConfiguracion().historial
    const abiertos = this.d.proyectos()
    const origenes = fuentes.flatMap((f) => Object.values(f.proyectos ?? {}))
    for (const f of fuentes) {
      let base: string
      try {
        // El id del perfil acaba en la ruta de la cuenta: uno que no es un tramo limpio no recibe nada.
        if (f.perfil !== null && !tramoSeguro(f.perfil)) throw new Error(t.fueraDeLaCuenta)
        base = f.perfil === null ? this.d.baseNativa(f.agente) : this.d.carpetaDestino(f.perfil, f.agente, f.cuenta ?? '', f.predeterminada)
      } catch (err) {
        this.resumen.saltadas.push({ ruta: f.cuenta ?? f.agente, motivo: t.sinCuenta(f.cuenta ?? f.agente, err instanceof Error ? err.message : String(err)) })
        continue
      }
      const candidatos = abiertos.filter((p) => f.perfil === null || p.profileId === f.perfil).map((p) => p.projectHostPath)
      const carpetas = new Map<string, DestinoProyecto>()
      for (const [carpeta, cwd] of Object.entries(f.proyectos ?? {})) carpetas.set(carpeta, destinoProyecto(cwd, candidatos, origenes))
      this.destinos.set(f.id, { agente: f.agente, base, carpetas })
    }
  }

  /** La ruta de destino de un archivo, con su carpeta de proyecto cambiada si toca. */
  private relDestino(dst: Destino, rel: string, principal: boolean): { rel: string; cambiada: boolean } {
    const carpeta = dst.agente === 'claude-code' ? carpetaDe(rel) : null
    const destino = carpeta === null ? undefined : dst.carpetas.get(carpeta)
    if (carpeta === null || destino === undefined || destino.tipo === 'igual') return { rel, cambiada: false }
    if (destino.tipo === 'cambiada') return { rel: conCarpeta(rel, destino.carpeta), cambiada: true }
    if (principal) {
      const t = txConfiguracion().historial
      const motivos = { varios: t.varios, variosOrigen: t.variosOrigen, larga: t.larga, sinProyecto: t.sinProyecto }
      const motivo = motivos[destino.tipo](destino.nombre)
      const o = this.original.get(carpeta) ?? { carpeta, conversaciones: 0, motivo }
      o.conversaciones++
      this.original.set(carpeta, o)
    }
    return { rel, cambiada: false }
  }

  private async empezar(m: TrozoArchivo['meta']): Promise<void> {
    const dst = this.destinos.get(m.fuente)
    this.ignorando = true
    if (!dst) return
    const t = txConfiguracion().historial
    const principal = esPrincipal(dst.agente, m.ruta)
    const { rel, cambiada } = esConversacion(dst.agente, m.ruta) ? this.relDestino(dst, m.ruta, principal) : { rel: m.ruta, cambiada: false }
    const abs = rutaDentro(dst.agente, dst.base, rel)
    if (abs === null) {
      this.resumen.saltadas.push({ ruta: m.ruta, motivo: t.fueraDeLaCuenta })
      return
    }
    if (await pasaPorEnlace(dst.base, abs)) {
      this.resumen.saltadas.push({ ruta: rel, motivo: t.enlace })
      return
    }
    await mkdir(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.tessera-importando-${randomBytes(4).toString('hex')}`
    this.actual = { agente: dst.agente, rel, abs, tmp, f: await open(tmp, 'wx'), principal, cambiada }
    this.ignorando = false
  }

  /**
   * ¿Puede haber un CLI escribiendo ahora en esta conversación? Si una sesión de Tessera está en ella (también
   * en el hilo de uno de sus subagentes) o el archivo se tocó hace poco (`VENTANA_EN_USO_MS`).
   */
  private async enUso(a: EnCurso): Promise<boolean> {
    const nombres = a.rel.split('/').map((n) => n.replace(/\.jsonl(\.zst)?$/, ''))
    for (const id of this.d.conversacionesAbiertas()) {
      if (nombres.some((n) => n === id || n.endsWith(`-${id}`))) return true
    }
    try {
      return Date.now() - (await stat(a.abs)).mtimeMs < VENTANA_EN_USO_MS
    } catch {
      return false
    }
  }

  private async terminar(a: EnCurso): Promise<void> {
    await a.f.close()
    const t = txConfiguracion().historial
    const otra = a.agente === 'codex' ? otraForma(a.abs) : null
    if (otra !== null && (await existe(otra))) {
      await rm(a.tmp, { force: true })
      if (a.principal) this.resumen.conservadas.push({ ruta: a.rel, motivo: t.otroFormato })
      return
    }
    const estado = await compararConDestino(a.tmp, a.abs)
    const alReves = estado === 'distinto' && (await compararConDestino(a.abs, a.tmp)) === 'prefijo'
    let accion = accionImportar(estado, alReves)
    const abierta = accion === 'actualizar' && (await this.enUso(a))
    if (abierta) accion = 'conservar'
    if (accion === 'escribir' || accion === 'actualizar') await rename(a.tmp, a.abs)
    else await rm(a.tmp, { force: true })
    if (a.principal) this.contar(a, accion, abierta)
  }

  private contar(a: EnCurso, accion: AccionImportar, abierta: boolean): void {
    const t = txConfiguracion().historial
    if (a.cambiada && (accion === 'escribir' || accion === 'actualizar')) this.resumen.rutaCambiada++
    if (accion === 'escribir') this.resumen.importadas++
    else if (accion === 'actualizar') this.resumen.actualizadas++
    else if (accion === 'alDia') this.resumen.alDia++
    else this.resumen.conservadas.push({ ruta: a.rel, motivo: abierta ? t.abierta : t.distinto })
  }

  /** Atiende un trozo de datos. Un fallo de disco en un archivo lo salta (y borra su temporal), no corta el resto. */
  async trozo({ meta, datos }: TrozoArchivo): Promise<void> {
    try {
      if (meta.parte === 0) await this.empezar(meta)
      const a = this.actual
      if (this.ignorando || a === null) return
      await a.f.write(datos)
      if (!meta.ultima) return
      // Sigue en curso hasta que acaba: si `terminar` falla, `soltar` borra su temporal.
      await this.terminar(a)
      this.actual = null
    } catch (err) {
      await this.soltar()
      this.ignorando = true
      this.resumen.saltadas.push({ ruta: meta.ruta, motivo: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Borra el temporal del archivo a medias, si hay. */
  async soltar(): Promise<void> {
    const a = this.actual
    this.actual = null
    if (!a) return
    await a.f.close().catch(() => {})
    await rm(a.tmp, { force: true })
  }

  /** El resumen con las carpetas que se quedaron con su ruta de origen. */
  cerrar(error: string | null): ResumenHistorialImportado {
    this.resumen.rutaOriginal = [...this.original.values()]
    this.resumen.error = error
    return this.resumen
  }
}
