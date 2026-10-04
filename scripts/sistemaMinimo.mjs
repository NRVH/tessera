// =============================================================================
// El mínimo de macOS en el feed: lee `LSMinimumSystemVersion` del Info.plist del artefacto
// (la verdad de lo que se distribuye) y lo escribe en `latest-mac.yml` como
// `minimumSystemVersion`, que electron-builder no rellena y electron-updater sí mira. Va
// traducido a Darwin en semver (`os.release()` + `semver.lt`): macOS 11–15 son Darwin 20–24
// y desde la 26, Darwin 25. Un «12.0» tal cual sería inválido y dejaría pasar la
// actualización. Lo usan `parchearMinimoMac.mjs`, `publish-update.mjs` y `estado-feeds.mjs`.
// Decisiones: docs/decisiones/despliegue/releases-de-github.md
// =============================================================================

/** El `LSMinimumSystemVersion` de un Info.plist en XML, o `null` si no lo lleva. */
export function macosMinimoDelPlist(xml) {
  const m = /<key>LSMinimumSystemVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(xml)
  return m ? m[1].trim() : null
}

/** Versión de macOS ("12.0", "13", "26.1") → versión de Darwin en semver ("21.0.0"). */
export function darwinDeMacos(version) {
  const mayor = Number.parseInt(String(version).split('.')[0], 10)
  if (Number.isInteger(mayor) && mayor >= 11 && mayor <= 15) return `${mayor + 9}.0.0`
  if (Number.isInteger(mayor) && mayor >= 26) return `${mayor - 1}.0.0`
  throw new Error(`versión de macOS no reconocida para traducirla a Darwin: "${version}"`)
}

/**
 * El manifiesto con la clave de primer nivel `minimumSystemVersion: <darwin>`: se
 * SUSTITUYE si ya estaba (nunca dos) y se añade al final si no. El resto no se toca.
 */
export function conSistemaMinimo(yml, darwin) {
  const linea = `minimumSystemVersion: ${darwin}`
  const existente = /^minimumSystemVersion:.*$/m
  if (existente.test(yml)) return yml.replace(existente, linea)
  return `${yml.replace(/\s*$/, '')}\n${linea}\n`
}

/**
 * El `minimumSystemVersion` que ya lleva un manifiesto, o `null` si no lo lleva o no es
 * un semver de Darwin (`21.0.0`). Un «12.0» cuenta como ausente: electron-updater lo
 * tragaría sin proteger a nadie, que es lo mismo que no tenerlo.
 */
export function sistemaMinimoDelManifiesto(yml) {
  const m = /^minimumSystemVersion:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(yml)
  if (!m || !/^\d+\.\d+\.\d+$/.test(m[1])) return null
  return m[1]
}
