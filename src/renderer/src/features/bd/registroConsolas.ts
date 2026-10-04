// =============================================================================
// Registro de las consolas montadas, por `paneKey`: lo que la carcasa (`DbArea`) y el
// apagado necesitan preguntarles sin conocer su interior. Cerrar una consola puede
// exigir «¿Detener y cerrar?», resolver una transacción pendiente y vaciar su texto
// pendiente; eso lo sabe el pane, y la carcasa solo decide CUÁNDO se cierra. Al apagar
// se vacían TODAS, también las de otros perfiles montadas por keep-alive.
// Módulo sin React ni DOM: se puede probar con `node`.
// =============================================================================

/** Lo que una consola montada ofrece a la carcasa. */
export interface ApiConsolaRegistrada {
  /**
   * Pide cerrar la consola: pregunta lo que haga falta (ejecución en curso,
   * transacción pendiente) y resuelve `true` si se puede cerrar. `false` = el
   * usuario canceló.
   */
  solicitarCierre: () => Promise<boolean>
  /** Manda al main el texto pendiente del debounce. */
  vaciar: () => Promise<void>
}

const registro = new Map<string, ApiConsolaRegistrada>()

/** Registra la API de una consola; devuelve la función de baja. */
export function registrarConsola(paneKey: string, api: ApiConsolaRegistrada): () => void {
  registro.set(paneKey, api)
  return () => {
    // Solo da de baja si sigue siendo ESTA api: un remontaje rápido (StrictMode,
    // cambio de key) registra la nueva antes de que la vieja se despida.
    if (registro.get(paneKey) === api) registro.delete(paneKey)
  }
}

/** Cierre de una consola por su paneKey. Si no está registrada, se puede cerrar. */
export async function solicitarCierreConsola(paneKey: string): Promise<boolean> {
  const api = registro.get(paneKey)
  return api ? api.solicitarCierre() : true
}

/** Vacía el texto pendiente de todas las consolas montadas. Nunca lanza. */
export async function vaciarTodasLasConsolas(): Promise<void> {
  await Promise.all(
    [...registro.values()].map((api) => api.vaciar().catch(() => undefined))
  )
}
