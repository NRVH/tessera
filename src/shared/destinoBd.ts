// =============================================================================
// Limpieza de los campos de destino de una conexión (host y servicio o base). Puro.
// Quita lo que nunca puede ser parte de un host o un servicio (el esquema `http://` o
// `jdbc:oracle:thin:@`, los espacios y las barras sobrantes) y no adivina más: normalizar de más
// acaba conectando a un sitio distinto del escrito, y es peor que el error del driver.
// =============================================================================

/**
 * `http://`, `https://`, `oracle://`, `jdbc:postgresql://`, `jdbc:oracle:thin:@`…
 *
 * EL FINAL (`//` o `@`) ES LO QUE HACE QUE ESTO SEA SEGURO, y su ausencia fue un
 * defecto real que este comentario existe para no repetir. La primera versión era
 * `^(?:[a-z][a-z0-9+.-]*:)+\/*(?:@)?`, o sea "una o más palabras seguidas de dos
 * puntos", y eso NO distingue un esquema de un host con puerto: se comía la mitad
 * izquierda de `srv-bd:1521` y guardaba el host como `1521`. Justo la forma en la que
 * se copia y pega un destino — que es para lo que se escribió la función.
 *
 * Un esquema SIEMPRE termina en `//` (URL) o en `@` (cadena JDBC de Oracle); un
 * `host:puerto` no termina en ninguna de las dos. Exigirlo es lo que separa los dos
 * casos sin tener que mantener una lista de esquemas conocidos.
 */
const ESQUEMA = /^(?:[a-z][a-z0-9+.-]*:)+(?:\/\/|@)/i

/**
 * Deja un host o un nombre de servicio en lo que de verdad es.
 *
 * Devuelve la cadena vacía si no queda nada: quien llame decide si eso es un error
 * (un host vacío lo es) o simplemente "sin valor" (el servicio puede faltar cuando se
 * conecta por SID).
 */
export function limpiarDestinoBd(valor: string | undefined | null): string {
  if (typeof valor !== 'string') return ''
  let s = valor.trim()
  if (s.length === 0) return ''
  // El esquema puede venir repetido en una copia torpe (`http://http://`).
  for (let i = 0; i < 3 && ESQUEMA.test(s); i++) s = s.replace(ESQUEMA, '')
  // Barras de sobra por delante y por detrás: `/servicio/` -> `servicio`.
  s = s.replace(/^\/+/, '').replace(/\/+$/, '')
  return s.trim()
}

/**
 * ¿Este valor traía un esquema pegado? Sirve para AVISAR de que se limpió, en vez de
 * cambiárselo al usuario por la espalda: que vea que su `http://…` desapareció y por
 * qué es lo que hace que no lo vuelva a pegar la próxima vez.
 */
export function traiaEsquema(valor: string | undefined | null): boolean {
  return typeof valor === 'string' && ESQUEMA.test(valor.trim())
}
