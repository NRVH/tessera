// =============================================================================
// La guardia de solo lectura de SQL Server para `tdb`: parte el texto en lotes por sus líneas de
// GO, rechaza los lotes que no empiezan por SELECT o WITH y los que llevan palabras que escriben
// o ejecutan, y arma el envoltorio con ROLLBACK. Pieza de `sqlserver.cjs`. La impone Tessera,
// no el servidor: `test-sqlserver-tdb` la cruza con el clasificador compartido.
// Decisiones: docs/decisiones/bd/adaptador-sqlserver-solo-lectura.md
// =============================================================================

'use strict'

const { tokenizar } = require('./lexicoSqlserver.cjs')

/** Cómo empieza un lote de solo lectura. */
const INICIOS_LECTURA = Object.freeze(['select', 'with'])

/**
 * Palabras que ESCRIBEN, EJECUTAN o se saltan el envoltorio: su presencia en cualquier sitio
 * del texto (fuera de cadenas, comentarios y nombres entre comillas) rechaza un lote de solo
 * lectura. Por qué cada una, en `MOTIVO_PALABRA`.
 */
const PROHIBIDAS = Object.freeze({
  // Escriben datos o estructura.
  INSERT: 'escribe',
  UPDATE: 'escribe',
  DELETE: 'escribe',
  MERGE: 'escribe',
  TRUNCATE: 'escribe',
  INTO: 'escribe', // SELECT … INTO, INSERT INTO, OUTPUT … INTO
  CREATE: 'escribe',
  ALTER: 'escribe',
  DROP: 'escribe',
  ADD: 'escribe', // ADD SIGNATURE, ADD COUNTER SIGNATURE
  GRANT: 'escribe',
  REVOKE: 'escribe',
  DENY: 'escribe',
  WRITETEXT: 'escribe',
  UPDATETEXT: 'escribe',
  BULK: 'escribe',
  BACKUP: 'escribe',
  RESTORE: 'escribe',
  DUMP: 'escribe',
  LOAD: 'escribe',
  DBCC: 'escribe',
  CHECKPOINT: 'escribe',
  RECONFIGURE: 'escribe',
  SHUTDOWN: 'escribe',
  KILL: 'escribe',
  SETUSER: 'escribe',
  // Service Broker: SEND/RECEIVE mueven mensajes de una cola (RECEIVE los BORRA).
  SEND: 'escribe',
  RECEIVE: 'escribe',
  CONVERSATION: 'escribe',
  DIALOG: 'escribe',
  // Ejecutan código que puede escribir por dentro (y hacer COMMIT de la transacción de fuera).
  EXEC: 'ejecuta',
  EXECUTE: 'ejecuta',
  // El SQL va dentro de una CADENA que el escaneo no ve, y corre en otro servidor u origen.
  OPENQUERY: 'remoto',
  OPENROWSET: 'remoto',
  OPENDATASOURCE: 'remoto',
  // La transacción es la del envoltorio: un COMMIT o un ROLLBACK del texto la cierran y lo de
  // después se confirmaría solo.
  COMMIT: 'transaccion',
  ROLLBACK: 'transaccion',
  SAVE: 'transaccion',
  // Esperar o bloquear para modificar.
  WAITFOR: 'bloquea',
  UPDLOCK: 'bloquea',
  XLOCK: 'bloquea',
  TABLOCKX: 'bloquea'
})

const MOTIVO_PALABRA = Object.freeze({
  escribe: 'que escribe o cambia la base',
  ejecuta: 'y en solo lectura no se ejecuta ningún procedimiento: puede escribir por dentro, y hasta confirmar la transacción de fuera',
  remoto: 'que manda SQL escrito en una cadena a otro servidor u origen, y eso no se puede comprobar',
  transaccion: 'y en solo lectura la transacción la gestiona tdb (un COMMIT del texto confirmaría lo que viniera detrás)',
  bloquea: 'que espera o bloquea filas para modificarlas'
})

/**
 * Lo que puede ir detrás de SET en solo lectura: COPIA de `REGLAS.sqlserver.sesionSoloLectura`
 * de `shared/sql/dialectosSql.ts` (el clasificador del main), en mayúsculas.
 * `test-sqlserver-tdb` las cruza. Y `SET @variable`, que no toca la sesión. TRANSACTION solo
 * como `SET TRANSACTION ISOLATION LEVEL`.
 */
const SET_PERMITIDOS = Object.freeze(['LOCK_TIMEOUT', 'NOCOUNT', 'STATISTICS', 'DEADLOCK_PRIORITY', 'TRANSACTION'])

/** Detrás de BEGIN, lo que abre una transacción (o una conversación de Service Broker). */
const BEGIN_TRANSACCION = Object.freeze(['TRAN', 'TRANSACTION', 'DISTRIBUTED', 'DIALOG', 'CONVERSATION'])

/**
 * Parte el texto en LOTES por sus líneas de GO. `{ ok: true, lotes }` con cada lote `{ texto,
 * linea (la primera, base 1), tokens }` y SOLO los que tienen algo que ejecutar; o `{ ok: false,
 * motivo }` con un `GO n`, que se rechaza: repetir en silencio, o mandarlo al servidor como
 * texto, sería peor.
 */
function dividirLotes(texto) {
  const s = String(texto)
  const { tokens, go } = tokenizar(s)
  const repetido = go.find((g) => g.repetir)
  if (repetido) {
    return {
      ok: false,
      motivo:
        `«GO n» (línea ${repetido.linea}) repite el lote n veces en los clientes de SQL Server, y tdb no lo hace: ` +
        'escribe el lote las veces que haga falta o usa un WHILE.'
    }
  }
  const lotes = []
  let inicio = 0
  let lineaInicio = 1
  let t = 0
  const cortes = [...go, { desde: s.length, hasta: s.length, linea: 0 }]
  for (const corte of cortes) {
    const propios = []
    while (t < tokens.length && tokens[t].desde < corte.desde) propios.push(tokens[t++])
    if (propios.length > 0) lotes.push({ texto: s.slice(inicio, corte.desde), linea: lineaInicio, tokens: propios })
    inicio = corte.hasta
    // La línea siguiente a la del GO.
    lineaInicio = corte.linea + 1
  }
  return { ok: true, lotes }
}

/** Una palabra con su consejo de corchetes (por si es el nombre de una columna o una tabla). */
function conCorchetes(tok) {
  return `Si ${tok.v} es el nombre de una columna o una tabla, escríbelo entre corchetes: [${tok.v.toLowerCase()}].`
}

/** El motivo de un lote que no empieza por SELECT o WITH (tras los `;` del principio), o null. `quien`: «el texto» o «el lote 2». */
function motivoDePrefijo(lote, quien) {
  const tk = lote.tokens
  let k = 0
  while (k < tk.length && tk[k].t === 'o' && tk[k].v === ';') k++
  const primero = tk[k]
  if (primero && primero.t === 'p' && INICIOS_LECTURA.indexOf(primero.v.toLowerCase()) >= 0) return null
  const empieza = primero ? (primero.t === 'p' || primero.t === 'v' || primero.t === 'h' ? primero.v : 'otra cosa') : 'nada'
  return (
    `${quien} empieza por «${empieza}» (línea ${primero ? primero.linea : lote.linea}), y en solo lectura cada lote tiene que ` +
    `empezar por ${INICIOS_LECTURA.map((x) => x.toUpperCase()).join(' o ')}: en T-SQL un nombre suelto al principio de un lote EJECUTA ese procedimiento.`
  )
}

/** El motivo de un SET que no es de los permitidos, o null (`SET @variable` y los de `SET_PERMITIDOS` pasan). */
function motivoDeSet(tk, i, lleva) {
  const sig = tk[i + 1]
  if (sig && sig.t === 'v') return null
  const sigP = sig && sig.t === 'p' ? sig.v : ''
  const permitido = SET_PERMITIDOS.indexOf(sigP) >= 0 && (sigP !== 'TRANSACTION' || (tk[i + 2] !== undefined && tk[i + 2].v === 'ISOLATION'))
  if (permitido) return null
  return (
    `${lleva(`SET ${sigP || (sig ? sig.v : '')}`.trim())}, y en solo lectura solo se permite SET @variable, ` +
    'SET NOCOUNT, STATISTICS, LOCK_TIMEOUT, DEADLOCK_PRIORITY y SET TRANSACTION ISOLATION LEVEL.'
  )
}

/** El motivo por el que una palabra del lote (`tk[i]`) no se admite en solo lectura, o null. */
function motivoDePalabra(tk, i, quien) {
  const tok = tk[i]
  const sig = tk[i + 1]
  const sigP = sig && sig.t === 'p' ? sig.v : ''
  const lleva = (que) => `${quien} lleva ${que} (línea ${tok.linea})`
  const clase = Object.prototype.hasOwnProperty.call(PROHIBIDAS, tok.v) ? PROHIBIDAS[tok.v] : null
  if (clase) return `${lleva(tok.v)}, ${MOTIVO_PALABRA[clase]}. ${conCorchetes(tok)}`
  if (tok.v === 'BEGIN' && BEGIN_TRANSACCION.indexOf(sigP) >= 0) return `${lleva(`BEGIN ${sigP}`)}, ${MOTIVO_PALABRA.transaccion}.`
  if (tok.v === 'SET') return motivoDeSet(tk, i, lleva)
  if (tok.v === 'NEXT' && sigP === 'VALUE') return `${lleva('NEXT VALUE FOR')}, que avanza una secuencia, y eso no se deshace.`
  if ((tok.v === 'DISABLE' || tok.v === 'ENABLE') && sigP === 'TRIGGER') return `${lleva(`${tok.v} TRIGGER`)}, que cambia la base.`
  if (tok.v === 'WITH' && sigP === 'LOG') return `${lleva('WITH LOG')}, que escribe en el registro del servidor.`
  return null
}

/**
 * La GUARDIA DE SOLO LECTURA de un lote (capas 1 y 2): `null` si pasa, o el motivo. `n` y
 * `total` numeran el lote en el mensaje si hay más de uno.
 */
function guardiaLote(lote, n, total) {
  // «el texto» con un solo lote; «el lote 2» con varios.
  const quien = total > 1 ? `el lote ${n}` : 'el texto'
  const prefijo = motivoDePrefijo(lote, quien)
  if (prefijo) return prefijo
  const tk = lote.tokens
  for (let i = 0; i < tk.length; i++) {
    if (tk[i].t !== 'p') continue
    const motivo = motivoDePalabra(tk, i, quien)
    if (motivo) return motivo
  }
  return null
}

/**
 * La guardia de solo lectura del TEXTO entero: `{ ok: true, lotes }` o `{ ok: false, motivo }`.
 * PURA: `tdb.cjs` la llama antes de conectar y `consultar` otra vez antes de enviar.
 */
function guardiaSoloLectura(texto) {
  const div = dividirLotes(texto)
  // Un `GO n` no es cosa del solo lectura: su motivo va solo (`mensajeGuardia`).
  if (!div.ok) return { ok: false, motivo: div.motivo, general: true }
  for (let i = 0; i < div.lotes.length; i++) {
    const motivo = guardiaLote(div.lotes[i], i + 1, div.lotes.length)
    if (motivo) return { ok: false, motivo }
  }
  return { ok: true, lotes: div.lotes }
}

/**
 * El mensaje de un rechazo de `guardiaSoloLectura` para el agente: la frase de siempre de `tdb`
 * («"x" es de SOLO LECTURA y…»), el motivo, y quién impone el candado. Lo usan `tdb.cjs`
 * (antes de conectar) y `consultar`, para que digan lo mismo.
 */
function mensajeGuardia(alias, g) {
  if (g.general) return g.motivo
  return (
    `"${alias}" es de SOLO LECTURA y ${g.motivo}\n` +
    '    En SQL Server el solo lectura lo impone Tessera (el servidor no tiene candado): se rechaza toda\n' +
    '    escritura, todo EXEC y toda transacción del texto antes de enviarlo.'
  )
}

/** El envoltorio de solo lectura de un lote (capa 3): el prefijo en la MISMA línea. */
function envolverSoloLectura(texto) {
  return `BEGIN TRAN; ${texto}\nIF @@TRANCOUNT>0 ROLLBACK`
}

module.exports = {
  INICIOS_LECTURA,
  PROHIBIDAS,
  SET_PERMITIDOS,
  tokenizar,
  dividirLotes,
  guardiaSoloLectura,
  mensajeGuardia,
  envolverSoloLectura
}
