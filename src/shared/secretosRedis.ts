// =============================================================================
// Tapar contraseñas (`***`) en un comando de la consola de Redis antes de guardarlo en el historial:
// `AUTH`, `HELLO … AUTH`, `MIGRATE … AUTH/AUTH2`, el valor de `CONFIG SET` de las contraseñas y de las frases de TLS, y las
// contraseñas de `ACL SETUSER` (`>clave`, `<clave`, `#hash`). Los argumentos se parten como los parte la
// consola (comillas simples o dobles). Puro, neutral y ES2020 (lo compila también el renderer).
// =============================================================================

import { SECRETO_TAPADO } from './sql/secretosSql.ts'

/** Un argumento: entre comillas dobles, entre simples, o sin comillas. */
const ARGUMENTO = /"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|[^\s"']+/g

interface Arg {
  texto: string
  inicio: number
}

/** Los parámetros de `CONFIG SET` cuyo valor es una contraseña. */
const PARAMETROS_SECRETOS = new Set(['requirepass', 'masterauth', 'tls-key-file-pass', 'tls-client-key-file-pass'])

/** Sin las comillas de alrededor, en minúscula (para comparar nombres). */
function sinComillas(a: string): string {
  const c = a[0]
  return (c === '"' || c === "'" ? a.slice(1, a.endsWith(c) && a.length > 1 ? -1 : undefined) : a).toLowerCase()
}

/** `HELLO` y `MIGRATE`: tras la palabra `AUTH` o `AUTH2` van el usuario y/o la clave. */
function secretosConAuth(args: readonly Arg[], cmd: string): number[] {
  const out: number[] = []
  for (let i = 1; i < args.length; i++) {
    const k = sinComillas(args[i].texto)
    // `AUTH clave` o `AUTH usuario clave` (HELLO) y `AUTH2 usuario clave` (MIGRATE): se tapa lo que sigue.
    const n = k === 'auth2' || (cmd === 'hello' && k === 'auth') ? 2 : k === 'auth' ? 1 : 0
    for (let j = 1; j <= n; j++) if (i + j < args.length) out.push(i + j)
  }
  return out
}

/** Los índices de los argumentos que son una contraseña. */
function secretosDe(args: readonly Arg[]): number[] {
  const cmd = sinComillas(args[0].texto)
  const sub = args[1] ? sinComillas(args[1].texto) : ''
  const desde = (i: number): number[] => args.map((_a, k) => k).filter((k) => k >= i)
  if (cmd === 'auth') return desde(1)
  if (cmd === 'hello' || cmd === 'migrate') return secretosConAuth(args, cmd)
  if (cmd === 'config' && sub === 'set') {
    // Los argumentos van en pares parámetro/valor: el valor de los parámetros secretos.
    return desde(2).filter((i) => (i - 2) % 2 === 1 && PARAMETROS_SECRETOS.has(sinComillas(args[i - 1].texto)))
  }
  if (cmd === 'acl' && sub === 'setuser') return desde(3).filter((i) => /^["']?[>#<]/.test(args[i].texto))
  return []
}

/** El argumento tapado: conserva el signo de una contraseña de ACL (`>`, `<`, `#`), pero no las comillas. */
function tapado(a: string, esAcl: boolean): string {
  const m = esAcl ? /^["']?([>#<])/.exec(a) : null
  return m ? `${m[1]}${SECRETO_TAPADO}` : SECRETO_TAPADO
}

/** `texto` con las contraseñas cambiadas por `***`; el MISMO texto si no hay nada que tapar. */
export function taparSecretosRedis(texto: string): string {
  const args: Arg[] = []
  for (const m of texto.matchAll(ARGUMENTO)) args.push({ texto: m[0], inicio: m.index ?? 0 })
  if (args.length < 2) return texto
  const tapar = secretosDe(args)
  if (tapar.length === 0) return texto
  const esAcl = sinComillas(args[0].texto) === 'acl'
  let salida = texto
  // De atrás adelante: así los índices de los anteriores no se mueven.
  for (const i of [...new Set(tapar)].sort((a, b) => b - a)) {
    const a = args[i]
    salida = salida.slice(0, a.inicio) + tapado(a.texto, esAcl) + salida.slice(a.inicio + a.texto.length)
  }
  return salida
}
