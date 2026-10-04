// =============================================================================
// Convierte una selección de archivos en las líneas de `.gitignore` o `.git/info/exclude`: una
// carpeta cuyos archivos conocidos están TODOS marcados se colapsa a `/carpeta/` (la más alta
// posible). Reglas: anclar con «/», escapar los metacaracteres y los espacios finales.
// Puro: sin electron, sin fs, sin git. Lo usa `ignorar.ts`.
// =============================================================================

/**
 * Líneas a añadir para ignorar `rutasAIgnorar`, colapsando a la carpeta cuando
 * está entera dentro del objetivo.
 *
 * @param rutasAIgnorar rutas de ARCHIVO relativas al repo (POSIX) que hay que ignorar.
 * @param todasLasRutas TODO lo que existe bajo esas carpetas, rastreado o no. Es
 *   lo que permite decidir si una carpeta está "entera": una carpeta con 8
 *   archivos de los que solo 6 están marcados NO se colapsa, porque la línea
 *   `/x/` también ignoraría los otros 2.
 *
 *   **`null` significa "no se sabe", y entonces NO se colapsa nada.** No es lo
 *   mismo que una lista vacía: con la lista vacía el universo es el propio
 *   objetivo, así que toda carpeta sale "entera" y se colapsa hasta la raíz. El
 *   universo tiene que venir de git (`ls-files --cached --others`), nunca de lo
 *   que la UI tenga a la vista: la lista de "Sin versionar" no contiene los
 *   archivos que git YA rastrea, así que un solo archivo nuevo dentro de `src/`
 *   haría que `src/` pareciera entera y se escribiría `/src/`.
 */
export function construirPatrones(
  rutasAIgnorar: readonly string[],
  todasLasRutas: readonly string[] | null
): string[] {
  const objetivo = new Set(rutasAIgnorar.map(normalizar).filter((r) => r !== ''))
  if (objetivo.size === 0) return []
  if (todasLasRutas === null) {
    return [...new Set([...objetivo].map((r) => `/${escaparPatron(r)}`))].sort((a, b) =>
      a.localeCompare(b)
    )
  }
  const universo = new Set([...todasLasRutas.map(normalizar).filter((r) => r !== ''), ...objetivo])

  // Cuántos archivos conoce cada carpeta y cuántos de ellos están marcados. Una
  // carpeta está "entera" cuando los dos números coinciden.
  const totales = new Map<string, number>()
  const marcados = new Map<string, number>()
  for (const ruta of universo) {
    const enObjetivo = objetivo.has(ruta)
    for (const carpeta of ancestros(ruta)) {
      totales.set(carpeta, (totales.get(carpeta) ?? 0) + 1)
      if (enObjetivo) marcados.set(carpeta, (marcados.get(carpeta) ?? 0) + 1)
    }
  }

  // De cada ruta se sube al ancestro MÁS ALTO que esté entero; si ninguno lo
  // está, la ruta va sola. Un `Set` deduplica: los 8 archivos de .idea/ dan la
  // misma línea 8 veces.
  const lineas = new Set<string>()
  for (const ruta of objetivo) {
    let elegida: string | null = null
    for (const carpeta of ancestros(ruta)) {
      if ((totales.get(carpeta) ?? 0) === (marcados.get(carpeta) ?? -1)) {
        elegida = carpeta
        break // ancestros() va de arriba abajo: el primero es el más alto.
      }
    }
    lineas.add(elegida === null ? `/${escaparPatron(ruta)}` : `/${escaparPatron(elegida)}/`)
  }
  return [...lineas].sort((a, b) => a.localeCompare(b))
}

/**
 * Escapa lo que gitignore trata como sintaxis dentro de un nombre real.
 *
 * `#` y `!` solo son especiales al PRINCIPIO de la línea, pero como el patrón va
 * anclado con "/" nunca quedan ahí; se escapan igual para que la función sea
 * segura por sí sola si alguien la usa sin ancla. `*`, `?` y `[` son comodines en
 * cualquier posición. El espacio final se escapa porque git lo recortaría.
 */
export function escaparPatron(ruta: string): string {
  let out = ''
  for (const ch of ruta) {
    if (ch === '\\' || ch === '*' || ch === '?' || ch === '[' || ch === ']' || ch === '#' || ch === '!') {
      out += `\\${ch}`
    } else {
      out += ch
    }
  }
  // Solo el ÚLTIMO espacio necesita el escape (git recorta la cola, no el medio).
  return out.endsWith(' ') ? `${out.slice(0, -1)}\\ ` : out
}

/**
 * ¿Qué líneas de `nuevas` faltan en el archivo? Los comentarios no cuentan.
 *
 * El recorte NO puede ser un `trim()` a secas: el espacio final ESCAPADO
 * (`/nota\ `) es PARTE del patrón, y recortarlo lo convertía en `/nota\`, que
 * nunca casa con lo que se escribió — la misma línea se volvía a anexar en cada
 * invocación y el archivo engordaba con un duplicado por vez. Se recorta como
 * hace git: la cola solo si el espacio no viene escapado. El principio sí se
 * recorta entero, que es indulgente de más para gitignore (ahí el espacio inicial
 * es literal), pero esto es detección de duplicados, no un parser: de este lado
 * pasarse de tolerante solo evita una línea repetida.
 */
export function patronesQueFaltan(contenido: string, nuevas: readonly string[]): string[] {
  const presentes = new Set(
    contenido
      .split('\n')
      .map((l) =>
        l
          .replace(/\r$/, '')
          .replace(/^\s+/, '')
          .replace(/(?<!\\)\s+$/, '')
      )
      .filter((l) => l !== '' && !l.startsWith('#'))
  )
  return nuevas.filter((p) => !presentes.has(p))
}

/**
 * Añade líneas AL FINAL de un archivo de ignore, conservando lo que ya tenía.
 *
 * Nunca se reordena ni se reescribe: un `.gitignore` lleva comentarios y
 * secciones que son del usuario. Se respeta el EOL dominante (CRLF en Windows) y
 * se garantiza el salto de línea previo si el archivo no terminaba en uno — sin
 * él, el primer patrón nuevo se pegaría al último existente y ninguno de los dos
 * funcionaría.
 */
export function anexarPatrones(contenido: string, nuevas: readonly string[]): string {
  if (nuevas.length === 0) return contenido
  const crlf = (contenido.match(/\r\n/g)?.length ?? 0) > 0
  const eol = crlf ? '\r\n' : '\n'
  const cuerpo = nuevas.join(eol) + eol
  if (contenido === '') return cuerpo
  return contenido.endsWith('\n') ? contenido + cuerpo : contenido + eol + cuerpo
}

/**
 * Ruta POSIX sin barras iniciales, duplicadas ni finales.
 *
 * NO TRADUCE `\` A `/`, y eso es el arreglo de un fallo, no una omisión. Aquí llegan
 * rutas relativas al repo con separadores POSIX (el invariante del IPC), así que una
 * barra invertida es un carácter del NOMBRE. Al convertirla, ignorar un archivo dentro
 * de una carpeta llamada `a\b` —legal en macOS— escribía el patrón `a/b/…`, que no
 * casa con nada: el archivo se quedaba versionado y nadie veía un error. Es la misma
 * regla que documenta la cabecera de `shared/jarPath.ts`.
 */
function normalizar(ruta: string): string {
  return ruta
    .split('/')
    .filter((t) => t !== '' && t !== '.')
    .join('/')
}

/** Carpetas que contienen a `ruta`, de la más ALTA a la más honda. */
function ancestros(ruta: string): string[] {
  const tramos = ruta.split('/')
  const out: string[] = []
  for (let i = 1; i < tramos.length; i++) out.push(tramos.slice(0, i).join('/'))
  return out
}
