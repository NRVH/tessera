// =============================================================================
// `nunca(x)`: el cierre de un `switch` exhaustivo (`default: return nunca(d)`).
// Con todos los casos cubiertos, `d` es `never` y compila; un caso nuevo (otro motor)
// rompe la compilación justo ahí, en vez de caer en silencio en la rama de otro.
// En ejecución, si llega un valor que no respeta su tipo (un registro de una versión
// más nueva leído sin validar), LANZA con el valor en el mensaje.
// Ni `default: throw` a mano (compila con un caso de menos) ni `satisfies never` (calla
// en ejecución). Neutral: lo importan main, renderer, tests y shared; sin DOM ni `process`.
// =============================================================================

/**
 * Cierre de un `switch` exhaustivo (ver la cabecera). `contexto` dice dónde, para que el
 * mensaje de un valor imposible en ejecución se pueda buscar.
 */
export function nunca(x: never, contexto?: string): never {
  let legible: string
  try {
    legible = typeof x === 'string' ? `«${x}»` : JSON.stringify(x) ?? String(x)
  } catch {
    legible = String(x)
  }
  throw new Error(`Caso sin contemplar${contexto ? ` en ${contexto}` : ''}: ${legible}`)
}
