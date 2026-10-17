// =============================================================================
// `tssh doctor [alias]`: lo primero cuando `tssh` no funciona o una conexión no conecta. Enseña la entrega
// (atajo, PATH, puente, perfil, cliente SSH, programa de contraseñas) y, con un alias, la conexión y una
// prueba real en modo agente (`exit 0`, 20 s); acaba con UNA frase de qué pasa y qué hacer. Nunca imprime un
// secreto. Depende de `tsshPuente`, `tsshOrdenes`, `tsshEjecutar`, `tsshRutas` y `textosTssh`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

const path = require('node:path')
const { pedir } = require('./tsshPuente.cjs')
const { ejecutar } = require('./tsshEjecutar.cjs')
const { entornoDe, estadoDe, nombreMetodo, preparar, terminar } = require('./tsshOrdenes.cjs')
const { plataformaDelProceso } = require('./tsshRutas.cjs')
const { CODIGOS, ErrorTssh } = require('./tsshSalida.cjs')
const { textosTssh } = require('./textosTssh.cjs')

/** El tope de la prueba: ssh ya corta a los 10 s si no llega (`ConnectTimeout`). */
const TOPE_PRUEBA_S = 20

function fila(etiqueta, valor) {
  console.log('  ' + String(etiqueta).padEnd(16) + valor)
}

/** El veredicto final, con su marca. */
function veredicto(bien, texto) {
  console.log('')
  console.log(`  ${bien ? '✓' : '✗'} ${texto}`)
  console.log('')
}

/** ¿Son la misma carpeta? Con `path.win32` también en macOS: solo es una clave de comparación. */
function mismaCarpeta(a, b) {
  const limpiar = (s) => path.win32.normalize(String(s).trim()).toLowerCase().replace(/[/\\]+$/, '')
  return Boolean(a) && Boolean(b) && limpiar(a) === limpiar(b)
}

/** El shell, por el atajo que se usó (el atajo sin extensión es el de sh). */
function shellDe(atajo) {
  const a = String(atajo || '').toLowerCase()
  if (a.endsWith('.ps1')) return 'PowerShell'
  if (a.endsWith('.cmd')) return 'cmd.exe'
  if (a) return plataformaDelProceso() === 'windows' ? 'sh (Git Bash / MSYS)' : 'sh'
  return textosTssh().shellDesconocido
}

/** Lo que dice el entorno sobre el atajo: cuál, desde qué shell y en qué posición del PATH está su carpeta. */
function pintarEntrega() {
  const t = textosTssh()
  const e = t.etiquetas
  const atajo = process.env.TESSERA_SHIM || ''
  const segmentos = (process.env.PATH || process.env.Path || '').split(path.delimiter)
  const posicion = atajo ? segmentos.findIndex((s) => mismaCarpeta(s, path.dirname(atajo))) : -1
  console.log('')
  console.log('  tssh doctor')
  console.log('  ' + '─'.repeat(60))
  if (process.env.TESSERA_TSSH_BUZON === '1') {
    // Desde un contenedor no hay atajo ni PATH que mirar: lo lanza Tessera en este equipo.
    fila(e.entrega, t.entregaContenedor)
    fila(e.ejecutable, process.execPath)
    return
  }
  fila(e.shell, shellDe(atajo))
  fila(e.ejecutable, process.execPath)
  fila(e.guion, process.argv[1] || '')
  fila(e.atajo, atajo || t.sinAtajo)
  fila(e.atajoEnPath, posicion >= 0 ? t.enPath(posicion) : t.noEnPath)
}

/** El cliente SSH tal como lo ve Tessera. */
function textoCliente(c) {
  const t = textosTssh()
  if (!c || !c.ssh) return t.clienteNoEncontrado
  const origen = c.origen === 'git' ? t.clienteDeGit : t.clienteDelSistema
  return `${origen}: ${c.ssh}${c.scp ? '' : t.sinScp}`
}

/** La credencial de una conexión, sin el secreto. */
function textoCredencial(f) {
  const t = textosTssh()
  if (f.secreto === 'no-hace-falta') return f.metodo === 'clave' ? t.claveSinFrase : t.clavesDelSistema
  if (f.secreto === 'guardado') return f.metodo === 'clave' ? t.fraseGuardada : t.contrasenaGuardada
  return f.secreto === 'ilegible' ? t.guardadaIlegible : t.noGuardada
}

/** La prueba real de una conexión lista: `exit 0` en modo agente, sin enseñar lo que dice ssh. */
async function probar(alias) {
  const t = textosTssh()
  const prep = await preparar({ alias, uso: 'doctor' })
  const res = await ejecutar(prep.exe, [...prep.args, 'exit', '0'], { env: entornoDe(prep), topeS: TOPE_PRUEBA_S, silencio: true })
  const fin = await terminar(prep, 'doctor', res)
  if (res.codigo === 0) {
    fila(t.etiquetas.prueba, t.conecta(res.ms))
    veredicto(true, t.todoBienRun(/\s/.test(alias) ? `"${alias}"` : alias))
    return 0
  }
  fila(t.etiquetas.prueba, res.agotado ? t.pruebaSinRespuesta(TOPE_PRUEBA_S) : t.pruebaFalla(res.codigo ?? '-'))
  veredicto(false, (fin && fin.pista) || (res.agotado ? t.equipoNoContesta : t.sshNoEntro))
  if (res.agotado) return CODIGOS.tope
  return fin && fin.motivo === 'ssh-huella-cambiada' ? CODIGOS.huella : (res.codigo ?? CODIGOS.noUsable)
}

/** Con un alias: la conexión, lo que le falta y, si nada, la prueba. */
async function doctorDeAlias(d, alias) {
  const t = textosTssh()
  const e = t.etiquetas
  if (!d.conexion) {
    veredicto(false, d.problema ? d.problema.error : t.noHayAlias(alias))
    return d.problema ? d.problema.codigo : CODIGOS.alias
  }
  const c = d.conexion
  fila(e.conexion, `${c.alias}  ${c.usuario}@${c.host}:${c.puerto}  ${nombreMetodo(c.metodo)}`)
  fila(e.huella, c.huellaConfirmada ? t.huellaConfirmada : t.huellaPorConfirmar)
  fila(e.credencial, textoCredencial(c))
  fila(e.estado, estadoDe(c))
  if (d.problema) {
    veredicto(false, d.problema.error)
    return d.problema.codigo
  }
  return probar(c.alias)
}

/** `tssh doctor [alias]`. */
async function cmdDoctor(a) {
  const t = textosTssh()
  const e = t.etiquetas
  pintarEntrega()
  let d
  try {
    d = await pedir('ssh.diagnostico', a.alias ? { alias: a.alias } : {})
  } catch (err) {
    fila(e.puente, t.puenteNoResponde)
    veredicto(false, err instanceof Error ? err.message : String(err))
    return err instanceof ErrorTssh ? err.codigo : CODIGOS.puente
  }
  fila(e.puente, t.puenteResponde)
  fila(e.perfil, d.perfil || '?')
  fila(e.clienteSsh, textoCliente(d.cliente))
  fila(e.contrasenas, d.contrasenas ? t.contrasenasSi : t.contrasenasNo)
  fila(e.conexiones, t.conexionesDisponibles(d.disponibles, d.excluidas))
  if (d.aviso) {
    veredicto(false, t.noPuedeLeerConexiones(d.aviso))
    return CODIGOS.noUsable
  }
  if (a.alias) return doctorDeAlias(d, a.alias)
  if (!d.cliente || !d.cliente.ssh) {
    veredicto(false, t.sinClienteSsh)
    return CODIGOS.noUsable
  }
  veredicto(true, d.disponibles > 0 ? t.todoBienLs : t.todoBienSinConexiones)
  return 0
}

module.exports = { cmdDoctor }
