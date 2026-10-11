// =============================================================================
// Adaptador MongoDB del proceso de sesión del explorador: `sesion.cjs` despacha aquí `abrir`,
// `cancelar`, `cerrar` y la op `docs` (`bases`, `colecciones`, `detalle`, `consultar`, `mas`,
// `cerrarLector`, `consola`, `enviar`, `exportarAbrir`, `exportarMas`). La política (solo lectura, producción) se aplica antes de tocar
// el servidor; los cursores viven aquí, por id, con un tope por sesión. Las operaciones SQL del
// protocolo responden `protocolo`. Depende de `mongoComun.cjs`, `protocoloMongodb.cjs` y `cambiosMongodb.cjs`.
// Decisiones: docs/decisiones/bd/mongodb-sesion-lectores-y-enviar.md
// =============================================================================
'use strict'

const { randomUUID } = require('node:crypto')
const comun = require('./mongoComun.cjs')
const { CODIGO_LECTOR, protocolo, textoDe, enteroDe, politicaDe, guardia } = require('./protocoloMongodb.cjs')
const { errorDe } = require('./sesionProtocolo.cjs')
const { enviar } = require('./cambiosMongodb.cjs')
const { planDeExplain } = require('./planMongodb.cjs')
const { FORMATOS: FORMATOS_EXPORTAR, paginaExportada } = require('./exportarMongodb.cjs')

const TOPE_LECTORES = 8
const MUESTRA = 100
const TOPE_CONTEOS = 200
/** Una escritura de la consola no va en transacción: lo que llegó a escribir antes de pararse se queda. */
const MENSAJE_ESCRITURA_CANCELADA =
  'Operación cancelada. Si el servidor llegó a escribir algo antes de pararse, eso se queda: una escritura de la consola no se deshace a medias.'
const INTENTOS_KILLOP = 5
const ESPERA_KILLOP_MS = 200

// --- Abrir y cerrar ----------------------------------------------------------------------------

async function abrir(con, secreto, ctx, opciones, ganchos) {
  const op = opciones || {}
  const rol = op.rol || 'explorador'
  const appName = `Tessera/explorador ${rol} ${(ctx && ctx.usuarioWindows) || 'tessera'}@${(con && con.alias) || ''}`.slice(0, 128)
  const { cliente, topologia } = await comun.conectar(con, typeof secreto === 'string' ? secreto : '', { appName })
  const s = {
    motor: 'mongodb',
    con,
    cliente,
    topologia,
    lectores: new Map(),
    siguienteLector: 1,
    // El `comment` de cada operación lo usa el `killOp` de Stop, que mira todas las del usuario: tiene que
    // ser único entre sesiones, procesos y equipos con la misma cuenta.
    prefijoOp: randomUUID(),
    siguienteOp: 1,
    controlador: null,
    cancelado: false,
    escribiendo: false,
    comentario: null,
    ganchos: ganchos || {}
  }
  return {
    sesion: s,
    respuesta: {
      modo: 'nativo',
      driverId: null,
      version: topologia.version,
      esquema: null,
      usuario: con && con.user ? String(con.user) : null
    }
  }
}

async function cerrar(s) {
  if (!s || !s.cliente) return
  const lectores = [...s.lectores.values()]
  s.lectores.clear()
  await Promise.all(lectores.map((l) => comun.cerrarCursor(l.cursor)))
  try {
    await s.cliente.close()
  } catch {
    // cerrando igual
  }
}

async function cancelar(s) {
  if (!s || !s.controlador) return { cancelada: false }
  s.cancelado = true
  s.controlador.abort()
  // Las escrituras de la consola no admiten `signal`: sin esto seguirían en el servidor hasta acabar.
  // Las lecturas ya las para la señal, y «enviar» resuelve su propio lote.
  if (s.escribiendo && s.comentario) void matarEnServidor(s, s.comentario)
  return { cancelada: true }
}

/**
 * Mata en el servidor las operaciones propias con ese `comment`, único de esta sesión. Si el Stop llega
 * antes de que el servidor registre la escritura, reintenta mientras siga siendo la operación en curso.
 * Sin permiso, no hace nada: queda la cancelación del lado del cliente.
 */
async function matarEnServidor(s, comentario) {
  const admin = s.cliente.db('admin')
  for (let intento = 0; intento < INTENTOS_KILLOP && s.comentario === comentario; intento++) {
    try {
      const ops = await admin
        .aggregate([{ $currentOp: { allUsers: false, idleConnections: false } }, { $match: { 'command.comment': comentario } }])
        .toArray()
      if (ops.length > 0) {
        await Promise.allSettled(ops.map((op) => admin.command({ killOp: 1, op: op.opid })))
        return
      }
    } catch {
      return
    }
    await new Promise((r) => setTimeout(r, ESPERA_KILLOP_MS))
  }
}

// --- Lectores ----------------------------------------------------------------------------------

function guardarLector(s, lector) {
  const id = `m${s.siguienteLector++}`
  s.lectores.set(id, lector)
  while (s.lectores.size > TOPE_LECTORES) {
    const [viejo, l] = s.lectores.entries().next().value
    s.lectores.delete(viejo)
    comun.cerrarCursor(l.cursor)
  }
  return id
}

/** Primera página de un cursor: deja el lector si quedan más. */
async function primeraPagina(s, cursor, crear, max, conocidas, controlador, inicio) {
  const { documentos, hayMas } = await comun.siguientes(cursor, max)
  return paginaDe(s, cursor, crear, documentos, hayMas, conocidas, controlador, inicio)
}

function paginaDe(s, cursor, crear, documentos, hayMas, conocidas, controlador, inicio) {
  const columnas = comun.columnasDe(documentos, conocidas)
  let lector = null
  if (hayMas) {
    lector = guardarLector(s, { cursor, crear, entregados: documentos.length, columnas, controlador })
  } else {
    comun.cerrarCursor(cursor)
  }
  return conCrudos({ lector, documentos: documentos.map(comun.documento), columnas, ms: Date.now() - inicio }, documentos)
}

/**
 * Los documentos tal como los dio el driver, colgados de la página SIN ser enumerables: no viajan al main, y
 * la exportación los convierte a su formato sin volver a interpretar su texto.
 */
function conCrudos(pagina, crudos) {
  Object.defineProperty(pagina, 'crudos', { value: crudos, enumerable: false })
  return pagina
}

// --- Suboperaciones de `docs` -----------------------------------------------------------------

async function bases(s, _a, o) {
  const admin = s.cliente.db('admin').admin()
  let r
  try {
    r = await admin.listDatabases({ nameOnly: true, authorizedDatabases: true, comment: o.comment })
  } catch (err) {
    const fija = s.con && typeof s.con.database === 'string' ? s.con.database.trim() : ''
    if (err && err.code === 13 && fija) return [{ nombre: fija }]
    throw err
  }
  return (r.databases || [])
    .map((d) => {
      const b = { nombre: String(d.name) }
      if (typeof d.sizeOnDisk === 'number') b.tamano = d.sizeOnDisk
      return b
    })
    .sort((x, y) => x.nombre.localeCompare(y.nombre))
}

async function colecciones(s, a, o) {
  const db = s.cliente.db(textoDe(a.base, 'base'))
  const lista = await db.listCollections({}, { nameOnly: true, authorizedCollections: true, signal: o.signal, comment: o.comment }).toArray()
  const salida = lista
    .filter((c) => typeof c.name === 'string' && !c.name.startsWith('system.'))
    .map((c) => ({ nombre: c.name, tipo: c.type === 'view' ? 'vista' : c.type === 'timeseries' ? 'serieTemporal' : 'coleccion' }))
    .sort((x, y) => x.nombre.localeCompare(y.nombre))
  // El conteo estimado es de metadatos (barato), pero es un viaje por colección: con muchas
  // se omite antes que tardar.
  const contables = salida.filter((c) => c.tipo === 'coleccion')
  if (contables.length <= TOPE_CONTEOS) {
    // Los índices cuelgan de cada colección en el árbol: se piden con los conteos, con el mismo tope.
    const [conteos, indices] = await Promise.all([
      Promise.allSettled(contables.map((c) => db.collection(c.nombre).estimatedDocumentCount({ comment: o.comment }))),
      Promise.allSettled(contables.map((c) => indicesDe(db.collection(c.nombre), o)))
    ])
    conteos.forEach((r, i) => {
      if (r.status === 'fulfilled' && typeof r.value === 'number') contables[i].documentosEstimados = r.value
    })
    indices.forEach((r, i) => {
      if (r.status === 'fulfilled') contables[i].indices = r.value
    })
  }
  return salida
}

/** Los índices de una colección: nombre, clave en notación del shell y si es único. */
async function indicesDe(col, o) {
  const lista = await col.listIndexes({ comment: o.comment }).toArray()
  return lista.map((i) => ({ nombre: String(i.name), clave: comun.texto(i.key, true), unico: i.unique === true || i.name === '_id_' }))
}

async function detalle(s, a, o) {
  const col = s.cliente.db(textoDe(a.base, 'base')).collection(textoDe(a.coleccion, 'coleccion'))
  let indices
  try {
    indices = await indicesDe(col, o)
  } catch {
    // Una vista no tiene índices propios (listIndexes falla): se deja vacío.
    indices = []
  }
  const { campos, muestra } = await comun.muestrear(col, MUESTRA, { signal: o.signal, comment: o.comment })
  return { indices, campos, muestra }
}

async function consultar(s, a, o) {
  const col = s.cliente.db(textoDe(a.base, 'base')).collection(textoDe(a.coleccion, 'coleccion'))
  const max = enteroDe(a.maxDocumentos, 'maxDocumentos')
  for (const campo of ['filtro', 'proyeccion', 'orden']) {
    if (typeof a[campo] !== 'string') throw protocolo(`Falta «${campo}».`)
  }
  const filtro = comun.interpretarLiteral(a.filtro, 'filtro')
  const proyeccion = comun.interpretarLiteral(a.proyeccion, 'proyeccion')
  const orden = comun.interpretarLiteral(a.orden, 'orden')
  const inicio = Date.now()
  const crear = (saltar, signal) => {
    const opc = { promoteValues: false, batchSize: max, comment: o.comment }
    if (signal) opc.signal = signal
    if (Object.keys(proyeccion).length > 0) opc.projection = proyeccion
    if (Object.keys(orden).length > 0) opc.sort = orden
    if (saltar > 0) opc.skip = saltar
    return col.find(filtro, opc)
  }
  const cursor = crear(0, o.controlador.signal)
  return primeraPagina(s, cursor, crear, max, Array.isArray(a.columnas) ? a.columnas : [], o.controlador, inicio)
}

async function mas(s, a) {
  const id = textoDe(a.lector, 'lector')
  const max = enteroDe(a.maxDocumentos, 'maxDocumentos')
  const lec = s.lectores.get(id)
  if (!lec) throw errorDe('protocolo', 'El cursor ya no existe (se cerró o caducó): vuelve a consultar.', CODIGO_LECTOR)
  // Al final del mapa: es el más reciente para el tope.
  s.lectores.delete(id)
  s.lectores.set(id, lec)
  s.controlador = lec.controlador
  const inicio = Date.now()
  let r
  try {
    r = await comun.siguientes(lec.cursor, max)
  } catch (err) {
    if (!(err && err.code === 43) || s.cancelado) {
      s.lectores.delete(id)
      comun.cerrarCursor(lec.cursor)
      throw err
    }
    // El servidor lo mató por inactividad: se relanza saltándose lo ya entregado.
    comun.cerrarCursor(lec.cursor)
    lec.controlador = new AbortController()
    s.controlador = lec.controlador
    const nuevo = lec.crear(lec.entregados, lec.controlador.signal)
    if (!nuevo) {
      r = { documentos: [], hayMas: false }
    } else {
      lec.cursor = nuevo
      try {
        r = await comun.siguientes(nuevo, max)
      } catch (err2) {
        s.lectores.delete(id)
        comun.cerrarCursor(nuevo)
        throw err2
      }
    }
  }
  lec.entregados += r.documentos.length
  lec.columnas = comun.columnasDe(r.documentos, lec.columnas)
  if (!r.hayMas) {
    s.lectores.delete(id)
    comun.cerrarCursor(lec.cursor)
  }
  return conCrudos(
    { lector: r.hayMas ? id : null, documentos: r.documentos.map(comun.documento), columnas: lec.columnas, ms: Date.now() - inicio },
    r.documentos
  )
}

async function cerrarLectorDocs(s, a) {
  const id = textoDe(a.lector, 'lector')
  const lec = s.lectores.get(id)
  if (!lec) return { cerrado: false }
  s.lectores.delete(id)
  await comun.cerrarCursor(lec.cursor)
  return { cerrado: true }
}

async function consola(s, a, o) {
  const politica = politicaDe(a)
  const max = enteroDe(a.maxDocumentos, 'maxDocumentos')
  if (typeof a.texto !== 'string') throw protocolo('Falta «texto».')
  if (a.base !== null && a.base !== undefined && typeof a.base !== 'string') throw protocolo('«base» tiene que ser texto o null.')
  const base = a.base ? a.base : null
  // Interpretar y clasificar ANTES de tocar el servidor.
  const sentencia = comun.interpretarSentencia(a.texto)
  const clase = comun.clasificar(sentencia)
  if (!clase.lectura) guardia(politica, clase.motivo)
  s.escribiendo = !clase.lectura
  const inicio = Date.now()
  const r = await comun.ejecutar(s.cliente, base, sentencia, { maxDocumentos: max, signal: o.controlador.signal, comment: o.comment })
  const avisos = clase.avisos.length > 0 ? { avisos: clase.avisos } : {}
  switch (r.tipo) {
    case 'documentos': {
      const pagina = paginaDe(s, r.cursor, r.reabrir, r.primeros, r.hayMas, [], o.controlador, inicio)
      return { tipo: 'documentos', pagina, base, coleccion: r.coleccion, ...avisos }
    }
    case 'valor':
      if (r.plan) {
        // Los avisos del plan (colección entera, muchos documentos examinados) salen también en la Salida.
        const plan = planDeExplain(r.valor, Date.now() - inicio)
        const todos = [...clase.avisos, ...(plan.avisos || [])]
        return { tipo: 'plan', plan, base, ...(todos.length > 0 ? { avisos: todos } : {}) }
      }
      return { tipo: 'valor', texto: comun.texto(r.valor), base, ...avisos }
    case 'escritura':
      return {
        tipo: 'escritura',
        casados: r.casados,
        modificados: r.modificados,
        insertados: r.insertados,
        borrados: r.borrados,
        base,
        ...avisos
      }
    case 'base':
      return { tipo: 'base', base: r.base }
    default:
      throw protocolo('Resultado desconocido del intérprete.')
  }
}

// --- Exportar ----------------------------------------------------------------------------------

/** La página de una sentencia de lectura de la consola (`find`, `aggregate`); lo demás no se exporta. */
async function paginaDeSentencia(s, a, o) {
  if (typeof a.texto !== 'string') throw protocolo('Falta «texto».')
  const clase = comun.clasificar(comun.interpretarSentencia(a.texto))
  if (!clase.lectura) throw protocolo(`Solo se exporta el resultado de una consulta: ${clase.motivo}`)
  const soloLectura = { soloLectura: true, produccion: true, confirmado: false }
  const r = await consola(s, { ...a, politica: soloLectura }, o)
  if (r.tipo !== 'documentos') throw protocolo('La sentencia no devuelve documentos: no hay nada que exportar.')
  return r.pagina
}

function formatoDe(v) {
  if (!FORMATOS_EXPORTAR.includes(v)) throw protocolo('«formato» tiene que ser json o csv.')
  return v
}

/** La página en filas del formato; en CSV, con las columnas dadas o, en la primera página, las suyas. */
function respuestaExportacion(pagina, formato, columnas) {
  const cols = formato === 'csv' ? (columnas || comun.columnasDe(pagina.crudos, [])) : []
  const { filas, omitidos } = paginaExportada(pagina.crudos, formato, cols)
  return { lector: pagina.lector, columnas: cols, filas, omitidos }
}

/** La primera página de una exportación: la de una colección con su filtro, o la de una sentencia de lectura. */
async function exportarAbrir(s, a, o) {
  const formato = formatoDe(a.formato)
  let pagina
  if (a.origen === 'coleccion') pagina = await consultar(s, { ...a, columnas: [] }, o)
  else if (a.origen === 'sentencia') pagina = await paginaDeSentencia(s, a, o)
  else throw protocolo('Origen de exportación desconocido.')
  return respuestaExportacion(pagina, formato, null)
}

/** La página siguiente de una exportación abierta; `columnas` son las que fijó la primera. */
async function exportarMas(s, a) {
  const formato = formatoDe(a.formato)
  if (formato === 'csv' && !Array.isArray(a.columnas)) throw protocolo('Falta «columnas».')
  return respuestaExportacion(await mas(s, a), formato, formato === 'csv' ? a.columnas : null)
}

const OPERACIONES = new Map([
  ['bases', bases],
  ['colecciones', colecciones],
  ['detalle', detalle],
  ['consultar', consultar],
  ['mas', mas],
  ['cerrarLector', cerrarLectorDocs],
  ['consola', consola],
  ['enviar', enviar],
  ['exportarAbrir', exportarAbrir],
  ['exportarMas', exportarMas]
])

/** La op `docs` de `sesion.cjs` (dentro de `operar`: una a la vez por sesión). */
async function docs(s, operacion, args) {
  const fn = OPERACIONES.get(operacion)
  if (!fn) throw errorDe('protocolo', `Operación de documentos desconocida: ${String(operacion)}`, 'TESSERA-OP')
  const controlador = new AbortController()
  s.controlador = controlador
  s.cancelado = false
  s.escribiendo = false
  const comment = `tessera:${s.prefijoOp}:${s.siguienteOp++}`
  s.comentario = comment
  try {
    return await fn(s, args || {}, { controlador, signal: controlador.signal, comment })
  } catch (err) {
    const t = err && err.trabajador
    if (s.cancelado && !(t && (t.clase === 'protocolo' || t.clase === 'soloLectura'))) {
      throw errorDe('cancelada', s.escribiendo ? MENSAJE_ESCRITURA_CANCELADA : 'Operación cancelada.')
    }
    throw err
  } finally {
    s.controlador = null
    s.cancelado = false
    s.escribiendo = false
    s.comentario = null
  }
}

// --- Las operaciones SQL del protocolo: no son de este motor -----------------------------------

function noEsSql(op) {
  return async () => {
    throw errorDe('protocolo', `MongoDB no tiene la operación «${op}» (es de SQL): se usa la op «docs».`, 'TESSERA-OP')
  }
}

function esPerdida(err) {
  return comun.esPerdida(err)
}

function normalizarError(err) {
  return comun.normalizarError(err)
}

module.exports = {
  abrir,
  docs,
  ejecutar: noEsSql('ejecutar'),
  leer: noEsSql('leer'),
  cerrarLector: noEsSql('cerrarLector'),
  tx: noEsSql('tx'),
  autoCommit: noEsSql('autoCommit'),
  cancelar,
  cerrar,
  esPerdida,
  normalizarError
}
