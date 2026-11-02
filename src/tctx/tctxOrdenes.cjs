// =============================================================================
// Las órdenes de `tctx`, iguales en el equipo y en un contenedor: qué operación se pide al puente
// (`ctx.reglas`, `ctx.proponer`, `ctx.traspaso`, `ctx.buscar`), cómo se lee su respuesta y la ayuda. Solo cambia
// por dónde viaja la petición (el pipe en `tctx.cjs`, el buzón en `tctx-container.cjs`). El perfil y la sesión
// los pone Tessera por el token: aquí no se nombran. Depende de `tctxArgumentos`, `tctxSalida` y `textosTctx`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md, docs/decisiones/agentes/traspaso-entre-agentes.md,
// docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================
'use strict'

const { MAX_TEXTO_BUSCAR } = require('./tctxArgumentos.cjs')
const { CODIGOS, ErrorTctx } = require('./tctxSalida.cjs')
const { textosTctx } = require('./textosTctx.cjs')

/** Lo que se espera a `buscar`: más que el tope de tiempo de la búsqueda en el main (`TOPES_DEFECTO.ms`). */
const TOPE_BUSCAR_MS = 20_000

/** Los topes de `src/shared/reglasPerfil.ts` (`MAX_REGLAS_PERFIL`, `MAX_MOTIVO_PROPUESTA`); los fija `test:tctx`. */
const MAX_REGLAS = 6000
const MAX_MOTIVO = 500
/**
 * Lo que se manda como mucho: más largo, Tessera lo rechazaría igual. `MAX_PETICION` (los campos en JSON)
 * deja sitio al token y a la operación dentro del tope del puente (`MAX_PETICION` de `dbBridge.ts`, 32 KiB).
 */
const MAX_TEXTO_ENVIADO = MAX_REGLAS * 2
const MAX_MOTIVO_ENVIADO = MAX_MOTIVO * 4
const MAX_PETICION = 30 * 1024

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
  vacia: [CODIGOS.rechazo, (t) => t.propuestaVacia],
  larga: [CODIGOS.rechazo, (t, r) => t.propuestaLarga(Number(r.largo) || 0, Number(r.max) || MAX_REGLAS)],
  igual: [CODIGOS.rechazo, (t) => t.propuestaIgual],
  'motivo-largo': [CODIGOS.rechazo, (t, r) => t.motivoLargo(Number(r.max) || MAX_MOTIVO)],
  'sin-traspaso': [CODIGOS.rechazo, (t) => t.sinTraspaso],
  'busqueda-vacia': [CODIGOS.rechazo, (t) => t.faltaBusqueda],
  'busqueda-larga': [CODIGOS.rechazo, (t, r) => t.busquedaLarga(Number(r.max) || MAX_TEXTO_BUSCAR)],
  ocupado: [CODIGOS.rechazo, (t) => t.busquedaOcupada],
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

/** La operación y sus campos. En `proponer`, `texto` ya leído de su fuente; lo que no cabría se rechaza aquí. */
function peticionDe(a, texto) {
  if (a.sub === 'reglas') return { op: 'ctx.reglas', campos: {} }
  if (a.sub === 'traspaso') return { op: 'ctx.traspaso', campos: {} }
  if (a.sub === 'buscar') return { op: 'ctx.buscar', campos: { texto: a.texto, exacta: a.exacta === true, ...(a.max !== undefined ? { max: a.max } : {}) } }
  const t = textosTctx()
  if (texto.length > MAX_TEXTO_ENVIADO) throw new ErrorTctx(CODIGOS.rechazo, t.propuestaLarga(texto.length, MAX_REGLAS))
  if (a.motivo.length > MAX_MOTIVO_ENVIADO) throw new ErrorTctx(CODIGOS.rechazo, t.motivoLargo(MAX_MOTIVO))
  const campos = { texto, motivo: a.motivo }
  // Escapado en JSON, un texto lleno de saltos o de controles crece hasta seis veces.
  if (JSON.stringify(campos).length > MAX_PETICION) throw new ErrorTctx(CODIGOS.rechazo, t.propuestaLarga(texto.length, MAX_REGLAS))
  return { op: 'ctx.proponer', campos }
}

/** Escribe lo que toca de una respuesta ya pasada por `exigirPuente` y devuelve el código de salida. */
function mostrar(a, r) {
  const t = textosTctx()
  if (r.ok !== true) throw errorDeRechazo(r)
  if (a.sub === 'reglas') {
    if (typeof r.reglas !== 'string') throw new ErrorTctx(CODIGOS.puente, t.respuestaIncomprensible)
    process.stdout.write(r.reglas === '' ? `${t.sinReglas}\n` : `${r.reglas}\n`)
    return 0
  }
  if (a.sub === 'traspaso') {
    if (typeof r.traspaso !== 'string') throw new ErrorTctx(CODIGOS.puente, t.respuestaIncomprensible)
    process.stdout.write(r.traspaso.endsWith('\n') ? r.traspaso : `${r.traspaso}\n`)
    return 0
  }
  if (a.sub === 'buscar') {
    if (!Array.isArray(r.coincidencias)) throw new ErrorTctx(CODIGOS.puente, t.respuestaIncomprensible)
    process.stdout.write(textoBusqueda(r))
    return 0
  }
  process.stdout.write(`${t.propuestaEnviada}\n`)
  return 0
}

const NOMBRE_AGENTE = { 'claude-code': 'Claude Code', codex: 'Codex' }

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
    lineas.push(`${i + 1}. ${String(c.fechaLocal ?? '')} · ${agente} · ${cuenta} · «${String(c.titulo ?? '')}»`)
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

/** El texto de la ayuda, con los códigos de salida y el tope de verdad. */
function textoAyuda() {
  return textosTctx().ayuda(CODIGOS, MAX_REGLAS)
}

module.exports = { exigirPuente, peticionDe, mostrar, textoAyuda, textoBusqueda, MAX_REGLAS, MAX_MOTIVO, MAX_PETICION, TOPE_BUSCAR_MS }
