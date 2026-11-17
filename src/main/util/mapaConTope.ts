// =============================================================================
// mapaConTope: un `map` asíncrono con como mucho `tope` tareas en vuelo, que conserva
// el orden de los resultados. Para tandas de E/S (stat, readdir) que en paralelo sin
// límite ahogarían el bucle de eventos. Puro; lo usan escanearRepos y listadoTranscripciones.
// =============================================================================

/**
 * Recorre `items` con como mucho `tope` llamadas a `fn` a la vez; resultados en su orden.
 * Un tope menor que 1 se trata como 1: sin obreros no se ejecutaría nada.
 */
export async function mapaConTope<T, R>(
  elementos: readonly T[],
  tope: number,
  fn: (elemento: T, indice: number) => Promise<R>
): Promise<R[]> {
  const salida = new Array<R>(elementos.length)
  let siguiente = 0
  const obreros = Array.from({ length: Math.min(Math.max(1, Math.floor(tope)), elementos.length) }, async () => {
    for (;;) {
      const i = siguiente++
      if (i >= elementos.length) return
      salida[i] = await fn(elementos[i], i)
    }
  })
  await Promise.all(obreros)
  return salida
}
