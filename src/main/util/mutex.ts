// =============================================================================
// MutexPorClave: serializa secciones críticas ASÍNCRONAS por CLAVE. Cada clave tiene su cadena de
// promesas; `ejecutarExclusivo(key, fn)` encola `fn` tras lo último de esa clave y resuelve con su
// resultado; claves distintas corren en paralelo y la entrada se limpia al vaciarse. Lo usan el
// sandbox (por perfil: montajes y parada no se solapan), git (por repo: `.git/index.lock`) y los
// almacenes del explorador de BD (por perfil: el `.tmp` de `escribirArchivoAtomico`). `vaciar()` espera
// lo encolado hasta ese momento y `ocupado` dice si queda algo. NO es reentrante: la misma clave
// desde dentro de su sección bloquea; quien lo necesite delega en un cuerpo interno que no re-adquiere.
// =============================================================================

export class MutexPorClave {
  /** Última promesa encolada por clave (siempre resuelta, nunca rechaza). */
  private readonly colas = new Map<string, Promise<unknown>>()

  /**
   * Corre `fn` en EXCLUSIVA para `key`: espera a que termine lo anterior de esa
   * clave (pase lo que pase con ello) y entonces ejecuta `fn`. Devuelve la promesa
   * de `fn` tal cual (propaga su valor o su error al llamador). La cadena interna
   * nunca se rompe aunque `fn` rechace: el siguiente en la cola corre igual.
   */
  ejecutarExclusivo<T>(clave: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.colas.get(clave) ?? Promise.resolve()
    const ejecutar = prev.then(() => fn())
    // La nueva cola es una versión de `run` que SIEMPRE resuelve (traga el error),
    // para que un fallo de `fn` no deje la cadena en estado rechazado.
    const cola = ejecutar.then(
      () => undefined,
      () => undefined
    )
    this.colas.set(clave, cola)
    // Limpia la clave cuando ESTA cola sea la última (evita fuga de claves muertas).
    void cola.then(() => {
      if (this.colas.get(clave) === cola) this.colas.delete(clave)
    })
    return ejecutar
  }

  /**
   * Resuelve cuando termina lo encolado HASTA AHORA en todas las claves. Nunca rechaza
   * (las colas ya tragan el error); lo que se encole después no se espera.
   */
  async vaciar(): Promise<void> {
    await Promise.all([...this.colas.values()])
  }

  /**
   * ¿Queda algo encolado o en curso en ALGUNA clave? Para quien necesita esperar «hasta
   * que no quede nada», incluido lo que se encole mientras espera: repite `vaciar()`
   * mientras esto sea cierto (el AlmacenConsolas al cerrar la app). Tras `await vaciar()`
   * las claves que terminaron ya están limpias: la limpieza se engancha a la cola al
   * encolar, antes que la espera de `vaciar`, así que corre primero.
   */
  get ocupado(): boolean {
    return this.colas.size > 0
  }
}
