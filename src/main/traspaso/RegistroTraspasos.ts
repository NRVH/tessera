// =============================================================================
// Los traspasos en memoria: el pendiente que prepara «Continuar en…» hasta que la sesión de destino se abre
// con él, y el contenido que esa sesión lee con `tctx traspaso` mientras vive. Nada va a disco: un traspaso
// solo existe para la sesión que lo abrió y se olvida al cerrarla. Sin electron ni E/S.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import { randomUUID } from 'node:crypto'
import { VIDA_PENDIENTE_MS } from '../../shared/traspaso-ipc.ts'
import type { AgenteTraspaso } from './rutasTraspaso.ts'

/** Lo que espera a la apertura del destino. */
export interface TraspasoPendiente {
  profileId: string
  projectHostPath: string
  agente: AgenteTraspaso
  /** Frase para el aviso de arranque (rutas que cambian, o el aviso del traspaso derivado). */
  aviso: string | null
  /** Primer mensaje del destino (agente distinto). */
  promptInicial: string | null
  /** El Markdown del traspaso derivado, o null si el destino sigue la misma conversación. */
  contenido: string | null
}

interface Guardado extends TraspasoPendiente {
  caduca: number
}

function esDe(t: Guardado, de: { profileId: string; projectHostPath: string; agente: string }): boolean {
  return t.profileId === de.profileId && t.projectHostPath === de.projectHostPath && t.agente === de.agente
}

function datos(t: Guardado): TraspasoPendiente {
  return { profileId: t.profileId, projectHostPath: t.projectHostPath, agente: t.agente, aviso: t.aviso, promptInicial: t.promptInicial, contenido: t.contenido }
}

/** El almacén de los traspasos de esta ejecución. */
export class RegistroTraspasos {
  private readonly pendientes = new Map<string, Guardado>()
  /** Los reservados por una apertura en curso: nadie más los toma. */
  private readonly enApertura = new Map<string, Guardado>()
  private readonly porSesion = new Map<string, { profileId: string; contenido: string }>()
  private readonly ahora: () => number

  constructor(ahora: () => number = Date.now) {
    this.ahora = ahora
  }

  /** Guarda un pendiente y devuelve su id. */
  preparar(t: TraspasoPendiente): string {
    this.barrer()
    const id = randomUUID()
    this.pendientes.set(id, { ...t, caduca: this.ahora() + VIDA_PENDIENTE_MS })
    return id
  }

  /**
   * El pendiente si es de ESA apertura (mismo perfil, proyecto y agente) y no caducó; si no, null. No lo
   * toma: solo mira.
   */
  ver(id: string | undefined, de: { profileId: string; projectHostPath: string; agente: string }): TraspasoPendiente | null {
    if (!id) return null
    this.barrer()
    const t = this.pendientes.get(id)
    return t && esDe(t, de) ? datos(t) : null
  }

  /**
   * Toma el pendiente para una apertura que empieza, en el acto: una segunda apertura solapada del mismo id
   * ya no lo encuentra. Con `consumir` se gasta al salir bien; con `devolver`, si la apertura falla.
   */
  reservar(id: string | undefined, de: { profileId: string; projectHostPath: string; agente: string }): TraspasoPendiente | null {
    if (!id) return null
    this.barrer()
    const t = this.pendientes.get(id)
    if (!t || !esDe(t, de)) return null
    this.pendientes.delete(id)
    this.enApertura.set(id, t)
    return datos(t)
  }

  /** La apertura que lo había reservado falló: vuelve a estar pendiente, con su caducidad de antes. */
  devolver(id: string): void {
    const t = this.enApertura.get(id)
    if (!t) return
    this.enApertura.delete(id)
    this.pendientes.set(id, t)
  }

  /** La apertura salió bien: el pendiente se gasta y su contenido queda atado a la sesión abierta. */
  consumir(id: string, sesion: string): void {
    const t = this.enApertura.get(id) ?? this.pendientes.get(id)
    if (!t) return
    this.enApertura.delete(id)
    this.pendientes.delete(id)
    if (t.contenido !== null) this.porSesion.set(sesion, { profileId: t.profileId, contenido: t.contenido })
  }

  /** El contenido de una sesión, solo para su perfil; null si no tiene. */
  deSesion(sesion: string | undefined, perfilId: string): string | null {
    if (!sesion) return null
    const t = this.porSesion.get(sesion)
    return t && t.profileId === perfilId ? t.contenido : null
  }

  /** La sesión se cerró: su traspaso se va con ella. */
  olvidarSesion(sesion: string): void {
    this.porSesion.delete(sesion)
  }

  /** Cuántos hay de cada clase (las pruebas). */
  get tamano(): { pendientes: number; enApertura: number; sesiones: number } {
    return { pendientes: this.pendientes.size, enApertura: this.enApertura.size, sesiones: this.porSesion.size }
  }

  private barrer(): void {
    const ahora = this.ahora()
    for (const [id, t] of this.pendientes) if (t.caduca < ahora) this.pendientes.delete(id)
  }
}
