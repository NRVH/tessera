// =============================================================================
// Aritmética de rutas del host: normalizar, comparar y decidir parentesco. Pura: sin `fs`,
// `path` ni Electron, para correr bajo `node` en los tests.
// La familia (Windows o POSIX) se decide por la forma de la raíz, nunca por la plataforma, y
// la comparación no distingue mayúsculas. `esDescendienteHost` compara contra el ancestro
// con separador final: `D:\proyecto2` empieza por `D:\proyecto`.
// Única excepción con plataforma: `normalizarRelativaProyecto`. No toca el disco.
// Decisiones: docs/decisiones/shared/rutas-del-host-por-forma.md
// =============================================================================

// Con extensión explícita, como ya hacen `comprimidos.ts` y `treeFlatten.ts` con
// `jarPath.ts`: los `test-*.mts` que importan este módulo corren con `node` a secas
// y ahí un especificador sin extensión no resuelve. El bundler acepta las dos formas.
import { plataformaActual, type Plataforma } from './plataforma.ts'

/** Raíz de unidad (`D:\`) o raíz UNC (`\\servidor\recurso`), que no llevan padre. */
const RAIZ_UNIDAD = /^[A-Za-z]:\\$/
/**
 * Raíz UNC, CON la barra final OPCIONAL. Lo de la barra no es un detalle: con
 * `\\servidor\recurso\` obligatorio, las dos formas de escribir el mismo recurso
 * quedaban como sitios DISTINTOS —`mismaRutaHost` decía que no, `nombreRutaHost`
 * devolvía `recurso` en un caso y `servidor\recurso` en el otro, y `relativaPosixHost`
 * daba `null`—. Consecuencia real: si un proyecto guardado es la raíz de un recurso y
 * el Explorador entrega la misma sin barra (o al revés), `contenedoraMasProfunda` no lo
 * reconoce y se acuña un SEGUNDO proyecto solapado sobre el primero. Es justo la clase
 * de fallo que este archivo viene a evitar (ver su ADR). Las raíces de
 * unidad no tenían el problema: `D:\` se escribe siempre igual.
 */
const RAIZ_UNC = /^\\\\[^\\]+\\[^\\]+\\?$/
/** Raíz POSIX: `/` y nada más. Es la única ruta POSIX que no tiene padre. */
const RAIZ_POSIX = /^\/$/

/** Empieza por letra de unidad (`D:`, `d:/algo`, `C:\`). */
const EMPIEZA_UNIDAD = /^[A-Za-z]:/
/**
 * Empieza por DOS separadores iguales, con cualquiera de las dos barras: `\\srv` o
 * `//srv`. Las dos formas son UNC (ver el ADR de la cabecera: `//` no es POSIX porque nada del
 * repo lo produce y Windows sí lo acepta). Es UNA expresión, y no dos `startsWith`
 * sueltos, para que `familia()` y `normalizarRutaHost()` no puedan volver a discrepar:
 * la regresión que motiva este comentario fue exactamente que una miraba `//` y la
 * otra no.
 */
const EMPIEZA_UNC = /^(?:\\\\|\/\/)/

/**
 * A qué familia de rutas pertenece la cadena. `'posix'` es el caso por defecto de todo
 * lo que no tenga forma de ruta Windows —incluidas las rutas relativas y la cadena
 * vacía—, porque el separador POSIX (`/`) es el que ya usaba el código para las rutas
 * relativas que cruzan al renderer.
 *
 * El orden importa: `//` se pregunta ANTES de dar por POSIX todo lo que empieza por
 * `/`. Una sola barra es POSIX; dos son UNC.
 */
function familia(ruta: string): 'win' | 'posix' {
  if (EMPIEZA_UNIDAD.test(ruta)) return 'win'
  if (EMPIEZA_UNC.test(ruta)) return 'win'
  return 'posix'
}

/** El separador nativo de la familia de la ruta. */
function sepDe(ruta: string): '\\' | '/' {
  return familia(ruta) === 'win' ? '\\' : '/'
}

/** ¿Es una raíz sin padre? (`D:\`, `\\srv\recurso`, `/`) */
function esRaiz(normalizada: string): boolean {
  return (
    RAIZ_UNIDAD.test(normalizada) ||
    RAIZ_UNC.test(normalizada) ||
    RAIZ_POSIX.test(normalizada)
  )
}

/**
 * Deja una ruta del host en forma canónica para poder compararla: separadores unificados
 * al nativo de su familia, separadores repetidos colapsados y sin separador final (salvo
 * en una raíz, donde el separador ES parte de la ruta).
 *
 * NO cambia las mayúsculas: la ruta que se devuelve al renderer y se enseña en la
 * pestaña tiene que ser la que el usuario reconoce. La insensibilidad vive en la
 * comparación, no en el dato.
 */
export function normalizarRutaHost(ruta: string): string {
  if (ruta.length === 0) return ''

  // --- Familia POSIX (macOS/Linux) -----------------------------------------
  // Sin unidades ni UNC: sólo colapsar `/` repetidas y quitar la barra final. La raíz
  // `/` se preserva porque ahí la barra ES la ruta, igual que en `D:\`. Una ruta que
  // empiece por `//` NO entra aquí: `familia()` la ha mandado a la rama Windows como UNC.
  if (familia(ruta) === 'posix') {
    let s = ruta.replace(/\/{2,}/g, '/')
    if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1)
    return s
  }

  // --- Familia Windows ------------------------------------------------------
  // `EMPIEZA_UNC` reconoce `\\srv` y `//srv` por igual: la misma expresión que usa
  // `familia()`, para que lo que entra como UNC salga como UNC.
  const unc = EMPIEZA_UNC.test(ruta)
  let s = ruta.replace(/\//g, '\\')
  // Colapsa separadores repetidos; en UNC se respetan los dos del principio.
  s = unc ? '\\\\' + s.slice(2).replace(/\\{2,}/g, '\\') : s.replace(/\\{2,}/g, '\\')
  // La barra final se quita SIEMPRE menos en la raíz de unidad, donde forma parte de
  // la ruta (`D:` sin barra es "el directorio actual de D:", que es otra cosa). La raíz
  // UNC sí la pierde, y a propósito: es la única forma de que `\\srv\recurso` y
  // `\\srv\recurso\` —las dos maneras de escribir el mismo sitio, y las dos llegan— se
  // comparen como iguales. Dejarla opcional en la expresión no bastaba: cada forma se
  // conservaba tal cual y seguían siendo cadenas distintas.
  if (s.length > 1 && s.endsWith('\\') && !RAIZ_UNIDAD.test(s)) {
    s = s.slice(0, -1)
  }
  return s
}

/** El ancestro con separador final, que es contra lo que hay que comparar prefijos. */
function conSeparador(ruta: string): string {
  const sep = sepDe(ruta)
  return ruta.endsWith(sep) ? ruta : ruta + sep
}

/**
 * ¿Son la misma ruta? Ni Windows ni un Mac de fábrica distinguen mayúsculas (APFS es
 * case-insensitive por defecto; ver el ADR de la cabecera).
 */
export function mismaRutaHost(a: string, b: string): boolean {
  return normalizarRutaHost(a).toLowerCase() === normalizarRutaHost(b).toLowerCase()
}

/**
 * ¿`ruta` cuelga ESTRICTAMENTE de `ancestro`? (Ser el mismo sitio no cuenta.)
 *
 * Dos rutas de FAMILIAS distintas nunca se contienen: `D:\algo` no cuelga de
 * `/Users/ana` ni al revés. Sale gratis del prefijo (`/Users/ana/` no es prefijo de
 * `D:\algo`), pero se comprueba explícitamente porque es una garantía que se lee mejor
 * afirmada que deducida.
 */
export function esDescendienteHost(ancestro: string, ruta: string): boolean {
  const a = normalizarRutaHost(ancestro)
  const r = normalizarRutaHost(ruta)
  if (a.length === 0 || r.length === 0) return false
  if (familia(a) !== familia(r)) return false
  return r.toLowerCase().startsWith(conSeparador(a).toLowerCase())
}

/** ¿`ruta` es `ancestro` o cuelga de él? */
export function contieneRutaHost(ancestro: string, ruta: string): boolean {
  return mismaRutaHost(ancestro, ruta) || esDescendienteHost(ancestro, ruta)
}

/**
 * La ruta de `ruta` relativa a `ancestro`, en POSIX — que es el único formato que el
 * renderer acepta (`CenterPane`, `files.listDir`, las decoraciones de git).
 *
 * Devuelve `''` si son el mismo sitio y `null` si `ruta` no está dentro. Ese `null` no
 * es cosmético: es lo que impide construir una ruta con `..` y colársela a
 * `FileService.resolveProyecto`, que la rechazaría igualmente pero mucho más tarde y
 * con un error que no dice nada.
 */
export function relativaPosixHost(ancestro: string, ruta: string): string | null {
  const a = normalizarRutaHost(ancestro)
  const r = normalizarRutaHost(ruta)
  if (mismaRutaHost(a, r)) return ''
  if (!esDescendienteHost(a, r)) return null
  const relativa = r.slice(conSeparador(a).length)
  // Sólo la familia Windows traduce `\` a `/`: ahí `\` ES el separador y el renderer
  // sólo acepta `/`. En POSIX el reemplazo NO es un no-op —la barra invertida es un
  // carácter LEGAL de nombre de archivo, ver el ADR— y hacerlo convertía
  // `a\b/c` en `a/b/c`, una ruta de dos carpetas que no existen. Se probó dejarlo
  // común a las dos familias "porque el contrato de salida es el mismo" y se retiró
  // por eso: el contrato es "separadores POSIX", no "sin barras invertidas".
  return familia(r) === 'win' ? relativa.replace(/\\/g, '/') : relativa
}

/**
 * La INVERSA de `relativaPosixHost`: deja en forma canónica el relativo al proyecto
 * que vuelve del renderer por IPC, antes de que el main lo una a la raíz real.
 *
 * Hace dos cosas y las hace por motivos distintos:
 *   - Quita las anclas iniciales (`/x`, `//x`) SIEMPRE. En el espacio del renderer
 *     una barra inicial no es "la raíz del sistema": es un intento —accidental o no—
 *     de anclar fuera del proyecto, y `path.resolve` la obedecería.
 *   - Traduce `\` a `/` SOLO en Windows. Ahí `\` ES el separador nativo y el
 *     renderer solo habla POSIX. En macOS/Linux la barra invertida es un carácter
 *     LEGAL de nombre de archivo (ver el ADR), así que el reemplazo NO es un
 *     no-op: destruye el nombre.
 *
 * EL BUG QUE ARREGLA, ENTERO. Con una carpeta de Mac llamada literalmente `a\b`,
 * `relativaPosixHost` devuelve bien `a\b/c` y eso es lo que se le manda al renderer
 * para abrir el archivo; pero al volver, el `replace(/\\/g, '/')` incondicional que
 * había repartido por el main (FileService, GitService, jarPath) lo convertía otra
 * vez en `a/b/c`, dos carpetas que no existen. Resultado observable: el proyecto SÍ
 * se montaba y sus archivos NO se podían abrir. Arreglar sólo la ida dejaba la mitad
 * del camino roto.
 *
 * POR QUÉ LA PLATAFORMA ES UN PARÁMETRO y no una lectura de `process.platform` aquí
 * dentro: en la lógica pura la plataforma es un parámetro, y sin eso la mitad de los
 * casos —los de la plataforma ajena— sólo se comprobarían en la máquina del SO que
 * tocara, que es lo mismo que no comprobarlos. El valor por defecto es el sistema
 * actual, que es lo correcto en producción: el relativo se va a resolver con `path`,
 * y `path` ya es el de este proceso.
 */
export function normalizarRelativaProyecto(
  relPosix: string,
  plataforma: Plataforma = plataformaActual()
): string {
  const s = plataforma === 'windows' ? relPosix.replace(/\\/g, '/') : relPosix
  return s.replace(/^\/+/, '')
}

/** El último tramo de la ruta; en una raíz, la propia unidad o el recurso UNC. */
export function nombreRutaHost(ruta: string): string {
  const s = normalizarRutaHost(ruta)
  if (s.length === 0) return ''
  if (RAIZ_UNIDAD.test(s)) return s.slice(0, 2)
  if (RAIZ_UNC.test(s)) return s.replace(/\\+$/, '').split('\\').filter(Boolean).join('\\')
  // La raíz POSIX no tiene "último tramo": se devuelve ella misma, que es lo que la
  // pestaña puede enseñar. Devolver '' dejaría una pestaña sin título.
  if (RAIZ_POSIX.test(s)) return s
  const sep = sepDe(s)
  const trozos = s.split(sep).filter((x) => x.length > 0)
  return trozos[trozos.length - 1] ?? s
}

/** La carpeta padre, o `null` si ya estamos en una raíz (no hay a dónde subir). */
export function padreRutaHost(ruta: string): string | null {
  const s = normalizarRutaHost(ruta)
  if (s.length === 0 || esRaiz(s)) return null
  const sep = sepDe(s)
  const corte = s.lastIndexOf(sep)
  if (corte < 0) return null
  const padre = s.slice(0, corte)
  if (sep === '/') {
    // `/algo` -> corte en 0 -> `''`, que no es una ruta: es la raíz `/`.
    return padre.length === 0 ? '/' : padre
  }
  // `D:\algo` -> corte en 2 -> `D:`, que no es una ruta: es la raíz `D:\`.
  if (/^[A-Za-z]:$/.test(padre)) return padre + '\\'
  // En UNC, subir por encima del recurso (`\\srv\share`) no lleva a ningún sitio real.
  if (/^\\\\[^\\]+$/.test(padre) || padre === '\\\\') return null
  return padre.length === 0 ? null : padre
}

/**
 * De todos los candidatos que CONTIENEN la ruta, el más profundo.
 *
 * El más profundo y no el primero: si tienes abiertos `D:\trabajo` y
 * `D:\trabajo\cliente`, un archivo de dentro de `cliente` pertenece a `cliente`. Elegir
 * el primero de la lista haría que el resultado dependiera del orden de las pestañas,
 * que es exactamente la clase de comportamiento que nadie consigue reproducir.
 */
export function contenedoraMasProfunda<T extends { projectHostPath: string }>(
  candidatos: readonly T[],
  ruta: string
): T | null {
  let mejor: T | null = null
  let mejorLargo = -1
  for (const c of candidatos) {
    if (!contieneRutaHost(c.projectHostPath, ruta)) continue
    const largo = normalizarRutaHost(c.projectHostPath).length
    if (largo > mejorLargo) {
      mejor = c
      mejorLargo = largo
    }
  }
  return mejor
}
