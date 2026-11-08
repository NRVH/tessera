// =============================================================================
// Socket SSH del contenedor: transporta identidades y firmas al host por su buzón.
// Encuadra y limita las peticiones autenticadas para ofrecer el agente SSH sin alojar claves privadas.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
'use strict'
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createHash, randomUUID } = require('node:crypto')
const buzon = process.env.TESSERA_DB_BRIDGE || '/agent-config/dbbridge'
const token = process.env.TESSERA_DB_SESSION || ''
const socket = '/tmp/tessera-ssh-' + createHash('sha256').update(token).digest('hex').slice(0, 24) + '.sock'
const tope = 256 * 1024
const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms))

async function preguntar(campos) {
  if (!token || Date.now() - fs.statSync(path.join(buzon, '.alive')).mtimeMs > 120000) throw new Error('SSH')
  const id = randomUUID()
  const peticion = path.join(buzon, id + '.req.json')
  const respuesta = path.join(buzon, id + '.res.json')
  const temporal = peticion + '.tmp'
  fs.writeFileSync(temporal, JSON.stringify({ v: 1, prog: 'ssh-agente', token, ...campos }), { flag: 'wx', mode: 0o600 })
  fs.renameSync(temporal, peticion)
  try {
    const inicio = Date.now()
    while (Date.now() - inicio < 125000) {
      try {
        const texto = fs.readFileSync(respuesta, 'utf8')
        if (texto.length > 2 * 1024 * 1024) throw new Error('SSH')
        return JSON.parse(texto)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await dormir(50)
    }
    throw new Error('SSH')
  } finally {
    fs.rmSync(peticion, { force: true })
    fs.rmSync(respuesta, { force: true })
  }
}

function enmarcar(datos) {
  if (!datos.length || datos.length > tope) throw new Error('SSH')
  const cabecera = Buffer.alloc(4)
  cabecera.writeUInt32BE(datos.length)
  return Buffer.concat([cabecera, datos])
}

function extraerTrama(acumulado) {
  if (acumulado.length < 4) return null
  const longitud = acumulado.readUInt32BE()
  if (!longitud || longitud > tope) throw new Error('SSH')
  if (acumulado.length < longitud + 4) return null
  return { mensaje: acumulado.subarray(4, longitud + 4), resto: acumulado.subarray(longitud + 4) }
}

function servir() {
  let conexiones = 0
  const servidor = net.createServer((cliente) => {
    if (++conexiones > 32) { conexiones--; cliente.destroy(); return }
    cliente.once('close', () => conexiones--)
    cliente.on('error', () => {})
    cliente.setTimeout(130000, () => cliente.destroy())
    let acumulado = Buffer.alloc(0)
    let ocupado = false
    async function procesar() {
      if (ocupado) return
      ocupado = true
      try {
        while (!cliente.destroyed) {
          const trama = extraerTrama(acumulado)
          if (!trama) break
          const mensaje = trama.mensaje
          acumulado = trama.resto
          let respuesta = Buffer.from([5])
          try {
            if (mensaje[0] === 11 || mensaje[0] === 13) {
              const resultado = await preguntar({ mensaje: mensaje.toString('base64') })
              if (resultado.exitCode === 0 && typeof resultado.respuesta === 'string') respuesta = Buffer.from(resultado.respuesta, 'base64')
            }
          } catch { /* El protocolo solo admite fallo; no revela errores internos del host. */ }
          if (!cliente.destroyed) cliente.write(enmarcar(respuesta))
        }
      } catch { cliente.destroy() }
      finally { ocupado = false }
    }
    cliente.on('data', (datos) => {
      acumulado = Buffer.concat([acumulado, datos])
      if (acumulado.length > tope + 4) { cliente.destroy(); return }
      void procesar()
    })
  })
  servidor.on('error', () => process.exit(1))
  servidor.listen(socket, () => fs.chmodSync(socket, 0o600))
  // Un token revocado se recoge con el contenedor; el centinela evita procesos huérfanos sin host.
  setInterval(() => {
    try { if (Date.now() - fs.statSync(path.join(buzon, '.alive')).mtimeMs < 120000) return } catch { /* El host cerró el buzón. */ }
    servidor.close()
    process.exit(0)
  }, 30000).unref()
}

async function disponible() {
  return new Promise((resolver) => {
    const cliente = net.connect(socket)
    cliente.once('connect', () => { cliente.destroy(); resolver(true) })
    cliente.once('error', () => resolver(false))
    cliente.setTimeout(1000, () => { cliente.destroy(); resolver(false) })
  })
}

async function preparar() {
  const material = await preguntar({ operacion: 'material' })
  if (material.exitCode !== 0) throw new Error('SSH')
  const carpeta = '/home/agente/.ssh'
  fs.mkdirSync(carpeta, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(carpeta, 'config'), material.config, { mode: 0o600 })
  for (const publica of material.publicas) {
    if (!/^[a-f0-9]{64}\.pub$/.test(publica.nombre)) throw new Error('SSH')
    fs.writeFileSync(path.join(carpeta, publica.nombre), publica.texto, { mode: 0o600 })
  }
  const conocidas = path.join(carpeta, 'known_hosts')
  if (!fs.existsSync(conocidas)) fs.writeFileSync(conocidas, material.conocidas, { mode: 0o600 })
  if (!await disponible()) {
    fs.rmSync(socket, { force: true })
    const hijo = spawn(process.execPath, [__filename, '--servir'], { detached: true, stdio: 'ignore', env: process.env })
    hijo.unref()
    for (let intento = 0; intento < 100 && !await disponible(); intento++) await dormir(20)
    if (!await disponible()) throw new Error('SSH')
  }
  process.stdout.write(socket)
}

module.exports = { enmarcar, extraerTrama }
if (require.main === module) {
  if (process.argv[2] === '--servir') servir()
  else preparar().catch(() => process.exit(1))
}
