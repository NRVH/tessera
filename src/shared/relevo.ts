// =============================================================================
// El relevo: contrato y decisiones PURAS del proceso aparte que aplica la actualización
// cuando Tessera ya no existe (espera a que muera, lanza el instalador y cuenta cómo salió).
// Corre desde una COPIA fuera de la carpeta de instalación, que es la que el instalador
// tiene que renombrar. Aquí solo vive lo que se prueba con `node`: la forma del encargo,
// si el relevo es utilizable, cómo se lee la salida del instalador, qué se dice tras un fallo
// y si se puede reponer la copia; el efecto, en `main/relevo/`.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================
import { crearTextos } from './i18n.ts'

/** Los veredictos del instalador, en los dos idiomas. */
const txRelevo = crearTextos(
  {
    instalada: 'Actualización instalada',
    noEjecutoTitulo: 'El instalador no llegó a ejecutarse',
    noEjecutoDetalle:
      'No se pudo iniciar el archivo de instalación. Suele deberse a que un antivirus lo ' +
      'bloqueó o a que el archivo descargado se movió o se eliminó.',
    canceladaTitulo: 'Se canceló la instalación',
    canceladaDetalle: 'Windows solicitó permiso y no se concedió, por lo que el instalador no llegó a iniciarse.',
    noReemplazoTitulo: 'El instalador no pudo reemplazar los archivos',
    noReemplazoDetalle:
      'El desinstalador de la versión anterior se detuvo. Casi siempre se debe a una ruta ' +
      'demasiado larga dentro de la carpeta de la aplicación, no a un archivo en uso.',
    fallo: (code: number) => `El instalador falló (código ${code})`,
    falloDetalle: 'El instalador terminó con un error antes de finalizar.',
    sigueEnSuSitio:
      'Puede reintentar, volver a la versión anterior o abrir el instalador para realizar la instalación paso a paso.',
    seQuito:
      'La versión anterior se eliminó y la nueva no llegó a instalarse. Puede reintentar, volver a la ' +
      'versión anterior (sigue guardada) o abrir el instalador para realizar la instalación paso a paso.'
  },
  {
    instalada: 'Update installed',
    noEjecutoTitulo: 'The installer did not run',
    noEjecutoDetalle:
      'The installation file could not be started. This is usually because an antivirus ' +
      'blocked it or the downloaded file was moved or deleted.',
    canceladaTitulo: 'You canceled the installation',
    canceladaDetalle: 'Windows asked for permission and it was not granted, so the installer did not start.',
    noReemplazoTitulo: 'The installer could not replace the files',
    noReemplazoDetalle:
      'The previous version’s uninstaller stopped. This is almost always caused by a path ' +
      'that is too long inside the app folder, not by a file in use.',
    fallo: (code: number) => `The installer failed (code ${code})`,
    falloDetalle: 'The installer stopped with an error before finishing.',
    sigueEnSuSitio:
      'You can try again, go back to the previous version or open the installer to do it step by step.',
    seQuito:
      'The previous version was removed and the new one was not installed. You can try again, go back ' +
      'to the previous version (it is still saved) or open the installer to do it step by step.'
  }
)

/** Lo que la ventana del relevo sabe pintar. */
export interface EstadoRelevo {
  fase: 'esperando' | 'instalando' | 'ok' | 'error'
  titulo: string
  detalle: string
  /** Líneas de registro que se enseñan en el desplegable. */
  log: string[]
}

/** Lo que se le pide pintar a la ventana; el registro lo pone ella. */
export type EstadoPintable = Omit<EstadoRelevo, 'log'>

/** Nombre del encargo dentro de la carpeta del relevo. */
export const NOMBRE_ENCARGO = 'encargo.json'
/** Marcador con la versión con la que se hizo la copia del relevo. */
export const MARCADOR_COPIA = 'version.txt'
/** Lo que la carpeta del relevo tiene y la instalación no: no se repone al volver a la versión anterior. */
export const PROPIOS_DE_LA_COPIA = [NOMBRE_ENCARGO, MARCADOR_COPIA] as const

/**
 * Qué se le dice tras un fallo, según si el ejecutable sigue en su sitio. Se comprueba en vez de
 * suponerlo: el instalador desinstala la versión vieja ANTES de poner la nueva, y si falla entre
 * medias no queda nada que abrir.
 */
export function situacionTrasFallo(appEnSuSitio: boolean): string {
  return appEnSuSitio ? txRelevo().sigueEnSuSitio : txRelevo().seQuito
}

/**
 * ¿Se puede reponer la copia del relevo sobre la carpeta de instalación? Es el destino de un
 * `robocopy /MIR`, que borra lo que sobra: nunca la raíz de una unidad, nunca la propia copia y
 * nunca una carpeta que contenga a la otra. Rutas de Windows: solo allí hay relevo con copia.
 */
export function destinoRestaurable(raiz: string, copia: string): boolean {
  const r = rutaWindowsNormal(raiz)
  const c = rutaWindowsNormal(copia)
  if (r === null || c === null) return false
  // `c:` (la unidad) o `\\servidor\recurso` (la raíz de un recurso compartido).
  if (/^[a-z]:$/.test(r) || /^\\\\[^\\]+\\[^\\]+$/.test(r)) return false
  if (r === c) return false
  return !r.startsWith(`${c}\\`) && !c.startsWith(`${r}\\`)
}

/** Ruta absoluta de Windows en minúsculas, con `\`, sin barra final ni `.`/`..`; o null si no es absoluta. */
function rutaWindowsNormal(ruta: string): string | null {
  const s = ruta.trim().replace(/\//g, '\\').toLowerCase()
  const unidad = /^[a-z]:\\/.test(s)
  if (!unidad && !s.startsWith('\\\\')) return null
  const prefijo = unidad ? s.slice(0, 2) : ''
  const partes: string[] = []
  for (const p of (unidad ? s.slice(3) : s.slice(2)).split('\\')) {
    if (p === '' || p === '.') continue
    if (p === '..') {
      if (partes.length === 0) return null
      partes.pop()
    } else partes.push(p)
  }
  return unidad ? [prefijo, ...partes].join('\\') : `\\\\${partes.join('\\')}`
}

/** Versión del formato del encargo. Sube si cambian los campos. */
export const ENCARGO_VERSION = 1

/**
 * Bandera de línea de órdenes que convierte a este binario en el relevo.
 *
 * Va por ARGV y no por variable de entorno, y esto es una corrección con causa: con
 * `TESSERA_RELEVO` en el entorno, el proceso que el relevo lanza al pulsar "Abrir
 * Tessera" HEREDA la variable (en Windows un hijo sin bloque de entorno propio se
 * queda con el del padre). O sea: la Tessera recién instalada arrancaba en modo
 * relevo, encontraba el encargo todavía en disco y volvía a instalar. Un bucle, en
 * vez de la app. El argv no se hereda; el entorno sí.
 */
export const FLAG_RELEVO = '--tessera-relevo='

/** Ruta del encargo si nos arrancaron como relevo, o null. Puro: recibe el argv. */
export function rutaEncargoDesdeArgv(argv: readonly string[]): string | null {
  for (const a of argv) {
    if (a.startsWith(FLAG_RELEVO)) {
      const ruta = a.slice(FLAG_RELEVO.length)
      if (ruta.length > 0) return ruta
    }
  }
  return null
}

/**
 * Lo que Tessera le deja escrito al relevo antes de morir. Va a un JSON en el
 * directorio del relevo (no en `userData`): el relevo no debe depender de nada que
 * viva dentro de la carpeta que se va a reemplazar.
 */
export interface EncargoRelevo {
  version: number
  /** Ruta del instalador ya descargado y verificado. */
  instalador: string
  /** Carpeta de instalación que el instalador va a reemplazar. */
  raizInstalacion: string
  /** Ejecutable a relanzar cuando el usuario pulse "Abrir". */
  exeApp: string
  /** PID de la Tessera que se está muriendo. El relevo espera a que desaparezca. */
  pidPadre: number
  versionActual: string
  versionNueva: string
  /**
   * Ruta del log propio del relevo, tal y como la dejó escrita quien encargó.
   * El relevo NO la usa para abrir el registro: la deriva de la ruta del propio
   * encargo, porque tiene que poder escribir "no pude leer el encargo" — y para eso
   * el log ya debe estar abierto. Queda aquí como constancia de lo que se pretendía.
   */
  log: string
}

/** ¿Tiene el encargo la forma que esperamos? Defensivo: lo lee otro proceso. */
export function encargoValido(raw: unknown): raw is EncargoRelevo {
  if (typeof raw !== 'object' || raw === null) return false
  const o = raw as Record<string, unknown>
  const cadena = (k: string): boolean => typeof o[k] === 'string' && (o[k] as string).length > 0
  return (
    o.version === ENCARGO_VERSION &&
    cadena('instalador') &&
    cadena('raizInstalacion') &&
    cadena('exeApp') &&
    cadena('versionActual') &&
    cadena('versionNueva') &&
    cadena('log') &&
    typeof o.pidPadre === 'number' &&
    Number.isFinite(o.pidPadre)
  )
}

/** Estado de la copia del relevo que hay preparada en disco. */
export interface EstadoCopia {
  /** ¿Existe el ejecutable de la copia? */
  existeExe: boolean
  /** Versión de Tessera con la que se hizo la copia (del marcador), o null. */
  versionCopia: string | null
}

/**
 * ¿Se puede usar la copia del relevo? Solo si existe Y se hizo con la versión que
 * está corriendo ahora.
 *
 * La comprobación de versión no es cosmética: la copia se ejecuta con el MISMO
 * código que Tessera (una bandera decide si arranca la app o el relevo), así que
 * una copia de una versión anterior correría un relevo viejo — con otro formato de
 * encargo, u otros fallos ya corregidos. Ante la duda, no se usa: hay camino de
 * respaldo, y una actualización que cae al camino de siempre es infinitamente mejor
 * que una que se entrega a un supervisor equivocado.
 */
export function copiaUtilizable(estado: EstadoCopia, versionActual: string): boolean {
  return estado.existeExe && estado.versionCopia === versionActual
}

/** Cómo terminó el instalador, ya interpretado para enseñárselo a una persona. */
export interface VeredictoInstalador {
  ok: boolean
  titulo: string
  /** Explicación en prosa. Vacía si no hay nada que añadir al título. */
  detalle: string
}

/**
 * Traduce el código de salida del instalador NSIS.
 *
 * `null` = ni siquiera llegó a arrancar (el spawn falló). Se distingue de un código
 * distinto de cero A PROPÓSITO: son dos fallos con causas y arreglos distintos, y
 * mezclarlos es lo que llevaba a buscar procesos bloqueados cuando el problema era
 * que el archivo no estaba donde se creía.
 */
export function leerSalidaInstalador(code: number | null): VeredictoInstalador {
  const t = txRelevo()
  if (code === 0) {
    return { ok: true, titulo: t.instalada, detalle: '' }
  }
  if (code === null) {
    return { ok: false, titulo: t.noEjecutoTitulo, detalle: t.noEjecutoDetalle }
  }
  if (code === 1223) {
    return { ok: false, titulo: t.canceladaTitulo, detalle: t.canceladaDetalle }
  }
  if (code === 2) {
    return { ok: false, titulo: t.noReemplazoTitulo, detalle: t.noReemplazoDetalle }
  }
  return { ok: false, titulo: t.fallo(code), detalle: t.falloDetalle }
}
