// =============================================================================
// `tdb ls`: las conexiones visibles en esta sesión, en texto o en `--json`, con la marca de
// las que este `tdb` no sabe usar y el porqué de cada vacío.
// La ruta de un archivo de base de datos no se enseña nunca: `ls` pinta su nombre.
// Depende de `motores.cjs`, `tdbConexiones.cjs` y `tdbSalida.cjs`; lo usa `tdb.cjs`.
// =============================================================================
'use strict'

const motoresTdb = require('./motores.cjs')
const { pintarTabla } = require('./tdbSalida.cjs')
const { motorConocido, nombreDe, motorLegible, formaConocida, esIdRepetido, idRepetidoDe, entendida } = require('./tdbConexiones.cjs')

/** Lo que `ls` pinta en DESTINO de una conexión de un motor que este `tdb` no conoce. */
const DESTINO_MOTOR_DESCONOCIDO = 'motor desconocido: actualiza Tessera'
/**
 * Y de una de motor conocido con una forma que no reconoce. No dice «actualiza»: puede ser
 * una edición a mano, y la explicación entera no cabe en una celda, así que va debajo.
 */
const DESTINO_FORMA_DESCONOCIDA = 'forma no reconocida (ver debajo)'

/** Y de la copia de otra conexión con su mismo id; con quién la comparte, también debajo. */
const DESTINO_ID_REPETIDO = 'id repetido (ver debajo)'

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
  if (ctx.scopeDefinido && ctx.delPerfil.length > 0 && ctx.espacioDatos) {
    console.log('\n  El agente de datos no tiene ninguna base montada.')
    console.log(`  El perfil tiene ${ctx.delPerfil.length}: móntalas con el botón de bases de`)
    console.log('  datos de su cabecera, y marca las que quieras que vea.\n')
  } else if (ctx.scopeDefinido && ctx.delPerfil.length > 0) {
    console.log('\n  Este PROYECTO no tiene ninguna base montada.')
    console.log(`  El perfil tiene ${ctx.delPerfil.length}: móntalas con el icono de base de`)
    console.log('  datos en la cabecera del agente, y marca las que quieras aquí.\n')
  } else if (ctx.delPerfil.length === 0) {
    console.log('\n  No hay conexiones configuradas en este perfil.')
    console.log('  Añádelas en la vista Bases de datos de Tessera (icono de base de datos).\n')
  } else {
    // Ámbito ausente y aun así nada visible: casi siempre, perfil equivocado.
    console.log('\n  Ninguna conexión visible en esta sesión.')
    console.log('  Ejecuta  tdb doctor  para ver con qué perfil y ámbito arrancó.\n')
  }
}

/** El entorno de una conexión tal como lo pinta `ls`: producción en mayúsculas y nada si no lo conoce. */
function textoEntorno(entorno) {
  if (entorno === 'produccion') return 'PRODUCCIÓN'
  if (entorno === 'pruebas') return 'pruebas'
  if (entorno === 'desarrollo') return 'desarrollo'
  return ''
}

/** El destino que se pinta de una conexión que este `tdb` no sabe usar. */
function destinoNoUsable(c) {
  if (esIdRepetido(c)) return DESTINO_ID_REPETIDO
  return motorConocido(c.motor) ? DESTINO_FORMA_DESCONOCIDA : DESTINO_MOTOR_DESCONOCIDO
}

/**
 * Una fila de la tabla. Una conexión que no se sabe usar se lista con la marca en vez de un
 * destino (desaparecer sin decir nada parece una avería) y lo demás en blanco: ni el modo ni
 * el entorno significan nada para ella.
 */
function filaLs(c) {
  if (!entendida(c)) {
    return { ALIAS: nombreDe(c), MOTOR: motorLegible(c.motor), DESTINO: destinoNoUsable(c), USUARIO: '', MODO: '', ENTORNO: '' }
  }
  return {
    ALIAS: c.alias,
    MOTOR: c.motor,
    DESTINO: motoresTdb.destinoLs(c),
    // `DOMINIO\usuario` con una cuenta de dominio de SQL Server; los demás, igual.
    USUARIO: motoresTdb.usuarioLs(c),
    MODO: c.readonly === false ? 'escritura' : 'solo lectura',
    ENTORNO: textoEntorno(c.entorno)
  }
}

/**
 * Tessera pide confirmación al usuario antes de escribir en producción, pero `tdb` no pasa
 * por ese diálogo: el aviso es para quien lee la salida, casi siempre el agente. Solo de las
 * que este `tdb` sabe usar.
 */
function avisoProduccion(ctx) {
  const produccion = ctx.conexiones.filter((c) => c.entorno === 'produccion' && entendida(c)).map((c) => c.alias)
  if (produccion.length > 0) {
    console.log(`\n  PRODUCCIÓN: ${produccion.join(', ')}.`)
    console.log('  No escribas en ella salvo que el usuario lo pida explícitamente.')
  }
}

/**
 * La explicación de la marca, escrita, para el agente que lee la tabla: sin ella intentaría
 * consultarlas y se encontraría el error una a una. Un párrafo por caso, con lo mismo que
 * dice el error de cada uno.
 */
function explicarNoUsables(ctx) {
  const porMotor = ctx.conexiones.filter((c) => !motorConocido(c.motor)).map(nombreDe)
  const porForma = ctx.conexiones.filter((c) => motorConocido(c.motor) && !formaConocida(c)).map(nombreDe)
  const porId = ctx.conexiones
    .filter((c) => esIdRepetido(c))
    .map((c) => {
      const r = idRepetidoDe(c)
      return `${nombreDe(c)} (con ${r && r.comparteCon !== undefined ? `"${r.comparteCon}"` : 'una de otro perfil'})`
    })
  if (porMotor.length > 0) {
    console.log(`\n  Requieren una versión más nueva de Tessera: ${porMotor.join(', ')}.`)
    console.log('  Este tdb no conoce su motor y no puede consultarlas: actualiza Tessera.')
  }
  if (porForma.length > 0) {
    console.log(`\n  No se reconoce cómo están guardadas: ${porForma.join(', ')}.`)
    console.log('  Pueden venir de una versión más nueva de Tessera (actualiza para usarlas) o de una')
    console.log('  edición a mano del archivo; Tessera las conserva tal cual. Este tdb no puede consultarlas.')
  }
  if (porId.length > 0) {
    console.log(`\n  Comparten su identificador con otra conexión: ${porId.join(', ')}.`)
    console.log('  Este tdb no puede distinguirlas y usa la primera del registro; Tessera las conserva')
    console.log('  tal cual. Elimina desde Tessera la que sobre.')
  }
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
  pintarTabla(['ALIAS', 'MOTOR', 'DESTINO', 'USUARIO', 'MODO', 'ENTORNO'], ctx.conexiones.map(filaLs))
  avisoProduccion(ctx)
  explicarNoUsables(ctx)
  console.log('')
}

module.exports = { cmdLs }
