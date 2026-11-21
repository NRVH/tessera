// =============================================================================
// La tarjeta de una cuenta de «Uso de las cuentas»: su nombre y dónde corre, y el mismo cuerpo que el desplegable del
// pie (una barra por ventana, cuándo se reinicia y de cuándo es el dato). Sale con puntero o foco de teclado en una
// cápsula fijada (encima), salvo con la lista o el menú abiertos, o con puntero en una fila (a su izquierda).
// Es informativa: no recibe el puntero.
// Decisiones: docs/decisiones/agentes/uso-ventanas-de-la-cuenta.md
// =============================================================================
import { useLayoutEffect, useRef, useState } from 'react'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { HUECO, MARGEN } from '../../comun/popoverFlotante'
import { CuerpoUso } from './CuerpoUso'
import type { CuentaUso } from './modeloUsoCuentas'
import { ModoCuenta, nombreCuenta } from './piezasUsoCuenta'
import { txContexto } from './textosContexto'

export type LadoTarjeta = 'arriba' | 'izquierda'

/** Dónde corre la cuenta, en corto, para el encabezado. */
function dondeCorre(cuenta: CuentaUso): string {
  const t = txContexto().uso
  return cuenta.accountId === null ? t.equipo : cuenta.cuenta?.global ? t.dondeGlobal : t.dondePerfil
}

/**
 * Encima del ancla y alineada con su borde derecho, o a la izquierda de `junto` (la lista) a la altura del ancla.
 * Siempre dentro de la ventana; se mide tras pintarla y otra vez si cambia su contenido (`medida`).
 */
function usePosicion(tarjeta: React.RefObject<HTMLDivElement>, ancla: HTMLElement, lado: LadoTarjeta, junto: HTMLElement | null, medida: unknown): { left: number; top: number } {
  const [pos, ponerPos] = useState({ left: -9999, top: -9999 })
  useLayoutEffect(() => {
    const el = tarjeta.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const r = ancla.getBoundingClientRect()
    const borde = (junto ?? ancla).getBoundingClientRect()
    const acotar = (v: number, max: number): number => Math.max(MARGEN, Math.min(v, max - MARGEN))
    const siguiente = lado === 'arriba'
      ? { left: acotar(r.right - width, window.innerWidth - width), top: acotar(r.top - height - HUECO, window.innerHeight - height) }
      : { left: acotar(borde.left - width - HUECO * 2, window.innerWidth - width), top: acotar(r.top + r.height / 2 - height / 2, window.innerHeight - height) }
    ponerPos((p) => (p.left === siguiente.left && p.top === siguiente.top ? p : siguiente))
  }, [tarjeta, ancla, lado, junto, medida])
  return pos
}

export function TarjetaCuenta({ cuenta, ancla, lado, conBotonDeInicio, junto = null }: { cuenta: CuentaUso; ancla: HTMLElement; lado: LadoTarjeta; conBotonDeInicio: boolean; junto?: HTMLElement | null }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const pos = usePosicion(ref, ancla, lado, junto, cuenta.foto)
  // El «se reinicia en…» se calcula al pintar: la tarjeta se repinta con cada lectura de su uso.
  const ahora = Date.now()
  return (
    <EnCapaFlotante>
      <div ref={ref} className="agent-usage-pop tarjeta-cuenta" role="tooltip" style={pos}>
        <div className="tarjeta-cuenta-cab">
          <ModoCuenta cuenta={cuenta} tam={14} />
          <span className="tarjeta-cuenta-nombre">{nombreCuenta(cuenta)}</span>
          <span className="tarjeta-cuenta-donde">{dondeCorre(cuenta)}</span>
        </div>
        <CuerpoUso agente={cuenta.agente} foto={cuenta.foto} ahora={ahora} conBotonDeInicio={conBotonDeInicio} sinSesion={cuenta.cuenta?.conSesion === false} />
      </div>
    </EnCapaFlotante>
  )
}

/** Ancla por puntero: salir o pulsar la quita. La cápsula resuelve el foco de teclado y la supresión por lista o menú. */
export function useAnclaTarjeta(): { ancla: HTMLElement | null; eventos: Pick<React.HTMLAttributes<HTMLElement>, 'onMouseEnter' | 'onMouseLeave' | 'onMouseDown'> } {
  const [ancla, ponerAncla] = useState<HTMLElement | null>(null)
  return {
    ancla,
    eventos: {
      onMouseEnter: (e) => ponerAncla(e.currentTarget),
      onMouseLeave: () => ponerAncla(null),
      onMouseDown: () => ponerAncla(null)
    }
  }
}
