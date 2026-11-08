// =============================================================================
// Reconocer un servidor SSH sin huella guardada antes de autenticarse en él: cuál de la cadena toca (los
// bastiones primero, en el orden en que se llega), qué significa lo que dejó la conexión que trae su huella
// sin credenciales, y las huellas pendientes de que la persona las confirme, en memoria del main con una
// ficha de un solo uso y caducidad corta. El renderer solo devuelve la ficha, nunca la huella ni el texto.
// Puro salvo `node:crypto` y el `known_hosts` temporal (`crearTemporalHuellas`).
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md
// =============================================================================
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plataforma } from '../../../shared/plataforma.ts'
import type { SshHuella, SshResultadoPrueba } from '../../../shared/ssh-ipc.ts'
import { huellasDeKnownHosts, lineasDeKnownHosts } from '../huellasSsh.ts'
import { resultadoPrueba, type SalidaSsh } from './pruebaSsh.ts'

/** Lo que espera la conexión que trae la huella si un bastión puede preguntar en un diálogo: lo contesta una persona. */
export const TOPE_RECONOCER_DIALOGO_MS = 120_000

/** Lo que vive una huella pendiente: lo justo para compararla por otra vía (una llamada, un mensaje). */
export const VIDA_PENDIENTE_MS = 300_000

/** Cuántas pendientes guarda a la vez como mucho; al pasar, se va la más antigua. */
export const MAX_PENDIENTES = 16

/**
 * El primer servidor sin huella del camino, contando desde este equipo (el bastión más lejano del destino
 * primero y el destino el último), y los bastiones por los que se llega a él, del más cercano a él al más
 * lejano. `null` si todos la tienen. A un servidor solo se llega por bastiones ya confirmados.
 */
export function siguienteSinHuella<T>(destino: T, cadena: readonly T[], tieneHuella: (x: T) => boolean): { objetivo: T; saltos: T[] } | null {
  const ruta = [...cadena].reverse().concat([destino])
  const i = ruta.findIndex((x) => !tieneHuella(x))
  if (i < 0) return null
  return { objetivo: ruta[i], saltos: ruta.slice(0, i).reverse() }
}

/** Lo que se sabe tras la conexión que trae la huella. */
export type DesenlaceReconocer =
  | { tipo: 'nueva'; lineas: string[]; huellas: SshHuella[] }
  | { tipo: 'conocida' }
  | { tipo: 'fallo'; resultado: Extract<SshResultadoPrueba, { ok: false }> }

/**
 * Qué dejó la conexión que trae la huella, con el texto del `known_hosts` temporal. Sin línea nueva pero
 * con el servidor pidiendo credenciales (o dejando entrar), ssh ya lo conocía por el `known_hosts` del
 * sistema: no hay nada que confirmar. Si no llegó a eso, el fallo se cuenta como el de «Probar».
 */
export function desenlaceReconocer(
  salida: SalidaSsh,
  texto: string,
  destino: { host: string; puerto: number },
  ctx: { ms: number; plataforma: Plataforma }
): DesenlaceReconocer {
  const lineas = lineasDeKnownHosts(texto, destino.host, destino.puerto)
  if (lineas.length > 0) return { tipo: 'nueva', lineas, huellas: huellasDeKnownHosts(lineas.join('\n'), destino.host, destino.puerto) }
  const r = resultadoPrueba(salida, { ms: ctx.ms, huellas: [], soloAlcance: true, preguntaSinContestar: false, plataforma: ctx.plataforma })
  return r.ok ? { tipo: 'conocida' } : { tipo: 'fallo', resultado: r }
}

/** Una huella que espera a que la persona la confirme: de qué conexión es y qué se escribiría. */
export interface HuellaPendiente {
  conexionId: string
  host: string
  puerto: number
  lineas: string[]
}

interface Viva extends HuellaPendiente {
  caduca: number
}

/** Las huellas pendientes, por ficha: de un solo uso, con caducidad y con tope. */
export class HuellasPendientes {
  private readonly vivas = new Map<string, Viva>()
  private readonly ahora: () => number
  private readonly vidaMs: number
  private readonly nuevaFicha: () => string

  constructor(opts: { ahora?: () => number; vidaMs?: number; nuevaFicha?: () => string } = {}) {
    this.ahora = opts.ahora ?? Date.now
    this.vidaMs = opts.vidaMs ?? VIDA_PENDIENTE_MS
    this.nuevaFicha = opts.nuevaFicha ?? (() => randomBytes(24).toString('base64url'))
  }

  /** Guarda una pendiente y devuelve su ficha. */
  guardar(p: HuellaPendiente): string {
    const ahora = this.ahora()
    for (const [ficha, v] of this.vivas) if (v.caduca <= ahora) this.vivas.delete(ficha)
    while (this.vivas.size >= MAX_PENDIENTES) {
      const primera = this.vivas.keys().next().value
      if (primera === undefined) break
      this.vivas.delete(primera)
    }
    const ficha = this.nuevaFicha()
    this.vivas.set(ficha, { conexionId: p.conexionId, host: p.host, puerto: p.puerto, lineas: [...p.lineas], caduca: ahora + this.vidaMs })
    return ficha
  }

  /** La pendiente de la ficha, que deja de valer; `null` si no existe, ya se usó o caducó. */
  tomar(ficha: string): HuellaPendiente | null {
    const v = this.vivas.get(ficha)
    this.vivas.delete(ficha)
    if (v === undefined || v.caduca <= this.ahora()) return null
    return { conexionId: v.conexionId, host: v.host, puerto: v.puerto, lineas: [...v.lineas] }
  }

  /** La persona no la confirmó: se olvida sin escribir nada. */
  descartar(ficha: string): void {
    this.vivas.delete(ficha)
  }

  /** Cuántas hay (para las pruebas). */
  get tamano(): number {
    return this.vivas.size
  }
}

/** El `known_hosts` temporal de una conexión que trae una huella: solo lo escribe ese ssh y se borra al leerlo. */
export interface TemporalHuellas {
  ruta: string
  leer: () => string
  borrar: () => void
}

/** Una carpeta propia en la de temporales del sistema (en macOS y Linux, solo para este usuario) con el archivo dentro. */
export function crearTemporalHuellas(): TemporalHuellas {
  const dir = mkdtempSync(join(tmpdir(), 'tessera-huella-'))
  const ruta = join(dir, 'known_hosts')
  return {
    ruta,
    leer: () => {
      try {
        return readFileSync(ruta, 'utf8')
      } catch {
        return ''
      }
    },
    borrar: () => rmSync(dir, { recursive: true, force: true })
  }
}
