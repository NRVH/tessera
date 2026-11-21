// =============================================================================
// React conserva el contenedor del portal. Solo se mueve su DOM entre los huecos.
// El hueco de la principal es un nodo propio y el registro lo conserva al desacoplar.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CAMBIO_VENTANA_ANFITRION } from '../../util/ventanaDe'
import { registrarAnfitrion, type VentanaFranja } from './ventanasFranja'

export function AnfitrionMovil({ perfil, zona, children }: {
  perfil: string
  zona: 'lienzo' | 'agentes'
  children: ReactNode
}): React.JSX.Element {
  const [anfitrion] = useState(() => {
    const nodo = document.createElement('div')
    nodo.className = 'anfitrion-movil'
    nodo.dataset.anfitrionMovil = ''
    return nodo
  })
  const limpiar = useRef<(() => void) | undefined>()
  const alMontar = useCallback((hueco: HTMLDivElement | null) => {
    limpiar.current?.()
    limpiar.current = hueco ? registrarAnfitrion(perfil, (hija: VentanaFranja | undefined) => {
      const destino = hija?.[zona] ?? hueco
      if (anfitrion.parentNode === destino) return
      const documento = destino.ownerDocument
      const cambiaDocumento = anfitrion.ownerDocument !== documento
      if (cambiaDocumento) documento.adoptNode(anfitrion)
      destino.append(anfitrion)
      const ventana = documento.defaultView
      if (cambiaDocumento && ventana) anfitrion.dispatchEvent(new ventana.Event(CAMBIO_VENTANA_ANFITRION))
    }) : undefined
    if (!hueco) anfitrion.remove()
  }, [anfitrion, perfil, zona])
  return (
    <>
      <div ref={alMontar} className="anfitrion-movil" />
      {createPortal(children, anfitrion)}
    </>
  )
}
