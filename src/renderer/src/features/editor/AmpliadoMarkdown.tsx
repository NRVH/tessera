// =============================================================================
// Ampliado dentro del pane del editor. Conserva el documento montado bajo el visor
// y presenta el SVG como imagen vectorial aislada, con sus propias etiquetas y tema.
// Decisiones: docs/decisiones/editor/diagramas-mermaid.md
// =============================================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCapaVisible } from '../../comun/capaVisible'
import { hayDialogos } from '../../comun/pilaDialogos'
import { atributosPresencia, usePresencia } from '../../comun/presencia'
import { esDeUnaListaDeSelect, esDeUnMenu } from '../../comun/useDialogo'
import { EscenarioImagen } from './EscenarioImagen'
import { IconoAmpliar, IconoVolver } from './iconosVisor'
import { txAmpliacionMarkdown } from './textosVisores'
import type { AmpliacionMarkdown, useAmpliacionMarkdown } from './useAmpliacionMarkdown'
import { useImagenAmpliable } from './useVisorImagen'

type ControlesAmpliacion = ReturnType<typeof useAmpliacionMarkdown>

export function BotonesAmpliarMarkdown({ controles }: { controles: ControlesAmpliacion }): React.ReactNode {
  const { ampliar } = txAmpliacionMarkdown()
  return controles.elementos.map((elemento) => createPortal(
    <button
      type="button"
      className="btn btn-icon ampliar-markdown"
      title={ampliar}
      aria-label={ampliar}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        controles.ampliar(elemento)
      }}
    >
      <IconoAmpliar />
    </button>,
    elemento.hueco,
    elemento.clave
  ))
}

function useUrlDiagrama(svg: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (svg === null) return
    const nueva = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    setUrl(nueva)
    return () => URL.revokeObjectURL(nueva)
  }, [svg])
  return url
}

function ContenidoAmpliado({
  nombre, elemento, visible, cerrar
}: {
  nombre: string
  elemento: AmpliacionMarkdown
  visible: boolean
  cerrar: () => void
}): React.JSX.Element {
  const t = txAmpliacionMarkdown()
  const botonVolver = useRef<HTMLButtonElement>(null)
  const vistaImagen = useImagenAmpliable(visible)
  const vectorial = elemento.tipo === 'diagrama'
  const urlDiagrama = useUrlDiagrama(vectorial ? elemento.svg : null)
  const titulo = vectorial ? t.diagrama(elemento.numero) : elemento.alternativo.trim() || t.imagen(elemento.numero)

  useLayoutEffect(() => {
    if (visible) botonVolver.current?.focus({ preventScroll: true })
  }, [visible])

  return (
    <div className="contenido-ampliado-markdown" {...(!visible && { inert: '', 'aria-hidden': true })}>
      <header className="panel-header editor-header cabecera-ampliacion-markdown">
        <button className="btn btn-icon" type="button" ref={botonVolver} onClick={cerrar} title={t.volver} aria-label={t.volver}>
          <IconoVolver />
        </button>
        <div className="ruta-ampliacion-markdown">
          <span className="tramo-ampliacion-markdown" title={nombre}>{nombre}</span>
          <span aria-hidden="true">{'›'}</span>
          <span className="tramo-ampliacion-markdown" title={titulo}>{titulo}</span>
        </div>
      </header>
      <EscenarioImagen
        nombre={titulo}
        url={vectorial ? urlDiagrama : elemento.url}
        fondo={vectorial ? elemento.fondo : null}
        vistaImagen={vistaImagen}
        vectorial={vectorial}
        clase="escenario-ampliacion-markdown"
      />
    </div>
  )
}

export function AmpliadoMarkdown({ nombre, controles }: { nombre: string; controles: ControlesAmpliacion }): React.JSX.Element | null {
  const { elementoActivo, cerrar } = controles
  const capaVisible = useCapaVisible()
  const presencia = usePresencia(elementoActivo !== null)
  const ultimo = useRef(elementoActivo)
  if (elementoActivo !== null || !presencia.montado) ultimo.current = elementoActivo

  // Esc en window: arrastrar en el escenario lleva el foco a body; diálogos y menús encima tienen prioridad.
  const abierto = elementoActivo !== null && capaVisible
  useEffect(() => {
    if (!abierto) return
    function alPulsarTeclaVentana(e: KeyboardEvent): void {
      if (
        e.key !== 'Escape' ||
        e.defaultPrevented ||
        hayDialogos(document) ||
        esDeUnaListaDeSelect(e.target) ||
        esDeUnMenu(e.target) ||
        document.querySelector('.ctx-menu:not(.mov-despedida):not(.capa-viva.oculta *)') !== null
      ) return
      e.preventDefault()
      cerrar()
    }
    window.addEventListener('keydown', alPulsarTeclaVentana)
    return () => window.removeEventListener('keydown', alPulsarTeclaVentana)
  }, [abierto, cerrar])

  if (!presencia.montado || !ultimo.current) return null
  return (
    <div className="ampliado-markdown mov-aparece" {...atributosPresencia(presencia)}>
      <ContenidoAmpliado key={ultimo.current.clave} nombre={nombre} elemento={ultimo.current} visible={elementoActivo !== null} cerrar={cerrar} />
    </div>
  )
}
