// =============================================================================
// `tdb driver ls | install <id>`: los clientes de base de datos del catálogo y la descarga
// de su ZIP a la carpeta de drivers. El Instant Client de Mac (un `.dmg`) lo instala Tessera.
// Depende de `tdbContexto` (solo `ENV_DRIVERS`), `tdbSalida`, `zipPlano` y `textosTdb`; lo usa `tdb.cjs`.
// =============================================================================
'use strict'

const path = require('node:path')
const { existsSync, rmSync } = require('node:fs')
const { ENV_DRIVERS } = require('./tdbContexto.cjs')
const { fallar, paraContenedor, pintarTabla } = require('./tdbSalida.cjs')
const { enlacesDelZip, escribirPlano } = require('./zipPlano.cjs')
const { textosTdb } = require('./textosTdb.cjs')

/** La carpeta donde está instalado el pack (la externa registrada o la de Tessera), o `null`. */
function rutaDePack(ctx, paqueteDriver) {
  const candidatas = [ctx.externos[paqueteDriver.id], path.join(ctx.driversDir || '', paqueteDriver.motor, paqueteDriver.id)]
  return candidatas.find((r) => r && existsSync(path.join(r, paqueteDriver.centinela))) || null
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
async function bajarYDescomprimir(paqueteDriver, destino) {
  const t = textosTdb()
  const res = await fetch(paqueteDriver.url, { redirect: 'follow' })
  if (!res.ok) throw new Error(t.servidorRespondio(res.status, res.statusText))
  const zip = new Uint8Array(await res.arrayBuffer())
  if (zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) {
    throw new Error(t.noEsZip)
  }
  console.log(t.descomprimiendo)
  const { unzip } = require('fflate')
  const archivos = await new Promise((resolve, reject) =>
    unzip(zip, (err, datos) => (err ? reject(err) : resolve(datos)))
  )
  // Solo Linux crea los enlaces: el ZIP de Windows no los trae y allí crearlos pide permisos.
  escribirPlano(destino, archivos, enlacesDelZip(zip), process.platform === 'linux')
  if (!existsSync(path.join(destino, paqueteDriver.centinela))) {
    throw new Error(t.paqueteSinCentinela(paqueteDriver.centinela))
  }
}

async function instalarDriver(ctx, paqueteId) {
  const t = textosTdb()
  const paqueteDriver = ctx.packs.find((p) => p.id === paqueteId)
  if (!paqueteDriver) fallar(ctx, t.driverDesconocido(paqueteId))
  if (rutaDePack(ctx, paqueteDriver)) {
    console.log(t.yaInstalado(paqueteDriver.nombre))
    return
  }
  if (!ctx.driversDir) fallar(ctx, t.sinCarpetaDrivers(ENV_DRIVERS))
  // Montar el `.dmg`, copiarlo conservando sus enlaces simbólicos y verificar la firma lo
  // hace Tessera (`instalarDmg.ts`): se remite allí en vez de duplicar ese instalador aquí.
  if (paqueteDriver.formato === 'dmg') fallar(ctx, t.dmgLoInstalaTessera(paqueteDriver.nombre))

  const destino = path.join(ctx.driversDir, paqueteDriver.motor, paqueteDriver.id)
  console.log(t.descargando(paqueteDriver.nombre, paqueteDriver.sizeMB))
  try {
    await bajarYDescomprimir(paqueteDriver, destino)
    console.log(t.instaladoEn(paqueteDriver.nombre, paraContenedor() ? t.rutaDelEquipo : destino))
  } catch (err) {
    try {
      rmSync(destino, { recursive: true, force: true })
    } catch {
      // El centinela ausente ya impide darlo por instalado.
    }
    fallar(ctx, t.noSeInstalo(paqueteDriver.nombre, err.message))
  }
}

async function cmdDriver(ctx, sub, paqueteId) {
  if (sub === 'ls' || !sub) {
    listarDrivers(ctx)
    return
  }
  if (sub !== 'install') fallar(ctx, textosTdb().subcomandoDriver(sub))
  await instalarDriver(ctx, paqueteId)
}

module.exports = { cmdDriver }
