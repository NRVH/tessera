// =============================================================================
// Las huellas del servidor que `ssh` dejó en el `known_hosts` propio de una conexión: el tipo de
// clave y el SHA256 del blob en base64 sin relleno, que es lo que enseña `ssh-keygen -l`. Puro
// salvo `node:crypto`: el texto del archivo llega por parámetro. Solo cuentan las líneas del host y
// el puerto VIGENTES de la conexión (también las cifradas con `|1|`); las revocadas no.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md
// =============================================================================

import { createHash, createHmac } from 'node:crypto'
import type { SshHuella } from '../../shared/ssh-ipc.ts'

/** Cómo escribe `ssh` el destino en `known_hosts`: el host a secas en el 22, `[host]:puerto` en otro. */
export function patronKnownHosts(host: string, puerto: number): string {
  const h = host.toLowerCase()
  return puerto === 22 ? h : `[${h}]:${puerto}`
}

/** ¿Casa un nombre de `known_hosts` (en claro o cifrado `|1|sal|hash`) con el patrón? */
function casaNombre(nombre: string, patron: string): boolean {
  if (!nombre.startsWith('|1|')) return nombre.toLowerCase() === patron
  const [, , sal, hash] = nombre.split('|')
  if (!sal || !hash) return false
  try {
    return createHmac('sha1', Buffer.from(sal, 'base64')).update(patron).digest('base64') === hash
  } catch {
    return false
  }
}

/** El SHA256 de un blob de clave en base64, como lo enseña `ssh-keygen -l` (sin el prefijo ni el relleno). */
export function sha256DeClave(blobBase64: string): string | null {
  const blob = Buffer.from(blobBase64, 'base64')
  if (blob.length === 0) return null
  return createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
}

/** Una línea de `known_hosts` que es la clave de `host:puerto`, con su huella; las demás no cuentan. */
interface LineaHuella {
  linea: string
  huella: SshHuella
}

function lineasConHuella(texto: string, host: string, puerto: number): LineaHuella[] {
  const patron = patronKnownHosts(host, puerto)
  const r: LineaHuella[] = []
  for (const linea of texto.split(/\r?\n/)) {
    const campos = linea.trim().split(/\s+/)
    if (campos[0] === '' || campos[0].startsWith('#')) continue
    // `@cert-authority` no es la clave del servidor y `@revoked` es justo lo contrario de una aceptada.
    if (campos[0].startsWith('@')) continue
    if (campos.length < 3) continue
    const [nombres, algoritmo, blob] = campos
    if (!nombres.split(',').some((n) => casaNombre(n, patron))) continue
    const sha256 = sha256DeClave(blob)
    if (sha256 !== null) r.push({ linea: `${nombres} ${algoritmo} ${blob}`, huella: { algoritmo, sha256 } })
  }
  return r
}

/** Las huellas de `host:puerto` en el texto de un `known_hosts`, sin repetir. */
export function huellasDeKnownHosts(texto: string, host: string, puerto: number): SshHuella[] {
  const vistas = new Set<string>()
  const huellas: SshHuella[] = []
  for (const { huella } of lineasConHuella(texto, host, puerto)) {
    const clave = `${huella.algoritmo} ${huella.sha256}`
    if (vistas.has(clave)) continue
    vistas.add(clave)
    huellas.push(huella)
  }
  return huellas
}

/**
 * Las líneas de `host:puerto` de un `known_hosts`, rehechas con sus tres campos y una por línea: lo único que
 * se copia de un `known_hosts` temporal al de la conexión (ni comentarios, ni marcas, ni otros hosts).
 */
export function lineasDeKnownHosts(texto: string, host: string, puerto: number): string[] {
  return [...new Set(lineasConHuella(texto, host, puerto).map((l) => l.linea))]
}
