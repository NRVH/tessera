// =============================================================================
// Adaptador MongoDB del proceso de sesión del explorador: `sesion.cjs` despacha aquí `abrir`,
// `cancelar`, `cerrar` y la op `docs` (`bases`, `colecciones`, `detalle`, `consultar`, `mas`,
// `cerrarLector`, `consola`, `enviar`). La política (solo lectura, producción) se aplica antes de tocar
// el servidor; los cursores viven aquí, por id, con un tope por sesión. Las operaciones SQL del
// protocolo responden `protocolo`. Depende de `mongoComun.cjs`, `protocoloMongodb.cjs` y `cambiosMongodb.cjs`.
// Decisiones: docs/decisiones/bd/mongodb-sesion-lectores-y-enviar.md
// =============================================================================
'use strict'

const comun = require('./mongoComun.cjs')
const { CODIGO_LECTOR, protocolo, textoDe, enteroDe, politicaDe, guardia } = require('./protocoloMongodb.cjs')
const { errorDe } = require('./sesionProtocolo.cjs')
const { enviar } = require('./cambiosMongodb.cjs')

const TOPE_LECTORES = 8
const MUESTRA = 100
const TOPE_CONTEOS = 200

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
    siguienteOp: 1,
    controlador: null,
    cancelado: false,
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
  return { cancelada: true }
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
  return { lector, documentos: documentos.map(comun.documento), columnas, ms: Date.now() - inicio }
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
    const conteos = await Promise.allSettled(contables.map((c) => db.collection(c.nombre).estimatedDocumentCount({ comment: o.comment })))
    conteos.forEach((r, i) => {
      if (r.status === 'fulfilled' && typeof r.value === 'number') contables[i].documentosEstimados = r.value
    })
  }
  return salida
}

async function detalle(s, a, o) {
  const col = s.cliente.db(textoDe(a.base, 'base')).collection(textoDe(a.coleccion, 'coleccion'))
  let indices
  try {
    const lista = await col.listIndexes({ comment: o.comment }).toArray()
    indices = lista.map((i) => ({ nombre: String(i.name), clave: comun.texto(i.key, true), unico: i.unique === true || i.name === '_id_' }))
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
  return { lector: r.hayMas ? id : null, documentos: r.documentos.map(comun.documento), columnas: lec.columnas, ms: Date.now() - inicio }
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
  const inicio = Date.now()
  const r = await comun.ejecutar(s.cliente, base, sentencia, { maxDocumentos: max, signal: o.controlador.signal, comment: o.comment })
  const avisos = clase.avisos.length > 0 ? { avisos: clase.avisos } : {}
  switch (r.tipo) {
    case 'documentos': {
      const pagina = paginaDe(s, r.cursor, r.reabrir, r.primeros, r.hayMas, [], o.controlador, inicio)
      return { tipo: 'documentos', pagina, base, coleccion: r.coleccion, ...avisos }
    }
    case 'valor':
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

const OPERACIONES = new Map([
  ['bases', bases],
  ['colecciones', colecciones],
  ['detalle', detalle],
  ['consultar', consultar],
  ['mas', mas],
  ['cerrarLector', cerrarLectorDocs],
  ['consola', consola],
  ['enviar', enviar]
])

/** La op `docs` de `sesion.cjs` (dentro de `operar`: una a la vez por sesión). */
async function docs(s, operacion, args) {
  const fn = OPERACIONES.get(operacion)
  if (!fn) throw errorDe('protocolo', `Operación de documentos desconocida: ${String(operacion)}`, 'TESSERA-OP')
  const controlador = new AbortController()
  s.controlador = controlador
  s.cancelado = false
  const comment = `tessera:${s.siguienteOp++}`
  try {
    return await fn(s, args || {}, { controlador, signal: controlador.signal, comment })
  } catch (err) {
    const t = err && err.trabajador
    if (s.cancelado && !(t && (t.clase === 'protocolo' || t.clase === 'soloLectura'))) {
      throw errorDe('cancelada', 'Operación cancelada.')
    }
    throw err
  } finally {
    s.controlador = null
    s.cancelado = false
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
