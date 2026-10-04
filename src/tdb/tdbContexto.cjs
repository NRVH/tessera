// =============================================================================
// El contexto de una invocación de `tdb`: perfil, registro, ámbito y secretos, leídos del
// entorno de la terminal de Tessera y, si hay puente, de su respuesta (que manda).
// Depende de `tdbRegistro`, `tdbConexiones`, `tdbPuente` y `tdbSalida`; lo usa `tdb.cjs`.
// Decisiones: docs/decisiones/bd/puente-punto-de-escucha-y-concesiones.md
// =============================================================================
'use strict'

const path = require('node:path')
const { fallar } = require('./tdbSalida.cjs')
const { leerJson, leerRegistroConexiones } = require('./tdbRegistro.cjs')
const { marcarIdsRepetidos } = require('./tdbConexiones.cjs')
const { pedirAlPuente } = require('./tdbPuente.cjs')

const ENV_PERFIL = 'TESSERA_PROFILE'
const ENV_REGISTRO = 'TESSERA_DB_REGISTRY'
const ENV_DRIVERS = 'TESSERA_DB_DRIVERS'
const ENV_SCOPE = 'TESSERA_DB_SCOPE'
/**
 * Marca INFORMATIVA del espacio de datos ('1'). Respaldo de `espacioDatos` en la
 * respuesta del puente; solo elige la redacción. DEBE coincidir con `ENV_ESPACIO` de
 * `src/shared/db-ipc.ts`.
 */
const ENV_ESPACIO = 'TESSERA_DB_ESPACIO'
/**
 * Contrato del PUENTE LOCAL. Con estas tres, `tdb` no lee los secretos del entorno:
 * se los pide a Tessera en el momento de ejecutarse, junto con el ámbito VIGENTE.
 * Eso es lo que hace que montar o desmontar una base aplique sin reiniciar nada.
 */
const ENV_PIPE = 'TESSERA_DB_PIPE'
const ENV_SESION = 'TESSERA_DB_SESSION'
const ENV_MODO = 'TESSERA_DB_MODE'

const MENSAJE_SIN_CONTEXTO =
  'Esta terminal no lleva el contexto de bases de datos de Tessera.\n' +
  '    Suele ser una de estas dos:\n' +
  '      - La terminal se abrió ANTES de montar la base. Pulsa "Recargar" en la\n' +
  '        terminal de abajo, o "Reiniciar" en la cabecera del agente.\n' +
  '      - No es una terminal de Tessera en modo Windows (una consola suelta, o\n' +
  '        un proyecto en modo Docker).\n' +
  '\n' +
  '    Diagnóstico completo:  tdb doctor'

/**
 * Las conexiones del registro como las lee el main y las de ESTE perfil. Solo objetos (el
 * main conserva tal cual lo que no entiende); las copias con el id de otra se marcan sobre
 * TODAS, en el orden del archivo, antes de filtrar por perfil. La MISMA marca `formatoAjeno`
 * para un formato ajeno y para un registro ilegible: el porqué va en `avisoRegistro`.
 */
function leerConexiones(registro, perfil) {
  const { doc, aviso, origen } = registro
    ? leerRegistroConexiones(registro)
    : { doc: { connections: [] }, aviso: null, origen: 'ninguno' }
  const formatoAjeno = aviso !== null
  const todas =
    !formatoAjeno && doc && Array.isArray(doc.connections)
      ? doc.connections.filter((c) => c !== null && typeof c === 'object')
      : []
  marcarIdsRepetidos(todas)
  const delPerfil = perfil ? todas.filter((c) => c.profileId === perfil) : todas
  return { delPerfil, formatoAjeno, avisoRegistro: aviso, origenRegistro: origen }
}

/**
 * El ámbito, la marca del espacio de datos y los secretos. EL PUENTE MANDA sobre el entorno:
 * el entorno se fijó al arrancar el pty y la respuesta del puente es de hace un milisegundo.
 * En modo puente NO hay secretos en el entorno. `huellas` es la del destino de cada uno
 * (`null` = el puente no las mandó). Ámbito ausente = todas las del perfil; definido pero
 * vacío = ninguna, que NO es lo mismo. `espacioDatos` solo elige cómo se NOMBRA el sitio en
 * los mensajes; estricto con el '1', y el puente solo lo cambia si trae el campo.
 */
async function entornoDelPuente() {
  const entorno = {
    scope: process.env[ENV_SCOPE],
    scopeDefinido: process.env[ENV_SCOPE] !== undefined,
    espacioDatos: process.env[ENV_ESPACIO] === '1',
    secretos: null,
    huellas: null,
    puente: 'sin puente'
  }
  const pipe = process.env[ENV_PIPE]
  const sesion = process.env[ENV_SESION]
  if (pipe && sesion) {
    const r = await pedirAlPuente(pipe, sesion)
    if (r) {
      entorno.secretos = r.secretos || {}
      entorno.huellas = r.huellas && typeof r.huellas === 'object' ? r.huellas : null
      entorno.scopeDefinido = !r.consola
      entorno.scope = (r.scope || []).join(',')
      if (typeof r.espacioDatos === 'boolean') entorno.espacioDatos = r.espacioDatos
      entorno.puente = 'vivo'
    } else {
      // Se sigue con el entorno, que puede traer un ámbito viejo y ningún secreto: peor que
      // funcionar, pero mejor que colgarse, y el aviso sale por `doctor`.
      entorno.puente = 'no responde'
    }
  } else if (process.env[ENV_MODO] === 'pipe') {
    entorno.puente = 'esperado pero sin datos en el entorno'
  }
  return entorno
}

/**
 * Reúne todo lo que `tdb` necesita saber. Con `{ tolerante: true }` no falla aunque no haya
 * contexto ninguno: lo usa `doctor`, cuyo trabajo es explicar por qué falta. `{ json }` es el
 * modo de salida, que va en el `ctx` devuelto.
 */
async function contexto(opciones) {
  const tolerante = Boolean(opciones && opciones.tolerante)
  const registro = process.env[ENV_REGISTRO]
  const json = Boolean(opciones && opciones.json)
  if (!registro && !tolerante) fallar({ json }, MENSAJE_SIN_CONTEXTO)
  const driversDir = process.env[ENV_DRIVERS] || ''
  const catalogo = driversDir
    ? leerJson(path.join(driversDir, 'catalogo.json'), { packs: [], externos: {} })
    : { packs: [], externos: {} }
  const perfil = process.env[ENV_PERFIL] || ''
  const { delPerfil, formatoAjeno, avisoRegistro, origenRegistro } = leerConexiones(registro, perfil)
  const { scope, scopeDefinido, espacioDatos, secretos, huellas, puente } = await entornoDelPuente()

  let visibles = delPerfil
  if (scopeDefinido) {
    const permitidos = new Set(String(scope || '').split(',').filter(Boolean))
    visibles = delPerfil.filter((c) => permitidos.has(c.id))
  }
  return {
    // El modo de salida de toda la invocación (`--json` o texto): lo leen los `cmd*` y `fallar`.
    json,
    perfil,
    registro: registro || '',
    conexiones: visibles,
    secretos,
    huellas,
    puente,
    // Las del perfil ENTERO, para poder decir "hay 4 en este perfil, 0 montadas aquí".
    delPerfil,
    // Sin conexiones que ver (formato ajeno o ilegible): `avisoRegistro` es lo que se dice.
    formatoAjeno,
    avisoRegistro,
    // De qué archivo salió lo que se ve: `principal`, `respaldo` (el `.bak`) o `ninguno`.
    origenRegistro,
    scopeDefinido,
    espacioDatos,
    driversDir,
    packs: catalogo.packs || [],
    externos: catalogo.externos || {},
    usuarioWindows: process.env.USERNAME || process.env.USER || 'tessera',
    accion: 'query'
  }
}

module.exports = { contexto, ENV_DRIVERS }
