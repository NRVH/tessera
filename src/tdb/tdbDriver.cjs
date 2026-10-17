// =============================================================================
// `tdb driver ls | install <id>`: los clientes de base de datos del catálogo y la descarga
// de su ZIP a la carpeta de drivers. El Instant Client de Mac (un `.dmg`) lo instala Tessera.
// Depende de `tdbContexto` (solo `ENV_DRIVERS`), `tdbSalida`, `zipPlano` y `textosTdb`; lo usa `tdb.cjs`.
// =============================================================================
'use strict'

const path = require('node:path')
const { existsSync, rmSync } = require('node:fs')
const { ENV_DRIVERS } = require('./tdbContexto.cjs')
const { fallar, pintarTabla } = require('./tdbSalida.cjs')
const { enlacesDelZip, escribirPlano } = require('./zipPlano.cjs')
const { textosTdb } = require('./textosTdb.cjs')

/** La carpeta donde está instalado el pack (la externa registrada o la de Tessera), o `null`. */
function rutaDePack(ctx, pack) {
  const candidatas = [ctx.externos[pack.id], path.join(ctx.driversDir || '', pack.motor, pack.id)]
  return candidatas.find((r) => r && existsSync(path.join(r, pack.centinela))) || null
}

/** El `--json` lleva el estado fijo ('instalado' / 'no instalado'); el texto, en el idioma de la invocación. */
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
  const t = textosTdb()
  console.log('')
  pintarTabla(
    t.columnasDrivers,
    filas.map((f) => [f.ID, f.NOMBRE, f.MB, f.CUBRE, f.ESTADO === 'instalado' ? t.instalado : t.noInstalado])
  )
  console.log('')
}

/** Baja el ZIP del pack y extrae sus archivos planos en `destino`; lanza si no llega el centinela. */
async function bajarYDescomprimir(pack, destino) {
  const t = textosTdb()
  const res = await fetch(pack.url, { redirect: 'follow' })
  if (!res.ok) throw new Error(t.servidorRespondio(res.status, res.statusText))
  const zip = new Uint8Array(await res.arrayBuffer())
  if (zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) {
    throw new Error(t.noEsZip)
  }
  console.log(t.descomprimiendo)
  const { unzip } = require('fflate')
  const archivos = await new Promise((resolve, reject) =>
    unzip(zip, (err, data) => (err ? reject(err) : resolve(data)))
  )
  // Solo Linux crea los enlaces: el ZIP de Windows no los trae y allí crearlos pide permisos.
  escribirPlano(destino, archivos, enlacesDelZip(zip), process.platform === 'linux')
  if (!existsSync(path.join(destino, pack.centinela))) {
    throw new Error(t.paqueteSinCentinela(pack.centinela))
  }
}

async function instalarDriver(ctx, packId) {
  const t = textosTdb()
  const pack = ctx.packs.find((p) => p.id === packId)
  if (!pack) fallar(ctx, t.driverDesconocido(packId))
  if (rutaDePack(ctx, pack)) {
    console.log(t.yaInstalado(pack.nombre))
    return
  }
  if (!ctx.driversDir) fallar(ctx, t.sinCarpetaDrivers(ENV_DRIVERS))
  // Montar el `.dmg`, copiarlo conservando sus enlaces simbólicos y verificar la firma lo
  // hace Tessera (`instalarDmg.ts`): se remite allí en vez de duplicar ese instalador aquí.
  if (pack.formato === 'dmg') fallar(ctx, t.dmgLoInstalaTessera(pack.nombre))

  const destino = path.join(ctx.driversDir, pack.motor, pack.id)
  console.log(t.descargando(pack.nombre, pack.sizeMB))
  try {
    await bajarYDescomprimir(pack, destino)
    console.log(t.instaladoEn(pack.nombre, destino))
  } catch (err) {
    try {
      rmSync(destino, { recursive: true, force: true })
    } catch {
      // El centinela ausente ya impide darlo por instalado.
    }
    fallar(ctx, t.noSeInstalo(pack.nombre, err.message))
  }
}

async function cmdDriver(ctx, sub, packId) {
  if (sub === 'ls' || !sub) {
    listarDrivers(ctx)
    return
  }
  if (sub !== 'install') fallar(ctx, textosTdb().subcomandoDriver(sub))
  await instalarDriver(ctx, packId)
}

module.exports = { cmdDriver }
