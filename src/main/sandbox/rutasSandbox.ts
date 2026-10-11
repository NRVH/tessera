// =============================================================================
// Rutas del sandbox: dónde viven las raíces gestionadas en cada sistema (en la VM en
// Windows; bajo `userData` en macOS, porque Docker Desktop rechaza montar una ruta que solo
// existe en la VM) y cómo se nombra una ruta del host dentro del namespace del daemon.
// Puro; la plataforma es el último parámetro, con la actual por defecto.
// Decisiones: docs/decisiones/sandbox/raices-por-plataforma.md
// =============================================================================

import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

/**
 * Normaliza una ruta del host YA RESUELTA (`path.resolve` es del llamador) para
 * compararla y deduplicarla: en Windows con `/` en vez de `\`; en el resto, tal cual.
 *
 * El cambio de barras es SÓLO de Windows, no un no-op que "da igual dejar común": en
 * POSIX la barra invertida es un carácter LEGAL de nombre (ver el ADR). En
 * Windows queda byte a byte como estaba.
 *
 * @param rutaYaResuelta  Ruta absoluta del host, ya pasada por `path.resolve`.
 * @param plataforma      Dónde corre. Por defecto la actual; el test pasa las dos.
 */
export function normalizarRutaResuelta(rutaYaResuelta: string, plataforma: Plataforma = plataformaActual()): string {
  return plataforma === 'windows' ? rutaYaResuelta.replace(/\\/g, '/') : rutaYaResuelta
}

/** Las dos raíces gestionadas, ya en el namespace del daemon. */
export interface RaicesSandbox {
  /** Raíz de los proyectos montados. Cada perfil cuelga la suya de aquí. */
  proyectos: string
  /**
   * Raíz de las credenciales de agente. ÁRBOL SEPARADO del de proyectos a propósito:
   * las guardas de limpieza por-prefijo de un árbol no deben confundir montajes del
   * otro. Se conserva esa separación en las dos plataformas, y por eso los nombres de
   * macOS son HERMANOS y ninguno es prefijo del otro.
   */
  agentcfg: string
}

/**
 * Ocho cifras hexadecimales estables de una cadena (FNV-1a de 32 bits); no es criptográfica.
 * Con `userData` como entrada es el sello de una instancia de Tessera: dos usuarios del mismo
 * equipo, o la app y su arnés de pruebas, tienen carpetas de datos distintas.
 */
export function huellaInstancia(texto: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Raíces de Windows que usaban todas las instancias a la vez. Solo las limpia el barrido de
 * arranque de la app (no el del arnés de pruebas), para los montajes que dejó una versión anterior.
 */
export const RAICES_WINDOWS_HEREDADAS: RaicesSandbox = {
  proyectos: '/mnt/wsl/tessera-mm',
  agentcfg: '/mnt/wsl/tessera-agentcfg'
}

/**
 * Las raíces gestionadas para una plataforma.
 *
 * @param baseHost    Carpeta de datos de la instancia (en producción, `userData`). En macOS
 *                    las raíces cuelgan de ella; en Windows y Linux solo da su huella, para
 *                    que cada instancia tenga las suyas y ninguna barra los montajes de otra.
 * @param plataforma  Dónde corre. Por defecto la actual; el test pasa las dos.
 */
export function raicesSandbox(
  baseHost: string,
  plataforma: Plataforma = plataformaActual(),
  dirEjecucion?: string
): RaicesSandbox {
  // WINDOWS: dentro de la VM, donde el host no las ve.
  if (plataforma === 'windows') {
    const base = `/mnt/wsl/tessera-${huellaInstancia(baseHost)}`
    return { proyectos: `${base}/sandbox-mm`, agentcfg: `${base}/sandbox-agentcfg` }
  }
  // LINUX: con Docker nativo, el auxiliar privilegiado monta en el espacio de nombres del
  // PROPIO equipo, así que estas raíces son rutas vivas del usuario con sus proyectos dentro.
  // Bajo `userData` un `rm -rf ~/.config/Tessera`, una copia de seguridad o un indexador
  // entrarían en las carpetas reales. Van al directorio de ejecución del usuario (un tmpfs
  // que se vacía al reiniciar y que nadie recorre), con una carpeta por `userData` para que
  // dos instancias no se barran los montajes entre sí.
  if (plataforma === 'linux' && dirEjecucion !== undefined && dirEjecucion.startsWith('/')) {
    const base = `${dirEjecucion.replace(/\/+$/, '')}/tessera-${huellaInstancia(baseHost)}`
    return { proyectos: `${base}/sandbox-mm`, agentcfg: `${base}/sandbox-agentcfg` }
  }
  // Hermanos y sin prefijo común entre ellos (ver el comentario de `agentcfg`).
  // Cuelgan de `userData` porque es la carpeta que ya sobrevive a las actualizaciones
  // y está bajo `/Users`, o sea compartida con Docker Desktop de fábrica.
  return {
    proyectos: `${baseHost}/sandbox-mm`,
    agentcfg: `${baseHost}/sandbox-agentcfg`
  }
}

/**
 * Ruta del host -> ruta visible por el daemon de Docker.
 *
 * WINDOWS: `D:\algo` -> `/mnt/host/d/algo`. Docker Desktop expone los discos de
 * Windows bajo `/mnt/host/<unidad>/...` dentro del namespace del daemon (9p/drvfs).
 *
 * macOS: la IDENTIDAD. Docker Desktop comparte `/Users` (y `/Volumes`, `/private`,
 * `/tmp`) dentro de la VM CON LA MISMA RUTA — comprobado con `nsenter`: `/Users`
 * existe ahí. Es también lo que explica que `-v /Users/x:/y` funcione sin traducir
 * nada. La función existe igualmente en Mac, en vez de saltarse la llamada, para que
 * el llamador no tenga que saber en qué plataforma está.
 *
 * Lanza si la ruta no tiene la forma esperada. Ese `throw` es deliberado: una ruta que
 * no se sabe traducir NO debe montarse "por si acaso" — montaría otra cosa.
 *
 * @param rutaHostAbsoluta  Ruta absoluta del host, ya resuelta.
 * @param plataforma        Dónde corre. Por defecto la actual; el test pasa las dos.
 */
export function aRutaDelDaemon(rutaHostAbsoluta: string, plataforma: Plataforma = plataformaActual()): string {
  if (plataforma !== 'windows') {
    if (!rutaHostAbsoluta.startsWith('/')) {
      throw new Error(`Ruta no reconocida como ruta POSIX absoluta: ${rutaHostAbsoluta}`)
    }
    return rutaHostAbsoluta
  }
  const m = rutaHostAbsoluta.match(/^([A-Za-z]):[\\/](.*)$/)
  if (!m) {
    throw new Error(`Ruta no reconocida como ruta Windows absoluta: ${rutaHostAbsoluta}`)
  }
  return `/mnt/host/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`
}
