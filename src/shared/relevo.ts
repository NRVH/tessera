// =============================================================================
// El relevo: contrato y decisiones PURAS del proceso aparte que aplica la actualización
// cuando Tessera ya no existe (espera a que muera, lanza el instalador y cuenta cómo salió).
// Corre desde una COPIA fuera de la carpeta de instalación, que es la que el instalador
// tiene que renombrar. Aquí solo vive lo que se prueba con `node`: la forma del encargo,
// si el relevo es utilizable y cómo se lee la salida del instalador; el efecto, en `main/relevo/`.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================

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
  if (code === 0) {
    return { ok: true, titulo: 'Actualización instalada', detalle: '' }
  }
  if (code === null) {
    return {
      ok: false,
      titulo: 'El instalador no llegó a ejecutarse',
      detalle:
        'No se pudo arrancar el archivo de instalación. Suele ser que el antivirus lo ' +
        'bloqueó o que la descarga ya no está en su sitio. Tessera sigue instalada y ' +
        'funcionando en la versión anterior.'
    }
  }
  if (code === 1223) {
    return {
      ok: false,
      titulo: 'Cancelaste la instalación',
      detalle: 'Windows pidió permiso y no se concedió. No se cambió nada.'
    }
  }
  if (code === 2) {
    return {
      ok: false,
      titulo: 'El instalador no pudo reemplazar los archivos',
      detalle:
        'El desinstalador de la versión anterior abortó. Casi siempre es una ruta ' +
        'demasiado larga dentro de la carpeta de la aplicación, no un archivo en uso.'
    }
  }
  return {
    ok: false,
    titulo: `El instalador falló (código ${code})`,
    detalle: 'Tessera sigue instalada en la versión anterior; puedes abrirla y reintentar.'
  }
}
