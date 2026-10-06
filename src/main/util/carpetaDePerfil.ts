// =============================================================================
// La carpeta de un perfil dentro de una base de `userData` (`terminal/<id>`, `conexiones/<id>`): valida
// que el id sea un nombre de carpeta hija directa en las dos plataformas y la manda a la PAPELERA del
// sistema cuando el usuario borra el perfil (nunca en firme). La usan `ssh/controlador/espacioTerminal.ts`
// y `db/controlador/espacioDatos.ts`. Depende de `node:fs`, `node:path`, `shared/plataforma.ts` y de
// la papelera que le inyecten (`shell.trashItem` en la app).
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

/** Nombres de dispositivo de Windows: con o sin extensión abren el dispositivo, no una carpeta. */
const RESERVADO_WINDOWS = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i

/** Lo que no cabe en un nombre de carpeta de Windows; la barra no cabe en ninguno. */
const CARACTER_PROHIBIDO = /[<>:"/\\|?*]/

/**
 * ¿Es `id` un nombre de carpeta que no se puede reinterpretar? Los caracteres y los puntos o espacios
 * del final se exigen en las dos plataformas: Windows quita esos finales (`a.` sería `a`, y `...` la
 * propia base) y un `:` abre un flujo alternativo. Los nombres de dispositivo (`CON`, `aux`…) solo en
 * Windows: en macOS son carpetas normales, y el id de un perfil «Aux» es `aux`.
 */
function nombreDeCarpetaValido(id: unknown, plataforma: Plataforma): id is string {
  if (typeof id !== 'string' || id === '' || id === '.' || id === '..') return false
  if (CARACTER_PROHIBIDO.test(id) || [...id].some((c) => (c.codePointAt(0) ?? 0) < 0x20)) return false
  if (id.endsWith('.') || id.endsWith(' ')) return false
  if (plataforma === 'windows' && RESERVADO_WINDOWS.test(id)) return false
  return path.basename(id) === id
}

/**
 * `base/id` solo si `id` es un nombre de carpeta y no un camino: el id llega del renderer y un `..` o
 * una barra sacarían la escritura de `base`. Lanza sin la ruta dentro del mensaje.
 */
export function rutaHijaDirecta(base: string, id: string, plataforma: Plataforma = plataformaActual()): string {
  if (nombreDeCarpetaValido(id, plataforma)) {
    const raiz = path.resolve(base)
    const destino = path.resolve(raiz, id)
    if (path.dirname(destino) === raiz) return destino
  }
  throw new Error('Identificador de perfil no válido.')
}

/** `rutaHijaDirecta` de cada id, sin crearlas; un id inválido se omite. */
export function rutasHijas(base: string, ids: readonly string[], plataforma: Plataforma = plataformaActual()): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of ids) {
    try {
      out[id] = rutaHijaDirecta(base, id, plataforma)
    } catch {
      // Un id basura no tiene carpeta; los demás sí.
    }
  }
  return out
}

/**
 * La clave de un id de perfil: sin caja ni forma Unicode, como las carpetas de los discos por defecto
 * de Windows y macOS. Es el ÚNICO criterio de «el mismo perfil» del borrado: lo usan el candado, el
 * «¿ha vuelto a existir?» de cada paso y el «¿está en uso su carpeta?» de la papelera.
 */
export function claveDePerfil(id: string): string {
  return id.normalize('NFC').toLowerCase()
}

/** ¿Hay entre `idsVivos` uno que sea el mismo perfil que `id` (misma clave, y por tanto misma carpeta)? */
export function hayMismoPerfil(idsVivos: readonly string[], id: string): boolean {
  const clave = claveDePerfil(id)
  return idsVivos.some((vivo) => claveDePerfil(vivo) === clave)
}

/**
 * Manda una ruta a la papelera del sistema (`shell.trashItem` en la app) y rechaza si no puede. No
 * debe borrar en firme nunca: lo que se sabe de `trashItem` en cada sistema está en el ADR.
 */
export type APapelera = (ruta: string) => Promise<void>

/** Qué pasó al borrar: `en-uso` = un perfil que sigue vivo usa esa misma carpeta, y no se toca. */
export type ResultadoBorrado = 'en-la-papelera' | 'no-existia' | 'en-uso'

/** Reintentos tras el primer intento y su espera: cubren una sesión que aún se está cerrando. */
const REINTENTOS_PAPELERA = 3
const ESPERA_REINTENTO_MS = 300

/** ¿Hay algo en `dir`? Mira la entrada misma (`lstat`): un enlace cuenta aunque su destino no exista. */
async function existe(dir: string): Promise<boolean> {
  try {
    await lstat(dir)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

/**
 * Manda `base/id` a la papelera, con todo lo que tenga, cuando el usuario ha borrado ese perfil.
 * `idsVivos` da los perfiles que existen AHORA y se vuelve a leer justo antes de cada intento: entre
 * el primero y el último pasan más de 900 ms, y el usuario puede haber recreado el perfil. Si alguno
 * da la misma carpeta (él mismo, o el mismo id con otra caja) no se toca. Un id peligroso lanza ANTES
 * de tocar el disco. La papelera mueve la entrada tal cual: un enlace o una unión (dentro, o la
 * carpeta misma) viaja como enlace y su destino no se toca. Si la papelera falla (una sesión aún
 * cerrándose con la carpeta como directorio de trabajo, un archivo abierto, un disco sin papelera), se
 * reintenta poco y, si sigue, la carpeta SE QUEDA entera en su sitio y se lanza: nunca se cae a un
 * borrado en firme.
 */
export async function hijaDirectaALaPapelera(
  base: string,
  id: string,
  idsVivos: () => readonly string[],
  papelera: APapelera,
  plataforma: Plataforma = plataformaActual()
): Promise<ResultadoBorrado> {
  const dir = rutaHijaDirecta(base, id, plataforma)
  const enUso = (): boolean => hayMismoPerfil(idsVivos(), id)
  if (enUso()) return 'en-uso'
  if (!(await existe(dir))) return 'no-existia'
  let ultimoFallo: unknown
  for (let intento = 0; intento <= REINTENTOS_PAPELERA; intento++) {
    if (intento > 0) {
      await new Promise((resolver) => setTimeout(resolver, ESPERA_REINTENTO_MS))
      if (!(await existe(dir))) return 'no-existia'
    }
    // Con la lista de ESTE momento, sin nada que esperar entre la comprobación y la papelera.
    if (enUso()) return 'en-uso'
    try {
      await papelera(dir)
      return 'en-la-papelera'
    } catch (err) {
      ultimoFallo = err
    }
  }
  throw new Error('No se pudo mandar la carpeta a la papelera: se queda en su sitio.', { cause: ultimoFallo })
}
