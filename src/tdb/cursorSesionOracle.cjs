// =============================================================================
// Lectores de la sesión Oracle: el cursor vivo (`resultSet`) de una consulta de usuario, con la
// fila de más guardada en `pendiente`, en una LRU de `MAX_LECTORES` por sesión.
// "Más" lee del mismo cursor: una sola lectura consistente, sin re-escanear ni reordenar.
// Depende de `celdas.cjs`; lo usa `sesionOracle.cjs`.
// Decisiones: docs/decisiones/bd/sesiones-exportar-con-cursor-vivo.md
// =============================================================================
'use strict'

const celdas = require('./celdas.cjs')

/** Lectores vivos por sesión (LRU): cuentan contra OPEN_CURSORS (300 por defecto en 11g). */
const MAX_LECTORES = 8
/** Filas por viaje al descartar con `saltarFilas`. */
const BLOQUE_SALTO = 5000

/** Suelta un lector: LOB pendientes y el cursor. Nunca lanza. */
function soltarLector(l) {
  try {
    celdas.soltarFilas(l.pendiente.filter((f) => Array.isArray(f)))
  } catch {
    // nada
  }
  l.pendiente = []
  try {
    const p = l.rs.close()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch {
    // ya cerrado
  }
}

/**
 * Lee una página del cursor. `pendiente` guarda filas crudas (arrays) o ya
 * convertidas ({ya}) que no cupieron en la respuesta anterior: una fila con LOB ya
 * leído no se puede volver a convertir, su locator está suelto.
 */
async function leerPagina(l, maxFilas) {
  const necesito = maxFilas + 1 - l.pendiente.length
  if (necesito > 0 && !l.agotado) {
    const filas = await l.rs.getRows(necesito)
    if (filas.length < necesito) l.agotado = true
    for (const f of filas) l.pendiente.push(f)
  }
  const tomar = l.pendiente.splice(0, maxFilas)
  const acc = new celdas.AcumuladorPagina(l.topes.topeRespuesta)
  const devolver = []
  for (let i = 0; i < tomar.length; i++) {
    const entrada = tomar[i]
    let conv
    if (Array.isArray(entrada)) {
      const fila = l.quitarUltima ? entrada.slice(0, -1) : entrada
      conv = await celdas.filaOracle(fila, l.topes)
    } else {
      conv = entrada.ya
    }
    if (!acc.agregar(conv.celdas, conv.recortes)) {
      devolver.push({ ya: conv })
      for (let j = i + 1; j < tomar.length; j++) devolver.push(tomar[j])
      break
    }
  }
  if (devolver.length) l.pendiente = devolver.concat(l.pendiente)
  const pagina = { filasJson: acc.json(), nFilas: acc.n, hayMas: l.pendiente.length > 0 }
  if (acc.recortes.length) pagina.recortes = acc.recortes
  return pagina
}

/** Descarta `saltar` filas del cursor (`saltarFilas`) y devuelve cuántas se saltó; marca el lector agotado si se acabó. */
async function saltarFilas(lector, saltar) {
  let saltadas = 0
  while (saltadas < saltar) {
    const n = Math.min(BLOQUE_SALTO, saltar - saltadas)
    const filas = await lector.rs.getRows(n)
    celdas.soltarFilas(filas)
    saltadas += filas.length
    if (filas.length < n) {
      lector.agotado = true
      break
    }
  }
  return saltadas
}

/** Registra un lector; si pasa del tope, expulsa el menos usado. */
function registrarLector(s, l) {
  const expulsados = []
  s.lectores.set(l.id, l)
  while (s.lectores.size > MAX_LECTORES) {
    const [idViejo, viejo] = s.lectores.entries().next().value
    s.lectores.delete(idViejo)
    soltarLector(viejo)
    expulsados.push(idViejo)
  }
  return expulsados
}

function errorLectorDesconocido(id) {
  const e = new Error(`El lector ${id} ya no existe (se agotó, se cerró o lo expulsó el tope de ${MAX_LECTORES}).`)
  e.code = 'TESSERA-LECTOR'
  e.__protocolo = true
  return e
}

module.exports = { MAX_LECTORES, soltarLector, leerPagina, saltarFilas, registrarLector, errorLectorDesconocido }
