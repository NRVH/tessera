#!/usr/bin/env node
// =============================================================================
// Escribe en `latest-mac.yml` el `minimumSystemVersion` (en Darwin) que sale del
// `LSMinimumSystemVersion` del Info.plist del .app recién compilado. Lo corre el trabajo de
// macOS del workflow de publicación tras `electron-builder --mac`: sin él, el feed ofrecería
// la versión a Macs que no pueden con ella. `--dist <carpeta>` cambia la carpeta (por defecto
// `dist/`). Si falta el plist, la clave o el manifiesto, sale 1 sin tocar nada.
// Decisiones: docs/decisiones/despliegue/releases-de-github.md
// =============================================================================
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { conSistemaMinimo, darwinDeMacos, macosMinimoDelPlist } from './sistemaMinimo.mjs'

/** Dónde deja electron-builder el Info.plist del .app de arm64 dentro de su carpeta de salida. */
export function rutaPlistMac(dist) {
  return join(dist, 'mac-arm64', 'Tessera.app', 'Contents', 'Info.plist')
}

/**
 * El manifiesto con su mínimo de sistema, a partir del Info.plist. Lanza si el plist no
 * lleva la clave o la versión no se puede traducir: publicar sin mínimo dejaría que un Mac
 * por debajo del de Electron reciba una versión que no arranca.
 */
export function parchearManifiestoMac(plistXml, yml) {
  const macos = macosMinimoDelPlist(plistXml)
  if (macos === null) {
    throw new Error(
      'el Info.plist no lleva LSMinimumSystemVersion (`mac.minimumSystemVersion` de electron-builder.yml)'
    )
  }
  const darwin = darwinDeMacos(macos)
  return { macos, darwin, yml: conSistemaMinimo(yml, darwin) }
}

function ejecutadoDirectamente() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (ejecutadoDirectamente()) {
  const i = process.argv.indexOf('--dist')
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const dist = i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : join(raiz, 'dist')
  const plist = rutaPlistMac(dist)
  const manifiesto = join(dist, 'latest-mac.yml')
  const morir = (msg) => {
    console.error(`[minimo-mac] ✕ ${msg}`)
    process.exit(1)
  }
  if (!existsSync(plist)) morir(`no existe ${plist}. ¿Corrió "electron-builder --mac" antes?`)
  if (!existsSync(manifiesto)) morir(`no existe ${manifiesto}. ¿Corrió "electron-builder --mac" antes?`)
  try {
    const r = parchearManifiestoMac(readFileSync(plist, 'utf8'), readFileSync(manifiesto, 'utf8'))
    writeFileSync(manifiesto, r.yml)
    console.log(`[minimo-mac] latest-mac.yml: minimumSystemVersion ${r.darwin} (macOS ${r.macos}).`)
  } catch (e) {
    morir(e instanceof Error ? e.message : String(e))
  }
}
