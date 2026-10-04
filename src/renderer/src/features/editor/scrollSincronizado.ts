// =============================================================================
// Scroll sincronizado de la vista dividida (código y vista renderizada de un Markdown): el
// lado que se mueve lleva al otro a la MISMA fracción de su recorrido, y el movimiento que
// eso provoca en el otro lado (el eco, reconocido por su valor) no rebota. Puro: lo enchufa
// `useScrollSincronizado`.
// Decisiones: docs/decisiones/editor/scroll-sincronizado-vista-dividida.md
// =============================================================================

/** Lo que mide un lado: dónde está, cuánto hay y cuánto se ve. */
export interface MedidaScroll {
  top: number
  alto: number
  visible: number
}

export type Lado = 'codigo' | 'vista'

/** Fracción del recorrido ya hecha: 0 arriba, 1 abajo, 0 si no hay recorrido. */
export function fraccionDe(m: MedidaScroll): number {
  const recorrido = m.alto - m.visible
  if (!(recorrido > 0) || !Number.isFinite(m.top)) return 0
  return Math.min(1, Math.max(0, m.top / recorrido))
}

/** El `scrollTop` del otro lado que corresponde a esa fracción, acotado a su recorrido. */
export function topDestino(fraccion: number, destino: Pick<MedidaScroll, 'alto' | 'visible'>): number {
  const recorrido = destino.alto - destino.visible
  if (!(recorrido > 0)) return 0
  return Math.round(Math.min(1, Math.max(0, fraccion)) * recorrido)
}

/** Quien aplica un movimiento a un lado: lo que el hook sabe hacer con Monaco y con el DOM. */
export interface Aplicador {
  medir(lado: Lado): MedidaScroll
  mover(lado: Lado, top: number): void
}

export interface Sincronizador {
  /** Un lado se movió (por el usuario o por lo que sea): lleva al otro. Devuelve si lo movió. */
  alMoverse(lado: Lado): boolean
}

const otro = (lado: Lado): Lado => (lado === 'codigo' ? 'vista' : 'codigo')

/**
 * El sincronizador: al moverse un lado se mueve el otro, y el primer aviso que vuelve del otro
 * con JUSTO el valor que le pusimos es el eco y se ignora. Por valor y no por tiempo: el gesto
 * del usuario sobre Monaco llega animado (`smoothScrolling`), fotograma a fotograma, y cada
 * uno es un movimiento real que la vista sigue. Si lo que vuelve trae otro valor, el eco se da
 * por perdido. Un movimiento que ya deja al otro en su sitio no se aplica, y un «scroll» en el
 * que lo que cambió es la medida del lado (un repintado) y no su posición, tampoco.
 */
export function crearSincronizador(aplicador: Aplicador): Sincronizador {
  const esperado: Partial<Record<Lado, number>> = {}
  const ultimo: Partial<Record<Lado, MedidaScroll>> = {}
  return {
    alMoverse(lado) {
      const propio = aplicador.medir(lado)
      const anterior = ultimo[lado]
      ultimo[lado] = propio
      const eco = esperado[lado]
      if (eco !== undefined && Math.abs(propio.top - eco) <= 1) {
        esperado[lado] = undefined
        return false
      }
      // Llegó otro valor: el eco que esperábamos ya no va a venir (un refresco lo pisó), y
      // guardarlo haría pasar por eco el primer gesto real que cayera en ese mismo píxel.
      esperado[lado] = undefined
      // Cambió lo que mide el lado y no dónde está: es un repintado (la vista se refresca al
      // escribir, un diagrama termina de dibujarse, la ventana cambia de tamaño) y el navegador
      // ha acotado o repuesto el scroll. Nadie lo movió: no se propaga, el siguiente gesto
      // vuelve a casar los lados.
      if (anterior && (anterior.alto !== propio.alto || anterior.visible !== propio.visible)) return false
      if (anterior && anterior.top === propio.top) return false
      const destino = otro(lado)
      const medidaDestino = aplicador.medir(destino)
      const top = topDestino(fraccionDe(propio), medidaDestino)
      if (Math.abs(top - medidaDestino.top) < 1) return false
      esperado[destino] = top
      aplicador.mover(destino, top)
      return true
    }
  }
}
