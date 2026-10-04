// =============================================================================
// Marcador de actualización pendiente, la parte de DISCO: dónde vive (`<userData>/
// pending_update.json`, con `.bak`) y cómo se lee, guarda, sella y borra sin perderlo. Todo
// SÍNCRONO y crash-safe (`util/atomicWrite`): el sello es lo último antes de dejar de existir,
// y `leerMarcador` corre antes de sembrar el estado. La lógica es `marcadorUpdatePuro.ts`.
// Decisiones: docs/decisiones/actualizacion/marcador-y-prevuelos.md
// =============================================================================

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomicSync } from '../util/atomicWrite'
import { rutaUserData } from '../util/infoApp'
import {
  marcadorConIntento,
  sanearMarcador,
  type IntentoUpdate,
  type MarcadorUpdate
} from './marcadorUpdatePuro'

/** Ruta del marcador: `<userData>/pending_update.json`. */
export function rutaMarcador(): string {
  return join(rutaUserData(), 'pending_update.json')
}

function parsearSiSePuede(ruta: string): MarcadorUpdate | null {
  try {
    if (!existsSync(ruta)) return null
    return sanearMarcador(JSON.parse(readFileSync(ruta, 'utf-8')))
  } catch {
    return null
  }
}

/**
 * Lee el marcador. NUNCA lanza: primario -> `.bak` -> `null`. Un archivo a medio
 * escribir por un corte de luz tiene que degradarse a "no hay actualización
 * preparada", jamás a una app que no arranca.
 */
export function leerMarcador(): MarcadorUpdate | null {
  const ruta = rutaMarcador()
  return parsearSiSePuede(ruta) ?? parsearSiSePuede(`${ruta}.bak`)
}

/**
 * Persiste el marcador de forma crash-safe. Best-effort: no rompe el flujo si falla.
 * SÍNCRONA a propósito: `atomicWrite` usa un temporal de nombre FIJO por destino y su
 * `rename` reintenta hasta ~450 ms, así que una escritura asíncrona pendiente podía pisar
 * el intento sellado con `intentos: 0`. El coste es cero medible (~300 bytes, pocas veces).
 */
export function guardarMarcador(m: MarcadorUpdate): void {
  try {
    writeFileAtomicSync(rutaMarcador(), JSON.stringify(m, null, 2) + '\n')
  } catch (err) {
    console.error('[update] no se pudo guardar el marcador:', err)
  }
}

/**
 * Consume un intento y lo escribe con fsync ANTES de ceder el control al
 * instalador. Devuelve el marcador ya actualizado (o el de entrada si la escritura
 * falló, para que el llamador registre lo que de verdad hay en disco).
 */
export function sellarIntentoSync(
  m: MarcadorUpdate,
  i: Omit<IntentoUpdate, 'n'>
): MarcadorUpdate {
  const siguiente = marcadorConIntento(m, i)
  try {
    writeFileAtomicSync(rutaMarcador(), JSON.stringify(siguiente, null, 2) + '\n')
    return siguiente
  } catch (err) {
    console.error('[update] no se pudo sellar el intento:', err)
    return m
  }
}

/** Retira el marcador y sus satélites. Best-effort: si algo queda, `sanearMarcador` lo absorbe. */
export function borrarMarcador(): void {
  const ruta = rutaMarcador()
  for (const f of [ruta, `${ruta}.bak`, `${ruta}.tmp`, `${ruta}.bak.tmp`]) {
    try {
      rmSync(f, { force: true })
    } catch {
      // Un residuo no impide nada: el saneado del siguiente arranque lo descarta.
    }
  }
}

/** ¿Sigue en disco el instalador que el marcador promete? */
export function instaladorPresente(m: MarcadorUpdate | null): boolean {
  if (m === null) return false
  try {
    return existsSync(m.rutaInstalador)
  } catch {
    return false
  }
}
