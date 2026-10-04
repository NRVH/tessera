// =============================================================================
// Estado en memoria del explorador y su único dueño: la consola de cada `perfil|consola`, su
// esquema elegido, las esperas al renderer y las peticiones de datos que el main aún prepara.
// Lo crea la fachada; los módulos de `controlador/` lo usan solo por sus métodos.
// Decisiones: docs/decisiones/bd/explorador-controlador.md
// =============================================================================

import type { DbPestanaSinEnviar } from '../../../../shared/db-explorador-ipc.ts'

/** Clave de una petición de rol 'datos' en preparación: la misma que manda el Stop. */
function claveDatos(conexionId: string, peticionId: string): string {
  return `${conexionId}|${peticionId}`
}

function claveConsola(perfilId: string, consolaId: string): string {
  return `${perfilId}|${consolaId}`
}

/** La marca de una petición en preparación: el Stop la apunta y quien prepara la mira. */
export interface MarcaPreparacion {
  detenido(): boolean
  /** Fin de la preparación: la marca deja de existir. */
  soltar(): void
}

type Resolver = (p: DbPestanaSinEnviar[]) => void

/** Estado compartido por los módulos del controlador del explorador. */
export class EstadoExplorador {
  /** `perfil|consola` -> conexión (de `indice.json`). */
  private readonly conexionDe = new Map<string, string>()
  /** `perfil|consola` -> esquema elegido (de `indice.json`); ausente = el de la conexión. */
  private readonly esquemaDe = new Map<string, string>()
  /** `perfil|consola` con un cambio de esquema en vuelo: un `listar` no debe pisar `esquemaDe`. */
  private readonly esquemaEnVuelo = new Set<string>()
  /** Acuses pendientes de `dbx:consolas:vaciadas`. */
  private readonly esperasVaciado = new Set<() => void>()
  /** La pregunta de salida en curso al renderer por los cambios sin enviar, con su `id`. */
  private esperaSinEnviar: { id: number; resolver: Resolver } | null = null
  private ultimoIdSinEnviar = 0
  /** Peticiones de rol 'datos' que el main aún prepara, por `conexion|peticionId`. */
  private readonly enPreparacion = new Map<string, Set<{ detenido: boolean }>>()

  conexionDeConsola(perfilId: string, consolaId: string): string | undefined {
    return this.conexionDe.get(claveConsola(perfilId, consolaId))
  }

  /** Lo que dice el índice de una consola; mientras su esquema cambia, manda el cambio en vuelo. */
  recordarConsola(perfilId: string, consolaId: string, conexionId: string, esquema: string | undefined): void {
    const k = claveConsola(perfilId, consolaId)
    this.conexionDe.set(k, conexionId)
    if (this.esquemaEnVuelo.has(k)) return
    if (esquema !== undefined) this.esquemaDe.set(k, esquema)
    else this.esquemaDe.delete(k)
  }

  /** La consola se borró: fuera su conexión y su esquema. */
  olvidarConsola(perfilId: string, consolaId: string): void {
    const k = claveConsola(perfilId, consolaId)
    this.conexionDe.delete(k)
    this.esquemaDe.delete(k)
  }

  /** Olvida las consolas atadas a `conexionId`; con `perfilId`, solo las de ese perfil. */
  olvidarConsolasDeConexion(conexionId: string, perfilId?: string): void {
    const prefijo = perfilId === undefined ? null : `${perfilId}|`
    for (const [k, v] of [...this.conexionDe]) {
      if (v !== conexionId || (prefijo !== null && !k.startsWith(prefijo))) continue
      this.conexionDe.delete(k)
      this.esquemaDe.delete(k)
    }
  }

  esquemaDeConsola(perfilId: string, consolaId: string): string | undefined {
    return this.esquemaDe.get(claveConsola(perfilId, consolaId))
  }

  /** `null` o `undefined` = el de la conexión. */
  fijarEsquemaDeConsola(perfilId: string, consolaId: string, esquema: string | null | undefined): void {
    const k = claveConsola(perfilId, consolaId)
    if (esquema === null || esquema === undefined) this.esquemaDe.delete(k)
    else this.esquemaDe.set(k, esquema)
  }

  /**
   * Olvida el esquema `perdido` de una consola (el servidor ya no lo tiene) solo si sigue siendo
   * el guardado y no hay un cambio en vuelo: si mientras tanto el usuario eligió otro, lo elegido
   * manda. Devuelve si lo olvidó, para que el índice en disco haga lo mismo.
   */
  olvidarEsquemaPerdido(perfilId: string, consolaId: string, perdido: string): boolean {
    const k = claveConsola(perfilId, consolaId)
    if (this.esquemaEnVuelo.has(k) || this.esquemaDe.get(k) !== perdido) return false
    this.esquemaDe.delete(k)
    return true
  }

  /** Marca un cambio de esquema en vuelo; false si ya había uno en esa consola. */
  empezarCambioDeEsquema(perfilId: string, consolaId: string): boolean {
    const k = claveConsola(perfilId, consolaId)
    if (this.esquemaEnVuelo.has(k)) return false
    this.esquemaEnVuelo.add(k)
    return true
  }

  terminarCambioDeEsquema(perfilId: string, consolaId: string): void {
    this.esquemaEnVuelo.delete(claveConsola(perfilId, consolaId))
  }

  /** Abre la pregunta de «sin enviar» (sustituye a la anterior) y devuelve su id. */
  abrirEsperaSinEnviar(resolver: Resolver): number {
    const id = ++this.ultimoIdSinEnviar
    this.esperaSinEnviar = { id, resolver }
    return id
  }

  /** Cierra la pregunta `id` si sigue siendo la que está en curso. */
  cerrarEsperaSinEnviar(id: number): void {
    if (this.esperaSinEnviar?.id === id) this.esperaSinEnviar = null
  }

  /** Responde la pregunta en curso con lo que `leer` saque para su id (null = no es la respuesta). */
  responderSinEnviar(leer: (id: number) => DbPestanaSinEnviar[] | null): void {
    const espera = this.esperaSinEnviar
    if (!espera) return
    const pestanas = leer(espera.id)
    if (pestanas === null) return
    this.esperaSinEnviar = null
    espera.resolver(pestanas)
  }

  /** Promesa que se cumple con el próximo acuse de vaciado. */
  esperarVaciado(): Promise<void> {
    return new Promise<void>((resolve) => this.esperasVaciado.add(resolve))
  }

  acusarVaciado(): void {
    for (const resolver of [...this.esperasVaciado]) resolver()
    this.esperasVaciado.clear()
  }

  /** Se dejó de esperar (acuse o plazo): un acuse tardío ya no resuelve nada. */
  olvidarEsperasDeVaciado(): void {
    this.esperasVaciado.clear()
  }

  hayEnPreparacion(conexionId: string, peticionId: string): boolean {
    return this.enPreparacion.has(claveDatos(conexionId, peticionId))
  }

  /**
   * Apunta una petición en preparación. Un CONJUNTO por clave: dos con el mismo id a la vez
   * se paran las dos, y la que acaba no borra la marca de la otra.
   */
  apuntarPreparacion(conexionId: string, peticionId: string): MarcaPreparacion {
    const clave = claveDatos(conexionId, peticionId)
    const marca = { detenido: false }
    let marcas = this.enPreparacion.get(clave)
    if (!marcas) {
      marcas = new Set()
      this.enPreparacion.set(clave, marcas)
    }
    const deEsta = marcas
    deEsta.add(marca)
    return {
      detenido: () => marca.detenido,
      soltar: () => {
        deEsta.delete(marca)
        if (deEsta.size === 0 && this.enPreparacion.get(clave) === deEsta) this.enPreparacion.delete(clave)
      }
    }
  }

  /** El Stop de una petición que aún se prepara: sus marcas quedan detenidas. */
  detenerPreparacion(conexionId: string, peticionId: string): void {
    for (const marca of this.enPreparacion.get(claveDatos(conexionId, peticionId)) ?? []) marca.detenido = true
  }
}
