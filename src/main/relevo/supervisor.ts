// =============================================================================
// El supervisor del relevo, ya con la ventana en pantalla: espera a que el proceso de Tessera
// muera (sus DLL siguen cargadas desde la carpeta a reemplazar), comprueba que la carpeta de
// instalación se puede RENOMBRAR (lo primero que hace el desinstalador de NSIS, con o sin
// procesos a la vista), lanza el instalador y espera su código de salida para contarlo, que es
// lo que Tessera no podía hacer. Escribe su propio registro.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { leerSalidaInstalador, type EncargoRelevo, type VeredictoInstalador } from '../../shared/relevo'
import { esperar } from '../util/esperas'

/**
 * Con qué se llama al instalador NSIS. `/S`: silencioso, la ventana que informa es la
 * nuestra. `--updated`: mata la app sin preguntar y conserva los accesos directos; lo que
 * protege los datos del usuario es la guarda de `build/installer.nsh`, que el instalador
 * aplica siempre al arrancar el desinstalador viejo. SIN `--force-run` a propósito: relanzar
 * lo decide el usuario con el botón; si lo hiciera el instalador, la ventana del relevo
 * quedaría detrás anunciando un resultado que ya nadie mira.
 */
const ARGS_INSTALADOR = ['/S', '--updated'] as const

/** Cuánto se espera, como mucho, a que el proceso padre desaparezca. */
const ESPERA_PADRE_MS = 30_000
/** Cuánto se insiste en que la carpeta llegue a estar renombrable. */
const ESPERA_CARPETA_MS = 20_000
const SONDEO_MS = 250

export type Progreso = (titulo: string, detalle: string, linea?: string) => void

/** ¿Sigue vivo ese pid? `kill(pid, 0)` no mata: solo pregunta. */
export function procesoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Sufijo del temporal con el que se prueba el rename. */
const SUFIJO_TMP = '.relevo-tmp'
/** Cuántas veces se insiste en devolver la carpeta a su nombre. */
const REINTENTOS_VUELTA = 12
/** Espera entre intentos de vuelta. 12 × 250 ms = 3 s en el peor caso. */
const ESPERA_VUELTA_MS = 250

/** Cómo quedó la prueba de renombrado. */
export type EstadoCarpeta =
  /** Se renombró y volvió a su sitio: el desinstalador podrá hacer lo mismo. */
  | 'libre'
  /** No se pudo ni empezar: algo la tiene tomada. Se reintenta. */
  | 'ocupada'
  /** Se renombró y NO se pudo devolver. La app está bajo otro nombre. */
  | 'atascada'

/**
 * ¿Se puede renombrar la carpeta de instalación? Se prueba DE VERDAD (rename de ida
 * y vuelta) en vez de deducirlo de la lista de procesos, porque es exactamente lo
 * que el desinstalador va a intentar.
 *
 * EL PELIGRO ESTÁ EN LA VUELTA, y la primera versión no lo trataba: si el rename de
 * vuelta fallaba, devolvía `false` y se iba dejando la carpeta como
 * `Tessera.relevo-tmp`. A partir de ahí la app no existe en su ruta (el botón
 * "Abrir Tessera" apunta a un exe que ya no está), toda comprobación posterior falla
 * por partida doble (el origen no existe y el destino sí), y el llamador seguía
 * adelante e instalaba igual. El comentario decía "mejor no instalar que dejar la
 * carpeta con otro nombre" y el código hacía exactamente las dos cosas malas.
 *
 * Ahora la vuelta se INSISTE (el antivirus o el indexador pueden estar mirando el
 * árbol un instante) y, si aun así no vuelve, se dice `'atascada'`, que es un estado
 * distinto de `'ocupada'` y aborta la instalación en vez de continuar a ciegas.
 */
export async function probarRenombrado(raiz: string): Promise<EstadoCarpeta> {
  const tmp = `${raiz}${SUFIJO_TMP}`
  // Resto de un intento anterior que se quedó a medias: se intenta deshacer antes de
  // nada, porque si no el rename de ida fallaría para siempre (el destino existe).
  if (!existsSync(raiz) && existsSync(tmp)) {
    try {
      renameSync(tmp, raiz)
    } catch {
      return 'atascada'
    }
  }
  try {
    renameSync(raiz, tmp)
  } catch {
    return 'ocupada'
  }
  for (let i = 0; i < REINTENTOS_VUELTA; i++) {
    try {
      renameSync(tmp, raiz)
      return 'libre'
    } catch {
      await esperar(ESPERA_VUELTA_MS)
    }
  }
  return 'atascada'
}

/** Registro propio del relevo, en su carpeta (nunca dentro de la que se reemplaza). */
export function crearLog(ruta: string): (m: string) => void {
  try {
    mkdirSync(path.dirname(ruta), { recursive: true })
  } catch {
    /* si no se puede crear, el log se pierde pero el relevo sigue */
  }
  return (m: string): void => {
    try {
      appendFileSync(ruta, `[${new Date().toISOString()}] ${m}\n`, 'utf8')
    } catch {
      /* nunca por un log */
    }
  }
}

/**
 * Corre el encargo entero. Devuelve el veredicto ya en prosa, listo para la ventana.
 * NUNCA lanza: un supervisor que revienta deja al usuario con la misma pantalla en
 * blanco que veníamos a eliminar.
 */
export async function ejecutarRelevo(
  encargo: EncargoRelevo,
  avisar: Progreso,
  log: (m: string) => void
): Promise<VeredictoInstalador> {
  try {
    // --- 1. El padre ---------------------------------------------------------
    avisar('Cerrando Tessera…', 'Esperando a que la aplicación termine de cerrarse.')
    log(`esperando al pid ${encargo.pidPadre}`)
    const finEspera = Date.now() + ESPERA_PADRE_MS
    while (procesoVivo(encargo.pidPadre) && Date.now() < finEspera) {
      await esperar(SONDEO_MS)
    }
    const seguiaVivo = procesoVivo(encargo.pidPadre)
    log(`padre ${seguiaVivo ? 'SIGUE VIVO tras la espera' : 'terminado'}`)

    // --- 2. La carpeta -------------------------------------------------------
    avisar('Preparando la carpeta…', 'Comprobando que la aplicación esté liberada.')
    const finCarpeta = Date.now() + ESPERA_CARPETA_MS
    let estado: EstadoCarpeta = 'ocupada'
    while (Date.now() < finCarpeta) {
      estado = await probarRenombrado(encargo.raizInstalacion)
      if (estado !== 'ocupada') break
      await esperar(SONDEO_MS)
    }
    log(`prueba de renombrado: ${estado}`)
    if (estado === 'atascada') {
      // ÚNICO caso en que se aborta. La carpeta de la aplicación quedó bajo otro
      // nombre y lanzar el instalador encima sería empeorarlo: instalaría la versión
      // nueva junto a una carpeta huérfana con la vieja dentro. Se para y se dice
      // exactamente dónde está, que es lo que hace falta para recuperarla a mano.
      const tmp = `${encargo.raizInstalacion}${SUFIJO_TMP}`
      log(`ABORTADO: la carpeta quedó como ${tmp} y no se pudo devolver a su nombre`)
      return {
        ok: false,
        titulo: 'La actualización se detuvo por seguridad',
        detalle:
          'No se pudo dejar la carpeta de la aplicación en su sitio, así que no se ' +
          'instaló nada para no empeorarlo.\n\n' +
          `La versión anterior sigue completa en:\n${tmp}\n\n` +
          `Renómbrala a:\n${encargo.raizInstalacion}\n\n` +
          'y Tessera volverá a funcionar como antes.'
      }
    }
    if (estado === 'ocupada') {
      // Se sigue igual: el instalador puede apañárselas, y si no, su código de
      // salida lo dirá con precisión. Abortar aquí sería cambiar un fallo que se
      // explica por uno que nos inventamos.
      log('AVISO: la carpeta no llegó a estar libre; se intenta instalar igual')
    }

    // --- 3. El instalador ----------------------------------------------------
    if (!existsSync(encargo.instalador)) {
      log(`el instalador NO existe en ${encargo.instalador}`)
      return leerSalidaInstalador(null)
    }
    avisar('Instalando la actualización…', 'Esto tarda unos segundos.')
    log(`lanzando ${encargo.instalador} ${ARGS_INSTALADOR.join(' ')}`)
    const code = await new Promise<number | null>((resolve) => {
      const hijo = spawn(encargo.instalador, [...ARGS_INSTALADOR], {
        windowsHide: true,
        // Nunca dentro de la carpeta que el instalador tiene que renombrar.
        cwd: path.dirname(encargo.instalador)
      })
      hijo.on('error', (err) => {
        log(`spawn falló: ${String(err)}`)
        resolve(null)
      })
      hijo.on('close', (c) => resolve(c))
    })
    log(`instalador terminó con código ${code}`)
    return leerSalidaInstalador(code)
  } catch (err) {
    log(`el relevo lanzó: ${String(err)}`)
    return {
      ok: false,
      titulo: 'La actualización no se pudo completar',
      detalle: `${String(err)}\n\nTessera sigue instalada en la versión anterior.`
    }
  }
}
