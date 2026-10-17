// =============================================================================
// `tdb ls`: las conexiones visibles en esta sesión, en texto o en `--json`, con la marca de
// las que este `tdb` no sabe usar y el porqué de cada vacío.
// La ruta de un archivo de base de datos no se enseña nunca: `ls` pinta su nombre.
// Depende de `motores.cjs`, `tdbConexiones.cjs`, `tdbSalida.cjs` y `textosTdb.cjs`; lo usa `tdb.cjs`.
// =============================================================================
'use strict'

const motoresTdb = require('./motores.cjs')
const { pintarTabla } = require('./tdbSalida.cjs')
const { motorConocido, nombreDe, motorLegible, formaConocida, esIdRepetido, idRepetidoDe, entendida } = require('./tdbConexiones.cjs')
const { textosTdb } = require('./textosTdb.cjs')

/** La marca de `ls --json` de una conexión que este `tdb` no sabe usar, o `null`. */
function marcaJson(c) {
  if (entendida(c)) return null
  const repetido = idRepetidoDe(c)
  if (repetido) return { idRepetido: true, ...repetido }
  return motorConocido(c.motor) ? { formaDesconocida: true } : { motorDesconocido: true }
}

/**
 * La entrada de `ls --json` de una base de ARCHIVO sin su RUTA (la ruta dice dónde vive el
 * usuario y el agente abre por alias): va su NOMBRE, con el campo del DTO del main
 * (`archivoVisible`). Las de red salen tal cual, y una de forma no reconocida (sin `archivo`
 * de texto) o de un motor desconocido no se toca.
 */
function sinRuta(c) {
  if (!motoresTdb.deArchivo(c.motor) || typeof c.archivo !== 'string') return c
  const resto = { ...c }
  delete resto.archivo
  return { ...resto, archivoVisible: motoresTdb.destinoLs(c) }
}

/**
 * `ls --json`. Las marcas (`motorDesconocido`, `formaDesconocida`, `idRepetido`) y
 * `formatoAjeno` + `aviso` solo aparecen cuando son verdad: la salida de siempre no cambia.
 */
function lsJson(ctx) {
  console.log(
    JSON.stringify({
      ok: true,
      conexiones: ctx.conexiones.map((c) => {
        const marca = marcaJson(c)
        return marca ? { ...sinRuta(c), ...marca } : sinRuta(c)
      }),
      enElPerfil: ctx.delPerfil.length,
      acotado: ctx.scopeDefinido,
      ...(ctx.formatoAjeno ? { formatoAjeno: true, aviso: ctx.avisoRegistro } : {})
    })
  )
}

/**
 * TRES vacíos distintos, y cada uno se arregla de una forma: confundirlos convierte «monté
 * la base y no la ve» en un misterio. Con el agente de datos el sitio no se llama «proyecto».
 */
function mensajeSinConexiones(ctx) {
  const t = textosTdb()
  let lineas
  if (ctx.scopeDefinido && ctx.delPerfil.length > 0 && ctx.espacioDatos) {
    lineas = t.sinConexionesEspacio(ctx.delPerfil.length)
  } else if (ctx.scopeDefinido && ctx.delPerfil.length > 0) {
    lineas = t.sinConexionesProyecto(ctx.delPerfil.length)
  } else if (ctx.delPerfil.length === 0) {
    lineas = t.sinConexionesPerfil
  } else {
    // Ámbito ausente y aun así nada visible: casi siempre, perfil equivocado.
    lineas = t.ningunaVisible
  }
  for (const linea of lineas) console.log(linea)
}

/** El entorno de una conexión tal como lo pinta `ls`: producción en mayúsculas y nada si no lo conoce. */
function textoEntorno(entorno) {
  const t = textosTdb()
  if (entorno === 'produccion') return t.entornoProduccion
  if (entorno === 'pruebas') return t.entornoPruebas
  if (entorno === 'desarrollo') return t.entornoDesarrollo
  return ''
}

/**
 * El destino que se pinta de una conexión que este `tdb` no sabe usar. Una forma que no se
 * reconoce no dice «actualiza»: puede ser una edición a mano, y la explicación entera no cabe en
 * una celda, así que va debajo; con quién comparte el id una copia, también.
 */
function destinoNoUsable(c) {
  const t = textosTdb()
  if (esIdRepetido(c)) return t.destinoIdRepetido
  return motorConocido(c.motor) ? t.destinoFormaDesconocida : t.destinoMotorDesconocido
}

/**
 * Una fila de la tabla, en el orden de `columnasLs`. Una conexión que no se sabe usar se lista
 * con la marca en vez de un destino (desaparecer sin decir nada parece una avería) y lo demás en
 * blanco: ni el modo ni el entorno significan nada para ella.
 */
function filaLs(c) {
  if (!entendida(c)) return [nombreDe(c), motorLegible(c.motor), destinoNoUsable(c), '', '', '']
  const t = textosTdb()
  return [
    c.alias,
    c.motor,
    motoresTdb.destinoLs(c),
    // `DOMINIO\usuario` con una cuenta de dominio de SQL Server; los demás, igual.
    motoresTdb.usuarioLs(c),
    c.readonly === false ? t.modoEscritura : t.modoSoloLectura,
    textoEntorno(c.entorno)
  ]
}

/**
 * Tessera pide confirmación al usuario antes de escribir en producción, pero `tdb` no pasa
 * por ese diálogo: el aviso es para quien lee la salida, casi siempre el agente. Solo de las
 * que este `tdb` sabe usar.
 */
function avisoProduccion(ctx) {
  const produccion = ctx.conexiones.filter((c) => c.entorno === 'produccion' && entendida(c)).map((c) => c.alias)
  if (produccion.length > 0) for (const linea of textosTdb().avisoProduccion(produccion.join(', '))) console.log(linea)
}

/**
 * La explicación de la marca, escrita, para el agente que lee la tabla: sin ella intentaría
 * consultarlas y se encontraría el error una a una. Un párrafo por caso, con lo mismo que
 * dice el error de cada uno.
 */
function explicarNoUsables(ctx) {
  const t = textosTdb()
  const porMotor = ctx.conexiones.filter((c) => !motorConocido(c.motor)).map(nombreDe)
  const porForma = ctx.conexiones.filter((c) => motorConocido(c.motor) && !formaConocida(c)).map(nombreDe)
  const porId = ctx.conexiones
    .filter((c) => esIdRepetido(c))
    .map((c) => {
      const r = idRepetidoDe(c)
      return t.conQuien(nombreDe(c), r && r.comparteCon !== undefined ? `"${r.comparteCon}"` : t.unaDeOtroPerfilCorta)
    })
  const parrafos = []
  if (porMotor.length > 0) parrafos.push(t.noUsablesPorMotor(porMotor.join(', ')))
  if (porForma.length > 0) parrafos.push(t.noUsablesPorForma(porForma.join(', ')))
  if (porId.length > 0) parrafos.push(t.noUsablesPorId(porId.join(', ')))
  for (const linea of parrafos.flat()) console.log(linea)
}

function cmdLs(ctx) {
  if (ctx.json) {
    lsJson(ctx)
    return
  }
  if (ctx.formatoAjeno) {
    // Antes que los tres vacíos: ninguno es verdad y los tres mandan a añadir o montar.
    console.log(`\n  ${ctx.avisoRegistro}\n`)
    return
  }
  if (ctx.conexiones.length === 0) {
    mensajeSinConexiones(ctx)
    return
  }
  console.log('')
  pintarTabla(textosTdb().columnasLs, ctx.conexiones.map(filaLs))
  avisoProduccion(ctx)
  explicarNoUsables(ctx)
  console.log('')
}

module.exports = { cmdLs }
