// =============================================================================
// GestorDrivers: consigue los clientes de base de datos que Tessera no empaqueta (Instant Client):
// los detecta, los descarga (zip en Windows y Linux, .dmg en Mac) o registra uno que el usuario ya tiene.
// Todo vive en `userData/drivers`; la plataforma es una opción del constructor. Publica
// `catalogo.json`, que lee `tdb` en otro proceso. Depende de `paquetesDriver.ts`, `descarga.ts` e `instalarDmg.ts`.
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
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { open } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { unzip } from 'fflate'
import { escribirArchivoAtomicoSync } from '../util/escrituraAtomica.ts'
import type { ProgresoDriver, EstadoDriver } from '../../shared/db-ipc'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import {
  PAQUETES_DRIVER,
  disponibilidadPaqueteDriver,
  paqueteDriverPorId,
  paquetesDriverDePlataforma,
  type PaqueteDriverResuelto
} from './paquetesDriver.ts'
import { descargarConHuella } from './descarga.ts'
import { destinoDeEnlace, enlacesDelZip } from './zipConEnlaces.ts'
import { txDb } from './textosDb.ts'
import {
  barrerArranque,
  huellaCoincide,
  instalarDesdeDmg,
  rutasInstalacionDmg,
  sinAvisosDeObsoleto,
  type DepsInstalarDmg,
  type OrdenExterna
} from './instalarDmg.ts'

/** Registro de drivers apuntados A MANO (los descargados se detectan por disco). */
export interface RegistroExterno {
  version: number
  /** packId -> carpeta que el usuario apuntó. */
  externos: Record<string, string>
}

/** Lo que se escribe en `drivers/catalogo.json`, que lee `tdb`. */
export interface CatalogoDrivers {
  packs: PaqueteDriverResuelto[]
  externos: Record<string, string>
}

/** Lo que `GestorDrivers` recibe al construirse; salvo `dirDatosUsuario`, solo las pruebas cambian algo. */
export interface OpcionesGestorDrivers {
  /** Raíz de datos mutables (= app.getPath('userData')). */
  dirDatosUsuario: string
  /** Notifica progreso de descarga al renderer. */
  onProgreso?: (p: ProgresoDriver) => void
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
const PLAZO_ORDEN_MS = 5 * 60_000

/**
 * Ejecuta una orden SIN shell (`execFile`). El error lleva el stderr de la orden, que
 * es donde hdiutil y codesign dicen qué pasó; el nombre del binario, no su ruta.
 */
function ejecutarOrden(orden: OrdenExterna): Promise<void> {
  return new Promise((resolver, rechazar) => {
    execFile(
      orden.cmd,
      orden.args,
      { timeout: PLAZO_ORDEN_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, _stdout, stderr) => {
        if (!err) return resolver()
        const detalle = sinAvisosDeObsoleto(String(stderr ?? '')) || err.message
        rechazar(new Error(`${path.basename(orden.cmd)} ${orden.args[0] ?? ''}: ${detalle}`))
      }
    )
  })
}

/** Gestor de los clientes de base de datos descargados o registrados a mano. */
export class GestorDrivers {
  private readonly raiz: string
  private readonly rutaRegistro: string
  private readonly onProgreso: (p: ProgresoDriver) => void
  private readonly log: (msg: string) => void
  private readonly plataforma: Plataforma
  private readonly releaseSistema: string
  private readonly ejecutar: (orden: OrdenExterna) => Promise<void>
  private readonly funcionTraer: typeof fetch
  private readonly plazoInactividadMs: number | undefined
  private externos: Record<string, string>
  /** Instalaciones en vuelo, por packId: evita dos descargas simultáneas del mismo. */
  private readonly enVuelo = new Map<string, Promise<EstadoDriver>>()
  /** Barrido de montajes huérfanos del arranque (Mac); una instalación lo espera. */
  private readonly barrido: Promise<unknown>

  constructor(opts: OpcionesGestorDrivers) {
    this.raiz = path.join(opts.dirDatosUsuario, 'drivers')
    this.rutaRegistro = path.join(opts.dirDatosUsuario, 'db-drivers.json')
    this.onProgreso = opts.onProgreso ?? (() => {})
    this.log = opts.log ?? ((m) => console.log(`[db-drivers] ${m}`))
    this.plataforma = opts.plataforma ?? plataformaActual()
    this.releaseSistema = opts.releaseSistema ?? os.release()
    this.ejecutar = opts.ejecutar ?? ejecutarOrden
    this.funcionTraer = opts.fetch ?? fetch
    this.plazoInactividadMs = opts.plazoInactividadMs
    this.externos = this.leerRegistro()
    this.publishCatalog()
    // Solo Mac instala desde imágenes de disco, así que solo allí puede haber un montaje
    // colgado o un resto de .dmg/.instalando (Windows no cambia: su zip se escribe
    // directamente en el destino). Nunca lanza (ver `barrerArranque`), y no retrasa el
    // arranque: nadie lo espera salvo una instalación, para no desmontar ni borrar bajo
    // sus pies lo que ella acaba de hacer.
    this.barrido = this.plataforma === 'mac' ? barrerArranque(this.depsDmg(), this.raiz) : Promise.resolve()
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
  get dirDrivers(): string {
    return this.raiz
  }

  /**
   * Escribe `<drivers>/catalogo.json` con los packs y los externos registrados.
   * Es el puente hacia `tdb`, que corre en OTRO proceso y necesita el mismo catálogo
   * para resolver clientes y para `tdb driver install`. Se publica desde aquí para
   * que el catálogo tenga UNA sola fuente de verdad (`paquetesDriver.ts`) en vez de
   * duplicarlo en el CLI.
   *
   * Se publican solo los packs de ESTA plataforma y con el centinela ya resuelto a
   * string: `tdb.cjs` y `oracle.cjs` leen `pack.centinela` como nombre de archivo, y
   * así ninguno de los dos cambia.
   */
  private publishCatalog(): void {
    try {
      mkdirSync(this.raiz, { recursive: true })
      const doc: CatalogoDrivers = { packs: paquetesDriverDePlataforma(this.plataforma), externos: this.externos }
      writeFileSync(path.join(this.raiz, 'catalogo.json'), JSON.stringify(doc, null, 2) + '\n')
    } catch (err) {
      // Sin catálogo, `tdb` seguirá funcionando con las bases que no necesiten
      // driver externo; no vale la pena tumbar el arranque por esto.
      this.log(`no se pudo publicar el catálogo de drivers: ${String(err)}`)
    }
  }

  /** Carpeta donde vive el pack si se descargó (no si es externo). */
  private dirPaqueteDriver(paqueteDriver: PaqueteDriverResuelto): string {
    return path.join(this.raiz, paqueteDriver.motor, paqueteDriver.id)
  }

  /**
   * El pack de esta plataforma, o un error que distingue "no existe" de "existe,
   * pero no en este sistema": el segundo lo provoca un `driverId` que viene de la
   * otra plataforma (un registro de conexiones copiado entre máquinas), y decirle
   * al usuario que el driver es "desconocido" le haría pensar que el catálogo está
   * roto.
   */
  private paqueteDriverDePlataforma(paqueteDriverId: string): PaqueteDriverResuelto {
    const paqueteDriver = paqueteDriverPorId(paqueteDriverId, this.plataforma)
    if (paqueteDriver) return paqueteDriver
    if (PAQUETES_DRIVER.some((p) => p.id === paqueteDriverId)) {
      throw new Error(txDb().drivers.noDisponible(paqueteDriverId))
    }
    throw new Error(txDb().drivers.desconocido(paqueteDriverId))
  }

  private leerRegistro(): Record<string, string> {
    try {
      const analizado = JSON.parse(readFileSync(this.rutaRegistro, 'utf-8')) as RegistroExterno
      return typeof analizado?.externos === 'object' && analizado.externos !== null ? analizado.externos : {}
    } catch {
      return {}
    }
  }

  private persistirRegistro(): void {
    const doc: RegistroExterno = { version: 1, externos: this.externos }
    escribirArchivoAtomicoSync(this.rutaRegistro, JSON.stringify(doc, null, 2) + '\n')
    this.publishCatalog() // `tdb` lee el catálogo, no este registro
  }

  // --- Consulta --------------------------------------------------------------

  /**
   * Carpeta utilizable de un pack, o null si no está instalado. Prioriza el externo
   * (si el usuario apuntó uno, manda su decisión sobre la descarga automática).
   */
  resolver(paqueteDriverId: string): string | null {
    const paqueteDriver = paqueteDriverPorId(paqueteDriverId, this.plataforma)
    if (!paqueteDriver) return null
    const externo = this.externos[paqueteDriverId]
    if (externo && existsSync(path.join(externo, paqueteDriver.centinela))) return externo
    const propio = this.dirPaqueteDriver(paqueteDriver)
    if (existsSync(path.join(propio, paqueteDriver.centinela))) return propio
    return null
  }

  estado(): EstadoDriver[] {
    return paquetesDriverDePlataforma(this.plataforma).map((p) => {
      const ruta = this.resolver(p.id)
      const disponible = disponibilidadPaqueteDriver(p, this.plataforma, this.releaseSistema)
      return {
        id: p.id,
        motor: p.motor,
        nombre: p.nombre,
        tamanoMb: p.sizeMB,
        cubre: txDb().drivers.cubre[p.id] ?? p.cubre,
        descargable: p.url !== null && disponible.ok,
        // Solo si los hay: un pack sin aviso y descargable publica el mismo objeto que antes.
        ...(p.aviso ? { aviso: txDb().drivers.avisoSoporte[p.id] ?? p.aviso } : {}),
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
  usarExistente(paqueteDriverId: string, rutaElegida: string): EstadoDriver {
    const paqueteDriver = this.paqueteDriverDePlataforma(paqueteDriverId)

    const candidatos = [rutaElegida, path.join(rutaElegida, paqueteDriver.carpetaInterna)]
    const valida = candidatos.find((c) => existsSync(path.join(c, paqueteDriver.centinela)))
    if (!valida) {
      throw new Error(txDb().drivers.noEncontrado(paqueteDriver.centinela, rutaElegida))
    }
    this.externos[paqueteDriverId] = valida
    this.persistirRegistro()
    this.log(`driver externo registrado: ${paqueteDriverId} -> ${valida}`)
    return this.estado().find((s) => s.id === paqueteDriverId)!
  }

  /** Olvida el driver externo de un pack (vuelve a mandar el descargado, si lo hay). */
  olvidarExistente(paqueteDriverId: string): void {
    if (!(paqueteDriverId in this.externos)) return
    delete this.externos[paqueteDriverId]
    this.persistirRegistro()
  }

  // --- Descarga --------------------------------------------------------------

  /**
   * Descarga e instala un pack. Idempotente: si ya está instalado devuelve su
   * estado sin bajar nada, y dos llamadas concurrentes comparten la misma descarga.
   */
  async instalar(paqueteDriverId: string): Promise<EstadoDriver> {
    const paqueteDriver = this.paqueteDriverDePlataforma(paqueteDriverId)
    if (this.resolver(paqueteDriverId)) return this.estado().find((s) => s.id === paqueteDriverId)!

    const enCurso = this.enVuelo.get(paqueteDriverId)
    if (enCurso) return enCurso

    const tarea = this.ejecutarInstalacion(paqueteDriver).finally(() => this.enVuelo.delete(paqueteDriverId))
    this.enVuelo.set(paqueteDriverId, tarea)
    return tarea
  }

  /**
   * Lanza, avisando por el progreso, si el pack no se puede descargar: sin URL (con el porqué del pack,
   * y no un 404 que haría pensar en la red) o en un sistema donde el cliente no cargaría.
   */
  private exigirDescargable(paqueteDriver: PaqueteDriverResuelto): void {
    if (paqueteDriver.url === null) {
      const motivo = txDb().drivers.sinDescarga[paqueteDriver.id] ?? paqueteDriver.sinDescarga ?? txDb().drivers.oracleSinDescarga(paqueteDriver.nombre)
      this.log(`${paqueteDriver.id}: sin descarga automática`)
      this.onProgreso({ packId: paqueteDriver.id, porcentaje: null, fase: 'error', mensaje: motivo })
      throw new Error(motivo)
    }
    const disponible = disponibilidadPaqueteDriver(paqueteDriver, this.plataforma, this.releaseSistema)
    if (!disponible.ok) {
      this.log(`${paqueteDriver.id}: no disponible en este sistema`)
      this.onProgreso({ packId: paqueteDriver.id, porcentaje: null, fase: 'error', mensaje: disponible.motivo })
      throw new Error(disponible.motivo)
    }
  }

  /**
   * Escribe el zip descomprimido APLANADO en `destino` y devuelve cuántos archivos escribió. En
   * Linux, los enlaces simbólicos del zip (`enlaces`) se crean como enlaces; el de Windows no trae.
   */
  private aplanarEn(destino: string, archivos: Record<string, Uint8Array>, enlaces: Set<string>): number {
    mkdirSync(destino, { recursive: true })
    let escritos = 0
    for (const [nombre, datos] of Object.entries(archivos)) {
      if (nombre.endsWith('/') || datos.length === 0) continue
      // Solo el basename: aparte de simplificar, corta un `../` de un zip manipulado.
      const base = path.basename(nombre)
      if (!base || base === '.' || base === '..') continue
      // META-INF son las firmas del zip de Oracle: ruido.
      if (nombre.includes('META-INF/')) continue
      if (this.plataforma === 'linux' && enlaces.has(nombre)) {
        const apunta = destinoDeEnlace(datos)
        if (apunta === null) continue
        rmSync(path.join(destino, base), { force: true })
        symlinkSync(apunta, path.join(destino, base))
      } else {
        writeFileSync(path.join(destino, base), datos)
      }
      escritos++
    }
    return escritos
  }

  private async ejecutarInstalacion(paqueteDriver: PaqueteDriverResuelto): Promise<EstadoDriver> {
    const destino = this.dirPaqueteDriver(paqueteDriver)
    this.exigirDescargable(paqueteDriver)
    if (paqueteDriver.formato === 'dmg') return this.ejecutarInstalacionDmg(paqueteDriver, destino)
    try {
      this.log(`descargando ${paqueteDriver.id} desde ${paqueteDriver.url}`)
      const zip = await this.download(paqueteDriver)

      this.onProgreso({ packId: paqueteDriver.id, porcentaje: 100, fase: 'descomprimiendo' })
      const archivos = await this.descomprimirEnMemoria(zip)
      // El zip trae todo bajo `instantclient_XX_YY/`: se aplana para que la ruta de `initOracleClient`
      // sea la misma venga de una descarga o de un driver externo.
      const escritos = this.aplanarEn(destino, archivos, enlacesDelZip(zip))
      this.log(`${paqueteDriver.id}: ${escritos} archivos en ${destino}`)

      if (!existsSync(path.join(destino, paqueteDriver.centinela))) {
        throw new Error(txDb().drivers.sinContenido(paqueteDriver.centinela))
      }
      this.onProgreso({ packId: paqueteDriver.id, porcentaje: 100, fase: 'listo' })
      return this.estado().find((s) => s.id === paqueteDriver.id)!
    } catch (err) {
      // Una instalación a medias es peor que ninguna: se limpia para que el próximo intento parta de cero.
      try {
        rmSync(destino, { recursive: true, force: true })
      } catch {
        // Si no se puede borrar, el centinela ausente ya impide darlo por instalado.
      }
      const mensaje = err instanceof Error ? err.message : String(err)
      this.onProgreso({ packId: paqueteDriver.id, porcentaje: null, fase: 'error', mensaje })
      throw new Error(txDb().drivers.noSePudoInstalar(paqueteDriver.nombre, mensaje), { cause: err })
    }
  }

  /**
   * Instala un pack publicado como .dmg (`instalarDmg.ts`), con el mismo contrato que la rama zip.
   * Se comprueba que `destino` coincide con el que recalcula `rutasInstalacionDmg`.
   */
  private async ejecutarInstalacionDmg(paqueteDriver: PaqueteDriverResuelto, destino: string): Promise<EstadoDriver> {
    const rutas = rutasInstalacionDmg(this.raiz, paqueteDriver)
    try {
      if (rutas.destino !== destino) throw new Error('rutas de instalación incoherentes')
      if (paqueteDriver.url === null) throw new Error(txDb().drivers.sinDescargaAutomatica)
      // Sin huella no se monta nada: sería darle al parser de imágenes bytes sin verificar.
      if (!paqueteDriver.sha256) throw new Error('el paquete no declara su huella SHA-256 y no se monta sin verificarla.')
      await this.barrido

      this.log(`descargando ${paqueteDriver.id} desde ${paqueteDriver.url}`)
      mkdirSync(path.dirname(rutas.dmg), { recursive: true })
      const fh = await open(rutas.dmg, 'w')
      let huella: { sha256: string; bytes: number }
      try {
        huella = await descargarConHuella(
          this.funcionTraer,
          paqueteDriver.url,
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
          (pct) => this.onProgreso({ packId: paqueteDriver.id, porcentaje: pct, fase: 'descargando' }),
          { inactividadMs: this.plazoInactividadMs }
        )
      } catch (err) {
        rmSync(rutas.dmg, { force: true })
        throw err
      }
      if (!huellaCoincide(huella.sha256, paqueteDriver.sha256)) {
        rmSync(rutas.dmg, { force: true })
        throw new Error(txDb().drivers.huellaNoCoincide(huella.bytes))
      }

      this.onProgreso({ packId: paqueteDriver.id, porcentaje: 100, fase: 'instalando' })
      await instalarDesdeDmg(this.depsDmg(), rutas, paqueteDriver)
      this.log(`${paqueteDriver.id}: instalado en ${destino}`)
      this.onProgreso({ packId: paqueteDriver.id, porcentaje: 100, fase: 'listo' })
      return this.estado().find((s) => s.id === paqueteDriver.id)!
    } catch (err) {
      // El stderr de codesign nombra el archivo con su ruta entera: la carpeta de datos
      // se sustituye antes de que el mensaje salga hacia la interfaz.
      const crudo = err instanceof Error ? err.message : String(err)
      const mensaje = crudo.split(this.raiz).join('<drivers>')
      this.onProgreso({ packId: paqueteDriver.id, porcentaje: null, fase: 'error', mensaje })
      throw new Error(txDb().drivers.noSePudoInstalar(paqueteDriver.nombre, mensaje), { cause: err })
    }
  }

  /** Descarga el zip a memoria informando del progreso. */
  private async download(paqueteDriver: PaqueteDriverResuelto): Promise<Uint8Array> {
    // `ejecutarInstalacion` ya cortó el caso sin URL; esto es solo para el compilador.
    if (paqueteDriver.url === null) throw new Error(txDb().drivers.sinDescargaAutomatica)
    // La descarga de siempre (`descarga.ts`), a memoria: el zip se descomprime con
    // fflate sin pasar por disco. La huella no se usa (el zip no la publica).
    const trozos: Uint8Array[] = []
    const { bytes } = await descargarConHuella(
      this.funcionTraer,
      paqueteDriver.url,
      {
        escribir: async (trozo) => {
          trozos.push(trozo)
        },
        cerrar: async () => {}
      },
      (pct) => this.onProgreso({ packId: paqueteDriver.id, porcentaje: pct, fase: 'descargando' }),
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
      throw new Error(txDb().drivers.noEsZip)
    }
    return zip
  }

  private descomprimirEnMemoria(zip: Uint8Array): Promise<Record<string, Uint8Array>> {
    return new Promise((resolver, rechazar) => {
      unzip(zip, (err, datos) => (err ? rechazar(err) : resolver(datos)))
    })
  }
}
