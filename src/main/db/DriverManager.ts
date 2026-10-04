// =============================================================================
// DriverManager: consigue los clientes de base de datos que Tessera no empaqueta (Instant Client):
// los detecta, los descarga (zip en Windows, .dmg en Mac) o registra uno que el usuario ya tiene.
// Todo vive en `userData/drivers`; la plataforma es una opción del constructor. Publica
// `catalogo.json`, que lee `tdb` en otro proceso. Depende de `driverPacks.ts`, `descarga.ts` e `instalarDmg.ts`.
// Decisiones: docs/decisiones/bd/drivers-descarga-y-plataformas.md
// =============================================================================
import { execFile } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { open } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { unzip } from 'fflate'
import { writeFileAtomicSync } from '../util/atomicWrite.ts'
import type { DriverProgress, DriverStatus } from '../../shared/db-ipc'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import {
  DRIVER_PACKS,
  disponibilidadPack,
  packById,
  packsDePlataforma,
  type DriverPackResuelto
} from './driverPacks.ts'
import { descargarConHuella } from './descarga.ts'
import {
  barrerArranque,
  huellaCoincide,
  instalarDesdeDmg,
  rutasInstalacionDmg,
  type DepsInstalarDmg,
  type OrdenExterna
} from './instalarDmg.ts'

/** Registro de drivers apuntados A MANO (los descargados se detectan por disco). */
interface ExternalRegistry {
  version: number
  /** packId -> carpeta que el usuario apuntó. */
  externos: Record<string, string>
}

/** Lo que `DriverManager` recibe al construirse; salvo `userDataDir`, solo las pruebas cambian algo. */
export interface DriverManagerOptions {
  /** Raíz de datos mutables (= app.getPath('userData')). */
  userDataDir: string
  /** Notifica progreso de descarga al renderer. */
  onProgress?: (p: DriverProgress) => void
  log?: (msg: string) => void
  /** Plataforma cuyos packs se gestionan. Por defecto, la de este proceso (solo el test la fija). */
  plataforma?: Plataforma
  /** `os.release()` del sistema (Darwin en Mac). Por defecto, el real (solo el test lo fija). */
  releaseSistema?: string
  /** Ejecuta hdiutil/ditto/codesign. Por defecto, `execFile` sin shell (solo el test lo cambia). */
  ejecutar?: (orden: OrdenExterna) => Promise<void>
  /** `fetch` de las descargas (zip y .dmg). Por defecto, el global (solo el test lo cambia). */
  fetch?: typeof fetch
  /** Plazo de inactividad de una descarga, en ms. Por defecto, el de `descarga.ts` (solo el test lo cambia). */
  plazoInactividadMs?: number
}

/** Tope de cada orden externa: un .dmg de 66 MB se monta y se copia en segundos. */
const TIMEOUT_ORDEN_MS = 5 * 60_000

/**
 * Ejecuta una orden SIN shell (`execFile`). El error lleva el stderr de la orden, que
 * es donde hdiutil y codesign dicen qué pasó; el nombre del binario, no su ruta.
 */
function ejecutarOrden(orden: OrdenExterna): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      orden.cmd,
      orden.args,
      { timeout: TIMEOUT_ORDEN_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, _stdout, stderr) => {
        if (!err) return resolve()
        const detalle = String(stderr ?? '').trim() || err.message
        reject(new Error(`${path.basename(orden.cmd)} ${orden.args[0] ?? ''}: ${detalle}`))
      }
    )
  })
}

/** Gestor de los clientes de base de datos descargados o registrados a mano. */
export class DriverManager {
  private readonly root: string
  private readonly registryPath: string
  private readonly onProgress: (p: DriverProgress) => void
  private readonly log: (msg: string) => void
  private readonly plataforma: Plataforma
  private readonly releaseSistema: string
  private readonly ejecutar: (orden: OrdenExterna) => Promise<void>
  private readonly fetchFn: typeof fetch
  private readonly plazoInactividadMs: number | undefined
  private externos: Record<string, string>
  /** Instalaciones en vuelo, por packId: evita dos descargas simultáneas del mismo. */
  private readonly enVuelo = new Map<string, Promise<DriverStatus>>()
  /** Barrido de montajes huérfanos del arranque (Mac); una instalación lo espera. */
  private readonly barrido: Promise<unknown>

  constructor(opts: DriverManagerOptions) {
    this.root = path.join(opts.userDataDir, 'drivers')
    this.registryPath = path.join(opts.userDataDir, 'db-drivers.json')
    this.onProgress = opts.onProgress ?? (() => {})
    this.log = opts.log ?? ((m) => console.log(`[db-drivers] ${m}`))
    this.plataforma = opts.plataforma ?? plataformaActual()
    this.releaseSistema = opts.releaseSistema ?? os.release()
    this.ejecutar = opts.ejecutar ?? ejecutarOrden
    this.fetchFn = opts.fetch ?? fetch
    this.plazoInactividadMs = opts.plazoInactividadMs
    this.externos = this.readRegistry()
    this.publishCatalog()
    // Solo Mac instala desde imágenes de disco, así que solo allí puede haber un montaje
    // colgado o un resto de .dmg/.instalando (Windows no cambia: su zip se escribe
    // directamente en el destino). Nunca lanza (ver `barrerArranque`), y no retrasa el
    // arranque: nadie lo espera salvo una instalación, para no desmontar ni borrar bajo
    // sus pies lo que ella acaba de hacer.
    this.barrido = this.plataforma === 'mac' ? barrerArranque(this.depsDmg(), this.root) : Promise.resolve()
  }

  /** Lo que `instalarDmg.ts` necesita del mundo: el sistema de archivos y el ejecutor. */
  private depsDmg(): DepsInstalarDmg {
    return {
      ejecutar: (orden) => this.ejecutar(orden),
      existe: existsSync,
      crearCarpeta: (ruta) => mkdirSync(ruta, { recursive: true }),
      borrar: (ruta) => rmSync(ruta, { recursive: true, force: true }),
      quitarCarpetaVacia: (ruta) => rmdirSync(ruta),
      renombrar: renameSync,
      rutaReal: realpathSync,
      listar: (ruta) => readdirSync(ruta),
      // lstat: un enlace simbólico dejado bajo `.montajes` no se sigue hasta otro volumen.
      dispositivo: (ruta) => lstatSync(ruta).dev,
      log: (m) => this.log(m)
    }
  }

  /** Raíz de drivers; se pasa a `tdb` por entorno. */
  get driversDir(): string {
    return this.root
  }

  /**
   * Escribe `<drivers>/catalogo.json` con los packs y los externos registrados.
   * Es el puente hacia `tdb`, que corre en OTRO proceso y necesita el mismo catálogo
   * para resolver clientes y para `tdb driver install`. Se publica desde aquí para
   * que el catálogo tenga UNA sola fuente de verdad (`driverPacks.ts`) en vez de
   * duplicarlo en el CLI.
   *
   * Se publican solo los packs de ESTA plataforma y con el centinela ya resuelto a
   * string: `tdb.cjs` y `oracle.cjs` leen `pack.centinela` como nombre de archivo, y
   * así ninguno de los dos cambia.
   */
  private publishCatalog(): void {
    try {
      mkdirSync(this.root, { recursive: true })
      writeFileSync(
        path.join(this.root, 'catalogo.json'),
        JSON.stringify(
          { packs: packsDePlataforma(this.plataforma), externos: this.externos },
          null,
          2
        ) + '\n'
      )
    } catch (err) {
      // Sin catálogo, `tdb` seguirá funcionando con las bases que no necesiten
      // driver externo; no vale la pena tumbar el arranque por esto.
      this.log(`no se pudo publicar el catálogo de drivers: ${String(err)}`)
    }
  }

  /** Carpeta donde vive el pack si se descargó (no si es externo). */
  private packDir(pack: DriverPackResuelto): string {
    return path.join(this.root, pack.motor, pack.id)
  }

  /**
   * El pack de esta plataforma, o un error que distingue "no existe" de "existe,
   * pero no en este sistema": el segundo lo provoca un `driverId` que viene de la
   * otra plataforma (un registro de conexiones copiado entre máquinas), y decirle
   * al usuario que el driver es "desconocido" le haría pensar que el catálogo está
   * roto.
   */
  private packDePlataforma(packId: string): DriverPackResuelto {
    const pack = packById(packId, this.plataforma)
    if (pack) return pack
    if (DRIVER_PACKS.some((p) => p.id === packId)) {
      throw new Error(`El driver "${packId}" no está disponible en este sistema.`)
    }
    throw new Error(`Driver desconocido: "${packId}".`)
  }

  private readRegistry(): Record<string, string> {
    try {
      const parsed = JSON.parse(readFileSync(this.registryPath, 'utf-8')) as ExternalRegistry
      return typeof parsed?.externos === 'object' && parsed.externos !== null ? parsed.externos : {}
    } catch {
      return {}
    }
  }

  private persistRegistry(): void {
    const doc: ExternalRegistry = { version: 1, externos: this.externos }
    writeFileAtomicSync(this.registryPath, JSON.stringify(doc, null, 2) + '\n')
    this.publishCatalog() // `tdb` lee el catálogo, no este registro
  }

  // --- Consulta --------------------------------------------------------------

  /**
   * Carpeta utilizable de un pack, o null si no está instalado. Prioriza el externo
   * (si el usuario apuntó uno, manda su decisión sobre la descarga automática).
   */
  resolve(packId: string): string | null {
    const pack = packById(packId, this.plataforma)
    if (!pack) return null
    const externo = this.externos[packId]
    if (externo && existsSync(path.join(externo, pack.centinela))) return externo
    const propio = this.packDir(pack)
    if (existsSync(path.join(propio, pack.centinela))) return propio
    return null
  }

  status(): DriverStatus[] {
    return packsDePlataforma(this.plataforma).map((p) => {
      const ruta = this.resolve(p.id)
      const disponible = disponibilidadPack(p, this.plataforma, this.releaseSistema)
      return {
        id: p.id,
        motor: p.motor,
        nombre: p.nombre,
        sizeMB: p.sizeMB,
        cubre: p.cubre,
        descargable: p.url !== null && disponible.ok,
        // Solo si los hay: un pack sin aviso y descargable publica el mismo objeto que antes.
        ...(p.aviso ? { aviso: p.aviso } : {}),
        ...(disponible.ok ? {} : { noDisponible: disponible.motivo }),
        instalado: ruta !== null,
        ruta: ruta ?? undefined,
        externo: ruta !== null && ruta === this.externos[p.id]
      }
    })
  }

  // --- Escotilla: usar uno que ya tengo --------------------------------------

  /**
   * Registra un Instant Client que el usuario ya tiene en su máquina. Acepta tanto
   * la carpeta que contiene el centinela (`oci.dll` en Windows, `libclntsh.dylib`
   * en Mac) como su padre (es fácil apuntar un nivel de más al elegir en el
   * diálogo, y fallar por eso sería mezquino).
   */
  useExisting(packId: string, rutaElegida: string): DriverStatus {
    const pack = this.packDePlataforma(packId)

    const candidatos = [rutaElegida, path.join(rutaElegida, pack.carpetaInterna)]
    const valida = candidatos.find((c) => existsSync(path.join(c, pack.centinela)))
    if (!valida) {
      throw new Error(
        `No encontré "${pack.centinela}" en "${rutaElegida}". Elige la carpeta del Instant Client (la que contiene ${pack.centinela}).`
      )
    }
    this.externos[packId] = valida
    this.persistRegistry()
    this.log(`driver externo registrado: ${packId} -> ${valida}`)
    return this.status().find((s) => s.id === packId)!
  }

  /** Olvida el driver externo de un pack (vuelve a mandar el descargado, si lo hay). */
  forgetExisting(packId: string): void {
    if (!(packId in this.externos)) return
    delete this.externos[packId]
    this.persistRegistry()
  }

  // --- Descarga --------------------------------------------------------------

  /**
   * Descarga e instala un pack. Idempotente: si ya está instalado devuelve su
   * estado sin bajar nada, y dos llamadas concurrentes comparten la misma descarga.
   */
  async install(packId: string): Promise<DriverStatus> {
    const pack = this.packDePlataforma(packId)
    if (this.resolve(packId)) return this.status().find((s) => s.id === packId)!

    const enCurso = this.enVuelo.get(packId)
    if (enCurso) return enCurso

    const tarea = this.doInstall(pack).finally(() => this.enVuelo.delete(packId))
    this.enVuelo.set(packId, tarea)
    return tarea
  }

  /**
   * Lanza, avisando por el progreso, si el pack no se puede descargar: sin URL (con el porqué del pack,
   * y no un 404 que haría pensar en la red) o en un sistema donde el cliente no cargaría.
   */
  private exigirDescargable(pack: DriverPackResuelto): void {
    if (pack.url === null) {
      const motivo =
        pack.sinDescarga ??
        `Oracle ya no publica ${pack.nombre} para descarga directa: solo queda en su ` +
          'archivo histórico, que exige iniciar sesión y aceptar la licencia en el ' +
          'navegador. Descárgalo a mano y usa "Seleccionar carpeta…".'
      this.log(`${pack.id}: sin descarga automática`)
      this.onProgress({ packId: pack.id, porcentaje: null, fase: 'error', mensaje: motivo })
      throw new Error(motivo)
    }
    const disponible = disponibilidadPack(pack, this.plataforma, this.releaseSistema)
    if (!disponible.ok) {
      this.log(`${pack.id}: no disponible en este sistema`)
      this.onProgress({ packId: pack.id, porcentaje: null, fase: 'error', mensaje: disponible.motivo })
      throw new Error(disponible.motivo)
    }
  }

  /** Escribe el zip descomprimido APLANADO en `destino` y devuelve cuántos archivos escribió. */
  private aplanarEn(destino: string, archivos: Record<string, Uint8Array>): number {
    mkdirSync(destino, { recursive: true })
    let escritos = 0
    for (const [nombre, datos] of Object.entries(archivos)) {
      if (nombre.endsWith('/') || datos.length === 0) continue
      // Solo el basename: aparte de simplificar, corta un `../` de un zip manipulado.
      const base = path.basename(nombre)
      if (!base || base === '.' || base === '..') continue
      // META-INF son las firmas del zip de Oracle: ruido.
      if (nombre.includes('META-INF/')) continue
      writeFileSync(path.join(destino, base), datos)
      escritos++
    }
    return escritos
  }

  private async doInstall(pack: DriverPackResuelto): Promise<DriverStatus> {
    const destino = this.packDir(pack)
    this.exigirDescargable(pack)
    if (pack.formato === 'dmg') return this.doInstallDmg(pack, destino)
    try {
      this.log(`descargando ${pack.id} desde ${pack.url}`)
      const zip = await this.download(pack)

      this.onProgress({ packId: pack.id, porcentaje: 100, fase: 'descomprimiendo' })
      const archivos = await this.unzipToMemory(zip)
      // El zip trae todo bajo `instantclient_XX_YY/`: se aplana para que la ruta de `initOracleClient`
      // sea la misma venga de una descarga o de un driver externo.
      const escritos = this.aplanarEn(destino, archivos)
      this.log(`${pack.id}: ${escritos} archivos en ${destino}`)

      if (!existsSync(path.join(destino, pack.centinela))) {
        throw new Error(`El paquete descargado no contiene "${pack.centinela}".`)
      }
      this.onProgress({ packId: pack.id, porcentaje: 100, fase: 'listo' })
      return this.status().find((s) => s.id === pack.id)!
    } catch (err) {
      // Una instalación a medias es peor que ninguna: se limpia para que el próximo intento parta de cero.
      try {
        rmSync(destino, { recursive: true, force: true })
      } catch {
        // Si no se puede borrar, el centinela ausente ya impide darlo por instalado.
      }
      const mensaje = err instanceof Error ? err.message : String(err)
      this.onProgress({ packId: pack.id, porcentaje: null, fase: 'error', mensaje })
      throw new Error(
        `No se pudo instalar ${pack.nombre}: ${mensaje}\n` +
          `Alternativa: descárgalo a mano y usa "Seleccionar carpeta…".`,
        { cause: err }
      )
    }
  }

  /**
   * Instala un pack publicado como .dmg (`instalarDmg.ts`), con el mismo contrato que la rama zip.
   * Se comprueba que `destino` coincide con el que recalcula `rutasInstalacionDmg`.
   */
  private async doInstallDmg(pack: DriverPackResuelto, destino: string): Promise<DriverStatus> {
    const rutas = rutasInstalacionDmg(this.root, pack)
    try {
      if (rutas.destino !== destino) throw new Error('rutas de instalación incoherentes')
      if (pack.url === null) throw new Error('Este cliente no tiene descarga automática.')
      // Sin huella no se monta nada: sería darle al parser de imágenes bytes sin verificar.
      if (!pack.sha256) throw new Error('el paquete no declara su huella SHA-256 y no se monta sin verificarla.')
      await this.barrido

      this.log(`descargando ${pack.id} desde ${pack.url}`)
      mkdirSync(path.dirname(rutas.dmg), { recursive: true })
      const fh = await open(rutas.dmg, 'w')
      let huella: { sha256: string; bytes: number }
      try {
        huella = await descargarConHuella(
          this.fetchFn,
          pack.url,
          {
            escribir: async (trozo) => {
              let hecho = 0
              while (hecho < trozo.length) {
                const { bytesWritten } = await fh.write(trozo, hecho, trozo.length - hecho)
                hecho += bytesWritten
              }
            },
            cerrar: () => fh.close()
          },
          (pct) => this.onProgress({ packId: pack.id, porcentaje: pct, fase: 'descargando' }),
          { inactividadMs: this.plazoInactividadMs }
        )
      } catch (err) {
        rmSync(rutas.dmg, { force: true })
        throw err
      }
      if (!huellaCoincide(huella.sha256, pack.sha256)) {
        rmSync(rutas.dmg, { force: true })
        throw new Error(
          `lo descargado (${huella.bytes} bytes) no coincide con la huella SHA-256 publicada ` +
            'del paquete. Puede ser una descarga cortada o un proxy que devolvió otra cosa; si ' +
            'se repite, el paquete publicado cambió y Tessera tiene que actualizar su ficha.'
        )
      }

      this.onProgress({ packId: pack.id, porcentaje: 100, fase: 'instalando' })
      await instalarDesdeDmg(this.depsDmg(), rutas, pack)
      this.log(`${pack.id}: instalado en ${destino}`)
      this.onProgress({ packId: pack.id, porcentaje: 100, fase: 'listo' })
      return this.status().find((s) => s.id === pack.id)!
    } catch (err) {
      // El stderr de codesign nombra el archivo con su ruta entera: la carpeta de datos
      // se sustituye antes de que el mensaje salga hacia la interfaz.
      const crudo = err instanceof Error ? err.message : String(err)
      const mensaje = crudo.split(this.root).join('<drivers>')
      this.onProgress({ packId: pack.id, porcentaje: null, fase: 'error', mensaje })
      throw new Error(
        `No se pudo instalar ${pack.nombre}: ${mensaje}\n` +
          `Alternativa: descárgalo a mano y usa "Seleccionar carpeta…".`,
        { cause: err }
      )
    }
  }

  /** Descarga el zip a memoria informando del progreso. */
  private async download(pack: DriverPackResuelto): Promise<Uint8Array> {
    // `doInstall` ya cortó el caso sin URL; esto es solo para el compilador.
    if (pack.url === null) throw new Error('Este cliente no tiene descarga automática.')
    // La descarga de siempre (`descarga.ts`), a memoria: el zip se descomprime con
    // fflate sin pasar por disco. La huella no se usa (el zip no la publica).
    const trozos: Uint8Array[] = []
    const { bytes } = await descargarConHuella(
      this.fetchFn,
      pack.url,
      {
        escribir: async (trozo) => {
          trozos.push(trozo)
        },
        cerrar: async () => {}
      },
      (pct) => this.onProgress({ packId: pack.id, porcentaje: pct, fase: 'descargando' }),
      { inactividadMs: this.plazoInactividadMs }
    )

    const zip = new Uint8Array(bytes)
    let off = 0
    for (const t of trozos) {
      zip.set(t, off)
      off += t.length
    }
    // Firma PK\x03\x04: si Oracle devolvió una página de error con 200, se detecta aquí.
    if (zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) {
      throw new Error('Lo descargado no es un ZIP (¿la red devolvió una página de error?).')
    }
    return zip
  }

  private unzipToMemory(zip: Uint8Array): Promise<Record<string, Uint8Array>> {
    return new Promise((resolve, reject) => {
      unzip(zip, (err, data) => (err ? reject(err) : resolve(data)))
    })
  }
}
