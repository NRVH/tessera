// =============================================================================
// `tssh ls`, `tssh run` y `tssh cp`: piden a Tessera la lista o la línea de ssh/scp de un alias (nunca un
// secreto), la lanzan y le cuentan cómo acabó, que revoca la ficha del programa de contraseñas, lo apunta y,
// si ssh falló por algo suyo, dice qué decirle al usuario. Depende de `tsshPuente`, `tsshEjecutar`,
// `tsshRutas`, `tsshSalida` y `textosTssh`; lo usan `tssh.cjs` y `tsshDoctor.cjs`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pedir } = require('./tsshPuente.cjs')
const { ejecutar, entornoHijo } = require('./tsshEjecutar.cjs')
const { lados, plataformaDelProceso } = require('./tsshRutas.cjs')
const { CODIGOS, ErrorTssh, aviso, carpetasDelEquipo, paraContenedor } = require('./tsshSalida.cjs')
const { textosTssh } = require('./textosTssh.cjs')

/** Cómo se nombra un método, o el método tal cual si no se conoce. */
function nombreMetodo(metodo) {
  return textosTssh().metodos[metodo] || metodo
}

/** Si una conexión está lista para usarse, y si no, por qué. */
function estadoDe(f) {
  const t = textosTssh()
  if (!f.huellaConfirmada) return t.huellaSinConfirmar
  if (f.secreto === 'falta') return f.metodo === 'clave' ? t.sinFraseGuardada : t.sinContrasenaGuardada
  if (f.secreto === 'ilegible') return t.secretoIlegibleAqui
  return t.lista
}

/** Las filas en columnas alineadas. */
function tabla(filas) {
  const anchos = filas[0].map((_, i) => Math.max(...filas.map((f) => f[i].length)))
  return filas.map((f) => f.map((c, i) => (i === f.length - 1 ? c : c.padEnd(anchos[i]))).join('  ')).join('\n')
}

/** `tssh ls`: las conexiones disponibles para los agentes ahora mismo. */
async function cmdLs(a) {
  const r = await pedir('ssh.listar')
  if (a.json) {
    console.log(JSON.stringify({ conexiones: r.conexiones || [], excluidas: r.excluidas || 0, ...(r.aviso ? { aviso: r.aviso } : {}) }))
    return r.aviso ? CODIGOS.noUsable : 0
  }
  const t = textosTssh()
  if (r.aviso) throw new ErrorTssh(CODIGOS.noUsable, t.noPuedeLeerConexiones(r.aviso))
  const conexiones = r.conexiones || []
  if (conexiones.length === 0) console.log(t.sinConexiones)
  else {
    const filas = conexiones.map((f) => [f.alias, f.grupo || t.sinGrupo, `${f.usuario}@${f.host}:${f.puerto}`, nombreMetodo(f.metodo), estadoDe(f)])
    console.log(tabla([t.columnasLs, ...filas]))
  }
  // La línea de las que no están disponibles, sin nombrarlas.
  const excluidas = t.excluidas(r.excluidas || 0)
  if (excluidas) console.log(excluidas)
  return 0
}

/** La línea de ssh o scp que decide Tessera; un «no» sale con su código y su mensaje. */
async function preparar(campos) {
  const r = await pedir('ssh.preparar', campos)
  if (r.ok !== true) throw new ErrorTssh(Number.isInteger(r.codigo) ? r.codigo : CODIGOS.puente, r.error || textosTssh().noPudoPreparar)
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
  const t = textosTssh()
  if (res.agotado) {
    aviso(t.topeAgotado(topeS))
    return CODIGOS.tope
  }
  if (res.codigo === null) {
    aviso(t.noSePudoLanzar(sub === 'cp' ? 'scp' : 'ssh', res.error || t.motivoDesconocido))
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

/** Tope de lo que se lee de una configuración de los saltos: Tessera escribe unas pocas líneas por bastión. */
const MAX_CONFIG_SALTOS = 256 * 1024

/**
 * Las rutas citadas en `s`, ya sin citar: entre comillas dobles (`\"`, `\\` y `%%` como los lee ssh) o
 * simples, como cita un `ProxyCommand` para `/bin/sh` (`'\''` es la comilla).
 */
function rutasCitadas(s) {
  const r = []
  for (const m of s.matchAll(/"((?:[^"\\]|\\.)*)"/g)) r.push(m[1].replace(/\\(["\\])/g, '$1').replace(/%%/g, '%'))
  for (const m of s.matchAll(/'((?:[^']|'\\'')*)'/g)) r.push(m[1].replace(/'\\''/g, "'").replace(/%%/g, '%'))
  return r
}

/** Las configuraciones de los saltos que nombra un `ProxyCommand` de `s` (`-F` y la ruta citada). */
function configsDeSaltos(s) {
  const r = []
  for (const m of s.matchAll(/(?:^|\s)-F\s+("(?:[^"\\]|\\.)*"|'(?:[^']|'\\'')*')/g)) r.push(...rutasCitadas(m[1]))
  return r.filter((c) => c.endsWith('.conf'))
}

/** Las líneas de una configuración de los saltos, o ninguna si no se deja leer o no es suya. */
function lineasDeConfig(ruta) {
  try {
    const st = fs.statSync(ruta)
    return st.isFile() && st.size <= MAX_CONFIG_SALTOS ? fs.readFileSync(ruta, 'utf8').split(/\r?\n/).map((l) => l.trim()) : []
  } catch {
    return []
  }
}

/**
 * Lo que ssh lee de la línea que dio Tessera: sus argumentos y, por cada `ProxyCommand`, las líneas de la
 * configuración de los saltos (la huella, la clave y el siguiente salto de cada bastión). Solo de `prep`,
 * que viene del host: la ruta local de `cp` no decide qué se lee.
 */
function textosDeLaLinea(prep) {
  const textos = [prep.exe, ...(Array.isArray(prep.args) ? prep.args : [])].map((a) => String(a || ''))
  const leidas = new Set()
  for (let i = 0; i < textos.length; i++) {
    for (const conf of configsDeSaltos(textos[i])) {
      if (leidas.has(conf)) continue
      leidas.add(conf)
      textos.push(...lineasDeConfig(conf))
    }
  }
  return textos
}

/**
 * Para un contenedor, las carpetas de lo que Tessera le da a ssh o scp que cuelgan de las del usuario: el
 * programa, las huellas y la clave (también las de cada bastión, en la configuración de los saltos), esa
 * configuración, el programa de contraseñas y lo demás de `prep.env`, y la ruta local de `cp`. ssh las repite
 * en sus avisos. Solo esas, y no las del usuario enteras, porque la misma salida de errores trae la de la
 * orden remota. Sin contenedor, ninguna.
 */
function carpetasDeLaLinea(prep, extra = [], plataforma = plataformaDelProceso(), delEquipo = carpetasDelEquipo(plataforma)) {
  if (!paraContenedor()) return []
  const ruta = plataforma === 'windows' ? path.win32 : path.posix
  const clave = (r) => r.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const delUsuario = delEquipo.map(clave).filter((c) => c.length > 2)
  const dentro = (r) => delUsuario.some((c) => clave(r).startsWith(c + '/'))
  const archivos = extra.map((a) => String(a || ''))
  const carpetas = []
  for (const s of textosDeLaLinea(prep)) archivos.push(...rutasCitadas(s), s.replace(/^[A-Za-z]+=/, ''))
  for (const [k, v] of Object.entries(prep.env || {})) {
    if (typeof v !== 'string') continue
    if (k.toUpperCase() === 'PATH') carpetas.push(...v.split(plataforma === 'windows' ? ';' : ':'))
    else archivos.push(v)
  }
  return [...new Set([...archivos.filter(dentro).map((r) => ruta.dirname(r)), ...carpetas.filter(dentro)])]
}

/** `tssh run`: la orden en el equipo, con su salida en vivo y su código. */
async function cmdRun(a) {
  let prep
  try {
    prep = await preparar({ alias: a.alias, uso: 'run', entrada: a.entrada })
  } catch (e) {
    // `tssh run nas casa -- …` sin comillas busca «nas»: el alias con espacios va entre comillas.
    if (e instanceof ErrorTssh && e.codigo === CODIGOS.alias && a.orden.includes('--')) e.message += textosTssh().aliasConEspacios
    throw e
  }
  const res = await ejecutar(prep.exe, [...prep.args, ...a.orden], { env: entornoDe(prep), entrada: a.entrada, topeS: a.tope, ocultar: carpetasDeLaLinea(prep) })
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
  const res = await ejecutar(prep.exe, args, { env: entornoDe(prep), entrada: false, topeS: null, ocultar: carpetasDeLaLinea(prep, [l.local], plataforma) })
  return concluir(prep, 'cp', res, null)
}

module.exports = { cmdLs, cmdRun, cmdCp, preparar, terminar, entornoDe, estadoDe, nombreMetodo, carpetasDeLaLinea }
