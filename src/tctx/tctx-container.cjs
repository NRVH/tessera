// =============================================================================
// `tctx` DENTRO del contenedor de un proyecto en modo Docker: deja la petición en el buzón del puente de `tdb`
// y Tessera la atiende en el host sin lanzar nada, con el perfil del token de la sesión. Lo que se pide y
// cómo se lee la respuesta es lo mismo que en el equipo (`tctxOrdenes`). Se copia al buzón con los demás
// `tctx*.cjs` y `textosTctx` y corre con el `node` de la imagen. Host: `src/main/reglas/buzonTctx.ts`.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md, docs/decisiones/bd/puente-buzon-de-docker.md
// =============================================================================
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { analizar } = require('./tctxArgumentos.cjs')
const { leerTexto, plataformaDelProceso } = require('./tctxEntrada.cjs')
const { exigirPuente, mostrar, peticionDe, textoAyuda, ejecutarDelegacion } = require('./tctxOrdenes.cjs')
const { CODIGOS, ErrorTctx, aviso, salir } = require('./tctxSalida.cjs')
const { textosTctx } = require('./textosTctx.cjs')

/** Carpeta del buzón y token de la sesión: los fija Tessera al montar y al abrir la terminal. */
const BUZON = process.env.TESSERA_DB_BRIDGE || '/agent-config/dbbridge'
const TOKEN = process.env.TESSERA_DB_SESSION || ''
/** El centinela que Tessera refresca: si falta o está rancio, el puente no está (como en `tdb`). */
const CENTINELA = path.join(BUZON, '.alive')
const CENTINELA_MAX_EDAD_MS = 120_000
/** Tessera contesta sin lanzar nada: esto es solo para no colgarse si se cerró. */
const ESPERA_S = 30
const SONDEO_MS = 50

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Falla en el acto, con la frase útil, si el buzón no está montado o Tessera no da señales. */
function comprobarBuzon() {
  const t = textosTctx()
  if (!TOKEN) throw new ErrorTctx(CODIGOS.puente, t.sinContextoContenedor)
  if (!fs.existsSync(BUZON)) throw new ErrorTctx(CODIGOS.puente, t.buzonSinMontar(BUZON))
  let edad = Infinity
  try {
    edad = Date.now() - fs.statSync(CENTINELA).mtimeMs
  } catch {
    // Sin centinela: el bind se perdió al recrearse el contenedor.
  }
  if (edad > CENTINELA_MAX_EDAD_MS) throw new ErrorTctx(CODIGOS.puente, t.buzonNoResponde)
}

/** Lee la respuesta si ya está entera (sobre 9p la entrada puede verse antes que su contenido). */
function leerRespuesta(ruta) {
  try {
    const texto = fs.readFileSync(ruta, 'utf-8')
    return texto.trim() ? JSON.parse(texto) : null
  } catch {
    return null
  }
}

/** Escribe la petición y SONDEA la respuesta: `inotify` no ve las escrituras del host sobre el bind. */
async function preguntar(op, campos) {
  const id = randomUUID()
  const rutaPeticion = path.join(BUZON, `${id}.req.json`)
  const rutaRespuesta = path.join(BUZON, `${id}.res.json`)
  const tmp = `${rutaPeticion}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...campos, v: 1, prog: 'tctx', token: TOKEN, op }), 'utf-8')
  fs.renameSync(tmp, rutaPeticion)
  const t0 = Date.now()
  for (;;) {
    const r = fs.existsSync(rutaRespuesta) ? leerRespuesta(rutaRespuesta) : null
    if (r) {
      fs.rmSync(rutaRespuesta, { force: true })
      return r
    }
    if (Date.now() - t0 > ESPERA_S * 1000) {
      fs.rmSync(rutaPeticion, { force: true })
      throw new ErrorTctx(CODIGOS.puente, textosTctx().puenteSinRespuesta(ESPERA_S))
    }
    await dormir(SONDEO_MS)
  }
}

/** Despacha y resuelve con el código de salida. */
async function main(argv) {
  const a = analizar(argv)
  if (a.sub === 'help') {
    process.stdout.write(textoAyuda())
    return 0
  }
  comprobarBuzon()
  const texto = a.fuente ? await leerTexto(a.fuente, { plataforma: plataformaDelProceso(), cwd: process.cwd(), casa: os.homedir(), delegacion: a.sub === 'delegar' || a.sub === 'tarea' }) : ''
  const { op, campos } = peticionDe(a, texto)
  const r = await preguntar(op, campos)
  // Sin `respuesta`, quien contestó fue el buzón (un programa que no conoce): su código y su salida de errores.
  if (r.respuesta === undefined) {
    if (typeof r.stderr === 'string' && r.stderr) process.stderr.write(r.stderr)
    return typeof r.exitCode === 'number' ? r.exitCode : CODIGOS.puente
  }
  if (a.sub === 'delegar' || a.sub === 'tarea') return ejecutarDelegacion(a, r.respuesta, async (operacion, datos) => {
    comprobarBuzon()
    const siguiente = await preguntar(operacion, datos)
    if (siguiente.respuesta === undefined) throw new ErrorTctx(CODIGOS.puente, textosTctx().buzonNoResponde)
    return siguiente.respuesta
  })
  return mostrar(a, exigirPuente(r.respuesta))
}

if (require.main === module) {
  main(process.argv.slice(2)).then(salir, (e) => {
    aviso(e instanceof Error ? e.message : String(e))
    salir(e instanceof ErrorTctx ? e.codigo : 1)
  })
}
