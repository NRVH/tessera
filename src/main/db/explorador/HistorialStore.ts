// =============================================================================
// Historial de consultas del explorador: cada sentencia de consola que llegó al servidor, por perfil, en JSON Lines
// fuera del espacio de datos que lee el agente. Tapa las contraseñas al anotar y compacta con `writeFileAtomic`.
// El sistema de archivos se inyecta (`FsHistorial`): se prueba con `node` a secas.
// Decisiones: docs/decisiones/bd/explorador-historial.md
// =============================================================================

import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { DbEntradaHistorial, DbFiltroHistorial, DbLenguajeHistorial } from '../../../shared/db-explorador-ipc.ts'
import type { DialectoSql } from '../../../shared/sql/dialectosSql.ts'
import { taparSecretosSql } from '../../../shared/sql/secretosSql.ts'
import { taparSecretosMongo } from '../../../shared/secretosMongo.ts'
import { taparSecretosRedis } from '../../../shared/secretosRedis.ts'
import { writeFileAtomic } from '../../util/atomicWrite.ts'
import { KeyedMutex } from '../../util/mutex.ts'
import {
  HISTORIAL_LISTAR_MAX,
  HISTORIAL_LISTAR_POR_DEFECTO,
  MARGEN_COMPACTAR_HISTORIAL,
  TOPE_BYTES_HISTORIAL,
  TOPE_HISTORIAL_POR_PERFIL,
  TOPE_SQL_HISTORIAL
} from './limites.ts'

/** Lo que el store usa del sistema de archivos. */
export interface FsHistorial {
  /** Contenido, o null si no existe. */
  leer(ruta: string): Promise<string | null>
  /** Añade al final (crea el archivo y su carpeta si hace falta). */
  anexar(ruta: string, texto: string): Promise<void>
  /** Reescribe de forma atómica y durable. */
  escribir(ruta: string, texto: string): Promise<void>
  /** Borra; no falla si no existe. */
  borrar(ruta: string): Promise<void>
}

function codigo(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code
}

/** El de verdad: `fs/promises` + `writeFileAtomic`. */
export const FS_NODO: FsHistorial = {
  async leer(ruta) {
    try {
      return await readFile(ruta, 'utf8')
    } catch (e) {
      if (codigo(e) === 'ENOENT') return null
      throw e
    }
  },
  async anexar(ruta, texto) {
    await mkdir(path.dirname(ruta), { recursive: true })
    await appendFile(ruta, texto, 'utf8')
  },
  escribir: (ruta, texto) => writeFileAtomic(ruta, texto),
  async borrar(ruta) {
    try {
      await unlink(ruta)
    } catch (e) {
      if (codigo(e) !== 'ENOENT') throw e
    }
  }
}

export interface OpcionesHistorial {
  /** `<userData>/db-historial`. */
  dir: string
  fs?: FsHistorial
  tope?: number
  margen?: number
  topeBytes?: number
  topeSql?: number
  nuevoId?: () => string
  log?: (linea: string) => void
}

/** Una entrada antes de tener id (la pone el store). */
export type NuevaEntrada = Omit<DbEntradaHistorial, 'id'>

/** Cuántas entradas de un lenguaje hay y cuánto ocupan sus líneas (unidades UTF-16). */
interface Medida {
  cuenta: number
  tamano: number
}

const lenguajeDe = (e: DbEntradaHistorial): DbLenguajeHistorial => e.lenguaje ?? 'sql'

/** La medida de cada lenguaje: los topes son POR LENGUAJE, y una consola no empuja fuera el historial de la otra. */
function medir(entradas: readonly DbEntradaHistorial[]): Record<DbLenguajeHistorial, Medida> {
  const por: Record<DbLenguajeHistorial, Medida> = { sql: { cuenta: 0, tamano: 0 }, mongosh: { cuenta: 0, tamano: 0 }, comandos: { cuenta: 0, tamano: 0 } }
  for (const e of entradas) {
    const m = por[lenguajeDe(e)]
    m.cuenta++
    m.tamano += linea(e).length
  }
  return por
}

interface EstadoPerfil {
  /** De la más vieja a la más reciente, como en el archivo. */
  entradas: DbEntradaHistorial[]
  /** La medida de cada lenguaje, para saber cuándo compactar el suyo. */
  por: Record<DbLenguajeHistorial, Medida>
  /** El archivo acaba en salto de línea (o no existe). */
  terminaEnSalto: boolean
}

const RESULTADOS: ReadonlyArray<DbEntradaHistorial['resultado']> = ['ok', 'error', 'cancelada']
const EXTENSION = '.jsonl'
const NOMBRE_SIMPLE = /^[A-Za-z0-9_-]{1,100}$/

/**
 * Nombre del archivo de un perfil: su id si es un nombre de archivo sencillo; si no
 * (espacios, tildes, un nombre reservado de Windows…), un resumen fijo del id. Así
 * ningún id puede salirse de la carpeta ni chocar con las reglas de NTFS o APFS.
 */
export function archivoDePerfil(perfilId: string): string {
  if (NOMBRE_SIMPLE.test(perfilId) && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(perfilId)) return perfilId + EXTENSION
  return 'p-' + createHash('sha256').update(perfilId, 'utf8').digest('hex').slice(0, 32) + EXTENSION
}

/** Sin caja y sin tildes: «Año» encuentra «ano» y al revés. */
export function normalizarBusqueda(t: string): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function esEntrada(v: unknown): v is DbEntradaHistorial {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const e = v as Record<string, unknown>
  return tieneCamposObligatorios(e) && tieneCamposOpcionales(e)
}

function tieneCamposObligatorios(e: Record<string, unknown>): boolean {
  return (
    typeof e.id === 'string' &&
    typeof e.en === 'number' &&
    typeof e.perfilId === 'string' &&
    typeof e.conexionId === 'string' &&
    typeof e.consolaId === 'string' &&
    typeof e.sql === 'string' &&
    RESULTADOS.indexOf(e.resultado as DbEntradaHistorial['resultado']) >= 0 &&
    typeof e.ms === 'number'
  )
}

function tieneCamposOpcionales(e: Record<string, unknown>): boolean {
  return (
    (e.filas === undefined || typeof e.filas === 'number') &&
    (e.esquema === undefined || e.esquema === null || typeof e.esquema === 'string') &&
    (e.lenguaje === undefined || e.lenguaje === 'mongosh' || e.lenguaje === 'comandos')
  )
}

/** Líneas de un archivo -> entradas válidas (las rotas se saltan). */
export function parsearHistorial(texto: string): DbEntradaHistorial[] {
  const salida: DbEntradaHistorial[] = []
  for (const linea of texto.split('\n')) {
    const t = linea.trim()
    if (!t) continue
    try {
      const v: unknown = JSON.parse(t)
      if (esEntrada(v)) salida.push(v)
    } catch {
      // línea a medio escribir o corrupta
    }
  }
  return salida
}

function linea(e: DbEntradaHistorial): string {
  return JSON.stringify(e) + '\n'
}

export class HistorialStore {
  private readonly dir: string
  private readonly fs: FsHistorial
  private readonly tope: number
  private readonly margen: number
  private readonly topeBytes: number
  /** Tamaño al que se recorta al compactar (ver la cabecera): por debajo de `topeBytes`. */
  private readonly objetivoBytes: number
  private readonly topeSql: number
  private readonly nuevoId: () => string
  private readonly log: (linea: string) => void
  private readonly estados = new Map<string, EstadoPerfil>()
  /** La fila de cada perfil (ver la cabecera). */
  private readonly filas = new KeyedMutex()
  /**
   * El texto de cada entrada ya sin caja ni tildes: el filtro del renderer pregunta en
   * cada tecla, y normalizar 5000 sentencias cada vez era trabajo repetido.
   */
  private readonly normalizadas = new WeakMap<DbEntradaHistorial, string>()

  private normalizada(e: DbEntradaHistorial): string {
    let n = this.normalizadas.get(e)
    if (n === undefined) {
      n = normalizarBusqueda(e.sql)
      this.normalizadas.set(e, n)
    }
    return n
  }

  constructor(op: OpcionesHistorial) {
    this.dir = op.dir
    this.fs = op.fs ?? FS_NODO
    this.tope = Math.max(1, op.tope ?? TOPE_HISTORIAL_POR_PERFIL)
    this.margen = Math.max(0, op.margen ?? MARGEN_COMPACTAR_HISTORIAL)
    this.topeBytes = Math.max(1, op.topeBytes ?? TOPE_BYTES_HISTORIAL)
    this.objetivoBytes = Math.max(1, Math.floor((this.topeBytes * this.tope) / (this.tope + this.margen)))
    this.topeSql = Math.max(1, op.topeSql ?? TOPE_SQL_HISTORIAL)
    this.nuevoId = op.nuevoId ?? randomUUID
    this.log = op.log ?? (() => {})
  }

  private ruta(perfilId: string): string {
    return path.join(this.dir, archivoDePerfil(perfilId))
  }

  /** Encola `fn` en la fila del perfil. Un fallo no rompe la fila de las siguientes. */
  private enFila<T>(perfilId: string, fn: () => Promise<T>): Promise<T> {
    return this.filas.runExclusive(perfilId, fn)
  }

  private async cargar(perfilId: string): Promise<EstadoPerfil> {
    const hay = this.estados.get(perfilId)
    if (hay) return hay
    const texto = await this.fs.leer(this.ruta(perfilId))
    const entradas = texto === null ? [] : parsearHistorial(texto)
    const estado: EstadoPerfil = {
      entradas,
      por: medir(entradas),
      terminaEnSalto: texto === null || texto === '' || texto.endsWith('\n')
    }
    this.estados.set(perfilId, estado)
    return estado
  }

  /** Reescribe el archivo con `entradas` (o lo borra si no queda ninguna) y borra el `.bak`. */
  private async reescribir(perfilId: string, estado: EstadoPerfil, entradas: DbEntradaHistorial[]): Promise<void> {
    const ruta = this.ruta(perfilId)
    if (entradas.length === 0) await this.fs.borrar(ruta)
    else await this.fs.escribir(ruta, entradas.map(linea).join(''))
    await this.fs.borrar(ruta + '.bak')
    estado.entradas = entradas
    estado.por = medir(entradas)
    estado.terminaEnSalto = true
  }

  /**
   * De `lenguaje`, las más recientes que caben en el tope de número y en el objetivo de tamaño; las
   * del otro lenguaje se quedan todas. En orden de archivo.
   */
  private recortar(entradas: readonly DbEntradaHistorial[], lenguaje: DbLenguajeHistorial): DbEntradaHistorial[] {
    const quedan: DbEntradaHistorial[] = []
    let cuenta = 0
    let tamano = 0
    let lleno = false
    for (let i = entradas.length - 1; i >= 0; i--) {
      const e = entradas[i]
      if (lenguajeDe(e) !== lenguaje) {
        quedan.push(e)
        continue
      }
      const t = linea(e).length
      if (lleno || cuenta >= this.tope || tamano + t > this.objetivoBytes) {
        lleno = true
        continue
      }
      cuenta++
      tamano += t
      quedan.push(e)
    }
    return quedan.reverse()
  }

  /**
   * Añade una entrada (con las contraseñas tapadas). Nunca lanza: el historial no
   * puede romper la ejecución que lo produjo; un fallo va al registro.
   */
  anotar(e: NuevaEntrada, d: DialectoSql): Promise<void> {
    if (e.sql.length > this.topeSql) return Promise.resolve()
    return this.guardar({ id: this.nuevoId(), ...e, sql: taparSecretosSql(e.sql, d) })
  }

  /** Lo mismo para una orden del shell de MongoDB (`sql` es su texto), con sus contraseñas tapadas. */
  anotarMongosh(e: Omit<NuevaEntrada, 'lenguaje'>): Promise<void> {
    if (e.sql.length > this.topeSql) return Promise.resolve()
    return this.guardar({ id: this.nuevoId(), ...e, sql: taparSecretosMongo(e.sql), lenguaje: 'mongosh' })
  }

  /** Lo mismo para un comando de la consola de Redis (`sql` es su texto), con sus contraseñas tapadas. */
  anotarRedis(e: Omit<NuevaEntrada, 'lenguaje'>): Promise<void> {
    if (e.sql.length > this.topeSql) return Promise.resolve()
    return this.guardar({ id: this.nuevoId(), ...e, sql: taparSecretosRedis(e.sql), lenguaje: 'comandos' })
  }

  private guardar(e: DbEntradaHistorial): Promise<void> {
    return this.enFila(e.perfilId, async () => {
      const estado = await this.cargar(e.perfilId)
      const l = linea(e)
      await this.fs.anexar(this.ruta(e.perfilId), (estado.terminaEnSalto ? '' : '\n') + l)
      estado.terminaEnSalto = true
      estado.entradas.push(e)
      const m = estado.por[lenguajeDe(e)]
      m.cuenta++
      m.tamano += l.length
      if (m.cuenta > this.tope + this.margen || m.tamano > this.topeBytes) {
        await this.reescribir(e.perfilId, estado, this.recortar(estado.entradas, lenguajeDe(e)))
      }
    }).catch((err: unknown) => {
      this.log(`historial: no se pudo anotar (${codigo(err) ?? 'error'})`)
    })
  }

  /** Las entradas del perfil que pasan el filtro, la más reciente primero. */
  listar(filtro: DbFiltroHistorial): Promise<DbEntradaHistorial[]> {
    return this.enFila(filtro.perfilId, async () => {
      const estado = await this.cargar(filtro.perfilId)
      const limiteCrudo = typeof filtro.limite === 'number' && Number.isFinite(filtro.limite) ? Math.floor(filtro.limite) : HISTORIAL_LISTAR_POR_DEFECTO
      const limite = Math.max(1, Math.min(HISTORIAL_LISTAR_MAX, limiteCrudo))
      const aguja = filtro.texto ? normalizarBusqueda(filtro.texto) : ''
      const salida: DbEntradaHistorial[] = []
      for (let i = estado.entradas.length - 1; i >= 0 && salida.length < limite; i--) {
        const e = estado.entradas[i]
        if (filtro.conexionId !== undefined && e.conexionId !== filtro.conexionId) continue
        if (filtro.lenguaje !== undefined && (e.lenguaje ?? 'sql') !== filtro.lenguaje) continue
        if (aguja && this.normalizada(e).indexOf(aguja) < 0) continue
        salida.push(e)
      }
      return salida
    })
  }

  /**
   * Borra esas entradas del perfil, o TODO su historial con `null`. Con `lenguaje` y `null`, solo
   * las de ese lenguaje: «Borrar todo» desde una consola no se lleva el historial de la otra.
   */
  borrar(perfilId: string, ids: readonly string[] | null, lenguaje?: DbLenguajeHistorial): Promise<void> {
    return this.enFila(perfilId, async () => {
      if (ids === null && lenguaje !== undefined) {
        const estado = await this.cargar(perfilId)
        const quedan = estado.entradas.filter((e) => (e.lenguaje ?? 'sql') !== lenguaje)
        if (quedan.length !== estado.entradas.length) await this.reescribir(perfilId, estado, quedan)
        // Un `.tmp` de una escritura cortada guarda el historial entero, también lo de este lenguaje.
        await this.fs.borrar(this.ruta(perfilId) + '.tmp')
        return
      }
      if (ids === null) {
        const ruta = this.ruta(perfilId)
        await this.fs.borrar(ruta)
        await this.fs.borrar(ruta + '.bak')
        await this.fs.borrar(ruta + '.tmp')
        this.estados.set(perfilId, { entradas: [], por: medir([]), terminaEnSalto: true })
        return
      }
      const estado = await this.cargar(perfilId)
      const fuera = new Set(ids)
      const quedan = estado.entradas.filter((e) => !fuera.has(e.id))
      if (quedan.length !== estado.entradas.length) await this.reescribir(perfilId, estado, quedan)
    })
  }

  /** La conexión se borró: fuera sus entradas (su id no volverá a existir). */
  borrarConexion(perfilId: string, conexionId: string): Promise<void> {
    return this.enFila(perfilId, async () => {
      const estado = await this.cargar(perfilId)
      const quedan = estado.entradas.filter((e) => e.conexionId !== conexionId)
      if (quedan.length !== estado.entradas.length) await this.reescribir(perfilId, estado, quedan)
    })
  }

  /** Espera a que termine lo encolado (tests y cierre). */
  async esperar(): Promise<void> {
    await this.filas.vaciar()
  }
}
