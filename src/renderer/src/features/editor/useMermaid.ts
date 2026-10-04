// =============================================================================
// Rellena con SVG los huecos de diagrama que deja el render de HTML (`CLASE_MERMAID`), tanto de
// los bloques mermaid de un .md como de un .mmd entero. Hook aparte por la cancelación: el
// dibujo es asíncrono y el HTML se reescribe entero en cada pulsación.
// =============================================================================

import { useEffect, useRef } from 'react'
import { CLASE_MERMAID, CLASE_MERMAID_LISTO } from './htmlContent'
import { dibujarMermaid } from './mermaidRender'

/** Dibuja los diagramas de `contenedor` cada vez que `html` cambia (el nodo no cambia entre repintados). */
export function useMermaid(
  contenedor: React.RefObject<HTMLElement | null>,
  html: string,
  activo: boolean,
  alTerminar?: () => void
): void {
  // El callback va en un ref y no en las deps: su identidad cambia en cada render.
  const alTerminarRef = useRef(alTerminar)
  alTerminarRef.current = alTerminar

  useEffect(() => {
    if (!activo) return
    const raiz = contenedor.current
    if (!raiz) return
    // `:not(.dibujado)` hace idempotente volver a pasar: un hueco resuelto no vuelve a entrar.
    const huecos = [
      ...raiz.querySelectorAll<HTMLElement>(`.${CLASE_MERMAID}:not(.${CLASE_MERMAID_LISTO})`)
    ]
    if (huecos.length === 0) return
    // Mientras hay pendientes el documento mide de menos (un hueco pendiente va con
    // `height: 0`): por eso se avisa al terminar.

    // Cancelación por bandera: llega un `html` nuevo cada 120 ms y una pasada vieja aterrizaría
    // sobre nodos ya ausentes o sobre los de la pasada nueva.
    let cancelado = false

    void (async () => {
      for (const hueco of huecos) {
        // El texto del diagrama es el contenido del hueco (en un atributo, DOMPurify lo borra).
        const texto = hueco.textContent ?? ''
        const r = await dibujarMermaid(texto)
        // Cancelado: la pasada ya no vale. Un hueco desconectado es solo ese nodo: `continue`.
        if (cancelado) return
        if (!hueco.isConnected) continue
        if (r.ok) {
          hueco.innerHTML = r.svg
          hueco.classList.remove('con-error')
        } else {
          // El error se enseña donde estaba el diagrama, con el texto de mermaid.
          hueco.classList.add('con-error')
          hueco.textContent = `No se pudo dibujar el diagrama: ${r.error}`
        }
        // Se marca siempre, salga bien o mal: lo saca de los pendientes y del `height: 0`.
        hueco.classList.add(CLASE_MERMAID_LISTO)
      }
      if (!cancelado) alTerminarRef.current?.()
    })()

    return () => {
      cancelado = true
    }
  }, [contenedor, html, activo])
}
