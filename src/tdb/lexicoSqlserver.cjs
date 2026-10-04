// =============================================================================
// El léxico de T-SQL que necesita la guardia de solo lectura de `tdb` y el partido por GO:
// tokens sin blancos ni comentarios (con comentarios anidados, cadenas, nombres entre corchetes
// y comillas, @variables, #temporales y dinero) y las líneas de GO. Pieza de `sqlserver.cjs`.
// Los números se cortan donde los corta el servidor (`finNumero`).
// Decisiones: docs/decisiones/bd/adaptador-sqlserver-solo-lectura.md
// =============================================================================

'use strict'

function esSaltoDeLinea(c) {
  return c === 10 || c === 13
}
function esBlanco(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12
}
/** Inicio de un nombre de T-SQL: letra, `_`, `@` (variable), `#` (temporal) o no ASCII. */
function esInicioNombre(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 64 || c === 35 || c >= 128
}
/** Parte de un nombre (`@a$b#c` es un nombre). */
function esParteNombre(c) {
  return esInicioNombre(c) || (c >= 48 && c <= 57) || c === 36
}
function esDigito(c) {
  return c >= 48 && c <= 57
}
function esHex(c) {
  return esDigito(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
}

/** Avanza `j` mientras `ok(código)`. */
function mientras(s, j, n, ok) {
  let k = j
  while (k < n && ok(s.charCodeAt(k))) k++
  return k
}

/** `0x` y solo dígitos hexadecimales, CERO o más (`0x` suelto es el binario vacío). */
function finHexadecimal(s, i, n) {
  return mientras(s, i + 2, n, esHex)
}

/** Decimal o dinero: dígitos, `.` y dígitos; el decimal admite un exponente `e`/`E` con su signo aunque NO lleve dígitos. */
function finDecimal(s, i, n, dinero) {
  let j = dinero ? i + 1 : i
  j = mientras(s, j, n, esDigito)
  if (j < n && s.charCodeAt(j) === 46) j = mientras(s, j + 1, n, esDigito)
  if (!dinero && j < n && (s.charCodeAt(j) === 101 || s.charCodeAt(j) === 69)) {
    j++
    if (j < n && (s.charCodeAt(j) === 43 || s.charCodeAt(j) === 45)) j++
    j = mientras(s, j, n, esDigito)
  }
  return j
}

/**
 * Dónde acaba el literal numérico que empieza en `i`, cortado EXACTAMENTE donde lo corta el
 * servidor: lo que venga pegado detrás es OTRO token. Si se tragaran letras y dígitos hasta el
 * primer blanco, `SELECT 1DELETE FROM t` sería SELECT, un número y FROM para la guardia,
 * mientras que el servidor lee `1` y `DELETE` (T-SQL admite `SELECT 1FROM t`) y BORRARÍA; con un
 * `1COMMIT` detrás, el COMMIT confirmaría el envoltorio. Las formas, cada una medida:
 *   - `0x` / `0X` y solo dígitos hexadecimales: `0x1DELETE` = `0x1DE` + `LETE` (un alias),
 *     `0xUPDATE t SET…` = `0x` + UPDATE (escribe).
 *   - dinero: `$`, dígitos y, si acaso, `.` y dígitos; SIN exponente (`$1EDELETE` = `$1` + el
 *     alias `EDELETE`).
 *   - decimal: `1.`, `.5` y un exponente aunque NO lleve dígitos: `1EDELETE` = `1E` + DELETE y
 *     `1e-DELETE` = `1e-` + DELETE (borran).
 *   - ni `_` ni letras: `1_a` = `1` + el alias `_a`, `1d` = `1` + el alias `d`.
 */
function finNumero(s, i, n) {
  const c = s.charCodeAt(i)
  if (c === 48 && (s.charCodeAt(i + 1) === 120 || s.charCodeAt(i + 1) === 88)) return finHexadecimal(s, i, n)
  return finDecimal(s, i, n, c === 36)
}

// --- Tokens ---------------------------------------------------------------------------------

/** ¿Es el salto de línea que cuenta como uno (`\n`, o un `\r` que no precede a `\n`)? */
function cuentaLinea(s, i) {
  const c = s.charCodeAt(i)
  return c === 10 || (c === 13 && s.charCodeAt(i + 1) !== 10)
}

/** Avanza hasta `hasta` contando los saltos de línea que cruce. */
function avanzar(st, hasta) {
  for (; st.i < hasta; st.i++) {
    if (cuentaLinea(st.s, st.i)) st.linea++
  }
}

/** Salta un blanco; un salto de línea cuenta y vuelve a dejar la línea «en su inicio». */
function saltarBlanco(st) {
  if (!esBlanco(st.s.charCodeAt(st.i))) return false
  if (cuentaLinea(st.s, st.i)) {
    st.linea++
    st.inicioLinea = true
    st.desdeLinea = st.i + 1
  }
  st.i++
  return true
}

/** El final de un comentario de bloque ANIDADO que empieza en `i` (o `n` si no se cierra). */
function finComentarioBloque(s, i, n) {
  let prof = 0
  let j = i
  while (j < n) {
    if (s.charCodeAt(j) === 47 && s.charCodeAt(j + 1) === 42) {
      prof++
      j += 2
    } else if (s.charCodeAt(j) === 42 && s.charCodeAt(j + 1) === 47) {
      prof--
      j += 2
      if (prof === 0) break
    } else j++
  }
  return Math.min(j, n)
}

/** Salta un comentario de línea o de bloque. */
function saltarComentario(st) {
  const c = st.s.charCodeAt(st.i)
  const d = st.s.charCodeAt(st.i + 1)
  if (c === 45 && d === 45) {
    st.i = mientras(st.s, st.i, st.n, (x) => !esSaltoDeLinea(x))
  } else if (c === 47 && d === 42) {
    avanzar(st, finComentarioBloque(st.s, st.i, st.n))
  } else {
    return false
  }
  st.inicioLinea = false
  return true
}

/** Lee una cadena '…' ('' dentro), un nombre "…" ("" dentro) o […] (]] dentro). */
function leerCitado(st, c, desde, linea) {
  const s = st.s
  const cierre = c === 91 ? 93 : c
  let j = st.i + 1
  while (j < st.n) {
    if (s.charCodeAt(j) === cierre) {
      if (s.charCodeAt(j + 1) === cierre) j += 2
      else {
        j++
        break
      }
    } else j++
  }
  avanzar(st, Math.min(j, st.n))
  st.tokens.push({ t: c === 39 ? 'c' : 'i', v: '', desde, linea })
}

/**
 * ¿Es la palabra que acaba en `j` un GO en su línea (lo PRIMERO de la línea y, detrás, solo
 * blancos y, si acaso, un `--`)? Si lo es, lo anota (`repetir` para `GO n`), avanza hasta justo
 * después de su salto de línea (`\r\n` cuenta como uno) y devuelve true.
 */
function leerGo(st, j, linea) {
  const s = st.s
  const k = mientras(s, j, st.n, (x) => !esSaltoDeLinea(x))
  const resto = s.slice(j, k)
  const limpio = /^[ \t]*(--.*)?$/.test(resto)
  const repetir = /^[ \t]+\d+[ \t]*(--.*)?$/.test(resto)
  if (!limpio && !repetir) return false
  let fin = k
  if (fin < st.n && s.charCodeAt(fin) === 13) fin++
  if (fin < st.n && s.charCodeAt(fin) === 10) fin++
  st.go.push({ desde: st.desdeLinea, hasta: fin, linea, repetir })
  avanzar(st, fin)
  st.inicioLinea = true
  st.desdeLinea = fin
  return true
}

/** Lee una palabra, una @variable o un #temporal (o un GO, que no es un token). */
function leerNombre(st, c, desde, linea, eraInicio) {
  const s = st.s
  const j = mientras(s, st.i + 1, st.n, esParteNombre)
  const palabra = s.slice(st.i, j)
  st.i = j
  if (c === 64) {
    st.tokens.push({ t: 'v', v: palabra, desde, linea })
    return
  }
  if (c === 35) {
    st.tokens.push({ t: 'h', v: palabra, desde, linea })
    return
  }
  const v = palabra.toUpperCase()
  if (eraInicio && v === 'GO' && leerGo(st, j, linea)) return
  st.tokens.push({ t: 'p', v, desde, linea })
}

/** Lee un token: cadena, nombre, número (COMO LO LEE T-SQL), `$palabra` o cualquier otro carácter. */
function leerToken(st) {
  const s = st.s
  const c = s.charCodeAt(st.i)
  const d = s.charCodeAt(st.i + 1)
  const desde = st.i
  const linea = st.linea
  const eraInicio = st.inicioLinea
  st.inicioLinea = false
  if (c === 39 || c === 34 || c === 91) return leerCitado(st, c, desde, linea)
  if (esInicioNombre(c)) return leerNombre(st, c, desde, linea, eraInicio)
  if (esDigito(c) || (c === 46 && esDigito(d)) || (c === 36 && (esDigito(d) || d === 46))) {
    st.i = finNumero(s, st.i, st.n)
    st.tokens.push({ t: 'n', v: '', desde, linea })
    return undefined
  }
  if (c === 36 && esInicioNombre(d)) {
    const j = mientras(s, st.i + 1, st.n, esParteNombre)
    st.tokens.push({ t: 'p', v: s.slice(st.i, j).toUpperCase(), desde, linea })
    st.i = j
    return undefined
  }
  st.tokens.push({ t: 'o', v: s[st.i], desde, linea })
  st.i++
  return undefined
}

/**
 * Parte el texto en TOKENS significativos (sin blancos ni comentarios): `{ t, v, desde, linea }`
 * con `t` = 'p' (palabra, `v` en MAYÚSCULAS), 'v' (@variable), 'h' (#temporal), 'c' (cadena),
 * 'i' (nombre entre [] o ""), 'n' (número o dinero), 'o' (cualquier otro carácter). Y marca las
 * líneas de GO: `go` = [{ desde, hasta, linea, repetir }] (`desde`: inicio de la línea; `hasta`:
 * justo después de su salto). `linea` empieza en 1. Una cadena, un comentario o unos corchetes
 * sin cerrar llegan hasta el final: el servidor rechazará el lote entero al compilarlo.
 */
function tokenizar(texto) {
  const s = String(texto)
  // `inicioLinea`: ¿solo hubo blancos desde el último salto de línea? (para reconocer GO).
  const st = { s, n: s.length, i: 0, linea: 1, inicioLinea: true, desdeLinea: 0, tokens: [], go: [] }
  while (st.i < st.n) {
    if (saltarBlanco(st) || saltarComentario(st)) continue
    leerToken(st)
  }
  return { tokens: st.tokens, go: st.go }
}

module.exports = { tokenizar, finNumero }
