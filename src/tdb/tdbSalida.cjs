// =============================================================================
// Salida de `tdb`: `fallar`, la tabla de texto y el ajuste de líneas. El modo `--json` NO es
// estado de módulo: viaja en `ctx.json` (lo fija `contexto()` desde los argumentos) y `fallar`
// lo recibe con el `ctx`.
// No depende de ningún otro módulo local; lo usan el resto de `tdb*.cjs`.
// =============================================================================
'use strict'

/** Ancho máximo de una celda al pintar en texto (el valor completo sale con --json). */
const ANCHO_CELDA = 40

/**
 * Escribe el error (stdout en `--json`, stderr en texto) y termina con 1 sin esperar.
 * `salida` es lo que lleva el modo: el `ctx` de `contexto()` o, antes de que exista, los
 * argumentos leídos (`{ json }`); los dos tienen `json`.
 */
function fallar(salida, mensaje, extra) {
  if (salida.json) {
    console.log(JSON.stringify({ ok: false, error: mensaje, ...(extra || {}) }))
  } else {
    console.error(`\n  ✗ ${mensaje}\n`)
  }
  process.exit(1)
}

function celda(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 19)
  if (Buffer.isBuffer(v)) return `<binario ${v.length} bytes>`
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Tabla de texto alineada. Pensada para que un LLM la lea sin ambigüedad. */
function pintarTabla(columnas, filas) {
  if (filas.length === 0) {
    console.log('  (sin filas)')
    return
  }
  const datos = filas.map((f) =>
    columnas.map((c) => {
      const t = celda(Array.isArray(f) ? f[columnas.indexOf(c)] : f[c])
      return t.length > ANCHO_CELDA ? t.slice(0, ANCHO_CELDA - 1) + '…' : t
    })
  )
  const anchos = columnas.map((c, i) =>
    Math.max(c.length, ...datos.map((d) => d[i].length))
  )
  const linea = (celdas) => '  ' + celdas.map((t, i) => t.padEnd(anchos[i])).join('  ').trimEnd()
  console.log(linea(columnas))
  console.log('  ' + anchos.map((a) => '─'.repeat(a)).join('  '))
  for (const d of datos) console.log(linea(d))
}

/**
 * Parte un texto en líneas de hasta `ancho` caracteres, con la sangría de continuación de
 * los mensajes de `tdb` (cuatro espacios: la primera línea la sangra quien lo pinta, con
 * su `✗` o sin él). Por palabras; una palabra más larga que el ancho va sola en su línea.
 */
function envolver(texto, ancho = 84) {
  const lineas = []
  let actual = ''
  for (const palabra of texto.split(' ')) {
    if (actual !== '' && actual.length + 1 + palabra.length > ancho) {
      lineas.push(actual)
      actual = palabra
    } else {
      actual = actual === '' ? palabra : `${actual} ${palabra}`
    }
  }
  if (actual !== '') lineas.push(actual)
  return lineas.join('\n    ')
}

module.exports = { fallar, pintarTabla, envolver }
