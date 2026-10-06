// =============================================================================
// Los archivos de las bases de archivo (SQLite) en el main: las fichas que sustituyen a la ruta en el IPC,
// la ruta de un archivo del proyecto y lo que se comprueba del archivo antes de darlo de alta, crearlo o
// montarlo. Puro, con la plataforma, el reloj y el `realpath` inyectados; sin `electron`.
// Decisiones: docs/decisiones/bd/conexiones-archivos-de-base-de-datos.md
// =============================================================================

import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Fichas, VIDA_FICHA_POR_DEFECTO_MS } from '../util/fichas.ts'
import { tocaContenedor } from '../../shared/jarPath.ts'
import { normalizarRelativaProyecto } from '../../shared/rutasHost.ts'
import { descriptor, etiquetaMotor, IDS_MOTORES } from '../../shared/motores/index.ts'
import { nunca } from '../../shared/nunca.ts'
import type { Plataforma } from '../../shared/plataforma.ts'
import type { DbArchivoElegido, DbMotor } from '../../shared/db-ipc.ts'
import { canonizarRutaArchivo, claveRutaArchivo, nombreArchivoDeRuta, type DepsRutaArchivo } from './rutaArchivoBd.ts'

/** Cuánto vale una ficha desde que se emite: la misma vida que las demás fichas (`util/fichas.ts`). */
export const VIDA_FICHA_MS = VIDA_FICHA_POR_DEFECTO_MS

/** Lo que el main recuerda de una ficha. */
export interface FichaArchivo {
  ruta: string
  motor: DbMotor
}

/** Mensaje de una ficha que el main no conoce (caducada o de antes de reiniciar). */
export const MENSAJE_FICHA_DESCONOCIDA = 'Ese archivo ya no está elegido (pasó demasiado tiempo o se reinició Tessera). Vuelve a elegirlo.'

/** Las fichas vivas del main, sobre las `Fichas` genéricas. Una instancia por proceso. */
export class FichasArchivo {
  private readonly fichas: Fichas<FichaArchivo>

  // Sin propiedades de parámetro: el test corre con `node` a secas (quita los tipos, no
  // transforma), y esa sintaxis no la admite.
  constructor(ahora: () => number = Date.now, vida: number = VIDA_FICHA_MS, nuevoToken: () => string = randomUUID) {
    this.fichas = new Fichas<FichaArchivo>({ ahora, vidaMs: vida, nuevoToken })
  }

  /** Emite una ficha para `ruta` (ya canónica) y devuelve lo que cruza al renderer. */
  emitir(ruta: string, motor: DbMotor, plataforma: Plataforma): DbArchivoElegido {
    const token = this.fichas.emitir({ ruta, motor })
    return { token, nombre: nombreArchivoDeRuta(ruta, plataforma) }
  }

  /** La ficha de `token` para `motor`. Lanza, con mensaje para el usuario, si no vale. */
  resolver(token: unknown, motor: DbMotor): FichaArchivo {
    const f = this.fichas.ver(token)
    if (!f) throw new Error(MENSAJE_FICHA_DESCONOCIDA)
    if (f.motor !== motor) {
      throw new Error(`Ese archivo se eligió para ${etiquetaMotor(f.motor)}, no para ${etiquetaMotor(motor)}: vuelve a elegirlo.`)
    }
    return { ...f }
  }

  /** Cuántas hay vivas (para el test). */
  get cuantas(): number {
    return this.fichas.cuantas
  }
}

// --- Archivos del proyecto --------------------------------------------------------------

function pathDe(plataforma: Plataforma): path.PlatformPath {
  return plataforma === 'windows' ? path.win32 : path.posix
}

/** ¿`ruta` cuelga ESTRICTAMENTE de `carpeta`? Por su clave (sin caja en Windows y Mac). */
export function dentroDeCarpeta(carpeta: string, ruta: string, plataforma: Plataforma): boolean {
  const sep = pathDe(plataforma).sep
  const c = claveRutaArchivo(carpeta, plataforma)
  const r = claveRutaArchivo(ruta, plataforma)
  const conSep = c.endsWith(sep) ? c : c + sep
  return r.startsWith(conSep) && r.length > conSep.length
}

/** Lo que devuelve `rutaDeArchivoDelProyecto`: la canónica y si existe (como `canonizarRutaArchivo`). */
export interface RutaDelProyecto {
  ruta: string
  existe: boolean
  codigoError?: string
}

/**
 * La ruta CANÓNICA del archivo `relPath` (POSIX, relativa a la contenedora) del proyecto
 * `projectHostPath`. Lanza, con mensaje para el usuario y sin rutas, si se sale del
 * proyecto por lo escrito o por lo real (un enlace), si está dentro de un comprimido o si
 * no nombra ningún archivo.
 */
export function rutaDeArchivoDelProyecto(projectHostPath: string, relPath: string, deps: DepsRutaArchivo): RutaDelProyecto {
  const p = pathDe(deps.plataforma)
  if (typeof projectHostPath !== 'string' || !p.isAbsolute(projectHostPath)) throw new Error('Proyecto desconocido.')
  if (typeof relPath !== 'string') throw new Error('Falta el archivo.')
  if (tocaContenedor(relPath)) throw new Error('Ese archivo está dentro de un comprimido: no se puede abrir como base de datos.')
  const rel = normalizarRelativaProyecto(relPath, deps.plataforma)
  if (rel === '') throw new Error('Falta el archivo.')
  const raiz = p.normalize(projectHostPath)
  const escrita = p.resolve(raiz, rel)
  if (!dentroDeCarpeta(raiz, escrita, deps.plataforma)) throw new Error('Ese archivo está fuera del proyecto.')
  const canon = canonizarRutaArchivo(escrita, deps)
  if (canon.existe) {
    // La raíz REAL del proyecto (una carpeta enlazada, `/tmp` → `/private/tmp`): contra ella
    // se compara la real del archivo. Si no se puede resolver, la escrita.
    let raizReal = raiz
    try {
      raizReal = deps.realpath(raiz)
    } catch {
      /* se compara con la escrita */
    }
    if (!dentroDeCarpeta(raizReal, canon.ruta, deps.plataforma)) {
      throw new Error(`«${nombreArchivoDeRuta(escrita, deps.plataforma)}» es un enlace a un archivo de fuera del proyecto: Tessera no lo abre como base de datos.`)
    }
  }
  return canon
}

/**
 * El nombre de una conexión nueva para el archivo `nombre` («Montar como base de datos»):
 * el nombre del archivo, y si ya lo lleva otra del perfil (sin caja, como la regla de
 * duplicados del registro), «nombre (2)», «nombre (3)»… Recortado a `max` sin partir el
 * sufijo.
 */
export function aliasLibre(nombre: string, ocupados: readonly string[], max: number): string {
  const usados = new Set(ocupados.map((a) => a.trim().toLowerCase()))
  const base = nombre.trim() || 'base'
  const recortar = (sufijo: string): string => base.slice(0, Math.max(1, max - sufijo.length)) + sufijo
  let candidato = recortar('')
  for (let n = 2; usados.has(candidato.toLowerCase()); n++) candidato = recortar(` (${n})`)
  return candidato
}

// --- Adaptadores por motor ----------------------------------------------------------------

/**
 * La parte de `src/tdb/sqliteComun.cjs` que usa el main (ver el ADR). Tipada aquí a
 * mano porque el main no importa los `.cjs` de `tdb`: los carga en ejecución de la carpeta
 * de la app.
 */
export interface ComunSqlite {
  inspeccionar(
    ruta: string,
    o?: { plataforma?: Plataforma }
  ): { nombre: string; tamano: number; cabecera: Uint8Array; hermanos: { wal: boolean; shm: boolean; journalCaliente: boolean } }
  decidirApertura(o: {
    nombre: string
    cabecera: Uint8Array
    tamano: number
    hermanos: { wal: boolean; shm: boolean; journalCaliente: boolean }
    soloLectura: boolean
    plataforma?: Plataforma
  }): { ok: true; modo: string; wal: boolean } | { ok: false; codigo: string; mensaje: string }
  crearBaseNueva(ruta: string, o?: { plataforma?: Plataforma }): void
  mensajePermiso(nombre: string, plataforma?: Plataforma): string
}

/** Lo que el main sabe hacer con el archivo de un motor de archivo. */
export interface AdaptadorArchivoBd {
  /** Lanza, con mensaje para el usuario, si el archivo no es de este motor o no se podría abrir así. */
  comprobar(ruta: string, soloLectura: boolean): void
  /** Crea una base NUEVA y vacía en `ruta` (que no existe). Lanza si ya existe. */
  crear(ruta: string): void
}

/** Un error de `sqliteComun` con su código, sin la ruta en el mensaje. */
function sinRutaSqlite(e: unknown, nombre: string, comun: ComunSqlite, plataforma: Plataforma): Error {
  const codigo = (e as { codigo?: unknown })?.codigo
  if (codigo === 'TESSERA-SQLITE-NO-EXISTE') return new Error(`No existe «${nombre}».`)
  if (codigo === 'TESSERA-SQLITE-PERMISO') return new Error(comun.mensajePermiso(nombre, plataforma))
  if (typeof codigo === 'string' && e instanceof Error) return e
  const errno = (e as NodeJS.ErrnoException)?.code
  if (errno === 'EPERM' || errno === 'EACCES') return new Error(comun.mensajePermiso(nombre, plataforma))
  return new Error(`No se pudo leer «${nombre}»${typeof errno === 'string' ? ` (${errno})` : ''}.`)
}

/**
 * El adaptador de archivo de `motor`, o null si el motor no es de archivo. `cargar` da el
 * módulo común de SQLite; se llama solo si hace falta (un alta de Oracle no lo carga).
 */
export function adaptadorArchivo(
  motor: DbMotor,
  cargar: () => ComunSqlite,
  plataforma: Plataforma
): AdaptadorArchivoBd | null {
  switch (motor) {
    case 'oracle':
    case 'postgres':
    case 'sqlserver':
    case 'mongodb':
    case 'redis':
      return null
    case 'sqlite':
      return {
        comprobar(ruta, soloLectura) {
          const comun = cargar()
          const nombre = nombreArchivoDeRuta(ruta, plataforma)
          let i: ReturnType<ComunSqlite['inspeccionar']>
          try {
            i = comun.inspeccionar(ruta, { plataforma })
          } catch (e) {
            throw sinRutaSqlite(e, nombre, comun, plataforma)
          }
          const d = comun.decidirApertura({ ...i, soloLectura, plataforma })
          if (!d.ok) throw new Error(d.mensaje)
        },
        crear(ruta) {
          const comun = cargar()
          try {
            comun.crearBaseNueva(ruta, { plataforma })
          } catch (e) {
            throw sinRutaSqlite(e, nombreArchivoDeRuta(ruta, plataforma), comun, plataforma)
          }
        }
      }
    default:
      return nunca(motor, 'adaptadorArchivo')
  }
}

/** Los motores de ARCHIVO del registro, en su orden. */
export function motoresDeArchivo(): DbMotor[] {
  return IDS_MOTORES.filter((m) => descriptor(m).conexion.deArchivo)
}

/**
 * El motor de un archivo por su CABECERA (ver el ADR): el primer motor de
 * archivo cuyo adaptador lo acepta en solo lectura. Lanza el error del primero si ninguno.
 */
export function motorDeArchivo(ruta: string, adaptador: (m: DbMotor) => AdaptadorArchivoBd | null): DbMotor {
  let primero: unknown = null
  for (const m of motoresDeArchivo()) {
    const a = adaptador(m)
    if (!a) continue
    try {
      a.comprobar(ruta, true)
      return m
    } catch (e) {
      primero ??= e
    }
  }
  if (primero instanceof Error) throw primero
  throw new Error('Ninguna base de datos de archivo sabe abrir ese archivo.')
}
