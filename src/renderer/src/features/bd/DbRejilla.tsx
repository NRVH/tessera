// =============================================================================
// La rejilla del explorador de bases de datos: la usan la pestaña de datos y los
// resultados de la consola. Pinta, selecciona, copia y avisa de que se acerca al final;
// los datos y lo que necesita al servidor son del dueño. Edita solo en una pestaña de
// TABLA con identidad de fila (`edicion`). Las piezas viven en `rejilla/Rejilla*`,
// `rejilla/useRejilla*`, `rejillaAcciones.ts` y `rejillaEventos.ts`.
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import { useCallback, type CSSProperties } from 'react'
import { useBaseRejilla, useEstadoRejilla } from './rejilla/useRejillaBase'
import { useAnchosRejilla, useVentanaRejilla } from './rejilla/useRejillaGeometria'
import { useScrollRejilla } from './rejilla/useRejillaScroll'
import { useSeleccionRejilla } from './rejilla/useRejillaSeleccion'
import { useEfectosEdicionRejilla } from './rejilla/useRejillaEdicion'
import { useCerrarMenu, alMenuContextual } from './rejilla/RejillaMenu'
import { alCopiar, alDobleClic, alPulsar, alTeclear } from './rejilla/rejillaEventos'
import {
  idActivoDe,
  lienzoRejilla,
  menuRejilla,
  pildoraRejilla,
  vaciaRejilla,
  visorRejilla
} from './rejilla/RejillaCuerpo'
import type { DbRejillaEdicionProps, Rejilla } from './rejilla/rejillaTipos'
import './rejilla.css'
import './filtro/filtro.css'

export type { DbRejillaEdicionProps } from './rejilla/rejillaTipos'

/** La rejilla virtualizada en los dos ejes, con selección, copia, visor y edición. */
export function DbRejilla(props: DbRejillaEdicionProps): React.JSX.Element {
  // El orden de estos hooks es el de sus efectos: no se reordena.
  const b = useBaseRejilla(props)
  const e = useEstadoRejilla(b)
  const anchos = useAnchosRejilla(b)
  const g = { ...anchos, ...useVentanaRejilla(b, anchos) }
  const s = useScrollRejilla(b, g, e)
  useSeleccionRejilla(b, e, s)
  const r: Rejilla = { ...b, ...g, ...e, ...s }
  useEfectosEdicionRejilla(r)
  const cerrarMenu = useCerrarMenu(r)
  // Estable: `useDialogo` vuelve a escuchar Esc cada vez que cambia su `onClose`.
  const { setVisor } = e
  const cerrarVisor = useCallback((): void => setVisor(null), [setVisor])

  const { total, datos, altoFila, etiquetaAria } = props
  const { edicion, numFilas, numCols, k } = r
  const hayMas = datos?.hayMas ?? false
  const ariaFilas = total !== null ? total + k + 1 : hayMas ? -1 : numFilas + 1

  return (
    <div
      ref={r.raizRef}
      className={`db-rejilla${edicion ? ' editable' : ''}`}
      role="grid"
      tabIndex={0}
      aria-label={etiquetaAria}
      aria-rowcount={ariaFilas}
      aria-colcount={numCols + 1}
      aria-multiselectable="true"
      aria-readonly={edicion ? undefined : true}
      aria-activedescendant={idActivoDe(r)}
      style={{ '--db-alto-fila': `${altoFila}px` } as CSSProperties}
      onKeyDown={(ev) => alTeclear(r, ev)}
      onCopy={(ev) => alCopiar(r, ev)}
      onContextMenu={(ev) => alMenuContextual(r, ev)}
    >
      <div
        ref={r.scrollRef}
        className="db-rejilla-scroll"
        onScroll={r.alDesplazar}
        onPointerDown={(ev) => alPulsar(r, ev)}
        onDoubleClick={(ev) => alDobleClic(r, ev)}
      >
        {lienzoRejilla(r)}
      </div>
      {vaciaRejilla(r)}
      {pildoraRejilla(r)}
      {menuRejilla(r, cerrarMenu)}
      {visorRejilla(r, cerrarVisor)}
    </div>
  )
}
