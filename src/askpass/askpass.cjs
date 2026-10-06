// =============================================================================
// Programa de contraseñas (SSH_ASKPASS) de Tessera en macOS y demás: ssh lo lanza, vía el lanzador `sh` que
// arranca Tessera como Node, con la pregunta del servidor. Se la pasa a Tessera por el puente local
// (TESSERA_DB_PIPE) con la ficha de esa sesión (TESSERA_SSH_TOKEN) y escribe la respuesta en stdout; si
// Tessera no contesta, sale con 1, que ssh toma como cancelar. Mismo protocolo que el `.exe` de Windows.
// Node a secas, sin dependencias.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================
'use strict'

const net = require('node:net')

// Fija y sin el texto del servidor: lo que este escriba no llega a la terminal por aquí.
const MENSAJE_NO = 'Tessera no contesta esa pregunta del servidor; reconecta escribiendo en la terminal'
const TOPE_MS = 5000
const MAX_RESPUESTA = 64 * 1024

/** Sale escribiendo antes: en macOS la salida a una tubería es asíncrona y `exit` la cortaría. */
function salir(flujo, texto, codigo) {
  flujo.write(texto, () => process.exit(codigo))
}

/** El secreto de la respuesta afirmativa del puente, o `null` con cualquier otra cosa. */
function respuestaDe(linea) {
  try {
    const r = JSON.parse(linea)
    return r && r.ok === true && typeof r.respuesta === 'string' ? r.respuesta : null
  } catch {
    return null
  }
}

/** Pregunta al puente y llama a `fin` una sola vez con el secreto o con `null`. */
function preguntar(prompt, fin) {
  const pipe = process.env.TESSERA_DB_PIPE
  const token = process.env.TESSERA_SSH_TOKEN
  if (!pipe || !token) return fin(null)
  const socket = net.connect(pipe)
  let terminado = false
  const acabar = (valor) => {
    if (terminado) return
    terminado = true
    socket.destroy()
    fin(valor)
  }
  let leido = ''
  socket.setTimeout(TOPE_MS, () => acabar(null))
  socket.on('error', () => acabar(null))
  socket.on('connect', () => socket.write(JSON.stringify({ v: 1, token, op: 'ssh.askpass', prompt }) + '\n'))
  socket.on('data', (trozo) => {
    leido += trozo.toString('utf-8')
    const corte = leido.indexOf('\n')
    if (corte >= 0) acabar(respuestaDe(leido.slice(0, corte)))
    else if (leido.length > MAX_RESPUESTA) acabar(null)
  })
  socket.on('end', () => acabar(null))
}

preguntar(process.argv[2] ?? '', (secreto) => {
  if (secreto === null) salir(process.stderr, MENSAJE_NO + '\n', 1)
  else salir(process.stdout, secreto + '\n', 0)
})
