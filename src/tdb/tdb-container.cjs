// =============================================================================
// `tdb` DENTRO del contenedor: no consulta ninguna base, reenvía el comando al host por un
// BUZÓN de archivos y escribe tal cual lo que le devuelvan (salida y código de salida).
// Se copia SOLO al buzón y corre con el `node` de la imagen: únicamente `node:*`, sin
// `require` de nada local. Lee aquí dentro el SQL de `--stdin` y `--file` y lo manda en la petición.
// Decisiones: docs/decisiones/bd/puente-buzon-de-docker.md
// =============================================================================
'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** Carpeta del buzón dentro del contenedor. La fija Tessera al montar. */
const BUZON = process.env.TESSERA_DB_BRIDGE || '/agent-config/dbbridge'
/** Token de esta sesión, inyectado por `docker exec -e`. */
const TOKEN = process.env.TESSERA_DB_SESSION || ''

/**
 * Centinela que Tessera refresca. Si falta o está rancio, el puente no está: se falla en un
 * segundo en vez de esperar el timeout largo. Cubre el bind perdido al recrearse el
 * contenedor: `mkdir -p` deja la carpeta VACÍA y la petición se escribiría al vacío.
 */
const CENTINELA = path.join(BUZON, '.alive')
const CENTINELA_MAX_EDAD_MS = 120_000

/** Tope total de espera. Alineado con el del main, más margen para el ida y vuelta. */
const TIMEOUT_MS = 100_000
/** Sondeo rápido los primeros segundos (una consulta corta vuelve en ~400 ms). */
const SONDEO_RAPIDO_MS = 50
const SONDEO_RAPIDO_HASTA_MS = 2000
const SONDEO_LENTO_MS = 200

/**
 * Tope del SQL que viaja en la petición. Holgado para cualquier guion a mano, y lejos de lo
 * que el buzón (un archivo JSON sobre 9p/virtiofs) puede mover sin notarse.
 */
const MAX_ENTRADA = 8 * 1024 * 1024

function fallar(mensaje) {
  process.stderr.write(`\n  ✗ ${mensaje}\n\n`)
  process.exit(2)
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Identificador de la petición: `randomUUID`, sin depender de la hora (dos en el mismo ms no colisionan). */
function nuevoId() {
  return require('node:crypto').randomUUID()
}

/** Escribe a `.tmp` y renombra: el lector nunca ve un archivo a medias. */
function escribirAtomico(destino, texto) {
  const tmp = `${destino}.tmp`
  fs.writeFileSync(tmp, texto, 'utf-8')
  fs.renameSync(tmp, destino)
}

/**
 * Lee la respuesta, o null si todavía no está legible. Sobre un bind 9p el `rename` es
 * atómico en el servidor, pero la caché de directorio del cliente puede exponer la entrada un
 * instante antes que su contenido: quien llama reintenta en el siguiente ciclo del sondeo,
 * con su pausa de verdad.
 */
function leerRespuesta(ruta) {
  try {
    const texto = fs.readFileSync(ruta, 'utf-8')
    if (!texto.trim()) return null
    return JSON.parse(texto)
  } catch {
    return null
  }
}

/**
 * La argv que viaja y el SQL que la acompaña. `--stdin` se queda en la argv (el `tdb` del
 * host lee su entrada estándar, que el main rellena con `entrada`); `--file <ruta>` se
 * sustituye por `--stdin` con el contenido del archivo, leído AQUÍ con la ruta relativa a la
 * carpeta de este proceso. Sin ninguno de los dos, la argv tal cual y sin `entrada`. Si llegan
 * los dos, manda `--stdin`. Falla (sale) con el mismo texto que `tdb` en el host.
 */
function prepararEnvio(argv) {
  const porStdin = argv.includes('--stdin')
  const iFile = argv.indexOf('--file')
  if (!porStdin && iFile < 0) return { argv, entrada: undefined }
  // Se quita el `--file` y su ruta: la ruta es de ESTE sistema de archivos y el host no
  // debe verla (ni intentar leerla).
  const sinFile = iFile >= 0 ? argv.filter((_, i) => i !== iFile && i !== iFile + 1) : argv.slice()
  let entrada
  if (porStdin) {
    try {
      entrada = fs.readFileSync(0, 'utf-8')
    } catch {
      entrada = ''
    }
  } else {
    const ruta = argv[iFile + 1]
    if (!ruta) fallar('Falta la ruta después de --file.')
    let texto
    try {
      texto = fs.readFileSync(path.resolve(process.cwd(), ruta), 'utf-8')
    } catch {
      fallar(`No existe el archivo "${ruta}".`)
    }
    if (!texto.trim()) fallar(`El archivo "${ruta}" está vacío.`)
    entrada = texto
    sinFile.push('--stdin')
  }
  if (Buffer.byteLength(entrada, 'utf-8') > MAX_ENTRADA) {
    fallar(`El SQL supera los ${Math.round(MAX_ENTRADA / (1024 * 1024))} MiB que admite el puente al host.`)
  }
  return { argv: sinFile, entrada }
}

/** Falla en el acto, con la frase útil, si el buzón no está montado o Tessera no da señales. */
function comprobarBuzon() {
  if (!TOKEN) {
    fallar(
      'Esta terminal no lleva el contexto de bases de datos de Tessera.\n' +
        '    Recarga la terminal (o reinicia el agente) después de montar la base.'
    )
  }
  if (!fs.existsSync(BUZON)) {
    fallar(
      `El puente al host no está montado (${BUZON} no existe).\n` +
        '    Recarga la terminal para que Tessera lo vuelva a montar.'
    )
  }
  try {
    const edad = Date.now() - fs.statSync(CENTINELA).mtimeMs
    if (edad > CENTINELA_MAX_EDAD_MS) {
      fallar(
        'El puente al host está montado pero Tessera no da señales.\n' +
          '    Recarga la terminal; si sigue, reinicia Tessera.'
      )
    }
  } catch {
    fallar(
      'El puente al host no responde (falta el centinela).\n' +
        '    Suele pasar tras recrearse el contenedor: recarga la terminal.'
    )
  }
}

/**
 * Si la respuesta ya se puede LEER, la escribe tal cual y sale con el código del host. Solo
 * se borra cuando se pudo leer: si se borrara antes, una respuesta que aún no era visible
 * entera se perdería y el comando fallaría con un «ilegible» que era «todavía no».
 */
function entregarSiHay(respuesta) {
  if (!fs.existsSync(respuesta)) return
  const r = leerRespuesta(respuesta)
  if (!r) return
  try {
    fs.unlinkSync(respuesta)
  } catch {
    // Si no se puede borrar, el barrido del host lo recogerá por antigüedad.
  }
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  process.exit(typeof r.exitCode === 'number' ? r.exitCode : 1)
}

/**
 * SE SONDEA, NO SE VIGILA: `inotify` no recibe eventos de escrituras hechas fuera del kernel
 * de la VM sobre un bind 9p/virtiofs, así que `fs.watch` aquí dentro no dispararía NUNCA y el
 * comando se colgaría hasta el timeout sin decir por qué.
 */
async function esperarRespuesta(peticion, respuesta) {
  const t0 = Date.now()
  for (;;) {
    entregarSiHay(respuesta)
    const transcurrido = Date.now() - t0
    if (transcurrido > TIMEOUT_MS) {
      try {
        fs.unlinkSync(peticion)
      } catch {
        // El barrido del host la recogerá.
      }
      fallar(
        `El puente no respondió en ${Math.round(TIMEOUT_MS / 1000)} s.\n` +
          '    Comprueba que Tessera sigue abierta y recarga la terminal.'
      )
    }
    await dormir(transcurrido < SONDEO_RAPIDO_HASTA_MS ? SONDEO_RAPIDO_MS : SONDEO_LENTO_MS)
  }
}

async function main() {
  comprobarBuzon()
  // El SQL se lee ANTES de escribir la petición: un `--file` que no existe falla aquí, en el
  // acto, sin ida y vuelta al host.
  const envio = prepararEnvio(process.argv.slice(2))

  const id = nuevoId()
  const peticion = path.join(BUZON, `${id}.req.json`)
  const respuesta = path.join(BUZON, `${id}.res.json`)

  escribirAtomico(
    peticion,
    JSON.stringify({
      v: 1,
      token: TOKEN,
      argv: envio.argv,
      cwd: process.cwd(),
      // Solo con `--stdin`/`--file`: un host de antes lo ignora.
      ...(envio.entrada !== undefined ? { entrada: envio.entrada } : {})
    })
  )
  await esperarRespuesta(peticion, respuesta)
}

main().catch((err) => fallar(String((err && err.message) || err)))
