// =============================================================================
// Tapar contraseñas (`***`) en una orden del shell de MongoDB antes de guardarla en el historial: el valor
// de `pwd` o `password` en un objeto (`createUser`, `updateUser`, `db.auth({…})`), el segundo argumento de
// `changeUserPassword` y de `db.auth(usuario, clave)`, y la clave de una URI (`mongodb://u:clave@…`).
// Conserva las comillas. Puro, neutral y ES2020 (lo compila también el renderer).
// =============================================================================

import { SECRETO_TAPADO, URI_CON_CLAVE } from './sql/secretosSql.ts'

/** Una cadena del shell entre comillas simples, dobles o invertidas, con sus escapes. */
const CADENA = String.raw`'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|` + '`(?:\\\\.|[^`\\\\])*`'

/**
 * `pwd: 'x'`, `"newPassword": "x"`: una clave (con o sin comillas) que CONTIENE pwd, passwd o password,
 * y su valor. Tapar de más un `passwordHash` es mejor que guardar en claro un `userPassword`.
 */
const CLAVE_CON_SECRETO = new RegExp(String.raw`((?:\b|["'])[\w$]*(?:pwd|passwd|password)[\w$]*["']?\s*:\s*)(` + CADENA + ')', 'gi')

/** `changeUserPassword('u', 'x')` y `auth('u', 'x')`: el segundo argumento. */
const SEGUNDO_ARGUMENTO = new RegExp(String.raw`(\b(?:changeUserPassword|auth)\s*\(\s*(?:` + CADENA + String.raw`)\s*,\s*)(` + CADENA + ')', 'g')

/** El valor tapado con las mismas comillas. */
function tapadoConComillas(valor: string): string {
  const c = valor[0]
  return `${c}${SECRETO_TAPADO}${c}`
}

/** `texto` con las contraseñas cambiadas por `***`; el MISMO texto si no hay nada que tapar. */
export function taparSecretosMongo(texto: string): string {
  const salida = texto
    .replace(CLAVE_CON_SECRETO, (_t, antes: string, valor: string) => antes + tapadoConComillas(valor))
    .replace(SEGUNDO_ARGUMENTO, (_t, antes: string, valor: string) => antes + tapadoConComillas(valor))
    .replace(URI_CON_CLAVE, (_m: string, antes: string) => `${antes}${SECRETO_TAPADO}@`)
  return salida === texto ? texto : salida
}
