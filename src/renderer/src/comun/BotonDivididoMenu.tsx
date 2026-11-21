// =============================================================================
// BotonDivididoMenu: el botón dividido cuya flecha abre un menú de opciones. Es el alojamiento de ese caso: guarda
// si el menú está abierto, lo coloca bajo el botón en la capa flotante del documento donde vive (principal o ventana
// desacoplada) y devuelve el foco a la flecha al cerrarlo con el teclado. La principal hace lo de siempre.
// Depende de `BotonDividido`, `MenuContextual` y `capaFlotante`.
// Decisiones: docs/decisiones/renderer/boton-dividido-y-capa-flotante.md
// =============================================================================
import { useRef, useState } from 'react'
import { BotonDividido, type PropsBotonDividido } from './BotonDividido'
import { EnCapaFlotante } from './capaFlotante'
import { MenuContextual, type EntradaMenuContextual } from './MenuContextual'
import { documentoDe } from '../util/ventanaDe'

/** Separación entre el botón y su menú, la de los demás menús que cuelgan de un botón. */
const SEPARACION_MENU = 4

type PropsAlojadas = 'grupoRef' | 'flechaAbierta' | 'flechaControla' | 'onFlecha' | 'despliega'

export function BotonDivididoMenu({ entradas, ...p }: Omit<PropsBotonDividido, PropsAlojadas> & {
  /** Sin entradas, la flecha no abre el menú. */
  entradas: EntradaMenuContextual[]
}): React.JSX.Element {
  const grupoRef = useRef<HTMLSpanElement>(null)
  const disparador = useRef<HTMLElement | null>(null)
  const [posicion, setPosicion] = useState<{ x: number; y: number } | null>(null)
  const puedeAbrir = !p.sinFlecha && entradas.length > 0
  const cerrar = (): void => setPosicion(null)
  if (!puedeAbrir && posicion !== null) cerrar()
  const alternar = (): void => {
    if (!puedeAbrir) return
    if (posicion !== null) return cerrar()
    const grupo = grupoRef.current
    if (grupo === null) return
    const caja = grupo.getBoundingClientRect()
    disparador.current = grupo.querySelector<HTMLElement>('.boton-dividido-flecha')
    setPosicion({ x: caja.left, y: caja.bottom + SEPARACION_MENU })
  }
  return (
    <>
      <BotonDividido
        {...p}
        grupoRef={grupoRef}
        despliega="menu"
        flechaAbierta={posicion !== null}
        onFlecha={alternar}
      />
      {posicion !== null && (
        <EnCapaFlotante documento={documentoDe(grupoRef.current)}>
          <MenuContextual x={posicion.x} y={posicion.y} items={entradas} onCerrar={cerrar} disparador={disparador} />
        </EnCapaFlotante>
      )}
    </>
  )
}
