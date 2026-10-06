// =============================================================================
// `tssh ls`, `tssh run` y `tssh cp`: piden a Tessera la lista o la línea de ssh/scp de un alias (nunca un
// secreto), la lanzan y le cuentan cómo acabó, que revoca la ficha del programa de contraseñas, lo apunta y,
// si ssh falló por algo suyo, dice qué decirle al usuario. Depende de `tsshPuente`, `tsshEjecutar`,
// `tsshRutas` y `tsshSalida`; lo usan `tssh.cjs` y `tsshDoctor.cjs`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

const { spawnSync } = require('node:child_process')
const os = require('node:os')
const { pedir } = require('./tsshPuente.cjs')
const { ejecutar, entornoHijo } = require('./tsshEjecutar.cjs')
const { lados, plataformaDelProceso } = require('./tsshRutas.cjs')
const { CODIGOS, ErrorTssh, aviso } = require('./tsshSalida.cjs')

/** Cómo se nombra cada método. */
const METODOS = { contrasena: 'contraseña', clave: 'archivo de clave', sistema: 'claves del sistema' }

/** Si una conexión está lista para usarse, y si no, por qué. */
function estadoDe(f) {
  if (!f.huellaConfirmada) return 'huella sin confirmar'
  if (f.secreto === 'falta') return f.metodo === 'clave' ? 'sin la frase guardada' : 'sin contraseña guardada'
  if (f.secreto === 'ilegible') return 'secreto ilegible aquí'
  return 'lista'
}

/** Las filas en columnas alineadas. */
function tabla(filas) {
  const anchos = filas[0].map((_, i) => Math.max(...filas.map((f) => f[i].length)))
  return filas.map((f) => f.map((c, i) => (i === f.length - 1 ? c : c.padEnd(anchos[i]))).join('  ')).join('\n')
}

/** La línea de las que no están disponibles, sin nombrarlas. */
function lineaExcluidas(n) {
  if (n === 1) return '(1 conexión más de este perfil no está disponible para los agentes)'
  return n > 1 ? `(${n} conexiones más de este perfil no están disponibles para los agentes)` : ''
}

/** `tssh ls`: las conexiones disponibles para los agentes ahora mismo. */
async function cmdLs(a) {
  const r = await pedir('ssh.listar')
  if (a.json) {
    console.log(JSON.stringify({ conexiones: r.conexiones || [], excluidas: r.excluidas || 0, ...(r.aviso ? { aviso: r.aviso } : {}) }))
    return r.aviso ? CODIGOS.noUsable : 0
  }
  if (r.aviso) throw new ErrorTssh(CODIGOS.noUsable, `Tessera no puede leer ahora las conexiones SSH de este perfil: ${r.aviso}`)
  const conexiones = r.conexiones || []
  if (conexiones.length === 0) console.log('Este perfil no tiene ninguna conexión SSH disponible para los agentes.')
  else {
    const filas = conexiones.map((f) => [f.alias, f.grupo || 'Sin grupo', `${f.usuario}@${f.host}:${f.puerto}`, METODOS[f.metodo] || f.metodo, estadoDe(f)])
    console.log(tabla([['ALIAS', 'GRUPO', 'DESTINO', 'MÉTODO', 'ESTADO'], ...filas]))
  }
  const excluidas = lineaExcluidas(r.excluidas || 0)
  if (excluidas) console.log(excluidas)
  return 0
}

/** La línea de ssh o scp que decide Tessera; un «no» sale con su código y su mensaje. */
async function preparar(campos) {
  const r = await pedir('ssh.preparar', campos)
  if (r.ok !== true) throw new ErrorTssh(Number.isInteger(r.codigo) ? r.codigo : CODIGOS.puente, r.error || 'Tessera no pudo preparar la conexión.')
  return r
}

/**
 * ¿Salió ssh por un fallo suyo? Como `esSalidaDeFalloSsh` del main: 255 en las dos plataformas y, en
 * Windows, también -1 / 4294967295 (el `exit(-1)` de un corte, que allí no llega como 255).
 */
function esFalloDeSsh(codigo, plataforma) {
  if (codigo === 255) return true
  return plataforma === 'windows' && (codigo === -1 || codigo === 0xffffffff)
}

/**
 * Le cuenta a Tessera cómo acabó (revoca la ficha y lo apunta); su respuesta trae la pista de un fallo de
 * ssh. La cola (lo último que escribió) solo viaja con un fallo de ssh: es lo único que Tessera clasifica.
 */
async function terminar(prep, sub, res, plataforma = plataformaDelProceso()) {
  try {
    return await pedir('ssh.terminar', {
      ficha: prep.ficha || '',
      alias: prep.alias,
      uso: sub,
      codigo: res.codigo,
      ms: res.ms,
      tope: res.agotado,
      cola: esFalloDeSsh(res.codigo, plataforma) ? res.cola : ''
    })
  } catch {
    // Sin respuesta, la ficha caduca sola en dos minutos; lo que no se sabe es el motivo del fallo.
    return null
  }
}

/** El código con que sale `tssh` tras lanzar ssh o scp, y lo que se avisa. */
async function concluir(prep, sub, res, topeS) {
  const fin = await terminar(prep, sub, res)
  if (res.agotado) {
    aviso(`se agotó el tope de ${topeS} s y se cortó la conexión.`)
    return CODIGOS.tope
  }
  if (res.codigo === null) {
    aviso(`no se pudo lanzar ${sub === 'cp' ? 'scp' : 'ssh'}: ${res.error || 'motivo desconocido'}.`)
    return CODIGOS.noUsable
  }
  if (fin && fin.pista) aviso(fin.pista)
  return fin && fin.motivo === 'ssh-huella-cambiada' ? CODIGOS.huella : res.codigo
}

/**
 * El entorno del ssh o scp lanzado: el de la terminal sin lo que no debe heredar, y lo que da Tessera. El
 * puente heredado (`TESSERA_DB_PIPE`) también fuera: ya viene en `prep.quitarEnv` (`QUITAR_ENV_TSSH` del
 * main) y se repite aquí por si una respuesta no trae la lista. Si el programa de contraseñas lo necesita,
 * Tessera lo vuelve a dar en `prep.env`; si no, ssh no tiene por qué verlo.
 */
function entornoDe(prep) {
  const quitar = Array.isArray(prep.quitarEnv) ? prep.quitarEnv : []
  return entornoHijo(process.env, [...quitar, 'TESSERA_DB_PIPE'], prep.env || {})
}

/** `tssh run`: la orden en el equipo, con su salida en vivo y su código. */
async function cmdRun(a) {
  let prep
  try {
    prep = await preparar({ alias: a.alias, uso: 'run', entrada: a.entrada })
  } catch (e) {
    // `tssh run nas casa -- …` sin comillas busca «nas»: el alias con espacios va entre comillas.
    if (e instanceof ErrorTssh && e.codigo === CODIGOS.alias && a.orden.includes('--')) e.message += ' Si el alias lleva espacios, ponlo entre comillas.'
    throw e
  }
  const res = await ejecutar(prep.exe, [...prep.args, ...a.orden], { env: entornoDe(prep), entrada: a.entrada, topeS: a.tope })
  return concluir(prep, 'run', res, a.tope)
}

/** Una ruta del shell de Git que no es de una unidad (`/tmp`, `/home`…), traducida por su `cygpath`. */
function cygpathW(ruta) {
  const r = spawnSync('cygpath', ['-w', ruta], { encoding: 'utf8', timeout: 5000, windowsHide: true })
  return r.status === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : null
}

/** `tssh cp`: copia con scp entre este equipo y una conexión; la ruta local, absoluta. */
async function cmdCp(a) {
  const plataforma = plataformaDelProceso()
  const l = lados(a.origen, a.destino, { plataforma, cwd: process.cwd(), casa: os.homedir(), cygpath: plataforma === 'windows' ? cygpathW : null })
  const prep = await preparar({ alias: l.alias, uso: 'cp', recursivo: a.recursivo })
  const remoto = `${prep.host}:${l.rutaRemota}`
  const args = [...prep.args, '--', l.subida ? l.local : remoto, l.subida ? remoto : l.local]
  const res = await ejecutar(prep.exe, args, { env: entornoDe(prep), entrada: false, topeS: null })
  return concluir(prep, 'cp', res, null)
}

module.exports = { cmdLs, cmdRun, cmdCp, preparar, terminar, entornoDe, estadoDe, METODOS }
