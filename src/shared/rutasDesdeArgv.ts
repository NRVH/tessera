// =============================================================================
// Qué rutas trae la línea de órdenes («Abrir con Tessera»). Puro: argv -> rutas.
// Lista blanca de FORMA (`X:\…`, `X:/…`, `\\servidor\recurso` en Windows; `/…` en macOS)
// y no «no empieza por --»: el motor mete banderas que no controlamos y una lista negra envejece.
// `argv[0]` se descarta siempre: es el ejecutable y tiene forma de ruta absoluta.
// En macOS el camino principal es el evento `open-file`, no el argv; los dos acaban en la
// cola de `main/shell/aperturasPendientes.ts`. No toca el disco (`resolverApertura.ts`).
// Decisiones: docs/decisiones/sistema/cola-de-aperturas.md
// =============================================================================

import { esWindows } from './plataforma.ts'

/**
 * Bandera que el instalador NSIS pasa tras una actualización. Vive aquí (y no solo en
 * `app/instanciaUnica.ts`, que la lee para decidir los reintentos del cerrojo) porque
 * este módulo tiene que reconocerla para NO tomarla por una ruta. Duplicar la cadena en
 * los dos sitios sería la forma más barata de que un renombrado futuro rompiera uno de
 * los dos en silencio.
 */
export const FLAG_ACTUALIZADO = '--updated'

/**
 * Sustituciones del registro de Windows. Si una clave está mal escrita —`%1` donde
 * tocaba `%V`, o un `Icon` con la sintaxis del `command`—, el Explorador puede entregar
 * el marcador SIN expandir. Reconocerlos evita el peor desenlace: intentar abrir un
 * proyecto llamado `%1`, crear la pestaña y no entender nunca por qué.
 */
const MARCADORES_SIN_EXPANDIR = new Set(['%1', '%v', '%l', '%d', '%w', '%*'])

/** Ruta absoluta con letra de unidad: `D:\algo`, `d:/algo`, `C:\`. */
const UNIDAD = /^[A-Za-z]:[\\/]/

/** Ruta UNC: `\\servidor\recurso`. Dos barras y algo detrás que no sea otra barra. */
const UNC = /^\\\\[^\\/]/

/**
 * Ruta absoluta POSIX (macOS): empieza por `/` y lleva algo detrás. `/` a secas se deja
 * fuera aposta —abrir la raíz del disco como "proyecto" no es nunca lo que se pidió, y
 * es justo lo que llegaría si un envoltorio pasara un argumento vacío mal citado.
 */
const POSIX_ABS = /^\/[^/]/

/**
 * Caracteres que Windows no admite en una ruta y que, si llegan, significan que esto no
 * era una ruta. El rango de control incluye el BYTE NUL, que en este repo ya tiene
 * historia: una expresión que no lo filtraba dejó pasar un nombre inválido hasta el
 * `paneKey` y costó encontrarlo.
 */
// eslint-disable-next-line no-control-regex
const CARACTERES_IMPOSIBLES = /[\u0000-\u001f<>"|?*]/

/**
 * Lo ÚNICO imposible en un nombre POSIX, aparte del propio separador: el rango de
 * control con el BYTE NUL. Se escribe con escapes `\u` y no con los caracteres
 * literales a propósito — un carácter de control crudo en el fuente es invisible en un
 * diff y en cualquier revisión.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_POSIX = /[\u0000-\u001f]/

/**
 * Familia de rutas del argv. NO se deduce de la FORMA de cada argumento, al revés que
 * en `rutasHost.ts`, y la diferencia es deliberada:
 *
 *   En Windows, `/S` y `/D=…` son BANDERAS del instalador NSIS. Con la detección por
 *   forma, un `/S` en el argv se convertiría en "la ruta /S", y Tessera intentaría abrir
 *   un proyecto inexistente después de cada update silencioso. En macOS ese mismo `/S`
 *   es una ruta absoluta perfectamente válida. La MISMA cadena significa cosas distintas
 *   según el SO, así que aquí el SO es el dato y no hay forma de esquivarlo.
 *
 * `rutasHost.ts` sí puede permitirse la detección por forma porque allí las cadenas
 * vienen de rutas ya validadas; aquí vienen de una línea de órdenes que compone
 * cualquiera.
 */
export type FamiliaArgv = 'win' | 'posix'

/**
 * La familia del SO donde corre el proceso. Aquí el SO SÍ es el dato (ver
 * `FamiliaArgv`): lo único que cambia es la forma de preguntarlo, `esWindows()` de
 * `plataforma.ts` y no `process.platform` a pelo, que es la regla 1 de ese módulo
 * (la comparación cruda no se puede sustituir en un test). `plataforma.ts` es puro y
 * corre bajo `node` a secas igual que este archivo.
 */
export function familiaArgvDelSistema(): FamiliaArgv {
  return esWindows() ? 'win' : 'posix'
}

/**
 * ¿Tiene esta cadena la forma de una ruta absoluta de Windows?
 *
 * Ojo con el `*` de `CARACTERES_IMPOSIBLES`: es válido en una clave del registro
 * (`*\shell\Tessera`) pero nunca en una ruta que el Explorador entregue, y dejarlo pasar
 * abriría la puerta a que un comodín acabara en un `fs.stat`.
 */
export function esRutaWindowsAbsoluta(valor: string): boolean {
  if (valor.length === 0) return false
  if (MARCADORES_SIN_EXPANDIR.has(valor.toLowerCase())) return false
  if (CARACTERES_IMPOSIBLES.test(valor)) return false
  return UNIDAD.test(valor) || UNC.test(valor)
}

/**
 * ¿Tiene esta cadena la forma de una ruta absoluta de macOS?
 *
 * El filtro de caracteres imposibles es MUCHO más corto que el de Windows, y eso es
 * correcto y no un olvido: en POSIX el único carácter prohibido en un nombre es `/` (que
 * aquí es el separador) y el NUL. `<`, `>`, `"`, `|`, `?` y `*` son nombres de archivo
 * legales en macOS —los crea cualquier `touch`—, así que rechazarlos como hace la rama
 * de Windows tiraría rutas REALES y "Abrir con Tessera" fallaría sin explicación sobre
 * una carpeta perfectamente normal.
 */
export function esRutaPosixAbsoluta(valor: string): boolean {
  if (valor.length === 0) return false
  if (CONTROL_POSIX.test(valor)) return false
  return POSIX_ABS.test(valor)
}

/**
 * ¿Es este argumento una ruta absoluta para la familia dada? Es el único punto donde se
 * decide, para que las dos plataformas compartan el resto del recorrido.
 */
export function esRutaAbsolutaDe(valor: string, familia: FamiliaArgv): boolean {
  return familia === 'win' ? esRutaWindowsAbsoluta(valor) : esRutaPosixAbsoluta(valor)
}

/**
 * Todas las rutas absolutas que vienen en el argv, en orden y sin repetir.
 *
 * Devuelve una LISTA y no la primera a propósito: aunque el verbo del menú contextual
 * se registra con `MultiSelectModel=Single` —justamente para que el Explorador no lance
 * un proceso por archivo seleccionado—, el argv de una segunda instancia lo compone
 * quien nos llame, y tragarse en silencio todo menos el primer elemento es la clase de
 * decisión que luego nadie encuentra.
 *
 * `familia` es explícita (con el SO actual por defecto) para que el test pueda fijar el
 * comportamiento de LAS DOS plataformas corriendo en UNA: sin el parámetro, la mitad de
 * los casos sólo se comprobaría en la máquina del SO que tocara.
 *
 * LA DEDUPLICACIÓN BAJA LA CAJA EN LAS DOS FAMILIAS. En POSIX eso puede unificar dos
 * rutas que en un volumen case-sensitive serían distintas; se acepta por el mismo
 * motivo que en `rutasHost.ts` (APFS es case-insensitive de fábrica) y porque el precio
 * aquí es abrir una pestaña de menos, nunca abrir la equivocada.
 */
export function rutasDesdeArgv(
  argv: readonly string[],
  familia: FamiliaArgv = familiaArgvDelSistema()
): string[] {
  const fuera: string[] = []
  const vistas = new Set<string>()
  // Desde 1: `argv[0]` es el propio ejecutable.
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (typeof a !== 'string') continue
    if (!esRutaAbsolutaDe(a, familia)) continue
    const clave = a.toLowerCase()
    if (vistas.has(clave)) continue
    vistas.add(clave)
    fuera.push(a)
  }
  return fuera
}

/** ¿Nos arrancaron justo después de una actualización? Misma bandera, mismo sitio. */
export function esArranqueTrasActualizarArgv(argv: readonly string[]): boolean {
  return argv.includes(FLAG_ACTUALIZADO)
}
