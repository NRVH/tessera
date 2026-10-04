// =============================================================================
// Cómo escribe SQL Oracle para leerlo o correrlo en SQL*Plus: el literal de una celda, el guion
// INSERT de exportar y la vista previa de «Enviar». Fechas con TO_DATE/TO_TIMESTAMP, booleanos 1/0,
// texto largo en trozos de `TO_CLOB`, y bloques PL/SQL para el binario grande y los nombres con saltos.
// Neutral y ES2020; contrato en `tipos.ts`.
// Decisiones: docs/decisiones/bd/escritura-sql-oracle-sqlplus.md, escritura-sql-oracle-binario-grande.md
// =============================================================================

import type { DbCelda, DbTipoLogico } from '../db-explorador-ipc.ts'
import type { ColumnaFormato, EscritorFilas } from '../formatosFilas.ts'
import type { EscrituraSqlMotor, VistaDml } from './tipos.ts'
import { NUMERAL_SQL, cadenaSql, celda, hexDe, type Filas } from './comun.ts'
import { bytesUtf8, bytesUtf8DelCaracter } from '../sql/posicionErrorSql.ts'

const TROZO_CLOB = 1000
/**
 * Hex que cabe en un literal de Oracle: 4000 BYTES con MAX_STRING_SIZE=STANDARD, el único
 * modo de la 11.2. Son 2000 bytes de binario; por encima, la fila va en bloque PL/SQL.
 */
const HEX_MAX_LITERAL_ORACLE = 4000
/** Bytes de binario por línea del bloque: 2000 de hex, bajo los 2498 de SQL*Plus 11g. */
const TROZO_BINARIO = 1000
/** Lo más largo que admite una variable RAW de PL/SQL (y, con ella, un LONG RAW). */
const MAX_RAW_PLSQL = 32767
/** Columnas que van en variable RAW y no en BLOB: un BLOB no entra en un LONG RAW. */
const TIPO_RAW_ORACLE = /^\s*(LONG\s+)?RAW\b/i
/**
 * Bytes por línea del INSERT de Oracle. MEDIDO en SQL*Plus 11.2: 2498 bytes entran y
 * con 2499 la línea se ignora (SP2-0027); cuenta BYTES, no caracteres. Se llena hasta
 * aquí, con margen (ver `docs/decisiones/bd/escritura-sql-oracle-sqlplus.md`).
 */
const LINEA_MAX_ORACLE = 2400
/**
 * Bytes UTF-8 de un trozo de literal de texto de Oracle YA entrecomillado (comillas
 * dobladas incluidas): con su `TO_CLOB(` y su ` ||` sigue cabiendo solo en una línea.
 */
const TROZO_LINEA_ORACLE = 2000
/**
 * LO QUE SQL*PLUS INTERPRETA DENTRO DE UN LITERAL, en UNA sola definición: la comprobación
 * rápida, los dos recorridos y la sustitución por marcadores leen esta, y así no pueden
 * discrepar. Eran cuatro copias, y discrepar no era teórico: con un carácter añadido solo a
 * la de la sustitución, la forma TRANSLATE escribía «undefined» en el dato. Son los
 * caracteres de control menos el tabulador, uno a uno, y el `&` en RACHAS (`&&` se corta
 * entera: `'x&&' || 'y'`). Lo demás entra tal cual, MEDIDO con el SQL*Plus de la 11.2 y de
 * la 21c corriendo un guion de este mismo escritor: el tabulador, DEL, todo U+0080–U+009F
 * (U+0085, NEL, incluido), U+2028, U+2029 y un BOM a media línea.
 * Es global y compartida, así que SOLO se usa con `search`, `matchAll` y `replace`, que no
 * dejan `lastIndex` movido; `test` y `exec` sí lo mueven, y la búsqueda siguiente empezaría
 * a medias.
 */
// eslint-disable-next-line no-control-regex -- casar los caracteres de control es justo su trabajo
const ESPECIAL_SQLPLUS = /[\u0000-\u0008\u000a-\u001f]|&+/g
/**
 * Cortes (CHR(n) y cortes detrás de un `&`) que un texto CORTO lleva a la vista antes de
 * pasar a la forma TRANSLATE (ver `docs/decisiones/bd/escritura-sql-oracle-sqlplus.md`): `'dos' || CHR(10) || 'líneas'` se lee
 * mejor, y con un tope así una fila de mil columnas sigue en unos pocos miles de operandos.
 */
const MAX_CORTES_CHR = 8
/**
 * Marcadores de la forma TRANSLATE, por orden de preferencia (los signos raros primero,
 * para que casi siempre quede uno libre). ASCII imprimible: el mismo byte en cualquier
 * juego de caracteres de la base, y SQL*Plus no hace nada con ellos dentro de un literal.
 * Fuera la comilla, el `&` (sustitución), la `\` (el carácter de SET ESCAPE) y la `?`,
 * que es en lo que Oracle convierte un carácter que el juego de la base no tiene: con
 * ella de marcador, ese carácter acabaría convertido en un salto de línea.
 */
const MARCADORES_TRANSLATE = '~^`|{}[]<>@$%*+=!_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** ¿Lleva `s` algo que SQL*Plus interprete dentro de un literal (`ESPECIAL_SQLPLUS`)? */
export function tieneEspecialSqlplus(s: string): boolean {
  return s.search(ESPECIAL_SQLPLUS) >= 0
}

/**
 * ¿Lleva `s` un CARÁCTER DE CONTROL de los que SQL*Plus interpreta (`ESPECIAL_SQLPLUS` sin el
 * `&`)? Es lo que un NOMBRE citado no puede llevar crudo en un guion: no se puede cortar como
 * un literal, y ahí no hay `SET DEFINE OFF` que valga. Sale de la MISMA expresión, para que las dos cosas no discrepen nunca.
 */
export function tieneControlSqlplus(s: string): boolean {
  for (const m of s.matchAll(ESPECIAL_SQLPLUS)) if (m[0][0] !== '&') return true
  return false
}

/**
 * `a`, `b`, `c` -> `a ||`, `b ||`, `c`: los SEGMENTOS de una concatenación. Juntos con
 * un espacio son `a || b || c`, y entre dos se puede partir la línea.
 */
function concatenados(trozos: readonly string[]): string[] {
  return trozos.map((t, i) => (i < trozos.length - 1 ? t + ' ||' : t))
}

/**
 * Los trozos de un texto de Oracle, ya escritos (`'…'` o `CHR(n)`): juntos con ` || `
 * son el texto EXACTO y ninguno lleva nada que SQL*Plus interprete (ver `docs/decisiones/bd/escritura-sql-oracle-sqlplus.md`).
 * Los caracteres de control salen como `CHR(n)`, el literal se corta detrás de cada `&`
 * para que le siga la comilla que lo cierra, y ningún trozo pasa de TROZO_LINEA_ORACLE
 * bytes. Nunca se parte un par sustituto ni una comilla doblada: se corta el texto
 * CRUDO y cada trozo se entrecomilla aparte.
 */
function trozosTextoOracle(s: string): string[] {
  // Atajo, el caso normal: nada que cortar, y tan corto que ni a 3 bytes por unidad (el
  // máximo en UTF-8; una comilla doblada son 2) pasa del trozo. Da lo mismo que el bucle.
  if (3 * s.length + 2 <= TROZO_LINEA_ORACLE && !tieneEspecialSqlplus(s)) return [cadenaSql(s)]
  const trozos: string[] = []
  // Se salta de especial en especial: el texto entre dos es un TRAMO que solo hay que
  // partir por tamaño. Un carácter de control sale como CHR(n); una racha de `&` se
  // queda al final de su tramo (y así le sigue la comilla que lo cierra), salvo la
  // última del texto, que ya la tiene.
  let inicio = 0
  for (const m of s.matchAll(ESPECIAL_SQLPLUS)) {
    const fin = m.index + m[0].length
    if (m[0][0] === '&') {
      if (fin === s.length) break
      trozosDeTramo(s.slice(inicio, fin), trozos)
    } else {
      trozosDeTramo(s.slice(inicio, m.index), trozos)
      trozos.push(`CHR(${m[0].charCodeAt(0)})`)
    }
    inicio = fin
  }
  trozosDeTramo(s.slice(inicio), trozos)
  return trozos.length > 0 ? trozos : ["''"]
}

/**
 * Un tramo SIN caracteres especiales, entrecomillado en trozos de como mucho
 * TROZO_LINEA_ORACLE bytes (añadidos a `trozos`). Se corta el texto CRUDO, así que nunca
 * se parte una comilla doblada, y nunca entre las dos mitades de un par sustituto.
 */
function trozosDeTramo(t: string, trozos: string[]): void {
  if (t === '') return
  if (3 * t.length + 2 <= TROZO_LINEA_ORACLE) {
    trozos.push(cadenaSql(t))
    return
  }
  let inicio = 0
  let bytes = 2 // las dos comillas
  let i = 0
  while (i < t.length) {
    // Los bytes del carácter, con la cuenta de `posicionErrorSql` (4 = un par entero, que
    // ocupa dos unidades); la comilla, 2, porque va doblada.
    const u = bytesUtf8DelCaracter(t, i)
    const b = t.charCodeAt(i) === 0x27 ? 2 : u
    if (bytes + b > TROZO_LINEA_ORACLE) {
      trozos.push(cadenaSql(t.slice(inicio, i)))
      inicio = i
      bytes = 2
    }
    bytes += b
    i += u === 4 ? 2 : 1
  }
  trozos.push(cadenaSql(t.slice(inicio)))
}

/**
 * Un texto de Oracle de como mucho TROZO_CLOB unidades, en segmentos. Con `maxCortes`
 * cortes o menos (un CHR(n) por carácter de control, uno por racha de `&` que no acaba el
 * texto), los trozos de `trozosTextoOracle`, que se leen de corrido. Con más, la forma
 * TRANSLATE (ver `docs/decisiones/bd/escritura-sql-oracle-sqlplus.md`): el texto con un MARCADOR en el sitio de cada especial,
 * `TRANSLATE('uno~dos~', '~', CHR(10))`, que son siempre unos pocos operandos por muchos
 * saltos que tenga. Si no queda marcador libre (el trozo usa casi todo el ASCII), la
 * forma de CHR(n), que es igual de exacta.
 */
function segmentosTrozoOracle(t: string, maxCortes: number): string[] {
  if (!tieneEspecialSqlplus(t)) return concatenados(trozosTextoOracle(t))
  let cortes = 0
  const especiales: string[] = []
  for (const m of t.matchAll(ESPECIAL_SQLPLUS)) {
    if (m[0][0] !== '&' || m.index + m[0].length < t.length) cortes++
    if (!especiales.includes(m[0][0])) especiales.push(m[0][0])
  }
  if (cortes <= maxCortes) return concatenados(trozosTextoOracle(t))
  const marcas: string[] = []
  for (const c of MARCADORES_TRANSLATE) {
    if (marcas.length === especiales.length) break
    if (!t.includes(c)) marcas.push(c)
  }
  if (marcas.length < especiales.length) return concatenados(trozosTextoOracle(t))
  const marcaDe = new Map<string, string>()
  especiales.forEach((c, k) => marcaDe.set(c, marcas[k]))
  const trozos: string[] = []
  // Cada especial por su marcador; una racha de `&`, por tantos marcadores como `&` tenga.
  trozosDeTramo(t.replace(ESPECIAL_SQLPLUS, (r) => (marcaDe.get(r[0]) as string).repeat(r.length)), trozos)
  const s = concatenados(trozos)
  s[0] = 'TRANSLATE(' + s[0]
  s[s.length - 1] += ','
  s.push(`'${marcas.join('')}',`)
  // El `&` de destino va entre comillas, y le sigue la que lo cierra: SQL*Plus no lo toca.
  const destino = concatenados(especiales.map((c) => (c === '&' ? "'&'" : `CHR(${c.charCodeAt(0)})`)))
  destino[destino.length - 1] += ')'
  for (const d of destino) s.push(d)
  return s
}

/**
 * Un texto de Oracle en segmentos. Largo: en trozos de TROZO_CLOB unidades, que con
 * `comoClob` van en TO_CLOB para esquivar ORA-01704 (lo que se INSERTA o se asigna, que
 * puede ser un CLOB) y sin él se concatenan como VARCHAR2 (lo que se COMPARA: Oracle no
 * compara con `=` un CLOB, ORA-00932, y lo que se compara es un VARCHAR2 o un CHAR, que
 * ya cabe). Los trozos de un texto largo pasan a la forma TRANSLATE con el primer
 * especial (ver `docs/decisiones/bd/escritura-sql-oracle-sqlplus.md`).
 */
function segmentosTextoOracle(s: string, comoClob: boolean): string[] {
  if (s.length <= TROZO_CLOB) return segmentosTrozoOracle(s, MAX_CORTES_CHR)
  const segmentos: string[] = []
  const trozos = trozosClob(s)
  trozos.forEach((t, k) => {
    const ultimo = k === trozos.length - 1
    const trozo = segmentosTrozoOracle(t, 0)
    if (comoClob) {
      trozo[0] = 'TO_CLOB(' + trozo[0]
      trozo[trozo.length - 1] += ultimo ? ')' : ') ||'
    } else if (!ultimo) {
      trozo[trozo.length - 1] += ' ||'
    }
    for (const x of trozo) segmentos.push(x)
  })
  return segmentos
}

/**
 * Un texto partido en trozos de `tope` unidades como mucho (TROZO_CLOB, o TROZO_EJECUTAR),
 * sin partir nunca un par sustituto (el trozo quedaría con medio carácter). Lo comparten el
 * texto largo de un literal (`segmentosTextoOracle`) y el de un EXECUTE IMMEDIATE largo.
 */
function trozosClob(s: string, tope: number = TROZO_CLOB): string[] {
  const trozos: string[] = []
  let i = 0
  while (i < s.length) {
    let fin = Math.min(s.length, i + tope)
    const c = s.charCodeAt(fin - 1)
    if (fin < s.length && c >= 0xd800 && c <= 0xdbff) fin--
    trozos.push(s.slice(i, fin))
    i = fin
  }
  return trozos
}

/**
 * Un binario de Oracle (hasta 2000 bytes: lo de más va en bloque) en segmentos. El hex
 * de más de 1000 bytes no cabe en una línea y se concatena dentro de HEXTORAW, que
 * sigue recibiendo un VARCHAR2 de 4000 como mucho (medido en la 11.2 por SQL*Plus).
 */
function segmentosHexOracle(hex: string): string[] {
  const paso = 2 * TROZO_BINARIO
  if (hex.length <= paso) return [`HEXTORAW('${hex}')`]
  const trozos: string[] = []
  for (let i = 0; i < hex.length; i += paso) trozos.push(`'${hex.slice(i, i + paso)}'`)
  const s = concatenados(trozos)
  s[0] = 'HEXTORAW(' + s[0]
  s[s.length - 1] += ')'
  return s
}

/**
 * Literal de fecha/hora de Oracle según el texto que fija la sesión de Tessera; null si
 * el texto no tiene ninguna de sus formas (va como texto).
 */
function fechaOracle(s: string): string | null {
  // YYYY-MM-DD HH24:MI:SS[.FF6][ TZH:TZM]  |  YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `TO_DATE(${cadenaSql(s)}, 'YYYY-MM-DD')`
  if (/\s[+-]\d{2}:\d{2}$/.test(s)) {
    return `TO_TIMESTAMP_TZ(${cadenaSql(s)}, 'YYYY-MM-DD HH24:MI:SS.FF6 TZH:TZM')`
  }
  if (/\.\d+$/.test(s)) return `TO_TIMESTAMP(${cadenaSql(s)}, 'YYYY-MM-DD HH24:MI:SS.FF6')`
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return `TO_DATE(${cadenaSql(s)}, 'YYYY-MM-DD HH24:MI:SS')`
  }
  return null
}

/** Los segmentos del literal de Oracle de una celda que no es NULL (ver `docs/decisiones/bd/escritura-sql-oracle-sqlplus.md`). */
function segmentosLiteralOracle(v: string | boolean, tipo: DbTipoLogico | undefined, comoClob: boolean): string[] {
  // Sin BOOLEAN en SQL antes de la 23ai: 1/0.
  if (typeof v === 'boolean') return [v ? '1' : '0']
  const texto = (s: string): string[] => segmentosTextoOracle(s, comoClob)
  switch (tipo) {
    case 'numero':
      return NUMERAL_SQL.test(v.trim()) ? [v.trim()] : texto(v)
    case 'fecha':
    case 'fechaHora': {
      const f = fechaOracle(v)
      return f === null ? texto(v) : [f]
    }
    case 'binario': {
      const hex = hexDe(v)
      if (hex === null) return texto(v)
      return segmentosHexOracle(hex)
    }
    default:
      return texto(v)
  }
}

/** Una celda binaria de Oracle que no cabe en un literal y va en una variable del bloque. */
interface BinarioGrande {
  variable: string
  /** Variable RAW(32767) (columnas RAW y LONG RAW) en vez de un BLOB temporal. */
  comoRaw: boolean
  /** Hex de longitud PAR (uno impar se completa por delante, como hace HEXTORAW). */
  hex: string
}

/** El binario grande de la celda `k`-ésima del bloque, o null si cabe en su literal. */
function binarioGrandeOracle(v: DbCelda | undefined, col: ColumnaFormato, k: number): BinarioGrande | null {
  if (typeof v !== 'string') return null
  const hex = hexDe(v)
  if (hex === null || hex.length <= HEX_MAX_LITERAL_ORACLE) return null
  const comoRaw = col.tipoMotor !== undefined && TIPO_RAW_ORACLE.test(col.tipoMotor)
  return {
    variable: `tessera_${comoRaw ? 'r' : 'b'}${k}`,
    comoRaw,
    hex: hex.length % 2 === 0 ? hex : '0' + hex
  }
}

/**
 * Los segmentos de un INSERT de Oracle: juntos con un espacio, la sentencia de una línea
 * de siempre (`INSERT INTO t (A, B) VALUES (1, 'x');`); entre dos se puede partir.
 * `valores[c]` son los segmentos del literal de la columna `c`.
 */
function segmentosInsert(tabla: string, nombres: readonly string[], valores: readonly (readonly string[])[]): string[] {
  if (nombres.length === 0) return [`INSERT INTO ${tabla} () VALUES ();`]
  const s: string[] = []
  nombres.forEach((c, i) => s.push((i === 0 ? `INSERT INTO ${tabla} (` : '') + c + (i < nombres.length - 1 ? ',' : ')')))
  valores.forEach((v, i) => {
    v.forEach((seg, j) => {
      let t = i === 0 && j === 0 ? 'VALUES (' + seg : seg
      if (j === v.length - 1) t += i < valores.length - 1 ? ',' : ');'
      s.push(t)
    })
  })
  return s
}

/**
 * La sentencia en líneas de como mucho LINEA_MAX_ORACLE bytes, partiendo SOLO entre
 * segmentos: entre columnas, entre valores y detrás de un ` ||`, nunca dentro de un
 * literal. Si cabe, UNA línea, la misma de siempre; las de continuación, dos espacios
 * más adentro. Ninguna línea acaba en `;` salvo la última, ni queda en blanco, ni es
 * `/` o `.` sola: son las que SQL*Plus interpreta a media sentencia.
 */
function lineasOracle(segmentos: readonly string[], sangria: string): string {
  // Atajo, el caso normal: si la sentencia entera cabe, el voraz de abajo daría esta
  // misma línea. Un byte por unidad como poco: si ni así cabe, ni se junta.
  let largo = sangria.length + segmentos.length - 1
  for (const s of segmentos) largo += s.length
  if (largo <= LINEA_MAX_ORACLE) {
    const una = sangria + segmentos.join(' ')
    if (3 * largo <= LINEA_MAX_ORACLE || bytesUtf8(una) <= LINEA_MAX_ORACLE) return una
  }
  const lineas: string[] = []
  const continuacion = sangria + '  '
  let linea = sangria + segmentos[0]
  let bytes = bytesUtf8(linea)
  for (let k = 1; k < segmentos.length; k++) {
    const b = bytesUtf8(segmentos[k])
    if (bytes + 1 + b <= LINEA_MAX_ORACLE) {
      linea += ' ' + segmentos[k]
      bytes += 1 + b
    } else {
      lineas.push(linea)
      linea = continuacion + segmentos[k]
      bytes = continuacion.length + b
    }
  }
  lineas.push(linea)
  return lineas.join('\n')
}

/**
 * La fila como bloque PL/SQL terminado en `/` (ver `docs/decisiones/bd/escritura-sql-oracle-sqlplus.md`). `cuerpo` es la sentencia ya
 * partida en líneas y sangrada: el INSERT, o su EXECUTE IMMEDIATE si un nombre lleva un salto
 * (con lo que ESE declare en `declarar`). Sin nada que declarar (el EXECUTE IMMEDIATE de una
 * sentencia corta y sin binarios grandes) el bloque empieza en BEGIN.
 */
function bloqueOracle(cuerpo: string, grandes: readonly BinarioGrande[], declarar: readonly string[] = []): string {
  const l: string[] = []
  for (const g of grandes) {
    const bytes = g.hex.length / 2
    if (g.comoRaw && bytes > MAX_RAW_PLSQL) {
      l.push(
        `-- ${bytes} bytes no caben en una variable RAW de PL/SQL (tope ${MAX_RAW_PLSQL}): ` +
          'esta fila fallará con ORA-06502, y no hay forma de insertarla con SQL.'
      )
    }
  }
  if (grandes.length > 0 || declarar.length > 0) l.push('DECLARE')
  for (const g of grandes) l.push(`  ${g.variable} ${g.comoRaw ? `RAW(${MAX_RAW_PLSQL})` : 'BLOB'};`)
  for (const d of declarar) l.push(d)
  l.push('BEGIN')
  for (const g of grandes) l.push(...lineasCargaBinario(g))
  l.push(cuerpo)
  for (const g of grandes) if (!g.comoRaw) l.push(`  DBMS_LOB.FREETEMPORARY(${g.variable});`)
  l.push('END;', '/')
  return l.join('\n') + '\n'
}

/** Las líneas de PL/SQL que llenan la variable de un binario grande, trozo a trozo. */
function lineasCargaBinario(g: BinarioGrande): string[] {
  const l: string[] = []
  const paso = 2 * TROZO_BINARIO
  if (!g.comoRaw) l.push(`  DBMS_LOB.CREATETEMPORARY(${g.variable}, TRUE);`)
  for (let i = 0; i < g.hex.length; i += paso) {
    const trozo = g.hex.slice(i, i + paso)
    if (!g.comoRaw) {
      l.push(`  DBMS_LOB.WRITEAPPEND(${g.variable}, ${trozo.length / 2}, HEXTORAW('${trozo}'));`)
    } else if (i === 0) {
      l.push(`  ${g.variable} := HEXTORAW('${trozo}');`)
    } else {
      l.push(`  ${g.variable} := UTL_RAW.CONCAT(${g.variable}, HEXTORAW('${trozo}'));`)
    }
  }
  return l
}

/** Lo que un EXECUTE IMMEDIATE pone en su bloque: sus declaraciones y sus líneas, ya sangradas. */
interface SentenciaPorTexto {
  declarar: string[]
  cuerpo: string
}

/** El CLOB temporal donde se arma el texto de un EXECUTE IMMEDIATE largo. */
const VARIABLE_SQL = 'tessera_sql'
/**
 * Unidades del texto de un EXECUTE IMMEDIATE por llamada: la sentencia entera si cabe, o cada
 * DBMS_LOB.APPEND de una larga. Es PL/SQL, así que el valor de la expresión es un VARCHAR2 de
 * hasta 32767 bytes, no de 4000 como en SQL: 8000 unidades son como mucho 24 000 bytes (3 por
 * unidad; un par sustituto, 4 por dos). Con los 1000 del literal de SQL eran 16 veces más
 * llamadas, y MEDIDO con un CLOB de 16 MiB en la 11.2, 140 s contra los 29 del INSERT de siempre.
 */
const TROZO_EJECUTAR = 8000

/**
 * `EXECUTE IMMEDIATE` de una sentencia de Oracle, en líneas que SQL*Plus no rompe: el TEXTO de la sentencia va escrito como literales de
 * PL/SQL (`segmentosTrozoOracle`), así que sus caracteres de control salen como CHR(n) (o
 * TRANSLATE) y sus `&`, cortados, y lo que ejecuta el servidor es exactamente `sentencia`.
 * Corta (hasta TROZO_EJECUTAR unidades), el texto va en la misma llamada; larga, se arma en
 * un CLOB temporal con DBMS_LOB.APPEND, trozo a trozo, y se ejecuta el CLOB. `usando`: las
 * variables del bloque que la sentencia recibe por posición (`:tessera_b1`…), en su orden.
 */
function ejecutarInmediatoOracle(sentencia: string, usando: readonly string[]): SentenciaPorTexto {
  /** Cierra la llamada: `;`, o `USING a, b;` con las variables en su orden. */
  const cerrar = (s: string[]): string[] => {
    if (usando.length === 0) s[s.length - 1] += ';'
    else usando.forEach((v, i) => s.push((i === 0 ? 'USING ' : '') + v + (i < usando.length - 1 ? ',' : ';')))
    return s
  }
  if (sentencia.length <= TROZO_EJECUTAR) {
    const s = segmentosTrozoOracle(sentencia, MAX_CORTES_CHR)
    s[0] = 'EXECUTE IMMEDIATE ' + s[0]
    return { declarar: [], cuerpo: lineasOracle(cerrar(s), '  ') }
  }
  // Largo: a un CLOB temporal, trozo a trozo: concatenarlo con `||` copia
  // lo acumulado en cada operando.
  const l: string[] = [`  DBMS_LOB.CREATETEMPORARY(${VARIABLE_SQL}, TRUE);`]
  for (const t of trozosClob(sentencia, TROZO_EJECUTAR)) {
    const s = segmentosTrozoOracle(t, MAX_CORTES_CHR)
    s[0] = `DBMS_LOB.APPEND(${VARIABLE_SQL}, TO_CLOB(` + s[0]
    s[s.length - 1] += '));'
    l.push(lineasOracle(s, '  '))
  }
  l.push(lineasOracle(cerrar([`EXECUTE IMMEDIATE ${VARIABLE_SQL}`]), '  '))
  l.push(`  DBMS_LOB.FREETEMPORARY(${VARIABLE_SQL});`)
  return { declarar: [`  ${VARIABLE_SQL} CLOB;`], cuerpo: l.join('\n') }
}

/**
 * Una sentencia de Oracle que se ENSEÑA y se puede copiar (la vista previa de «Enviar») con un
 * nombre que SQL*Plus rompería (`tieneEspecialSqlplus` en un nombre: un carácter de control o
 * un `&`), como bloque: `BEGIN` + su `EXECUTE IMMEDIATE` + `END;`. Sin la `/` que lo ejecuta:
 * la pone quien junta las sentencias, en su propia línea (ver `dmlRejilla`).
 */
export function bloqueEjecutarOracle(sentencia: string): string {
  const e = ejecutarInmediatoOracle(sentencia, [])
  return (e.declarar.length > 0 ? 'DECLARE\n' + e.declarar.join('\n') + '\n' : '') + 'BEGIN\n' + e.cuerpo + '\nEND;'
}

/**
 * El INSERT de Oracle, escrito para que lo acepte SQL*Plus: líneas partidas, el binario
 * grande en un bloque y el nombre con un salto por EXECUTE IMMEDIATE (ver `docs/decisiones/bd/escritura-sql-oracle-sqlplus.md`).
 */
function escritorInsertOracle(
  tabla: string,
  nombres: readonly string[],
  cabeza: string,
  columnas: readonly ColumnaFormato[]
): EscritorFilas {
  const n = columnas.length
  // Un NOMBRE con un carácter de control (un salto de línea en un nombre citado): cada
  // fila va por EXECUTE IMMEDIATE, con el texto de la sentencia escrito sin nada crudo
  // Solo esta tabla; las demás, byte a byte
  // como siempre.
  const porTexto = tieneControlSqlplus(cabeza)
  return {
    // Un `&` en un NOMBRE (citado) no se puede cortar como en un literal: ahí, y solo
    // ahí, se apaga la sustitución de SQL*Plus (ver `docs/decisiones/bd/escritura-sql-oracle-sqlplus.md`). Con EXECUTE IMMEDIATE
    // el nombre va dentro de una cadena y su `&` se corta como el de cualquier literal:
    // no hace falta, y el guion sigue siendo solo SQL y PL/SQL.
    inicio: () => (!porTexto && cabeza.includes('&') ? 'SET DEFINE OFF\n' : ''),
    filas: (filas: Filas) => {
      let s = ''
      for (const f of filas) {
        const vals: string[][] = []
        const grandes: BinarioGrande[] = []
        for (let c = 0; c < n; c++) {
          const v = celda(f, c)
          const g = columnas[c].tipoLogico === 'binario' ? binarioGrandeOracle(v, columnas[c], grandes.length + 1) : null
          if (g) grandes.push(g)
          // Por EXECUTE IMMEDIATE, la variable no está a la vista de la sentencia
          // dinámica: va por posición (`USING`), con su marcador en el texto. El NULL, como
          // en cualquier literal.
          if (g) vals.push([porTexto ? ':' + g.variable : g.variable])
          else vals.push(v === null || v === undefined ? ['NULL'] : segmentosLiteralOracle(v, columnas[c].tipoLogico, true))
        }
        const insert = segmentosInsert(tabla, nombres, vals)
        if (porTexto) {
          // La sentencia de una pieza (el servidor no lee por líneas) y sin su `;`, que
          // EXECUTE IMMEDIATE no admite (ORA-00911).
          const sentencia = insert.join(' ').slice(0, -1)
          const e = ejecutarInmediatoOracle(sentencia, grandes.map((x) => x.variable))
          s += bloqueOracle(e.cuerpo, grandes, e.declarar)
        } else {
          s += grandes.length > 0 ? bloqueOracle(lineasOracle(insert, '  '), grandes) : lineasOracle(insert, '') + '\n'
        }
      }
      return s
    },
    fin: () => ''
  }
}

/**
 * La vista previa de «Enviar»: la sentencia con un NOMBRE que SQL*Plus rompería (un
 * carácter de control o un `&`) en un bloque con EXECUTE IMMEDIATE y la `/` en su línea;
 * las demás, con `;`.
 */
function vistaDmlOracle(vista: string, nombres: readonly string[]): VistaDml {
  if (nombres.some((n) => tieneEspecialSqlplus(n))) return { vista: bloqueEjecutarOracle(vista), terminador: '\n/' }
  return { vista, terminador: ';' }
}

export const ESCRITURA_ORACLE: EscrituraSqlMotor = {
  segmentosLiteral: segmentosLiteralOracle,
  escritorInsert: (cabeza, columnas, tabla, nombres) => escritorInsertOracle(tabla, nombres, cabeza, columnas),
  vistaDml: vistaDmlOracle
}
