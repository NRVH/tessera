// =============================================================================
// Las órdenes de `tctx`, iguales en el equipo y en un contenedor: qué operación se pide al puente
// (reglas, documentos, búsqueda y delegación), cómo se lee su respuesta y la ayuda. Solo cambia
// por dónde viaja la petición (el pipe en `tctx.cjs`, el buzón en `tctx-container.cjs`). El perfil y la sesión
// los pone Tessera por el token: aquí no se nombran. Depende de `tctxArgumentos`, `tctxSalida` y `textosTctx`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md, docs/decisiones/agentes/traspaso-entre-agentes.md,
// docs/decisiones/agentes/buscar-en-el-historial.md, docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
'use strict'

const { MAX_TEXTO_BUSCAR } = require('./tctxArgumentos.cjs')
const { CODIGOS, ErrorTctx, aviso, MAX_ORDEN_BYTES } = require('./tctxSalida.cjs')
const { textosTctx } = require('./textosTctx.cjs')
const path = require('node:path')

/** Lo que se espera a `buscar`: más que el tope de tiempo de la búsqueda en el main (`TOPES_DEFECTO.ms`). */
const TOPE_BUSCAR_MS = 20_000
/**
 * Lo que se espera a `delegar` y a `tarea --cancelar|--continuar`: antes de contestar, Tessera comprueba Docker, lee el
 * uso de las cuentas o espera a que la tarea se pare. Cortar antes dejaría una tarea lanzada sin su id.
 */
const TOPE_DELEGAR_MS = 60_000

/** El tope de la petición de cada subcomando, o `undefined` para el del puente. */
const topeDe = (a) => (a.sub === 'buscar' ? TOPE_BUSCAR_MS : ['delegar', 'tarea', 'modelos'].includes(a.sub) ? TOPE_DELEGAR_MS : undefined)

/** Los topes de `src/shared/reglasPerfil.ts` (`MAX_REGLAS_PERFIL`, `MAX_MOTIVO_PROPUESTA`); los fija `test:tctx`. */
const MAX_REGLAS = 6000
const MAX_MOTIVO = 500
/**
 * Lo que se manda como mucho: más largo, Tessera lo rechazaría igual. `MAX_PETICION` (los campos en JSON)
 * deja sitio al token y a la operación dentro del tope del puente (`MAX_PETICION` de `puenteBd.ts`, 32 KiB).
 */
const MAX_TEXTO_ENVIADO = MAX_REGLAS * 2
const MAX_MOTIVO_ENVIADO = MAX_MOTIVO * 4
const MAX_PETICION = 30 * 1024
/** El tope de `MAX_PROPUESTA_CONFIG` (`operacionConfigTctx.ts`), en KiB, para el mensaje. */
const MAX_CONFIG_KIB = 24

/** Los «no» del propio puente (no los de la operación), con el código 3. */
function exigirPuente(r) {
  const t = textosTctx()
  if (r === null || typeof r !== 'object') throw new ErrorTctx(CODIGOS.puente, t.tesseraNoContesta)
  if (r.ok === true) return r
  // Los `error` que se comparan son códigos del puente, no textos para nadie: no se traducen.
  if (r.error === 'no autorizado') throw new ErrorTctx(CODIGOS.puente, t.sesionNoReconocida)
  if (r.error === 'operacion desconocida' || r.error === 'version de protocolo distinta') {
    throw new ErrorTctx(CODIGOS.puente, t.versionDistinta)
  }
  if (r.error === 'error interno') throw new ErrorTctx(CODIGOS.puente, t.falloInterno)
  if (r.error === 'peticion invalida') throw new ErrorTctx(CODIGOS.puente, t.peticionInvalida)
  return r
}

/** Cada rechazo de la operación: su código de salida y su texto (con los datos que trae la respuesta). */
const RECHAZOS = {
  ...Object.fromEntries([
    'delegar-desde-docker', 'delegar-sin-proyecto', 'agente-no-delegable', 'cuenta-no-existe', 'cuenta-ambigua',
    'ninguna-cuenta', 'sin-credencial', 'orden-vacia', 'orden-larga', 'archivo-fuera', 'archivo-no-existe',
    'tarea-no-existe', 'tarea-sin-conversacion', 'tarea-cerrandose', 'sin-docker', 'modelo-invalido', 'esfuerzo-invalido',
    'modelo-no-disponible', 'esfuerzo-no-admitido', 'catalogo-no-disponible', 'docker-iniciando'
  ].map((codigo) => [codigo, [CODIGOS.rechazo, (t, r) => t.rechazosDelegacion[codigo]({
    ...r,
    max: Number(r.max) || MAX_ORDEN_BYTES,
    reinicio: r.reinicio === undefined ? '' : horaLocal(r.reinicio),
    agente: NOMBRE_AGENTE[r.agente] || r.agente
  })]])),
  vacia: [CODIGOS.rechazo, (t) => t.propuestaVacia],
  larga: [CODIGOS.rechazo, (t, r) => t.propuestaLarga(Number(r.largo) || 0, Number(r.max) || MAX_REGLAS)],
  igual: [CODIGOS.rechazo, (t) => t.propuestaIgual],
  'sin-global': [CODIGOS.rechazo, (t) => t.sinGlobal],
  'motivo-largo': [CODIGOS.rechazo, (t, r) => t.motivoLargo(Number(r.max) || MAX_MOTIVO)],
  'sin-traspaso': [CODIGOS.rechazo, (t) => t.sinTraspaso],
  'busqueda-vacia': [CODIGOS.rechazo, (t) => t.faltaBusqueda],
  'busqueda-larga': [CODIGOS.rechazo, (t, r) => t.busquedaLarga(Number(r.max) || MAX_TEXTO_BUSCAR)],
  ocupado: [CODIGOS.rechazo, (t) => t.busquedaOcupada],
  'sin-documentos': [CODIGOS.rechazo, (t) => t.sinDocumentos],
  'doc-no-existe': [CODIGOS.rechazo, (t) => t.docNoExiste],
  'doc-ambiguo': [CODIGOS.rechazo, (t, r) => t.docAmbiguo(Array.isArray(r.candidatos) ? r.candidatos.map(String) : [])],
  'doc-grande': [CODIGOS.rechazo, (t, r) => t.docGrande(Math.ceil((Number(r.bytes) || 0) / 1024))],
  'doc-no-texto': [CODIGOS.rechazo, (t) => t.docNoTexto],
  'config-sin-agente': [CODIGOS.rechazo, (t) => t.configSinAgente],
  'config-larga': [CODIGOS.rechazo, (t) => t.configLarga(MAX_CONFIG_KIB)],
  'config-igual': [CODIGOS.rechazo, (t) => t.configIgual],
  'config-sin-global': [CODIGOS.rechazo, (t) => t.configSinGlobal],
  'config-sintaxis': [CODIGOS.rechazo, (t, r) => t.configSintaxis(Number(r.linea) || null, String(r.detalle ?? ''))],
  'sin-sesion': [CODIGOS.puente, (t) => t.sesionNoReconocida],
  'sin-perfil': [CODIGOS.puente, (t) => t.sinPerfil],
  peticion: [CODIGOS.puente, (t) => t.peticionInvalida]
}

/** Un rechazo de la operación, con su texto y su código; uno que no se conoce no se entiende. */
function errorDeRechazo(r) {
  const t = textosTctx()
  const conocido = typeof r.rechazo === 'string' && Object.prototype.hasOwnProperty.call(RECHAZOS, r.rechazo) ? RECHAZOS[r.rechazo] : null
  if (!conocido) return new ErrorTctx(CODIGOS.puente, t.respuestaIncomprensible)
  return new ErrorTctx(conocido[0], conocido[1](t, r))
}

/** `proponer --global` lleva el nivel; sin él, son las del perfil y no se manda. */
const nivelDe = (a) => (a.nivel === 'global' ? { nivel: 'global' } : {})

/** La operación y sus campos. En `proponer`, `texto` ya leído de su fuente; lo que no cabría se rechaza aquí. */
function peticionDe(a, texto) {
  if (a.sub === 'cuentas') return { op: 'ctx.cuentas', campos: {} }
  if (a.sub === 'tareas') return { op: 'ctx.tareas', campos: {} }
  if (a.sub === 'modelos') return { op: 'ctx.modelos', campos: { agente: a.agente, cuenta: a.cuenta, ...(a.actualizar ? { actualizar: true } : {}) } }
  if (['delegar', 'tarea'].includes(a.sub)) return peticionDelegacion(a, texto)
  if (a.sub === 'reglas') return { op: 'ctx.reglas', campos: {} }
  if (a.sub === 'traspaso') return { op: 'ctx.traspaso', campos: {} }
  if (a.sub === 'buscar') return { op: 'ctx.buscar', campos: { texto: a.texto, exacta: a.exacta === true, ...(a.max !== undefined ? { max: a.max } : {}) } }
  if (a.sub === 'docs') return { op: 'ctx.docs', campos: a.nombre === undefined ? {} : { nombre: a.nombre } }
  if (a.sub === 'config') return { op: 'ctx.config', campos: a.agente === undefined ? {} : { agente: a.agente } }
  if (a.sub === 'config-proponer') return peticionConfig(a, texto)
  const t = textosTctx()
  if (texto.length > MAX_TEXTO_ENVIADO) throw new ErrorTctx(CODIGOS.rechazo, t.propuestaLarga(texto.length, MAX_REGLAS))
  if (a.motivo.length > MAX_MOTIVO_ENVIADO) throw new ErrorTctx(CODIGOS.rechazo, t.motivoLargo(MAX_MOTIVO))
  const campos = { texto, motivo: a.motivo, ...nivelDe(a) }
  // Escapado en JSON, un texto lleno de saltos o de controles crece hasta seis veces.
  if (JSON.stringify(campos).length > MAX_PETICION) throw new ErrorTctx(CODIGOS.rechazo, t.propuestaLarga(texto.length, MAX_REGLAS))
  return { op: 'ctx.proponer', campos }
}

/** Escribe lo que toca de una respuesta ya pasada por `exigirPuente` y devuelve el código de salida. */
const conSalto = (texto) => (texto.endsWith('\n') ? texto : `${texto}\n`)

/**
 * Lo que escribe cada subcomando con una respuesta buena: el texto, o `null` si la respuesta no tiene la
 * forma que se espera.
 */
const SALIDAS = {
  cuentas: (a, r) => Array.isArray(r.cuentas) ? textoCuentas(r.cuentas) : null,
  tareas: (a, r) => Array.isArray(r.tareas) ? textoTareas(r.tareas) : null,
  modelos: (a, r) => Array.isArray(r.modelos) ? textoModelos(r) : null,
  reglas: (a, r, t) => (typeof r.reglas === 'string' ? textoReglas(a, r, t) : null),
  traspaso: (a, r) => (typeof r.traspaso === 'string' ? conSalto(r.traspaso) : null),
  buscar: (a, r) => (Array.isArray(r.coincidencias) ? textoBusqueda(r) : null),
  config: (a, r) => (Array.isArray(r.niveles) ? textoConfig(r) : null),
  'config-proponer': (a, r, t) => `${t.configPropuestaEnviada}\n`,
  docs: (a, r) => {
    if (a.nombre !== undefined) return typeof r.contenido === 'string' ? conSalto(r.contenido) : null
    return Array.isArray(r.documentos) ? textoDocumentos(r) : null
  },
  proponer: (a, r, t) => `${t.propuestaEnviada}\n`
}

function mostrar(a, r) {
  const t = textosTctx()
  if (r.ok !== true) throw errorDeRechazo(r)
  const salida = SALIDAS[a.sub](a, r, t)
  if (salida === null) throw new ErrorTctx(CODIGOS.puente, t.respuestaIncomprensible)
  process.stdout.write(salida)
  return 0
}

const NOMBRE_AGENTE = { 'claude-code': 'Claude Code', codex: 'Codex' }

function peticionConfig(a, texto) {
  const campos = { nivel: a.nivel, texto, motivo: a.motivo, ...(a.agente === undefined ? {} : { agente: a.agente }) }
  if (JSON.stringify(campos).length > MAX_PETICION) throw new ErrorTctx(CODIGOS.rechazo, textosTctx().configLarga(MAX_CONFIG_KIB))
  return { op: 'ctx.config.proponer', campos }
}

/**
 * El resultado de `buscar` en texto: cada coincidencia con su cabecera y su trozo, y las notas de lo que falta.
 * La fecha llega ya en la hora del equipo de Tessera: aquí la zona suele ser otra (un contenedor va en UTC).
 */
function textoBusqueda(r) {
  const t = textosTctx()
  const lineas = []
  const lista = r.coincidencias.filter((c) => c !== null && typeof c === 'object')
  lineas.push(lista.length === 0 ? t.sinCoincidencias : t.cabeceraBusqueda(lista.length), '')
  lista.forEach((c, i) => {
    const agente = NOMBRE_AGENTE[c.agente] || String(c.agente)
    const cuenta = typeof c.cuenta === 'string' ? c.cuenta : t.cuentaNativa
    lineas.push(`${i + 1}. ${String(c.fechaLocal ?? '')} · ${agente} · ${cuenta} · "${String(c.titulo ?? '')}"`)
    lineas.push(`   ${c.rol === 'usuario' ? t.rolUsuario : t.rolAgente}: ${String(c.trozo ?? '')}`, '')
  })
  if (r.hayMas === true) lineas.push(t.hayMas)
  if (r.corte === 'tiempo' || r.corte === 'bytes' || r.corte === 'archivos') lineas.push(t.busquedaCortada)
  const s = r.soloSuCuenta
  if (s && typeof s === 'object') {
    lineas.push(typeof s.cuenta === 'string' && s.agente ? t.soloSuCuenta(`${NOMBRE_AGENTE[s.agente] || s.agente} · ${s.cuenta}`) : t.soloSuCuenta(null))
  }
  while (lineas.length > 0 && lineas[lineas.length - 1] === '') lineas.pop()
  return `${lineas.join('\n')}\n`
}

/**
 * Las reglas vigentes: las globales, si las hay, y las del perfil, cada una con su encabezado. Con un nivel, solo
 * ese y tal cual, sin encabezado: es el texto que se edita y se propone entero.
 */
function textoReglas(a, r, t) {
  const globales = typeof r.reglasGlobales === 'string' ? r.reglasGlobales : ''
  if (a.nivel === 'perfil') return r.reglas === '' ? '' : `${r.reglas}\n`
  if (a.nivel === 'global') return globales === '' ? '' : `${globales}\n`
  if (globales === '') return r.reglas === '' ? `${t.sinReglas}\n` : `${r.reglas}\n`
  const perfil = r.reglas === '' ? t.sinReglasPerfil : r.reglas
  return `${t.encabezadoGlobales}\n${globales}\n\n${t.encabezadoPerfil}\n${perfil}\n\n${t.prevalecePerfil}\n`
}

/** Los niveles de `config`, cada archivo con su contenido entre separadores; uno vacío se dice. */
function textoConfig(r) {
  const t = textosTctx()
  const lineas = [t.cabeceraConfig(NOMBRE_AGENTE[r.agente] || String(r.agente)), '']
  for (const n of r.niveles) {
    for (const archivo of [n.configuracion, n.instrucciones]) {
      if (!archivo || typeof archivo !== 'object') continue
      lineas.push(`=== ${t.nivelConfig[n.nivel] || n.nivel}: ${archivo.nombre} ===`)
      lineas.push(typeof archivo.contenido === 'string' && archivo.contenido.trim() !== '' ? archivo.contenido.trimEnd() : t.archivoVacio, '')
    }
  }
  lineas.push(t.comoProponerConfig)
  return `${lineas.join('\n')}\n`
}

/** La lista de `docs`: un documento por línea, con su tamaño, y las notas de lo que falta. */
function textoDocumentos(r) {
  const t = textosTctx()
  const lista = r.documentos.filter((d) => d !== null && typeof d === 'object' && typeof d.nombre === 'string')
  const lineas = [lista.length === 0 ? t.docsVacia : t.cabeceraDocs(lista.length), '']
  for (const d of lista) lineas.push(`  ${d.nombre}  (${Math.max(1, Math.ceil((Number(d.bytes) || 0) / 1024))} KiB)`)
  if (lista.length > 0) lineas.push('', t.comoLeerDoc)
  if (r.truncado === true) lineas.push(t.docsTruncado)
  if (Array.isArray(r.noDisponibles) && r.noDisponibles.length > 0) lineas.push(t.carpetasNoDisponibles(r.noDisponibles.map(String)))
  return `${lineas.join('\n')}\n`
}

/** El texto de la ayuda, con los códigos de salida y el tope de verdad. */
function textoAyuda() {
  return textosTctx().ayuda(CODIGOS, MAX_REGLAS)
}

function peticionDelegacion(a, texto) {
  let fuente = {}
  if (a.sub === 'delegar' || a.accion === 'continuar') {
    if (a.fuente.tipo === 'ruta') fuente = { archivo: path.resolve(process.cwd(), a.fuente.ruta) }
    else {
      if (!texto.trim()) throw errorDeRechazo({ rechazo: 'orden-vacia' })
      if (Buffer.byteLength(texto, 'utf8') > MAX_ORDEN_BYTES) throw errorDeRechazo({ rechazo: 'orden-larga', max: MAX_ORDEN_BYTES })
      fuente = { orden: texto }
    }
  }
  const ajustes = { ...(a.modelo ? { modelo: a.modelo } : {}), ...(a.esfuerzo ? { esfuerzo: a.esfuerzo } : {}) }
  const peticion =
    a.sub === 'delegar'
      ? { op: 'ctx.delegar', campos: { agente: a.agente, cuenta: a.cuenta, ...(a.soloLectura ? { soloLectura: true } : {}), ...ajustes, ...fuente } }
      : { op: 'ctx.tarea', campos: { id: a.id, ...(a.accion ? { accion: a.accion } : {}), ...ajustes, ...fuente } }
  // Escapada en JSON, una orden llena de saltos o de comillas crece: si ya no cabe en el puente, mejor `--archivo`.
  if (JSON.stringify(peticion.campos).length > MAX_PETICION) throw errorDeRechazo({ rechazo: 'orden-larga', max: MAX_ORDEN_BYTES })
  return peticion
}

const CODIGO_ESTADO = { hecha: 0, fallida: CODIGOS.fallida, cancelada: CODIGOS.cancelada, 'en-marcha': CODIGOS.enMarcha, interrumpida: CODIGOS.interrumpida }
const segundosDesde = (inicio, fin) => Math.max(0, Math.floor((fin - inicio) / 1000))

function horaLocal(instante, ahora = Date.now()) {
  const fecha = new Date(instante)
  const dos = (n) => String(n).padStart(2, '0')
  const hora = `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`
  return fecha.toDateString() === new Date(ahora).toDateString() ? hora : `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())} ${hora}`
}

function textoCuentas(cuentas) {
  const t = textosTctx()
  const lineas = cuentas.map((c) => {
    const ventanas = c.ventanas.map((v) => t.ventanaCuenta(v.etiqueta, v.porcentaje, v.reinicio === undefined ? t.reinicioDesconocido : horaLocal(v.reinicio)))
    return [NOMBRE_AGENTE[c.agente], c.nombre, t.estadosCuenta[c.estado], ...ventanas, ...(c.enMarcha > 0 ? [t.tareasEnMarcha(c.enMarcha)] : [])].join(' · ')
  })
  if (!lineas.length) lineas.push(t.sinCuentas)
  return `${[...lineas, t.comoDelegar].join('\n')}\n`
}

/** «Modelo · esfuerzo» de una tarea, con los dos, uno o ninguno. */
const ajustesDeTarea = (tarea) => [tarea.modelo, tarea.esfuerzo].filter((v) => typeof v === 'string' && v !== '').join(' · ')

/** Las tareas del proyecto, una por línea: lo que permite recuperar un id perdido. */
function textoTareas(tareas, ahora = Date.now()) {
  const t = textosTctx()
  const lista = tareas.filter((x) => x !== null && typeof x === 'object' && typeof x.id === 'string')
  if (!lista.length) return `${t.sinTareas}\n`
  const lineas = lista.map((x) => {
    const ajustes = ajustesDeTarea(x)
    return [x.id, NOMBRE_AGENTE[x.agente] || String(x.agente), String(x.cuenta), t.estadosTarea[x.estado] || String(x.estado), ...(ajustes ? [ajustes] : []), t.haceSegundos(segundosDesde(x.inicio, ahora)), String(x.resumen ?? '')].join(' · ')
  })
  const notas = lista.some((x) => x.estado === 'interrumpida') ? [t.comoReanudar] : []
  return `${[...lineas, ...notas].join('\n')}\n`
}

/** El catálogo de una cuenta y cómo usarlo. */
function textoModelos(r) {
  const t = textosTctx()
  const agente = NOMBRE_AGENTE[r.agente] || String(r.agente)
  const lineas = r.modelos.filter((m) => m !== null && typeof m === 'object' && typeof m.id === 'string').map((m) => {
    const esfuerzos = Array.isArray(m.esfuerzos) && m.esfuerzos.length ? m.esfuerzos.join(', ') : t.sinEsfuerzos
    return `  ${m.id} (${String(m.nombre ?? m.id)}) · ${t.esfuerzosModelo(esfuerzos)}${m.porDefecto === true ? ` · ${t.modeloPorDefecto}` : ''}`
  })
  return `${[t.cabeceraModelos(agente, String(r.cuenta), Number.isFinite(r.leido) ? horaLocal(r.leido) : ''), ...lineas, t.comoUsarModelo(r.agente)].join('\n')}\n`
}

function tareaDe(respuesta) {
  const r = exigirPuente(respuesta)
  if (r.ok !== true) throw errorDeRechazo(r)
  const tarea = r.tarea
  if (!tarea || typeof tarea.id !== 'string' || !Object.hasOwn(CODIGO_ESTADO, tarea.estado) || !Array.isArray(tarea.actividad)) {
    throw new ErrorTctx(CODIGOS.puente, textosTctx().respuestaIncomprensible)
  }
  return tarea
}

function mostrarFinal(tarea) {
  const t = textosTctx()
  if (tarea.estado === 'hecha') process.stdout.write(conSalto(tarea.resultado ?? ''))
  else if (tarea.estado === 'fallida') {
    aviso(`${t.motivosFallo[tarea.motivo] || t.falloDelegado}${tarea.detalle ? `: ${tarea.detalle}` : ''}`)
    if (tarea.actividad.length) process.stderr.write(conSalto(tarea.actividad.join('\n')))
  } else if (tarea.estado === 'cancelada') aviso(tarea.motivo === 'actualizacion' ? t.motivosFallo.actualizacion : t.tareaCancelada(tarea.id))
  else if (tarea.estado === 'interrumpida') aviso(tarea.conversacion ? t.tareaInterrumpida(tarea.id) : t.tareaInterrumpidaSinConversacion)
  return CODIGO_ESTADO[tarea.estado]
}

function mostrarTarea(tarea, ahora = Date.now()) {
  const t = textosTctx()
  const ajustes = ajustesDeTarea(tarea)
  process.stdout.write(`${t.estadoTarea(NOMBRE_AGENTE[tarea.agente], tarea.cuenta, t.estadosTarea[tarea.estado], segundosDesde(tarea.inicio, tarea.fin ?? ahora), segundosDesde(tarea.ultimaActividad, ahora), tarea.soloLectura)}${ajustes ? ` · ${ajustes}` : ''}\n`)
  if (tarea.actividad.length && tarea.estado !== 'fallida') process.stdout.write(conSalto(tarea.actividad.join('\n')))
  return mostrarFinal(tarea)
}

/**
 * Reloj y pausa sustituibles para probar los reintentos sin esperar minutos. Sin `maxMs` no hay tope total; con él, la
 * espera termina con el código de «en marcha» y la tarea sigue, para volver antes del límite de la shell de quien llama.
 */
async function esperarTarea(inicial, consultar, { dormir = (ms) => new Promise((r) => setTimeout(r, ms)), ahora = Date.now, maxMs } = {}) {
  let tarea = inicial
  let fallos = 0
  const comienzo = ahora()
  let ultimoAviso = comienzo
  for (;;) {
    if (tarea.estado !== 'en-marcha') return mostrarFinal(tarea)
    if (maxMs !== undefined && ahora() - comienzo >= maxMs) {
      aviso(textosTctx().tareaSigueEnMarcha(tarea.id))
      return CODIGOS.enMarcha
    }
    await dormir(2000)
    try {
      tarea = tareaDe(await consultar('ctx.tarea', { id: tarea.id }))
      fallos = 0
    } catch (e) {
      if (!(e instanceof ErrorTctx) || e.codigo !== CODIGOS.puente) throw e
      if (++fallos >= 5) throw new ErrorTctx(CODIGOS.puente, textosTctx().tareaSinPuente(tarea.id))
    }
    if (tarea.estado === 'en-marcha' && ahora() - ultimoAviso >= 30_000) {
      aviso(textosTctx().progresoTarea(tarea.id, segundosDesde(tarea.inicio, ahora()), tarea.actividad.at(-1) || ''))
      ultimoAviso = ahora()
    }
  }
}

async function ejecutarDelegacion(a, respuesta, consultar) {
  const tarea = tareaDe(respuesta)
  if (a.accion === 'cancelar') {
    process.stdout.write(`${textosTctx().tareaCancelada(tarea.id)}\n`)
    return 0
  }
  if (a.esperar) return esperarTarea(tarea, consultar, a.maxSegundos ? { maxMs: a.maxSegundos * 1000 } : {})
  if (a.sub === 'tarea' && a.accion !== 'continuar') return mostrarTarea(tarea)
  aviso(textosTctx().tareaLanzada(tarea.id, NOMBRE_AGENTE[tarea.agente], tarea.cuenta))
  if (typeof respuesta.escribiendo === 'number' && respuesta.escribiendo > 0) aviso(textosTctx().otrasEscribiendo(respuesta.escribiendo))
  if (a.sinEsperar) {
    process.stdout.write(`${tarea.id}\n`)
    return 0
  }
  // `ctx.delegar` no incluye el resultado: incluso una tarea ya hecha se consulta una vez.
  return esperarTarea(tarea.estado === 'hecha' ? { ...tarea, estado: 'en-marcha' } : tarea, consultar)
}

module.exports = { exigirPuente, errorDeRechazo, peticionDe, mostrar, textoAyuda, textoBusqueda, textoDocumentos, MAX_REGLAS, MAX_MOTIVO, MAX_PETICION, TOPE_BUSCAR_MS, topeDe, MAX_ORDEN_BYTES, horaLocal, ejecutarDelegacion, esperarTarea, mostrarTarea }
