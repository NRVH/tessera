// =============================================================================
// Las rutas de `tssh cp`: qué lado es el remoto (`<alias>:<ruta>`) y la ruta local, absoluta (así scp no toma
// por remota una relativa con «:»). En Windows gana la letra de unidad (`C:\…` es local) y una ruta del shell
// de Git (`/c/Users/…`, `/tmp/…`) se traduce a la de Windows: el atajo `sh` le pide a MSYS que no convierta
// nada, para no estropear la orden remota ni el lado remoto. Pura, con la plataforma y el traductor de MSYS
// por parámetro; `plataformaDelProceso` es lo único de `tssh` que lee `process.platform`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
'use strict'

const path = require('node:path')
const { errorDeUso } = require('./tsshSalida.cjs')

/** La plataforma del proceso, en la unión de `shared/plataforma.ts`. */
function plataformaDelProceso() {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'mac'
  return 'otra'
}

function pathDe(plataforma) {
  return plataforma === 'windows' ? path.win32 : path.posix
}

/**
 * ¿Es remoto este lado de una copia? `{ alias, ruta }` si delante del primer «:» hay un alias (sin barras,
 * que lo harían una ruta local como `./a:b`); `null` si es local. Un alias no lleva «:» (el registro lo impide).
 */
function ladoRemoto(texto, plataforma) {
  if (plataforma === 'windows' && /^[A-Za-z]:([\\/]|$)/.test(texto)) return null
  const dosPuntos = texto.indexOf(':')
  if (dosPuntos <= 0) return null
  const alias = texto.slice(0, dosPuntos)
  if (/[\\/]/.test(alias)) return null
  return { alias, ruta: texto.slice(dosPuntos + 1) }
}

/** Una ruta del shell de Git: `/c/…` y `/cygdrive/c/…` sin ayuda; las demás (`/tmp`, `/home`…), con `cygpath`. */
function rutaDeMsys(texto, cygpath) {
  const unidad = /^\/(?:cygdrive\/)?([A-Za-z])(\/.*)?$/.exec(texto)
  if (unidad) return `${unidad[1].toUpperCase()}:${path.win32.normalize(unidad[2] || '/')}`
  const traducida = typeof cygpath === 'function' ? cygpath(texto) : null
  if (!traducida) {
    throw errorDeUso(`No sé a qué carpeta de Windows corresponde «${texto}»: usa una ruta de Windows (C:\\...) o una relativa a la carpeta actual.`)
  }
  return traducida
}

/**
 * La ruta local, absoluta: `~` es la carpeta del usuario (PowerShell no la expande al llamar a un programa),
 * en Windows una ruta del shell de Git se traduce, y una relativa cuelga de la carpeta actual.
 */
function rutaLocal(texto, { plataforma, cwd, casa, cygpath }) {
  const p = pathDe(plataforma)
  let ruta = texto
  const conTilde = ruta === '~' || ruta.startsWith('~/') || (plataforma === 'windows' && ruta.startsWith('~\\'))
  if (conTilde) ruta = p.join(casa, ruta.slice(1))
  else if (plataforma === 'windows' && ruta.startsWith('/') && !ruta.startsWith('//')) ruta = rutaDeMsys(ruta, cygpath)
  return p.resolve(cwd, ruta)
}

/** Los dos lados de `tssh cp`: exactamente uno remoto. `subida` = de este equipo al remoto. */
function lados(origen, destino, opciones) {
  const remotoOrigen = ladoRemoto(origen, opciones.plataforma)
  const remotoDestino = ladoRemoto(destino, opciones.plataforma)
  if (remotoOrigen && remotoDestino) throw errorDeUso('Los dos lados son remotos: copia primero a este equipo y después al otro.')
  if (!remotoOrigen && !remotoDestino) throw errorDeUso('Ninguno de los dos lados es remoto: uno tiene que ser <alias>:<ruta>.')
  const remoto = remotoOrigen || remotoDestino
  return {
    alias: remoto.alias,
    rutaRemota: remoto.ruta,
    local: rutaLocal(remotoOrigen ? destino : origen, opciones),
    subida: remotoDestino !== null
  }
}

module.exports = { plataformaDelProceso, ladoRemoto, rutaLocal, lados }
