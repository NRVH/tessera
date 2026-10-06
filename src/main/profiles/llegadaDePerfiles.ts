// =============================================================================
// La llegada de un perfil recién creado al main. El renderer guarda la lista de perfiles con unos 250 ms
// de espera (`features/pestanas/usePersistenciaTabs.ts`), así que preparar la carpeta del agente de la
// terminal o el espacio de datos de un perfil recién creado puede llegar ANTES que el guardado que lo
// trae. Quien prepara espera aquí, con tope, a que `SAVE_PROFILES` lo traiga, y después vuelve a mirar la
// lista con su guarda de siempre: un perfil que no llega sigue dando «Ese perfil no existe». Sin Electron.
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================

/**
 * Cuánto se espera a un perfil que aún no está: holgado sobre la espera del renderer (250 ms) más la
 * vuelta del IPC, y corto para que un id de verdad inexistente no cuelgue la petición.
 */
export const TOPE_LLEGADA_MS = 2000

/** Espera, con tope, a que un perfil aparezca en la lista viva del main. */
export class LlegadaDePerfiles {
  private readonly esperas = new Set<() => void>()
  private readonly ids: () => readonly string[]
  private readonly topeMs: number

  /**
   * @param ids los ids de la lista viva de CADA momento (`SAVE_PROFILES` la sustituye).
   * @param topeMs cuánto se espera como mucho; las pruebas lo acortan.
   */
  constructor(ids: () => readonly string[], topeMs: number = TOPE_LLEGADA_MS) {
    this.ids = ids
    this.topeMs = topeMs
  }

  /** Lo llama el guardado de perfiles justo después de sustituir la lista: despierta a quien espere. */
  cambiaron(): void {
    for (const mirar of [...this.esperas]) mirar()
  }

  /**
   * Resuelve cuando el perfil está en la lista, o al agotar el tope, SIN lanzar: quien espera vuelve a
   * mirar la lista y decide con su guarda. Un id que no es un texto no espera (lo rechaza la guarda).
   */
  esperar(profileId: unknown): Promise<void> {
    if (typeof profileId !== 'string' || this.ids().includes(profileId)) return Promise.resolve()
    return new Promise((resolver) => {
      const terminar = (): void => {
        clearTimeout(tope)
        this.esperas.delete(mirar)
        resolver()
      }
      const mirar = (): void => {
        if (this.ids().includes(profileId)) terminar()
      }
      const tope = setTimeout(terminar, this.topeMs)
      this.esperas.add(mirar)
    })
  }
}
