// =============================================================================
// El PATH del propio proceso main en macOS. Una app lanzada desde el Finder la arranca `launchd`
// con el PATH mínimo del sistema, y `spawn('docker', …)` muere con ENOENT con Docker Desktop a la
// vista. `asegurarPathDelHost` pregunta al shell de login e interactivo (`-ilc`) su PATH, entre
// dos marcadores, y lo fusiona con el del proceso; si el shell falla, añade igual las carpetas
// fijas donde suele estar `docker`. El delimitador lo da `delimitadorPath` (terminales). La parte
// pura (`fusionarPath`, `extraerPathMarcado`, `extraerEntreMarcas`, compartida con
// `agents/ejecutorShell.ts`) se prueba con `node` a secas (`test-path-de-login.mts`).
// Decisiones: docs/decisiones/util/path-del-main-desde-el-shell-de-login.md
// =============================================================================

import { execFile, type ExecFileException } from 'node:child_process'
import os from 'node:os'
import { esWindows } from '../../shared/plataforma.ts'
import { delimitadorPath } from '../terminals/entornoPty.ts'

/** Marcador que precede al PATH en la salida del shell. */
export const MARCA_INICIO = '__TESSERA_PATH__'
/** Marcador que sigue al PATH en la salida del shell. */
export const MARCA_FIN = '__TESSERA_FIN__'

/**
 * Lo que se le pide al shell. NO INTERPOLA NINGUNA VARIABLE, y eso es deliberado: el
 * PATH lo imprime `printenv`, un programa externo que lee su propio entorno.
 *
 * POR QUÉ NO `printf "%s" "${PATH}"`, QUE ES LO QUE HABÍA. Esa forma sólo vale en la
 * familia Bourne. En FISH —que es un `$SHELL` soportado, ver `shellNativo.ts`— falla
 * dos veces: `${PATH}` es un error de sintaxis (fish no tiene la forma con llaves), y
 * aunque no lo fuera, allí `PATH` es una LISTA y entrecomillarla la une con ESPACIOS,
 * no con `:`. O sea que el usuario de fish no recibía ningún marcador y se quedaba con
 * los cuatro extras fijos: todo lo suyo de nvm/pyenv/sdkman/`~/.local/bin` invisible
 * para cada `spawn` del main, y en silencio, que es lo peor.
 *
 * `printenv PATH` lo resuelve para TODOS los shells de golpe sin ramificar por shell:
 * el PATH que un shell exporta a sus hijos ya viene con el delimitador del sistema, lo
 * traduzca como lo traduzca por dentro. Se descartó detectar fish y mandarle un
 * `string join : $PATH`: son dos comandos que mantener, y el segundo sólo lo probaría
 * quien tenga fish instalado (aquí no lo hay).
 *
 * SE INTENTA PRIMERO POR RUTA ABSOLUTA y sólo después por nombre. `printenv` se busca
 * en el PATH del shell, que es justo lo que aquí puede estar mal: si el usuario se ha
 * dejado `/usr/bin` fuera de su PATH, buscarlo por nombre no lo encuentra y el comando
 * devuelve dos marcadores con NADA en medio — o sea, la misma degradación silenciosa
 * que este arreglo viene a quitar. El `||` vale igual en la familia Bourne y en fish.
 *
 * `printenv` deja un salto de línea al final; lo recorta `extraerPathMarcado`.
 */
export const COMANDO_PATH_MARCADO =
  `printf '%s' '${MARCA_INICIO}'; ` +
  '/usr/bin/printenv PATH || printenv PATH; ' +
  `printf '%s' '${MARCA_FIN}'`

/** Shell que se usa si `$SHELL` no viene en el entorno (el de macOS desde Catalina). */
const SHELL_POR_DEFECTO = '/bin/zsh'

/**
 * Sitios donde `docker` (y poco más) puede estar y que un PATH de `launchd` no trae.
 * Se añaden SIEMPRE, también cuando el shell respondió: no cuestan nada si ya
 * estaban (se deduplican) y salvan el caso del `.zshrc` que se rompió a medias.
 */
export function extrasDelHost(home: string = os.homedir()): string[] {
  return [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    `${home}/.docker/bin`,
    '/Applications/Docker.app/Contents/Resources/bin'
  ]
}

/**
 * Fusiona el PATH del proceso con el del shell de login y con los extras, sin
 * duplicados y conservando el orden: primero los segmentos del PATH de login (es el
 * orden que el usuario eligió), luego los que el proceso ya tenía y no estaban,
 * luego los extras que falten. Los segmentos vacíos (un `::` o un `:` final, que
 * en POSIX significan "el cwd") se descartan: en un PATH que se le va a dar a
 * `spawn` son un agujero, no una comodidad.
 *
 * @param delimitador El de la plataforma actual por defecto (`delimitadorPath()`);
 *                    se puede fijar para probar la ajena desde ésta.
 */
export function fusionarPath(
  pathActual: string,
  pathLogin: string | null,
  extras: readonly string[],
  delimitador = delimitadorPath()
): string {
  const vistos = new Set<string>()
  const resultado: string[] = []
  const anotar = (segmento: string): void => {
    if (segmento === '' || vistos.has(segmento)) return
    vistos.add(segmento)
    resultado.push(segmento)
  }
  for (const s of (pathLogin ?? '').split(delimitador)) anotar(s)
  for (const s of pathActual.split(delimitador)) anotar(s)
  for (const s of extras) anotar(s)
  return resultado.join(delimitador)
}

/**
 * Saca el PATH de entre los dos marcadores. Todo lo que haya fuera (un banner del
 * `.zshrc`, un aviso de "no job control" de un shell interactivo sin TTY) se ignora.
 * Devuelve `null` si falta cualquiera de los dos marcadores o si el PATH está vacío:
 * un PATH vacío no es un PATH, es un shell que no lo puso.
 *
 * SE RECORTA EL BLANCO de los extremos porque `printenv` termina en salto de línea, y
 * ese salto viajaría dentro del primer o del último segmento del PATH. El precio es un
 * segmento que empezara o acabara en espacio, que nadie tiene y que `spawn` trataría
 * como otro directorio distinto de todas formas.
 */
export function extraerPathMarcado(stdout: string): string | null {
  const entre = extraerEntreMarcas(stdout, MARCA_INICIO, MARCA_FIN)
  if (entre === null) return null
  const path = entre.trim()
  return path === '' ? null : path
}

/**
 * Lo que un shell imprimió entre dos marcadores, tal cual (sin recortar). Es la pieza
 * genérica de `extraerPathMarcado` y tiene un segundo dueño: el ejecutor de órdenes de
 * los agentes nativos (`agents/ejecutorShell.ts`), que envuelve sus sondas `--version`
 * en marcadores por el mismo motivo —un `.zshrc` puede imprimir cualquier cosa antes y
 * después—. Una sola implementación para los dos, así que un arreglo aquí llega a los
 * dos sitios.
 *
 * Se toma el PRIMER `ini` y el primer `fin` que venga DESPUÉS de él: un `fin` anterior
 * al inicio no cuenta, y lo que haya detrás del primer `fin` se ignora aunque traiga
 * otra pareja. Devuelve `null` si falta cualquiera de los dos; una cadena vacía
 * (marcadores pegados) es una respuesta válida y decide el llamador qué significa.
 */
export function extraerEntreMarcas(stdout: string, ini: string, fin: string): string | null {
  const inicio = stdout.indexOf(ini)
  if (inicio < 0) return null
  const desde = inicio + ini.length
  const final = stdout.indexOf(fin, desde)
  if (final < 0) return null
  return stdout.slice(desde, final)
}

/** Resultado de preguntar al shell: el PATH, o por qué no se pudo. */
export interface LecturaPathLogin {
  /** El PATH del shell de login, o `null` si no se pudo leer. */
  path: string | null
  /** Sólo cuando `path` es `null`: la causa, redactada para el log. */
  motivo: string | null
}

/**
 * Pregunta al shell de login cuál es su PATH y cuenta por qué falló si falla. Nunca
 * lanza: un shell roto no puede impedir que la app arranque.
 *
 * Si la salida trae los marcadores se acepta AUNQUE el shell haya terminado con
 * error o lo haya matado el timeout: el PATH ya estaba impreso, y un `.zshrc` cuyo
 * último comando devuelve distinto de cero no invalida lo que imprimió.
 */
export function leerPathDeLoginConMotivo(
  shell: string = process.env.SHELL || SHELL_POR_DEFECTO,
  timeoutMs = 5000
): Promise<LecturaPathLogin> {
  return new Promise((resolve) => {
    const terminar = (stdout: string, stderr: string, error: ExecFileException | null): void => {
      const path = extraerPathMarcado(stdout)
      if (path !== null) {
        resolve({ path, motivo: null })
        return
      }
      // Para el log basta la primera línea del stderr (es donde el shell dice qué
      // pasó); el `message` de Node repite el comando entero y no aporta.
      const detalle = stderr.trim().split('\n')[0] || error?.message || ''
      let motivo: string
      if (error?.killed) motivo = `${shell} no respondió en ${timeoutMs} ms`
      else if (error?.code === 'ENOENT') motivo = `${shell} no existe`
      else if (error) motivo = `${shell} falló (código ${String(error.code ?? '?')}): ${detalle}`
      else motivo = `${shell} respondió sin los marcadores`
      resolve({ path: null, motivo })
    }
    try {
      const hijo = execFile(
        shell,
        ['-ilc', COMANDO_PATH_MARCADO],
        { timeout: timeoutMs, encoding: 'utf8', windowsHide: true },
        (error, stdout, stderr) => terminar(stdout, stderr, error)
      )
      // El callback de `execFile` espera a 'close' (TODOS los stdio cerrados): un
      // `.zshrc` que deja algo en segundo plano heredando stdout retrasa la
      // resolución hasta el timeout aunque el PATH ya esté impreso. En cuanto los
      // marcadores llegan, no hay nada más que esperar. (`resolve` es idempotente,
      // así que el `terminar` que dispare el `kill` después no hace daño.)
      let visto = ''
      hijo.stdout?.on('data', (trozo: Buffer | string) => {
        visto += String(trozo)
        const path = extraerPathMarcado(visto)
        if (path === null) return
        resolve({ path, motivo: null })
        hijo.kill()
      })
      // Un shell interactivo puede quedarse leyendo de stdin si el `.zshrc` lo pide
      // (un `read`, un asistente de primera ejecución). Cerrarlo lo desengaña.
      hijo.stdin?.end()
    } catch (e) {
      terminar('', '', e as ExecFileException)
    }
  })
}

/**
 * Deja en `process.env.PATH` el PATH que el usuario tiene en su terminal, más los
 * respaldos fijos. En Windows no hace nada: allí el proceso hereda el PATH del
 * sistema y el problema no existe. Nunca lanza y deja en consola qué añadió, o por
 * qué no pudo leer el del shell (los extras se añaden igualmente).
 *
 * Tiene que correr ANTES de construir nada que pueda lanzar `docker`: un `spawn`
 * resuelve el ejecutable con el PATH del momento, no con el del arranque.
 */
export async function asegurarPathDelHost(): Promise<void> {
  if (esWindows()) return
  try {
    const actual = process.env.PATH ?? ''
    const lectura = await leerPathDeLoginConMotivo()
    const nuevo = fusionarPath(actual, lectura.path, extrasDelHost())
    process.env.PATH = nuevo
    if (lectura.path === null) {
      console.log(
        `[tessera] PATH: no se pudo leer el del shell de login (${lectura.motivo}); ` +
          'se añaden sólo los respaldos fijos.'
      )
    }
    const delim = delimitadorPath()
    const antes = new Set(actual.split(delim))
    const anadidos = nuevo.split(delim).filter((s) => !antes.has(s))
    console.log(
      anadidos.length > 0
        ? `[tessera] PATH: añadidos ${anadidos.join(', ')}`
        : '[tessera] PATH: el del proceso ya contenía el del shell de login; sin cambios.'
    )
  } catch (e) {
    // No debería pasar (todo lo de arriba está protegido), pero si pasa la app tiene
    // que arrancar: sin este PATH el síntoma es "Docker no está disponible", no un
    // cuelgue en el arranque.
    console.error('[tessera] PATH: fallo inesperado al fusionar el PATH del host:', e)
  }
}
