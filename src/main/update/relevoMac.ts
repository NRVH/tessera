// =============================================================================
// El relevo de macOS, la parte de I/O: dónde está el `.app` de este proceso, si su contenedor
// se puede escribir, dónde vive el guion (`<userData>/tessera-updater`, FUERA del bundle que
// sustituye), cómo se lanza desprendido y cómo se consume la marca con su desenlace (`ok` o
// `fallo: <motivo>`, lo único que puede explicar por qué no se aplicó). El texto del guion y
// lo que no toca disco están en `relevoMacPuro.ts`, que es lo que la prueba puede ejecutar.
// Decisiones: docs/decisiones/actualizacion/relevo-de-macos.md
// =============================================================================

import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { bundleDesdeExe, guionRelevoMac, interpretarMarcaRelevo, type ResultadoRelevo } from './relevoMacPuro'
import { rutaExe, rutaUserData } from '../util/infoApp'

/** Nombre del archivo donde el guion deja su desenlace. */
const NOMBRE_MARCA = 'relevo-mac.resultado'
/** Nombre del registro del guion (`set -x`). */
const NOMBRE_TRAZA = 'relevo-mac.log'
/** Nombre del guion generado. */
const NOMBRE_GUION = 'relevo-mac.sh'

/** El `.app` de ESTE proceso, o `null` si no corre desde uno. */
export function bundleDeLaApp(): string | null {
  try {
    return bundleDesdeExe(rutaExe())
  } catch {
    return null
  }
}

/**
 * ¿Se puede sustituir este bundle?
 *
 * Se pregunta por el CONTENEDOR y no por el bundle: los pasos que importan son un
 * `mv` del `.app` a un lado y otro del nuevo a su sitio, y los dos son escrituras en
 * el directorio que los contiene. Un `.app` con todo su contenido en modo 755 no se
 * puede renombrar si `/Applications` no es escribible.
 *
 * El caso real que atiende: una Tessera instalada en `/Applications` por OTRO usuario
 * (el propietario tiene escritura, los demás no) o servida desde un volumen de sólo
 * lectura —una imagen .dmg montada, que es como mucha gente "instala" una app de
 * macOS sin darse cuenta—. Ahí no se toca nada y el ciclo se queda en `available`,
 * ofreciendo la descarga manual del .dmg, que es lo que esa persona sí puede hacer.
 */
export function sePuedeEscribirEnElBundle(bundle: string): boolean {
  try {
    if (!existsSync(bundle)) return false
    accessSync(path.dirname(bundle), constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Carpeta del relevo: `<userData>/tessera-updater`. FUERA del bundle, a propósito. */
export function dirRelevoMac(): string {
  return path.join(rutaUserData(), 'tessera-updater')
}

/** Dónde deja el guion su desenlace. */
export function rutaMarcaRelevoMac(): string {
  return path.join(dirRelevoMac(), NOMBRE_MARCA)
}

/**
 * Lee el desenlace del relevo y lo BORRA. Se consume porque es de un solo uso: si se
 * quedara, el segundo arranque volvería a contar un fallo que ya se contó (o peor, lo
 * contaría junto a una actualización distinta). Nunca lanza.
 */
export function consumirMarcaRelevoMac(): ResultadoRelevo | null {
  const ruta = rutaMarcaRelevoMac()
  let res: ResultadoRelevo | null = null
  try {
    if (existsSync(ruta)) res = interpretarMarcaRelevo(readFileSync(ruta, 'utf8'))
  } catch {
    res = null
  }
  try {
    rmSync(ruta, { force: true })
  } catch {
    // Un residuo no rompe nada: la próxima lectura lo volverá a intentar borrar.
  }
  return res
}

export interface LanzamientoRelevoMac {
  /** El `.zip` descargado y verificado. */
  zip: string
  /** El `.app` que se sustituye. */
  destino: string
  /** Volver a abrir la app al terminar. */
  relanzar: boolean
  log: (m: string) => void
}

/**
 * Escribe el guion y lo ARRANCA desprendido de este proceso. Devuelve true si quedó
 * lanzado; el llamador debe entonces morirse sin tocar nada más (el relevo está
 * esperando exactamente a que este pid desaparezca).
 *
 * `detached` + `unref` son lo que le hace sobrevivir a nuestra muerte, que es toda la
 * gracia. El `cwd` va al temporal del sistema y no se hereda: heredarlo dejaría al
 * relevo con el directorio actual DENTRO del bundle que va a renombrar.
 *
 * Se le pasa `--user-data-dir` explícito al relanzar. En producción es la ruta por
 * defecto y no cambia nada; lo que compra es que una sesión con datos en otro sitio
 * —una prueba de interfaz, un arranque de diagnóstico— vuelva a abrirse en LOS SUYOS
 * y no en los de verdad.
 */
export function lanzarRelevoMac(o: LanzamientoRelevoMac): boolean {
  try {
    const dir = dirRelevoMac()
    mkdirSync(dir, { recursive: true })
    const guion = path.join(dir, NOMBRE_GUION)
    const marca = rutaMarcaRelevoMac()
    // Se retira la marca ANTES de lanzar: si quedara la de un intento anterior y este
    // guion muriera sin llegar a escribir, el arranque siguiente leería un desenlace
    // viejo y contaría el fallo equivocado.
    rmSync(marca, { force: true })
    writeFileSync(
      guion,
      guionRelevoMac({
        pid: process.pid,
        zip: o.zip,
        destino: o.destino,
        marca,
        traza: path.join(dir, NOMBRE_TRAZA),
        relanzar: o.relanzar,
        argumentos: [`--user-data-dir=${rutaUserData()}`]
      }),
      { mode: 0o700 }
    )
    const hijo = spawn('/bin/sh', [guion], {
      detached: true,
      stdio: 'ignore',
      cwd: os.tmpdir()
    })
    hijo.unref()
    o.log(
      `relevo de macOS lanzado (pid ${hijo.pid ?? '?'}): ${o.destino} <- ${o.zip}` +
        `${o.relanzar ? ', con relanzamiento' : ', sin relanzar'}.`
    )
    return true
  } catch (err) {
    o.log(`no se pudo lanzar el relevo de macOS: ${String(err)}`)
    return false
  }
}
