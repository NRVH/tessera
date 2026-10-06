// =============================================================================
// Dónde abre cada diálogo de «elegir carpeta / archivo»: la DECISIÓN; el diálogo lo abre
// `adaptadores/dialogosNativos.ts`. Desde Electron 43 un diálogo sin `defaultPath` abre en
// Descargas, así que Tessera recuerda la carpeta PADRE de lo elegido (el siguiente proyecto suele
// ser hermano del último), una por diálogo, en un archivo propio de `userData` crash-safe con
// `.bak`. Comprobar una candidata es un `stat` asíncrono con tope y en paralelo (uno síncrono en
// una unidad de red caída congela la app); un error de PERMISO (TCC en macOS) no la descarta; lo
// recordado que ya no existe cae al siguiente respaldo y al final al home. Puro; la plataforma
// entra por parámetro (`test-carpeta-dialogo.mts`).
// =============================================================================

import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { writeFileAtomic } from './atomicWrite.ts'

/** Los diálogos que recuerdan su carpeta. Una clave por diálogo, no una global. */
export type DialogoCarpeta =
  | 'abrir-proyecto'
  | 'carpeta-driver'
  | 'java'
  | 'guardar-como'
  /** Exportar filas del explorador de bases de datos (CSV, JSON…). */
  | 'exportar-bd'
  /** Elegir o crear el archivo de una base de datos de archivo (SQLite). */
  | 'archivo-bd'
  /** Elegir el archivo de clave de una conexión SSH (la primera vez, en `~/.ssh`). */
  | 'clave-ssh'
  /** Elegir el archivo `config` de OpenSSH del que importar conexiones SSH. */
  | 'config-ssh'
  /** La carpeta del equipo donde bajar desde el explorador SFTP. */
  | 'sftp-descarga'
  /** Lo que subir al servidor desde el explorador SFTP. */
  | 'sftp-subida'

/** ¿Se puede ofrecer `ruta` como carpeta inicial? Se inyecta para que el test no dependa del disco. */
export type EsCarpeta = (ruta: string) => Promise<boolean>

/** Tope de espera de un `stat`. Pasado, la carpeta se da por inalcanzable. */
export const ESPERA_STAT_MS = 1500

/**
 * ¿Un `stat` que falla con este código deja la carpeta como candidata? Sólo los de
 * PERMISO: la carpeta existe y el diálogo, que corre fuera del proceso, puede
 * enseñarla (ver la cabecera). Todo lo demás —no existe, no es carpeta, error de E/S—
 * la descarta.
 */
export function permisoSinAcceso(code: string | undefined): boolean {
  return code === 'EPERM' || code === 'EACCES'
}

interface OpcionesStat {
  /** El `stat` a usar; inyectable en el test. */
  stat?: (ruta: string) => Promise<{ isDirectory(): boolean }>
  /** Tope de espera (por defecto `ESPERA_STAT_MS`). */
  esperaMs?: number
}

/** ¿`ruta` es una carpeta que el diálogo pueda enseñar? No lanza, y no espera más del tope. */
export async function esCarpetaEnDisco(ruta: string, opciones: OpcionesStat = {}): Promise<boolean> {
  const consultar = opciones.stat ?? stat
  const esperaMs = opciones.esperaMs ?? ESPERA_STAT_MS
  let reloj: ReturnType<typeof setTimeout> | undefined
  const agotado = new Promise<boolean>((resolver) => {
    reloj = setTimeout(() => resolver(false), esperaMs)
  })
  const consulta = Promise.resolve()
    .then(() => consultar(ruta))
    .then(
      (s) => s.isDirectory(),
      (err: { code?: string } | null) => permisoSinAcceso(err?.code)
    )
  try {
    return await Promise.race([consulta, agotado])
  } finally {
    clearTimeout(reloj)
  }
}

/**
 * La primera de `candidatas` que valga, EN SU ORDEN; si ninguna, `home`. Pura.
 *
 * Se consultan todas en PARALELO: si la preferida está en una unidad de red caída, su
 * espera no se suma a la de las demás, y la respuesta tarda como mucho un tope.
 */
export async function carpetaInicial(
  candidatas: ReadonlyArray<string | null | undefined>,
  home: string,
  esCarpeta: EsCarpeta
): Promise<string> {
  const reales = candidatas.filter((c): c is string => typeof c === 'string' && c !== '')
  const validas = await Promise.all(reales.map((c) => esCarpeta(c)))
  const i = validas.indexOf(true)
  return i >= 0 ? reales[i] : home
}

/**
 * Qué carpeta se recuerda tras elegir `elegido`: la que lo contiene. Puro.
 *
 * `rutas` es el módulo de rutas de la PLATAFORMA (`path.win32` / `path.posix`), con la
 * actual por defecto: las rutas llegan del diálogo del sistema en el que se corre, y el
 * test comprueba las dos formas desde cualquiera de las dos máquinas.
 */
export function carpetaARecordar(elegido: string, rutas: path.PlatformPath = path): string {
  return rutas.dirname(elegido)
}

/** Candidatas que propone quien abre el diálogo, alrededor de lo recordado. */
export interface Candidatas {
  /** ANTES de lo recordado: p. ej. la carpeta del proyecto activo al guardar. */
  antes?: ReadonlyArray<string | null | undefined>
  /** DESPUÉS de lo recordado: p. ej. la carpeta que contiene el proyecto activo. */
  despues?: ReadonlyArray<string | null | undefined>
}

interface Documento {
  version: 1
  carpetas: Partial<Record<DialogoCarpeta, string>>
}

/** Lee y valida un documento; `null` si no existe o no se puede leer. */
async function leerDocumento(ruta: string): Promise<Documento | null> {
  try {
    const crudo = JSON.parse(await readFile(ruta, 'utf8')) as { carpetas?: unknown }
    const doc: Documento = { version: 1, carpetas: {} }
    if (typeof crudo.carpetas === 'object' && crudo.carpetas !== null) {
      for (const [clave, valor] of Object.entries(crudo.carpetas)) {
        // Sólo se aceptan cadenas: un archivo editado a mano o de otra versión no puede
        // colar un número o un objeto como `defaultPath`.
        if (typeof valor === 'string' && valor !== '') {
          doc.carpetas[clave as DialogoCarpeta] = valor
        }
      }
    }
    return doc
  } catch {
    return null
  }
}

/** La memoria, persistida en un JSON propio de `userData`. */
export class MemoriaCarpetas {
  /**
   * Lo recordado EN ESTA SESIÓN. Si la escritura a disco falla, el diálogo sigue
   * recordando hasta que se cierre la app: no poder persistir no invalida la sesión.
   */
  private cache: Documento | null = null
  /**
   * Cola de escrituras: `writeFileAtomic` usa un tmp de nombre FIJO por destino, así que
   * dos escrituras solapadas al mismo archivo se pisarían (ver `atomicWrite.ts`).
   */
  private escrituras: Promise<void> = Promise.resolve()
  private readonly archivo: string
  private readonly esCarpeta: EsCarpeta
  private readonly home: string

  // Campos declarados a mano y no como «parameter properties» (`private readonly x` en
  // la firma): el type-stripping de Node, con el que corren los `test-*.mts`, no las
  // admite, y el test moriría con ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
  constructor(
    archivo: string,
    esCarpeta: EsCarpeta = (ruta) => esCarpetaEnDisco(ruta),
    home: string = homedir()
  ) {
    this.archivo = archivo
    this.esCarpeta = esCarpeta
    this.home = home
  }

  /** Dónde abrir `dialogo`: `antes`, lo recordado, `despues` y el home, en ese orden. */
  async inicial(dialogo: DialogoCarpeta, candidatas: Candidatas = {}): Promise<string> {
    const doc = await this.leer()
    return carpetaInicial(
      [...(candidatas.antes ?? []), doc.carpetas[dialogo], ...(candidatas.despues ?? [])],
      this.home,
      this.esCarpeta
    )
  }

  /** Recuerda la carpeta de `elegido` para la próxima vez que se abra `dialogo`. */
  async recordar(dialogo: DialogoCarpeta, elegido: string): Promise<void> {
    const doc = await this.leer()
    doc.carpetas[dialogo] = carpetaARecordar(elegido)
    this.cache = doc
    const texto = JSON.stringify(doc, null, 2) + '\n'
    this.escrituras = this.escrituras
      .then(() => writeFileAtomic(this.archivo, texto))
      .catch(() => {
        // Best-effort: ver `cache`.
      })
    await this.escrituras
  }

  private async leer(): Promise<Documento> {
    if (this.cache !== null) return this.cache
    const doc = (await leerDocumento(this.archivo)) ??
      (await leerDocumento(`${this.archivo}.bak`)) ?? { version: 1, carpetas: {} }
    // Otra llamada pudo llenar la caché mientras se leía: gana la primera, que es la que
    // pudo empezar a recibir `recordar`.
    this.cache ??= doc
    return this.cache
  }
}

/** El archivo de `userData` donde vive la memoria. */
export const ARCHIVO_CARPETAS = 'carpetas-dialogos.json'

/** La memoria de ESTA instalación: su archivo dentro de `userDataDir`. */
export function memoriaCarpetasEn(userDataDir: string): MemoriaCarpetas {
  return new MemoriaCarpetas(path.join(userDataDir, ARCHIVO_CARPETAS))
}
