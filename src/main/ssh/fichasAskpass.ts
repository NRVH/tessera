// =============================================================================
// Las fichas del programa de contraseñas: un token por proceso ssh, atado a UNA conexión (y a los bastiones
// por los que salta, que también preguntan), con vida y usos
// contados. Viaja en `TESSERA_SSH_TOKEN` del ssh lanzado y `ssh.askpass` lo exige; se compara en tiempo
// constante y se revoca al cerrar o reconectar la pestaña. Sin temporizadores: la caducidad se mira al
// usarla. El reloj y el generador de tokens se inyectan para las pruebas.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { randomBytes, timingSafeEqual } from 'node:crypto'

/** Cuánto vive una ficha, cuántas preguntas contesta y si lo que no contesta Tessera se le pregunta al usuario. */
export interface UsoFicha {
  vidaMs: number
  usos: number
  /** Lo que no es el secreto guardado (o el guardado ya rechazado) lo contesta el usuario en un diálogo. */
  dialogo?: boolean
}

/**
 * Una pestaña o el explorador SFTP: margen para llegar al prompt con la red lenta y para que el usuario
 * conteste en el diálogo, y las tres preguntas de ssh por método más un segundo factor.
 */
export const FICHA_PESTANA: UsoFicha = { vidaMs: 300_000, usos: 8, dialogo: true }

/** «Probar»: su tope es de 20 s; la ficha no tiene por qué vivir más que un minuto. */
export const FICHA_PRUEBA: UsoFicha = { vidaMs: 60_000, usos: 2 }

/** `tssh`: el margen de una pestaña y un uso más; `ssh.terminar` la revoca en cuanto acaba el proceso. */
export const FICHA_AGENTE: UsoFicha = { vidaMs: 120_000, usos: 3 }

/** El túnel de una base de datos: solo el secreto guardado, sin diálogo; se revoca en cuanto el túnel abre. */
export const FICHA_TUNEL: UsoFicha = { vidaMs: 60_000, usos: 3 }

interface Viva {
  conexionId: string
  /** Los bastiones por los que salta su ssh, que pregunta también por ellos. */
  saltos: readonly string[]
  caduca: number
  usos: number
  /** Recibió una pregunta que Tessera no contesta (un código, un PIN…). */
  sinContestar: boolean
  dialogo: boolean
  /** Las conexiones de las que ya dio el secreto guardado: si se vuelve a pedir, el servidor lo rechazó. */
  secretoDado: Set<string>
}

/** Lo que se puede sustituir en una prueba. */
export interface OpcionesFichasAskpass {
  ahora?: () => number
  nuevoToken?: () => string
}

/** Las fichas vivas del programa de contraseñas. */
export class FichasAskpass {
  private readonly vivas = new Map<string, Viva>()
  private readonly ahora: () => number
  private readonly nuevoToken: () => string

  // Sin propiedades de parámetro: los test-*.mts corren con `node` a secas, que no las admite.
  constructor(opciones: OpcionesFichasAskpass = {}) {
    this.ahora = opciones.ahora ?? Date.now
    this.nuevoToken = opciones.nuevoToken ?? (() => randomBytes(24).toString('hex'))
  }

  /** Una ficha nueva para la conexión `conexionId` y sus bastiones (cada uno con los usos de una conexión). */
  emitir(conexionId: string, uso: UsoFicha, saltos: readonly string[] = []): string {
    this.podar()
    const token = this.nuevoToken()
    const viva: Viva = {
      conexionId,
      saltos: [...saltos],
      caduca: this.ahora() + uso.vidaMs,
      usos: uso.usos * (1 + saltos.length),
      sinContestar: false,
      dialogo: uso.dialogo === true,
      secretoDado: new Set()
    }
    this.vivas.set(token, viva)
    return token
  }

  /** La conexión y sus bastiones, sin gastar un uso; vacía si la ficha no vale. */
  conexiones(token: string): string[] {
    const viva = this.buscar(token)
    return viva === null ? [] : [viva.conexionId, ...viva.saltos]
  }

  /** ¿Lo que Tessera no contesta se le pregunta al usuario? */
  conDialogo(token: string): boolean {
    return this.buscar(token)?.dialogo === true
  }

  /** Anota que la ficha ya dio el secreto guardado de `id` (por defecto, su conexión). */
  anotarSecretoDado(token: string, id?: string): void {
    const viva = this.buscar(token)
    if (viva !== null) viva.secretoDado.add(id ?? viva.conexionId)
  }

  /** ¿Dio ya esa ficha el secreto guardado de `id` (por defecto, su conexión)? */
  secretoDado(token: string, id?: string): boolean {
    const viva = this.buscar(token)
    return viva !== null && viva.secretoDado.has(id ?? viva.conexionId)
  }

  /**
   * Gasta un uso de la ficha y devuelve su conexión; `null` si no existe, caducó o ya no le quedan usos
   * (el mismo `null` para los tres: quien prueba tokens no sabe cuál va por buen camino).
   */
  usar(token: string): string | null {
    this.podar()
    const viva = this.buscar(token)
    if (viva === null || viva.usos <= 0) return null
    viva.usos -= 1
    return viva.conexionId
  }

  /** Anota que la ficha recibió una pregunta que Tessera no contesta. */
  anotarSinContestar(token: string): void {
    const viva = this.buscar(token)
    if (viva !== null) viva.sinContestar = true
  }

  /** ¿Recibió esa ficha alguna pregunta que Tessera no contesta? */
  sinContestar(token: string): boolean {
    return this.buscar(token)?.sinContestar === true
  }

  /** La ficha deja de valer (la pestaña se cerró o se reconectó; «Probar» terminó). */
  revocar(token: string): void {
    const encontrada = this.claveDe(token)
    if (encontrada !== null) this.vivas.delete(encontrada)
  }

  /** Cuántas hay vivas. */
  get cuantas(): number {
    this.podar()
    return this.vivas.size
  }

  private podar(): void {
    const t = this.ahora()
    for (const [token, viva] of this.vivas) if (viva.caduca <= t) this.vivas.delete(token)
  }

  private buscar(token: string): Viva | null {
    const clave = this.claveDe(token)
    return clave === null ? null : (this.vivas.get(clave) ?? null)
  }

  /** La clave del mapa que es ese token, comparando en tiempo constante respecto al valor. */
  private claveDe(token: string): string | null {
    if (typeof token !== 'string' || token === '') return null
    const buscado = Buffer.from(token, 'utf-8')
    let encontrada: string | null = null
    for (const candidato of this.vivas.keys()) {
      const bufer = Buffer.from(candidato, 'utf-8')
      if (bufer.length === buscado.length && timingSafeEqual(bufer, buscado)) encontrada = candidato
    }
    return encontrada
  }
}
