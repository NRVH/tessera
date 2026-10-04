// =============================================================================
// Las consolas del explorador como archivos del espacio de datos del perfil (`consolas/<nombre>.sql|.js|.redis` más
// `indice.json`): crear, leer, escribir con detección de cambios por contenido, renombrar, fijar esquema y borrar.
// Sin `electron`: la papelera llega inyectada. Nombres, índice y disco viven en `controlador/consolasStore*.ts`.
// Decisiones: docs/decisiones/bd/explorador-consolas-persistencia.md
// =============================================================================

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DB_CONSOLA_MAX_BYTES,
  type DbConsolaInfo,
  type DbConsolaTexto,
  type DbEscrituraConsola
} from '../../../shared/db-explorador-ipc.ts'
import type { Plataforma } from '../../../shared/plataforma.ts'
import { writeFileAtomic } from '../../util/atomicWrite.ts'
import { KeyedMutex } from '../../util/mutex.ts'
import { codigoFs, ErrorConsolas, mensajeFs } from './controlador/consolasStoreErrores.ts'
import {
  CARPETA,
  ESQUEMA_MAX,
  extDe,
  infoDe,
  INDICE,
  leerArchivosConsola,
  nombreEnDisco,
  parsearIndice,
  reconciliar,
  type EntradaIndice,
  type EstadoCarpeta
} from './controlador/consolasStoreIndice.ts'
import {
  AUSENTE,
  eliminarArchivoConsola,
  leerBytesConsola,
  renombrarConReintentos,
  textoDe,
  VERSION_VACIA,
  versionDe
} from './controlador/consolasStoreDisco.ts'
import {
  claveNombre,
  EXT,
  EXTENSIONES,
  PREFIJO,
  rutaDeConsola,
  tieneControl,
  validarNombreConsola,
  type ExtensionConsola
} from './controlador/consolasStoreNombres.ts'

export { ErrorConsolas, respuestaConsolas, type CodigoErrorConsolas } from './controlador/consolasStoreErrores.ts'
export { claveNombre, sanearNombreArchivo, validarNombreConsola, type ExtensionConsola, type ValidacionNombre } from './controlador/consolasStoreNombres.ts'

function claveConsola(perfilId: string, id: string): string {
  return JSON.stringify([perfilId, id])
}

export interface ConsolasStoreOpciones {
  /** Carpeta del espacio de datos del perfil, o null si el perfil no está vivo. */
  dirPerfil: (perfilId: string) => string | null
  /** Manda un archivo a la papelera del sistema (`shell.trashItem` en el main). */
  papelera: (rutaAbs: string) => Promise<void>
  /** Plataforma para el saneado de nombres. El main pasa `plataformaActual()`. */
  plataforma: Plataforma
  /** Escritor del texto de una consola. Por defecto `writeFileAtomic`; el test lo espía. */
  escribirArchivo?: (ruta: string, texto: string) => Promise<void>
  nuevoId?: () => string
  ahora?: () => number
}

interface EsperaEscritura {
  resolve: (r: DbEscrituraConsola) => void
  reject: (err: unknown) => void
}

interface ColaEscritura {
  pendiente: { texto: string; esperas: EsperaEscritura[] } | null
  fin: Promise<void>
}

/** Las consolas de un perfil: crear, leer, escribir, renombrar, fijar esquema y borrar. */
export class ConsolasStore {
  private readonly dirPerfil: (perfilId: string) => string | null
  private readonly papelera: (rutaAbs: string) => Promise<void>
  private readonly plataforma: Plataforma
  private readonly escribirArchivo: (ruta: string, texto: string) => Promise<void>
  private readonly nuevoId: () => string
  private readonly ahora: () => number
  /** Última versión que el store leyó o escribió, por consola. */
  private readonly versiones = new Map<string, string>()
  /** El candado de cada perfil: el índice se lee y se reescribe entero. */
  private readonly candados = new KeyedMutex()
  /** Escrituras de texto en curso o pendientes, por consola. */
  private readonly colas = new Map<string, ColaEscritura>()

  constructor(opts: ConsolasStoreOpciones) {
    this.dirPerfil = opts.dirPerfil
    this.papelera = opts.papelera
    this.plataforma = opts.plataforma
    this.escribirArchivo = opts.escribirArchivo ?? writeFileAtomic
    this.nuevoId = opts.nuevoId ?? randomUUID
    this.ahora = opts.ahora ?? Date.now
  }

  // --- API pública -----------------------------------------------------------

  /** Consolas del perfil, reconciliando índice y disco. Orden natural por nombre. */
  listar(perfilId: string): Promise<DbConsolaInfo[]> {
    return this.proteger(perfilId, async () => {
      const { carpeta, entradas } = await this.estado(perfilId)
      const infos = await Promise.all(
        entradas.map(async (e) => {
          try {
            return infoDe(perfilId, e, await stat(this.ruta(carpeta, e.nombre, extDe(e))))
          } catch {
            return null // desapareció entre el readdir y el stat: la próxima vez se poda
          }
        })
      )
      return infos
        .filter((i): i is DbConsolaInfo => i !== null)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, undefined, { numeric: true, sensitivity: 'base' }))
    })
  }

  /**
   * Crea `consola_N` (N = menor libre en toda la carpeta), vacía y atada a la conexión.
   * `extension`: `.sql` (SQL), `.js` (MongoDB) o `.redis` (Redis); la decide quien llama por la familia.
   */
  crear(perfilId: string, conexionId: string, extension: ExtensionConsola = EXT): Promise<DbConsolaInfo> {
    return this.proteger(perfilId, async () => {
      if (typeof conexionId !== 'string' || conexionId === '') {
        throw new ErrorConsolas('entrada', 'Falta la conexión de la consola.')
      }
      if (!EXTENSIONES.includes(extension)) throw new ErrorConsolas('entrada', 'Tipo de consola desconocido.')
      const { carpeta, entradas, disco } = await this.estado(perfilId)
      const ocupados = new Set<string>([
        ...[...disco.values()].map((a) => claveNombre(a.nombre)),
        ...entradas.map((e) => claveNombre(e.nombre))
      ])
      try {
        await mkdir(carpeta, { recursive: true })
      } catch (err) {
        // Un ARCHIVO llamado `consolas` da EEXIST, y "ya existe un archivo con ese nombre" haría
        // pensar en el nombre de la consola.
        const c = codigoFs(err)
        if (c === 'EEXIST' || c === 'ENOTDIR') {
          throw new ErrorConsolas('fs', 'La carpeta de consolas no tiene la forma esperada.')
        }
        throw err
      }
      for (let n = 1; ; n++) {
        const nombre = `${PREFIJO}${n}`
        if (ocupados.has(claveNombre(nombre))) continue
        const ruta = this.ruta(carpeta, nombre, extension)
        try {
          // `wx`: si alguien lo creó por fuera entre el readdir y aquí, no se pisa.
          await writeFile(ruta, '', { flag: 'wx' })
        } catch (err) {
          if (codigoFs(err) === 'EEXIST') {
            ocupados.add(claveNombre(nombre))
            continue
          }
          throw err
        }
        const entrada: EntradaIndice = { id: this.nuevoId(), conexionId, nombre, creadaEn: this.ahora() }
        if (extension !== EXT) entrada.extension = extension
        try {
          await this.guardarIndice(carpeta, [...entradas, entrada])
        } catch (err) {
          await unlink(ruta).catch(() => undefined)
          throw err
        }
        // La versión es la del archivo VACÍO que se acaba de crear, no la que se lea ahora: si
        // alguien escribió en él entre medias, es un cambio de fuera.
        this.versiones.set(claveConsola(perfilId, entrada.id), VERSION_VACIA)
        return infoDe(perfilId, entrada, await stat(ruta))
      }
    })
  }

  /** Texto de la consola y su versión; la versión queda como "la conocida". */
  leer(perfilId: string, id: string): Promise<DbConsolaTexto> {
    return this.proteger(perfilId, async () => {
      const { carpeta, entrada } = await this.localizar(perfilId, id)
      const leido = await this.leerDisco(this.ruta(carpeta, entrada.nombre, extDe(entrada)))
      if (leido === null) throw new ErrorConsolas('noExiste', 'El archivo de la consola ya no existe.')
      this.versiones.set(claveConsola(perfilId, id), leido.version)
      return leido
    })
  }

  /**
   * Guarda el texto. Sin versión base: solo hay conflicto si el disco no coincide con la última
   * versión que este store leyó o escribió. Las llamadas que llegan mientras otra está en vuelo
   * se funden y gana la última.
   */
  escribir(perfilId: string, id: string, texto: string): Promise<DbEscrituraConsola> {
    if (typeof texto !== 'string') {
      return Promise.reject(new ErrorConsolas('entrada', 'El texto de la consola no es válido.'))
    }
    if (Buffer.byteLength(texto, 'utf8') > DB_CONSOLA_MAX_BYTES) {
      return Promise.reject(
        new ErrorConsolas('tamano', `La consola supera el máximo de ${DB_CONSOLA_MAX_BYTES / (1024 * 1024)} MiB.`)
      )
    }
    const clave = claveConsola(perfilId, id)
    return new Promise<DbEscrituraConsola>((resolve, reject) => {
      const existente = this.colas.get(clave)
      if (existente) {
        if (existente.pendiente) {
          existente.pendiente.texto = texto
          existente.pendiente.esperas.push({ resolve, reject })
        } else {
          existente.pendiente = { texto, esperas: [{ resolve, reject }] }
        }
        return
      }
      const cola: ColaEscritura = {
        pendiente: { texto, esperas: [{ resolve, reject }] },
        fin: Promise.resolve()
      }
      this.colas.set(clave, cola)
      cola.fin = this.bombear(clave, cola, perfilId, id)
    })
  }

  /**
   * Renombra: valida, comprueba unicidad (NFC + minúsculas contra el índice Y el disco),
   * renombra el archivo y después el índice.
   */
  renombrar(perfilId: string, id: string, nombre: string): Promise<DbConsolaInfo> {
    return this.proteger(perfilId, async () => {
      const v = validarNombreConsola(nombre, this.plataforma)
      if (!v.ok) throw new ErrorConsolas('nombre', v.motivo)
      const { carpeta, entradas, disco } = await this.estado(perfilId)
      const entrada = entradas.find((e) => e.id === id)
      if (!entrada) throw new ErrorConsolas('noExiste', 'La consola ya no existe.')
      const nueva = claveNombre(v.nombre)
      if (nueva !== claveNombre(entrada.nombre)) {
        const ocupado = nombreEnDisco(disco, nueva) || entradas.some((e) => e.id !== id && claveNombre(e.nombre) === nueva)
        if (ocupado) throw new ErrorConsolas('nombre', `Ya hay una consola llamada «${v.nombre}».`)
      }
      const ext = extDe(entrada)
      if (v.nombre !== entrada.nombre) {
        await renombrarConReintentos(this.ruta(carpeta, entrada.nombre, ext), this.ruta(carpeta, v.nombre, ext))
        await this.guardarIndice(
          carpeta,
          entradas.map((e) => (e.id === id ? { ...e, nombre: v.nombre } : e))
        )
      }
      const st = await stat(this.ruta(carpeta, v.nombre, ext))
      return infoDe(perfilId, { ...entrada, nombre: v.nombre }, st)
    })
  }

  /**
   * Guarda (o quita, con `null`) el esquema elegido en la consola. Va en el índice y no en el
   * archivo: es de la sesión, no del texto. Lo relee el main al reabrir la sesión.
   */
  fijarEsquema(perfilId: string, id: string, esquema: string | null): Promise<DbConsolaInfo> {
    return this.proteger(perfilId, async () => {
      if (esquema !== null && (typeof esquema !== 'string' || esquema === '' || esquema.length > ESQUEMA_MAX)) {
        throw new ErrorConsolas('entrada', 'El esquema no es válido.')
      }
      const { carpeta, entradas } = await this.estado(perfilId)
      const entrada = entradas.find((e) => e.id === id)
      if (!entrada) throw new ErrorConsolas('noExiste', 'La consola ya no existe.')
      const nueva: EntradaIndice = { ...entrada }
      if (esquema === null) delete nueva.esquema
      else nueva.esquema = esquema
      if (nueva.esquema !== entrada.esquema) {
        await this.guardarIndice(
          carpeta,
          entradas.map((e) => (e.id === id ? nueva : e))
        )
      }
      return infoDe(perfilId, nueva, await stat(this.ruta(carpeta, nueva.nombre, extDe(nueva))))
    })
  }

  /** A la papelera (o `unlink` si está vacía). Idempotente: una consola que ya no existe no es error. */
  borrar(perfilId: string, id: string): Promise<void> {
    return this.proteger(perfilId, async () => {
      const { carpeta, entradas } = await this.estado(perfilId)
      const entrada = entradas.find((e) => e.id === id)
      if (!entrada) return
      await this.eliminarArchivo(carpeta, entrada)
      await this.guardarIndice(
        carpeta,
        entradas.filter((e) => e.id !== id)
      )
      this.versiones.delete(claveConsola(perfilId, id))
    })
  }

  /**
   * Borra (a la papelera) todas las consolas de una conexión, al borrar la conexión. Devuelve
   * cuántas se borraron. Si alguna falla, las demás quedan borradas, el índice lo refleja y se
   * lanza un error que dice cuántas quedaron.
   */
  borrarDeConexion(perfilId: string, conexionId: string): Promise<number> {
    return this.proteger(perfilId, async () => {
      const { carpeta, entradas } = await this.estado(perfilId)
      const quedan: EntradaIndice[] = []
      let borradas = 0
      let fallos = 0
      for (const e of entradas) {
        if (e.conexionId !== conexionId) {
          quedan.push(e)
          continue
        }
        try {
          await this.eliminarArchivo(carpeta, e)
          this.versiones.delete(claveConsola(perfilId, e.id))
          borradas++
        } catch {
          fallos++
          quedan.push(e)
        }
      }
      if (quedan.length !== entradas.length) await this.guardarIndice(carpeta, quedan)
      if (fallos > 0) {
        throw new ErrorConsolas(
          'papelera',
          fallos === 1 ? 'No se pudo mover 1 consola a la papelera.' : `No se pudieron mover ${fallos} consolas a la papelera.`
        )
      }
      return borradas
    })
  }

  /**
   * Espera a que terminen todas las escrituras y operaciones en curso (cierre de la app), también
   * las que lleguen mientras espera: repite hasta que no queda ninguna.
   */
  async vaciar(): Promise<void> {
    for (;;) {
      const pendientes: Promise<unknown>[] = []
      for (const c of this.colas.values()) pendientes.push(c.fin)
      if (pendientes.length === 0 && !this.candados.ocupado) return
      pendientes.push(this.candados.vaciar())
      await Promise.all(pendientes.map((p) => p.catch(() => undefined)))
    }
  }

  // --- Escritura coalescida --------------------------------------------------

  /** Vacía la cola de una consola: cada vuelta escribe el ÚLTIMO texto pendiente. */
  private async bombear(clave: string, cola: ColaEscritura, perfilId: string, id: string): Promise<void> {
    while (cola.pendiente) {
      const lote = cola.pendiente
      cola.pendiente = null
      try {
        const r = await this.proteger(perfilId, () => this.escribirAhora(perfilId, id, lote.texto))
        for (const e of lote.esperas) e.resolve(r)
      } catch (err) {
        for (const e of lote.esperas) e.reject(err)
      }
    }
    this.colas.delete(clave)
  }

  private async escribirAhora(perfilId: string, id: string, texto: string): Promise<DbEscrituraConsola> {
    const { carpeta, entrada } = await this.localizar(perfilId, id)
    const ruta = this.ruta(carpeta, entrada.nombre, extDe(entrada))
    const clave = claveConsola(perfilId, id)
    const conocida = this.versiones.get(clave)
    if (conocida !== undefined) {
      // Se lee el disco entero: la versión es su contenido. El texto solo se decodifica si hace falta enseñarlo.
      const enDisco = await leerBytesConsola(ruta)
      const version = enDisco ? enDisco.version : AUSENTE
      if (version !== conocida) {
        const actual = enDisco ? textoDe(enDisco.bytes) : ''
        // Desde aquí, lo del disco cuenta como leído: "Conservar la mía" es volver a escribir.
        this.versiones.set(clave, version)
        // Si por fuera escribieron justo lo mismo, no hay nada que decidir.
        if (actual === texto) return { ok: true, version }
        return { ok: false, conflicto: true, texto: actual, version }
      }
    }
    await this.escribirArchivo(ruta, texto)
    // La de los bytes MANDADOS (UTF-8 sin BOM), no la de releer el disco: releer adoptaría un
    // cambio de fuera caído justo después.
    const version = versionDe(Buffer.from(texto, 'utf8'))
    this.versiones.set(clave, version)
    return { ok: true, version }
  }

  // --- Disco -----------------------------------------------------------------

  /** `<dirPerfil>/consolas`, o error si el perfil no es válido o no está vivo. */
  private carpeta(perfilId: string): string {
    if (
      typeof perfilId !== 'string' ||
      perfilId === '' ||
      perfilId === '.' ||
      perfilId === '..' ||
      perfilId.includes('/') ||
      perfilId.includes('\\') ||
      tieneControl(perfilId)
    ) {
      throw new ErrorConsolas('perfil', 'Perfil no válido.')
    }
    const dir = this.dirPerfil(perfilId)
    if (!dir) throw new ErrorConsolas('perfil', 'El perfil no existe o no está cargado.')
    return path.join(path.resolve(dir), CARPETA)
  }

  private ruta(carpeta: string, nombre: string, ext: ExtensionConsola): string {
    return rutaDeConsola(carpeta, nombre, ext)
  }

  /** Busca la entrada por id SIN reconciliar: un archivo que desaparece por fuera no toca el índice. */
  private async localizar(perfilId: string, id: string): Promise<{ carpeta: string; entrada: EntradaIndice }> {
    const carpeta = this.carpeta(perfilId)
    const entrada = typeof id === 'string' ? (await this.leerIndice(carpeta)).find((e) => e.id === id) : undefined
    if (!entrada) throw new ErrorConsolas('noExiste', 'La consola ya no existe.')
    return { carpeta, entrada }
  }

  /** Texto y versión DE LOS MISMOS BYTES: si el archivo se sustituye a mitad de lectura, siguen siendo del mismo. */
  private async leerDisco(ruta: string): Promise<DbConsolaTexto | null> {
    const leido = await leerBytesConsola(ruta)
    return leido && { texto: textoDe(leido.bytes), version: leido.version }
  }

  /**
   * Lee el índice. Lo inválido se descarta entrada a entrada. Si el principal está corrupto se
   * prueba el `.bak` que deja `writeFileAtomic`; si no existe, no hay consolas.
   */
  private async leerIndice(carpeta: string): Promise<EntradaIndice[]> {
    let bruto: string
    try {
      bruto = await readFile(path.join(carpeta, INDICE), 'utf-8')
    } catch (err) {
      if (codigoFs(err) === 'ENOENT' || codigoFs(err) === 'ENOTDIR') return []
      throw err
    }
    const principal = parsearIndice(bruto, carpeta)
    if (principal) return principal
    try {
      return parsearIndice(await readFile(path.join(carpeta, INDICE + '.bak'), 'utf-8'), carpeta) ?? []
    } catch {
      return []
    }
  }

  private async guardarIndice(carpeta: string, entradas: EntradaIndice[]): Promise<void> {
    const doc = { version: 1, consolas: entradas }
    await writeFileAtomic(path.join(carpeta, INDICE), JSON.stringify(doc, null, 2) + '\n')
  }

  /** Índice y disco reconciliados; si algo cambió, persiste el índice. Siempre dentro del candado del perfil. */
  private async estado(perfilId: string): Promise<EstadoCarpeta> {
    const carpeta = this.carpeta(perfilId)
    const leidas = await this.leerIndice(carpeta)
    const disco = await leerArchivosConsola(carpeta)
    const { entradas, cambiado } = reconciliar(leidas, disco)
    if (cambiado) await this.guardarIndice(carpeta, entradas)
    return { carpeta, entradas, disco }
  }

  private eliminarArchivo(carpeta: string, entrada: EntradaIndice): Promise<void> {
    return eliminarArchivoConsola(this.ruta(carpeta, entrada.nombre, extDe(entrada)), entrada.nombre, this.papelera)
  }

  // --- Candado y errores -----------------------------------------------------

  /**
   * Corre `fn` con el candado del perfil (FIFO, un `KeyedMutex`) y reescribe cualquier error que
   * no sea un `ErrorConsolas` para que no salga una ruta absoluta. Ninguna operación vuelve a
   * entrar en el candado desde dentro (no es reentrante): `bombear` lo toma por vuelta.
   */
  private proteger<T>(perfilId: string, fn: () => Promise<T>): Promise<T> {
    const clave = typeof perfilId === 'string' ? perfilId : ''
    return this.candados.runExclusive(clave, async () => {
      try {
        return await fn()
      } catch (err) {
        if (err instanceof ErrorConsolas) throw err
        throw new ErrorConsolas('fs', mensajeFs(err))
      }
    })
  }
}
