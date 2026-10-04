// =============================================================================
// `tdb driver ls | install <id>`: los clientes de base de datos del catálogo y la descarga
// de su ZIP a la carpeta de drivers. El Instant Client de Mac (un `.dmg`) lo instala Tessera.
// Depende de `tdbContexto` (solo `ENV_DRIVERS`) y `tdbSalida`; lo usa `tdb.cjs`.
// =============================================================================
'use strict'

const path = require('node:path')
const { existsSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { ENV_DRIVERS } = require('./tdbContexto.cjs')
const { fallar, pintarTabla } = require('./tdbSalida.cjs')

/** La carpeta donde está instalado el pack (la externa registrada o la de Tessera), o `null`. */
function rutaDePack(ctx, pack) {
  const candidatas = [ctx.externos[pack.id], path.join(ctx.driversDir || '', pack.motor, pack.id)]
  return candidatas.find((r) => r && existsSync(path.join(r, pack.centinela))) || null
}

function listarDrivers(ctx) {
  const filas = ctx.packs.map((p) => ({
    ID: p.id,
    NOMBRE: p.nombre,
    MB: p.sizeMB,
    CUBRE: p.cubre,
    ESTADO: rutaDePack(ctx, p) ? 'instalado' : 'no instalado'
  }))
  if (ctx.json) {
    console.log(JSON.stringify({ ok: true, drivers: filas }))
    return
  }
  console.log('')
  pintarTabla(['ID', 'NOMBRE', 'MB', 'CUBRE', 'ESTADO'], filas)
  console.log('')
}

/** Baja el ZIP del pack y extrae sus archivos planos en `destino`; lanza si no llega el centinela. */
async function bajarYDescomprimir(pack, destino) {
  const res = await fetch(pack.url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`el servidor respondió ${res.status} ${res.statusText}`)
  const zip = new Uint8Array(await res.arrayBuffer())
  if (zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) {
    throw new Error('lo descargado no es un ZIP')
  }
  console.log('  Descomprimiendo…')
  const { unzip } = require('fflate')
  const archivos = await new Promise((resolve, reject) =>
    unzip(zip, (err, data) => (err ? reject(err) : resolve(data)))
  )
  mkdirSync(destino, { recursive: true })
  for (const [nombre, datos] of Object.entries(archivos)) {
    if (nombre.endsWith('/') || datos.length === 0 || nombre.includes('META-INF/')) continue
    const base = path.basename(nombre)
    if (!base || base === '.' || base === '..') continue
    writeFileSync(path.join(destino, base), datos)
  }
  if (!existsSync(path.join(destino, pack.centinela))) {
    throw new Error(`el paquete no contiene ${pack.centinela}`)
  }
}

async function instalarDriver(ctx, packId) {
  const pack = ctx.packs.find((p) => p.id === packId)
  if (!pack) fallar(ctx, `Driver desconocido: "${packId}". Mira los disponibles con: tdb driver ls`)
  if (rutaDePack(ctx, pack)) {
    console.log(`\n  ${pack.nombre} ya está instalado.\n`)
    return
  }
  if (!ctx.driversDir) fallar(ctx, 'No sé dónde instalar drivers (falta ' + ENV_DRIVERS + ').')
  // Montar el `.dmg`, copiarlo conservando sus enlaces simbólicos y verificar la firma lo
  // hace Tessera (`instalarDmg.ts`): se remite allí en vez de duplicar ese instalador aquí.
  if (pack.formato === 'dmg') {
    fallar(
      ctx,
      `${pack.nombre} se publica como imagen de disco y lo instala Tessera:\n` +
        `    "Descargar" en "Clientes de base de datos", en el diálogo de la conexión (vista Bases de datos).`
    )
  }

  const destino = path.join(ctx.driversDir, pack.motor, pack.id)
  console.log(`\n  Descargando ${pack.nombre} (${pack.sizeMB} MB)…`)
  try {
    await bajarYDescomprimir(pack, destino)
    console.log(`\n  ✓ ${pack.nombre} instalado en ${destino}\n`)
  } catch (err) {
    try {
      rmSync(destino, { recursive: true, force: true })
    } catch {
      // El centinela ausente ya impide darlo por instalado.
    }
    fallar(
      ctx,
      `No se pudo instalar ${pack.nombre}: ${err.message}\n` +
        `    Alternativa: descárgalo a mano y regístralo con "Seleccionar carpeta…" en\n` +
        `    "Clientes de base de datos", en el diálogo de la conexión (vista Bases de datos).`
    )
  }
}

async function cmdDriver(ctx, sub, packId) {
  if (sub === 'ls' || !sub) {
    listarDrivers(ctx)
    return
  }
  if (sub !== 'install') fallar(ctx, `Subcomando de driver desconocido: "${sub}". Usa ls | install.`)
  await instalarDriver(ctx, packId)
}

module.exports = { cmdDriver }
