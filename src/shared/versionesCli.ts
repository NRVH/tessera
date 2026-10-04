// =============================================================================
// Versiones de los CLIs de agente. Puro: sin Node ni Electron. En `shared` para que lo que
// promete el botón del renderer y lo que ejecuta el main no puedan discrepar.
// Nunca `!==`: con el canal `stable` la instalada puede ir POR DELANTE de la «última», y se
// reinstalaría una más vieja; solo cuenta el «mayor que» de `compararVersiones`.
// `esVersionExacta` es una puerta: la «última» llega de la red y acaba en una orden de npm,
// así que sin versión exacta no se construye ninguna orden.
// Una sesión con versión desconocida (sonda fallida) no cuenta como atrasada.
// =============================================================================

/**
 * Semver ESTRICTO: `1.2.3` con prerelease opcional (`-alpha.16.4`). Sin `v` delante,
 * sin metadatos de build (`+…`), sin ceros a la izquierda en los tres números. El
 * tope de longitud corta de raíz cualquier entrada absurda antes de mirar nada más.
 */
const VERSION_EXACTA =
  /^(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

/** Primera versión que aparezca en un texto libre (salida de `--version`). */
const VERSION_EN_TEXTO = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)/

const TOPE_LONGITUD = 64

/** ¿Es `v` una versión exacta, apta para ir dentro de una orden de instalación? */
export function esVersionExacta(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.length <= TOPE_LONGITUD && VERSION_EXACTA.test(v)
}

/**
 * Saca la versión de la salida de `<cli> --version`, que cada CLI escribe a su
 * manera: `codex-cli 0.156.0`, `2.1.281 (Claude Code)`. Devuelve null si no hay
 * ninguna versión exacta dentro (un error de la shell, un banner, nada).
 */
export function extraerVersion(salida: string | null | undefined): string | null {
  if (!salida) return null
  const m = VERSION_EN_TEXTO.exec(salida)
  if (!m) return null
  const v = m[1]
  return esVersionExacta(v) ? v : null
}

/** Compara dos identificadores de prerelease según semver §11.4. */
function compararIdentificador(a: string, b: string): number {
  const na = /^\d+$/.test(a)
  const nb = /^\d+$/.test(b)
  if (na && nb) {
    const x = Number(a)
    const y = Number(b)
    return x === y ? 0 : x < y ? -1 : 1
  }
  // Los numéricos van SIEMPRE antes que los alfanuméricos.
  if (na) return -1
  if (nb) return 1
  return a === b ? 0 : a < b ? -1 : 1
}

/**
 * Precedencia semver: -1 si `a` < `b`, 0 si iguales, 1 si `a` > `b`. Una versión con
 * prerelease es MENOR que la misma sin él (`0.155.0-alpha.16` < `0.155.0`). Lanza si
 * alguna no es exacta: comparar basura es un error de quien llama, no un empate.
 */
export function compararVersiones(a: string, b: string): number {
  const ma = VERSION_EXACTA.exec(a)
  const mb = VERSION_EXACTA.exec(b)
  if (!ma || !mb || a.length > TOPE_LONGITUD || b.length > TOPE_LONGITUD) {
    throw new Error(`compararVersiones: versión no exacta (${JSON.stringify(a)} / ${JSON.stringify(b)})`)
  }
  for (let i = 1; i <= 3; i++) {
    const x = Number(ma[i])
    const y = Number(mb[i])
    if (x !== y) return x < y ? -1 : 1
  }
  const pa = ma[4]
  const pb = mb[4]
  if (pa === undefined && pb === undefined) return 0
  if (pa === undefined) return 1
  if (pb === undefined) return -1
  const ia = pa.split('.')
  const ib = pb.split('.')
  const n = Math.max(ia.length, ib.length)
  for (let i = 0; i < n; i++) {
    // Con todos los anteriores iguales, el que tiene MENOS identificadores va antes.
    if (ia[i] === undefined) return -1
    if (ib[i] === undefined) return 1
    const c = compararIdentificador(ia[i], ib[i])
    if (c !== 0) return c
  }
  return 0
}

/**
 * ¿Hay una versión NUEVA que instalar? Sólo si las dos se conocen, son exactas y la
 * última es ESTRICTAMENTE mayor (ver la cabecera: con el canal `stable` la instalada
 * puede ir por delante y eso no es una novedad).
 */
export function hayVersionNueva(instalada: string | null, ultima: string | null): boolean {
  if (!esVersionExacta(instalada) || !esVersionExacta(ultima)) return false
  return compararVersiones(ultima, instalada) > 0
}

/**
 * ¿Corre esta sesión un binario más viejo que el instalado? Sólo con las dos
 * versiones conocidas (ver la cabecera: una sonda fallida no enciende el aviso).
 */
export function sesionAtrasada(versionLanzada: string | null, instalada: string | null): boolean {
  if (!esVersionExacta(versionLanzada) || !esVersionExacta(instalada)) return false
  return compararVersiones(instalada, versionLanzada) > 0
}
