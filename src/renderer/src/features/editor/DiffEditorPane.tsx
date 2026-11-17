// =============================================================================
// Columna central: DIFF EDITOR de Monaco (dos modelos, original|modified) que ocupa la
// misma columna que PaneEditor, nunca ambas a la vez. Es "tonto": pide los dos lados
// que le indican, y si el derecho es el archivo en disco lo presta el registro de modelos.
// El estado y los efectos viven en useDiffEditor; la cabecera, en DiffCabecera.
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import { AvisoCaja } from '../../comun/AvisoCaja'
import { useEffect, useRef, useState } from 'react'
import { MS_ENTRADA, movimientoReducido } from '../../comun/presencia'
import { Presente } from '../../comun/Presente'
import { DiffCabecera } from './DiffCabecera'
import { LupaDiff } from './DiffLupa'
import { useDiffEditor, useDiffListo } from './useDiffEditor'
import { useEntradaContenido } from '../../comun/useEntradaContenido'
import type { PropsPaneDiffEditor } from './diffEditorTipos'

/** Pane de diff de Monaco: un tab montado por diff, oculto (no desmontado) si no está activo. */
export function PaneDiffEditor(pane: PropsPaneDiffEditor): React.JSX.Element {
  const { visible, sobreElHost, aviso } = pane
  const estado = useDiffEditor(pane)
  // El aviso externo gana: lo que se pinta y lo que se esconde salen los dos de aquí.
  const avisoVisible = aviso ?? estado.problema
  const listo = useDiffListo(estado.numCambios !== null || !!avisoVisible, (pane.colapsarSinCambios ?? false) && estado.hayPlegable, estado.inst.diffEditorRef)
  // Solo el texto: la cabecera no parpadea al cambiar de archivo, de modo o de plegado.
  // Solo ya listo: una animación manda sobre el `opacity: 0` del host y enseñaría el texto sin plegar.
  useEntradaContenido(JSON.stringify([pane.destino, estado.modoEfectivo, pane.colapsarSinCambios ?? false]), visible && listo, estado.inst.hostRef)
  const [avisoDesplegado, setAvisoDesplegado] = useState(false)
  useEffect(() => {
    if (!avisoVisible) { setAvisoDesplegado(false); return }
    const t = setTimeout(() => setAvisoDesplegado(true), movimientoReducido() ? 0 : MS_ENTRADA)
    return () => clearTimeout(t)
  }, [avisoVisible])
  const ultimoAviso = useRef(avisoVisible)
  if (avisoVisible) ultimoAviso.current = avisoVisible
  return (
    <section
      className={`editor${visible ? '' : ' hidden'}`}
      aria-label="Diff"
      aria-hidden={!visible}
    >
      <DiffCabecera pane={pane} estado={estado} avisoVisible={avisoVisible} />
      {sobreElHost}
      <Presente visible={!!avisoVisible} className="mov-despliega">
        {ultimoAviso.current && (
        <AvisoCaja
          titulo={ultimoAviso.current.titulo}
          sugerencia={ultimoAviso.current.pista}
          detalle={ultimoAviso.current.detalle}
        />
        )}
      </Presente>
      {/* El host no se desmonta al haber un problema: se oculta, para no recrear el editor. */}
      <div
        className="editor-host"
        ref={estado.inst.hostRef}
        style={{ ...(avisoVisible && avisoDesplegado ? { visibility: 'hidden' } : {}), ...(listo ? {} : { opacity: 0 }) }}
      />
      {visible && !avisoVisible && estado.lupa && <LupaDiff lupa={estado.lupa} />}
    </section>
  )
}
