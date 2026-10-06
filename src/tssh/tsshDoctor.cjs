// =============================================================================
// `tssh doctor [alias]`: lo primero cuando `tssh` no funciona o una conexión no conecta. Enseña la entrega
// (atajo, PATH, puente, perfil, cliente SSH, programa de contraseñas) y, con un alias, la conexión y una
// prueba real en modo agente (`exit 0`, 20 s); acaba con UNA frase de qué pasa y qué hacer. Nunca imprime un
// secreto. Depende de `tsshPuente`, `tsshOrdenes`, `tsshEjecutar` y `tsshRutas`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

const path = require('node:path')
const { pedir } = require('./tsshPuente.cjs')
const { ejecutar } = require('./tsshEjecutar.cjs')
const { METODOS, entornoDe, estadoDe, preparar, terminar } = require('./tsshOrdenes.cjs')
const { plataformaDelProceso } = require('./tsshRutas.cjs')
const { CODIGOS, ErrorTssh } = require('./tsshSalida.cjs')

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
  return 'desconocido (invocación directa, sin atajo)'
}

/** Lo que dice el entorno sobre el atajo: cuál, desde qué shell y en qué posición del PATH está su carpeta. */
function pintarEntrega() {
  const atajo = process.env.TESSERA_SHIM || ''
  const segmentos = (process.env.PATH || process.env.Path || '').split(path.delimiter)
  const posicion = atajo ? segmentos.findIndex((s) => mismaCarpeta(s, path.dirname(atajo))) : -1
  console.log('')
  console.log('  tssh doctor')
  console.log('  ' + '─'.repeat(60))
  if (process.env.TESSERA_TSSH_BUZON === '1') {
    // Desde un contenedor no hay atajo ni PATH que mirar: lo lanza Tessera en este equipo.
    fila('entrega', 'contenedor de Docker, por el buzón del puente (ssh corre en este equipo)')
    fila('ejecutable', process.execPath)
    return
  }
  fila('shell', shellDe(atajo))
  fila('ejecutable', process.execPath)
  fila('guion', process.argv[1] || '')
  fila('atajo', atajo || '(invocación directa, sin atajo)')
  fila('atajo en PATH', posicion >= 0 ? `sí (posición ${posicion})` : 'NO')
}

/** El cliente SSH tal como lo ve Tessera. */
function textoCliente(c) {
  if (!c || !c.ssh) return 'NO ENCONTRADO'
  const origen = c.origen === 'git' ? 'el de Git (no se encontró el del sistema)' : 'el del sistema'
  return `${origen}: ${c.ssh}${c.scp ? '' : ' (sin scp: tssh cp no funcionará)'}`
}

/** La credencial de una conexión, sin el secreto. */
function textoCredencial(f) {
  if (f.secreto === 'no-hace-falta') return f.metodo === 'clave' ? 'la clave no tiene frase' : 'claves del sistema'
  if (f.secreto === 'guardado') return f.metodo === 'clave' ? 'frase guardada' : 'contraseña guardada'
  return f.secreto === 'ilegible' ? 'guardada, pero ilegible en este equipo' : 'NO GUARDADA'
}

/** La prueba real de una conexión lista: `exit 0` en modo agente, sin enseñar lo que dice ssh. */
async function probar(alias) {
  const prep = await preparar({ alias, uso: 'doctor' })
  const res = await ejecutar(prep.exe, [...prep.args, 'exit', '0'], { env: entornoDe(prep), topeS: TOPE_PRUEBA_S, silencio: true })
  const fin = await terminar(prep, 'doctor', res)
  if (res.codigo === 0) {
    fila('prueba', `conecta (${res.ms} ms)`)
    veredicto(true, `Todo en orden. Prueba:  tssh run ${/\s/.test(alias) ? `"${alias}"` : alias} -- uptime`)
    return 0
  }
  fila('prueba', res.agotado ? `sin respuesta en ${TOPE_PRUEBA_S} s` : `falla (código ${res.codigo ?? '-'})`)
  veredicto(false, (fin && fin.pista) || (res.agotado ? 'El equipo no contesta: comprueba con el usuario la red o la VPN.' : 'ssh no pudo entrar; el usuario puede pulsar «Probar» en la conexión para ver el motivo.'))
  if (res.agotado) return CODIGOS.tope
  return fin && fin.motivo === 'ssh-huella-cambiada' ? CODIGOS.huella : (res.codigo ?? CODIGOS.noUsable)
}

/** Con un alias: la conexión, lo que le falta y, si nada, la prueba. */
async function doctorDeAlias(d, alias) {
  if (!d.conexion) {
    veredicto(false, d.problema ? d.problema.error : `No hay ninguna conexión disponible llamada «${alias}».`)
    return d.problema ? d.problema.codigo : CODIGOS.alias
  }
  const c = d.conexion
  fila('conexión', `${c.alias}  ${c.usuario}@${c.host}:${c.puerto}  ${METODOS[c.metodo] || c.metodo}`)
  fila('huella', c.huellaConfirmada ? 'confirmada' : 'SIN CONFIRMAR')
  fila('credencial', textoCredencial(c))
  fila('estado', estadoDe(c))
  if (d.problema) {
    veredicto(false, d.problema.error)
    return d.problema.codigo
  }
  return probar(c.alias)
}

/** `tssh doctor [alias]`. */
async function cmdDoctor(a) {
  pintarEntrega()
  let d
  try {
    d = await pedir('ssh.diagnostico', a.alias ? { alias: a.alias } : {})
  } catch (e) {
    fila('puente', 'no responde')
    veredicto(false, e instanceof Error ? e.message : String(e))
    return e instanceof ErrorTssh ? e.codigo : CODIGOS.puente
  }
  fila('puente', 'responde')
  fila('perfil', d.perfil || '?')
  fila('cliente SSH', textoCliente(d.cliente))
  fila('contraseñas', d.contrasenas ? 'Tessera puede darlas' : 'falta el programa de contraseñas de Tessera')
  fila('conexiones', `${d.disponibles} disponibles para los agentes${d.excluidas ? `, ${d.excluidas} más que no lo están` : ''}`)
  if (d.aviso) {
    veredicto(false, `Tessera no puede leer ahora las conexiones SSH de este perfil: ${d.aviso}`)
    return CODIGOS.noUsable
  }
  if (a.alias) return doctorDeAlias(d, a.alias)
  if (!d.cliente || !d.cliente.ssh) {
    veredicto(false, 'No se encontró el cliente SSH del sistema: tssh no puede conectar.')
    return CODIGOS.noUsable
  }
  veredicto(true, d.disponibles > 0 ? 'Todo en orden. Prueba:  tssh ls' : 'Todo en orden, pero este perfil no tiene ninguna conexión disponible para los agentes.')
  return 0
}

module.exports = { cmdDoctor }
