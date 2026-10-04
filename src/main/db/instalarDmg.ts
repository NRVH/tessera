// =============================================================================
// Instalar un Instant Client que Oracle publica como imagen de disco (.dmg, el de Apple Silicon): montar
// en una carpeta propia, copiar las entradas visibles con `cp -R -P -X`, desmontar siempre, verificar la
// firma del fabricante y renombrar al final; más el barrido de arranque de lo que una app muerta dejó.
// Las órdenes se construyen aquí y las ejecuta `deps.ejecutar`, así se prueba desde Windows.
// Decisiones: docs/decisiones/bd/drivers-instalar-desde-dmg.md
// =============================================================================
import path from 'node:path'
import { mensajeDe } from '../util/valores.ts'

/** Una orden externa: binario por ruta absoluta y argumentos sueltos (sin shell). */
export interface OrdenExterna {
  cmd: string
  args: string[]
}

export const HDIUTIL = '/usr/bin/hdiutil'
export const CP = '/bin/cp'
export const CODESIGN = '/usr/bin/codesign'

/** Carpeta (bajo la raíz de drivers) donde se montan las imágenes. Solo de Tessera. */
export const CARPETA_MONTAJES = '.montajes'
/** Carpeta (bajo la raíz de drivers) donde se deja el .dmg mientras se instala. */
export const CARPETA_DESCARGAS = '.descargas'

export interface RutasDmg {
  /** El .dmg descargado. */
  dmg: string
  /** Punto de montaje propio (nunca /Volumes). */
  montaje: string
  /** Copia en curso; se renombra a `destino` al final. */
  destinoTmp: string
  /** Carpeta final del pack (la que busca `resolve()`). */
  destino: string
}

/**
 * Rutas de una instalación. `destino` es la de siempre (`<drivers>/<motor>/<id>`,
 * la misma que calcula `DriverManager.packDir` y que busca `oracle.cjs`); lo demás
 * cuelga de la raíz de drivers para que el barrido sepa dónde mirar. El `.instalando`
 * va en la MISMA carpeta que el destino, porque un renombrado entre volúmenes no existe.
 */
export function rutasInstalacionDmg(
  driversDir: string,
  pack: { id: string; motor: string }
): RutasDmg {
  const carpetaMotor = path.join(driversDir, pack.motor)
  return {
    dmg: path.join(driversDir, CARPETA_DESCARGAS, `${pack.id}.dmg`),
    montaje: path.join(driversDir, CARPETA_MONTAJES, pack.id),
    destinoTmp: path.join(carpetaMotor, `.${pack.id}.instalando`),
    destino: path.join(carpetaMotor, pack.id)
  }
}

/** ¿Es este nombre la copia a medias de una instalación (`.<pack>.instalando`)? */
export function esCopiaAMedias(nombre: string): boolean {
  return /^\..+\.instalando$/.test(nombre)
}

export function ordenMontar(dmg: string, montaje: string): OrdenExterna {
  return {
    cmd: HDIUTIL,
    args: ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', montaje, dmg]
  }
}

/**
 * Lo que se copia de la raíz del volumen: las entradas VISIBLES, en orden estable. Lo
 * que empieza por punto es del sistema de archivos (ver el ADR), y
 * `.`/`..` no son entradas.
 */
export function entradasACopiar(nombres: readonly string[]): string[] {
  return nombres.filter((n) => n.length > 0 && !n.startsWith('.')).sort()
}

/**
 * `cp -R -P -X` de cada entrada de `montaje` a `destinoTmp`, que YA existe (con varias
 * fuentes, cp copia cada una DENTRO del destino, con su nombre).
 */
export function ordenCopiar(montaje: string, entradas: readonly string[], destinoTmp: string): OrdenExterna {
  return { cmd: CP, args: ['-R', '-P', '-X', ...entradas.map((e) => path.join(montaje, e)), destinoTmp] }
}

export function ordenDesmontar(montaje: string, forzado: boolean): OrdenExterna {
  return { cmd: HDIUTIL, args: forzado ? ['detach', montaje, '-force'] : ['detach', montaje] }
}

/**
 * Requisito de firma: encadenada a una raíz de Apple Y con el Team ID de Oracle en el
 * certificado final. Solo «anchor apple generic» aceptaría cualquier Developer ID; solo
 * el Team ID, un certificado falso con ese OU. El `=` inicial le dice a codesign que es
 * TEXTO de requisito y no la ruta de un archivo que lo contenga.
 */
export function requisitoFirma(teamId: string): string {
  return `=anchor apple generic and certificate leaf[subject.OU] = "${teamId}"`
}

export function ordenVerificarFirma(archivo: string, teamId: string): OrdenExterna {
  return { cmd: CODESIGN, args: ['--verify', '--strict', '-R', requisitoFirma(teamId), archivo] }
}

/** ¿Coincide la huella calculada con la publicada? Sin caja ni espacios de más. */
export function huellaCoincide(calculada: string, esperada: string): boolean {
  const a = calculada.trim().toLowerCase()
  const b = esperada.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(b) && a === b
}

/** Lo que la instalación necesita del mundo. Todo inyectable para el test. */
export interface DepsInstalarDmg {
  /** Ejecuta una orden; rechaza con un Error legible si sale con código ≠ 0. */
  ejecutar: (orden: OrdenExterna) => Promise<void>
  existe: (ruta: string) => boolean
  crearCarpeta: (ruta: string) => void
  /** Borra una ruta recursivamente (sin error si no existe). NUNCA se usa sobre un montaje. */
  borrar: (ruta: string) => void
  /**
   * Borra una carpeta SOLO si está vacía (rmdir). Es lo único que se hace sobre un punto
   * de montaje: un borrado recursivo sobre un volumen que siguiera montado borraría lo
   * que hay DENTRO.
   */
  quitarCarpetaVacia: (ruta: string) => void
  renombrar: (de: string, a: string) => void
  /** Ruta real de un enlace simbólico (la del binario que se firma). */
  rutaReal: (ruta: string) => string
  listar: (ruta: string) => string[]
  /**
   * Dispositivo (`st_dev`) de una ruta SIN seguir enlaces (lstat). Lanza si no existe.
   * Es lo que decide si una carpeta es un punto de montaje (`esPuntoDeMontaje`).
   */
  dispositivo: (ruta: string) => number
  log: (msg: string) => void
}

/** Lo que la instalación necesita del pack. */
export interface PackDmg {
  centinela: string
  firma?: { teamId: string; archivos: readonly string[] }
  sobrantes?: readonly string[]
}

/**
 * ¿Hay un volumen montado JUSTO en `ruta`? Sí si su dispositivo no es el de su carpeta
 * padre. `null` si no se puede saber (y entonces no se desmonta ni se borra nada).
 */
export function esPuntoDeMontaje(deps: Pick<DepsInstalarDmg, 'dispositivo'>, ruta: string): boolean | null {
  try {
    return deps.dispositivo(ruta) !== deps.dispositivo(path.dirname(ruta))
  } catch {
    return null
  }
}

/** Desmonta `montaje` (normal y, si falla, forzado). Nunca lanza: devuelve si quedó libre. */
export async function desmontar(deps: DepsInstalarDmg, montaje: string): Promise<boolean> {
  try {
    await deps.ejecutar(ordenDesmontar(montaje, false))
    return true
  } catch (err) {
    deps.log(`hdiutil detach falló (${mensajeDe(err)}); se fuerza`)
  }
  try {
    await deps.ejecutar(ordenDesmontar(montaje, true))
    return true
  } catch (err) {
    deps.log(`hdiutil detach -force falló (${mensajeDe(err)}); lo recogerá el barrido del próximo arranque`)
    return false
  }
}

/**
 * Deja libre una carpeta de montaje que sobró de otra vez: `detach -force` SOLO si de
 * verdad hay algo montado en ella (ver el ADR), y después rmdir si quedó vacía.
 * Nunca lanza. Devuelve si desmontó algo.
 */
async function liberarMontajeHuerfano(deps: DepsInstalarDmg, montaje: string): Promise<boolean> {
  const montado = esPuntoDeMontaje(deps, montaje)
  if (montado === null) {
    deps.log(`no se pudo saber si ${path.basename(montaje)} es un punto de montaje; se deja como está`)
    return false
  }
  let desmontado = false
  if (montado) {
    try {
      await deps.ejecutar(ordenDesmontar(montaje, true))
      desmontado = true
      deps.log(`montaje huérfano desmontado: ${path.basename(montaje)}`)
    } catch (err) {
      deps.log(`no se pudo desmontar ${path.basename(montaje)} (${mensajeDe(err)})`)
      return false
    }
  }
  try {
    deps.quitarCarpetaVacia(montaje)
  } catch {
    // Si no está vacía (o no es una carpeta), se deja: lo de dentro no se toca a ciegas.
  }
  return desmontado
}

/** Las entradas de `dir`, o ninguna si no existe o no se puede listar. */
function listarSeguro(deps: DepsInstalarDmg, dir: string): string[] {
  try {
    return deps.existe(dir) ? deps.listar(dir) : []
  } catch {
    return []
  }
}

/**
 * Desmonta lo que haya quedado colgado bajo `drivers/.montajes` (una app que murió
 * entre montar y desmontar). Solo esa carpeta, que es de Tessera: nunca /Volumes, y
 * solo lo que de verdad es un punto de montaje. Nunca lanza.
 */
export async function barrerMontajes(deps: DepsInstalarDmg, dirMontajes: string): Promise<number> {
  let barridos = 0
  for (const nombre of listarSeguro(deps, dirMontajes)) {
    if (await liberarMontajeHuerfano(deps, path.join(dirMontajes, nombre))) barridos++
  }
  return barridos
}

/**
 * Borra los restos de instalaciones que murieron a mitad: todo lo que haya en
 * `drivers/.descargas` y cada `drivers/<motor>/.<pack>.instalando`. Solo eso, y solo
 * bajo `driversDir`: los packs instalados, los externos y cualquier otra cosa se quedan.
 * Nunca lanza. Devuelve las rutas borradas.
 */
export function barrerRestos(deps: DepsInstalarDmg, driversDir: string): string[] {
  const borradas: string[] = []
  const borrar = (ruta: string): void => {
    try {
      deps.borrar(ruta)
      borradas.push(ruta)
      deps.log(`resto de una instalación anterior borrado: ${path.relative(driversDir, ruta)}`)
    } catch (err) {
      deps.log(`no se pudo borrar ${path.relative(driversDir, ruta)} (${mensajeDe(err)})`)
    }
  }
  const dirDescargas = path.join(driversDir, CARPETA_DESCARGAS)
  for (const nombre of listarSeguro(deps, dirDescargas)) borrar(path.join(dirDescargas, nombre))
  for (const motor of listarSeguro(deps, driversDir)) {
    // Las carpetas propias (`.montajes`, `.descargas`) no son de un motor.
    if (motor.startsWith('.')) continue
    const dirMotor = path.join(driversDir, motor)
    for (const nombre of listarSeguro(deps, dirMotor)) {
      if (esCopiaAMedias(nombre)) borrar(path.join(dirMotor, nombre))
    }
  }
  return borradas
}

/**
 * El barrido de arranque de Mac (ver el ADR): primero los montajes, para que nada
 * de lo que se borre después siga montado. Nunca lanza.
 */
export async function barrerArranque(
  deps: DepsInstalarDmg,
  driversDir: string
): Promise<{ montajes: number; restos: string[] }> {
  const montajes = await barrerMontajes(deps, path.join(driversDir, CARPETA_MONTAJES))
  const restos = barrerRestos(deps, driversDir)
  return { montajes, restos }
}

/** Sin la copia a medias de un intento anterior y con las dos carpetas que hacen falta. */
function prepararCarpetas(deps: DepsInstalarDmg, rutas: RutasDmg): void {
  deps.borrar(rutas.destinoTmp)
  deps.crearCarpeta(rutas.montaje)
  // El destino de cp tiene que existir: con varias fuentes, cp copia dentro de él.
  deps.crearCarpeta(rutas.destinoTmp)
}

/** Quita la carpeta del montaje si quedó vacía; si no, la recoge el barrido. */
function quitarMontajeVacio(deps: DepsInstalarDmg, rutas: RutasDmg): void {
  try {
    deps.quitarCarpetaVacia(rutas.montaje)
  } catch {
    // Si no quedó vacía, es que algo sí se montó (o no se desmontó): la recoge el barrido.
  }
}

/** Las entradas visibles de la imagen montada; lanza si no hay ninguna. */
function entradasDeLaImagen(deps: DepsInstalarDmg, rutas: RutasDmg): string[] {
  const entradas = entradasACopiar(deps.listar(rutas.montaje))
  if (entradas.length === 0) throw new Error('la imagen de disco está vacía.')
  return entradas
}

/** Quita los sobrantes de la copia y exige su centinela. */
function depurarCopia(deps: DepsInstalarDmg, rutas: RutasDmg, pack: PackDmg): void {
  for (const sobrante of pack.sobrantes ?? []) {
    deps.borrar(path.join(rutas.destinoTmp, sobrante))
  }
  if (!deps.existe(path.join(rutas.destinoTmp, pack.centinela))) {
    throw new Error(`La imagen de disco no contiene "${pack.centinela}".`)
  }
}

/** La ruta real de un binario de la copia cuya firma hay que verificar; lanza si no está. */
function binarioAFirmar(deps: DepsInstalarDmg, rutas: RutasDmg, archivo: string): string {
  const ruta = path.join(rutas.destinoTmp, archivo)
  if (!deps.existe(ruta)) throw new Error(`La imagen de disco no contiene "${archivo}".`)
  return deps.rutaReal(ruta)
}

/**
 * Instala desde un .dmg ya descargado y verificado por huella. Si algo falla, lanza con un mensaje para
 * el usuario y deja limpio: sin montaje, sin `.instalando` y sin el .dmg. El destino final no se toca
 * hasta que todo pasó. Cada orden se espera aquí, en el cuerpo: en funciones `async` aparte sumaría
 * turnos; lo que no espera nada sale a funciones síncronas.
 */
export async function instalarDesdeDmg(
  deps: DepsInstalarDmg,
  rutas: RutasDmg,
  pack: PackDmg
): Promise<void> {
  try {
    // Un montaje colgado en NUESTRO punto se desmonta antes de nada, o el attach fallaría con «resource busy».
    if (deps.existe(rutas.montaje)) await liberarMontajeHuerfano(deps, rutas.montaje)
    prepararCarpetas(deps, rutas)
    try {
      await deps.ejecutar(ordenMontar(rutas.dmg, rutas.montaje))
    } catch (err) {
      quitarMontajeVacio(deps, rutas)
      throw new Error(`No se pudo montar la imagen de disco: ${mensajeDe(err)}`, { cause: err })
    }
    // Copia sus entradas visibles a `destinoTmp` y desmonta siempre, salga como salga.
    try {
      await deps.ejecutar(ordenCopiar(rutas.montaje, entradasDeLaImagen(deps, rutas), rutas.destinoTmp))
    } catch (err) {
      throw new Error(`No se pudo copiar el cliente desde la imagen de disco: ${mensajeDe(err)}`, { cause: err })
    } finally {
      if (await desmontar(deps, rutas.montaje)) quitarMontajeVacio(deps, rutas)
    }
    depurarCopia(deps, rutas, pack)
    // La firma de cada binario que se carga, uno a uno y en orden.
    const { archivos, teamId } = pack.firma ?? { archivos: [], teamId: '' }
    for (const archivo of archivos) {
      const real = binarioAFirmar(deps, rutas, archivo)
      try {
        await deps.ejecutar(ordenVerificarFirma(real, teamId))
      } catch (err) {
        throw new Error(`"${path.basename(real)}" no lleva la firma esperada del fabricante (Team ID ${teamId}): ${mensajeDe(err)}`, { cause: err })
      }
    }
    deps.borrar(rutas.destino)
    deps.renombrar(rutas.destinoTmp, rutas.destino)
  } catch (err) {
    try {
      deps.borrar(rutas.destinoTmp)
    } catch {
      // Sin centinela en el destino final, nada lo da por instalado.
    }
    throw err
  } finally {
    try {
      deps.borrar(rutas.dmg)
    } catch {
      // Un .dmg olvidado en `.descargas` lo borra el barrido del próximo arranque.
    }
  }
}
