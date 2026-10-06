// =============================================================================
// El popover del lanzador de conexiones SSH: un diálogo no modal anclado al botón dividido de la
// cabecera de la terminal, alineado a su borde izquierdo y que sale hacia arriba si abajo no cabe. Se
// cierra con Esc, un clic fuera, al conectar y al abrir un diálogo (quien lo monta lo cierra además si cambia
// la pantalla completa, y le da un ancla nueva si cambia el panel o la ventana), y el foco vuelve a quien
// lo tenía. Va a la capa flotante, bajo el menú contextual. Depende de `comun/`.
// Decisiones: docs/decisiones/terminales/lanzador-de-conexiones.md
// =============================================================================

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { EnCapaFlotante } from '../../comun/capaFlotante'
import { HUECO, recolocar, type AnclaPopover, type PosicionPopover } from '../../comun/popoverFlotante'
import { useCierreYFoco } from '../../comun/usePopoverFlotante'
import { ListaConexionesSsh, type DatosListaConexionesSsh } from './ListaConexionesSsh'
import { ID_LANZADOR_SSH } from './rielSsh'

/** Lo que recibe el popover: lo de la lista, el rectángulo de su ancla y cómo cerrarse. */
export interface PropsPopoverConexionesSsh extends DatosListaConexionesSsh {
  ancla: AnclaPopover
  onCerrar: () => void
}

/** Esc lo cierra; lo que se teclea en un menú de la lista (va por portal y burbujea por React) no es suyo. */
function alTeclear(e: KeyboardEvent<HTMLDivElement>, onCerrar: () => void): void {
  if (e.key !== 'Escape' || !e.currentTarget.contains(e.target as Node)) return
  e.preventDefault()
  e.stopPropagation()
  onCerrar()
}

/** Coloca el popover bajo (o sobre) su ancla y lo vuelve a medir cuando cambia su tamaño (llega la lista, se filtra). */
function usePosicion(raizRef: React.RefObject<HTMLDivElement>, ancla: AnclaPopover): PosicionPopover {
  const [pos, setPos] = useState<PosicionPopover>({ left: ancla.left, top: ancla.bottom + HUECO })
  useLayoutEffect(() => {
    const el = raizRef.current
    if (!el) return
    const colocar = (): void => recolocar(el, () => ancla.left, ancla.top, ancla.bottom, setPos)
    colocar()
    const observador = new ResizeObserver(colocar)
    observador.observe(el)
    return () => observador.disconnect()
  }, [raizRef, ancla.left, ancla.top, ancla.bottom])
  return pos
}

/** El popover del lanzador de las conexiones SSH del perfil. */
export function PopoverConexionesSsh({ ancla, onCerrar, ...lista }: PropsPopoverConexionesSsh): React.JSX.Element {
  const raizRef = useRef<HTMLDivElement>(null)
  const filtroRef = useRef<HTMLInputElement>(null)
  useCierreYFoco(raizRef, filtroRef, onCerrar)
  // Con otra ventana de otro tamaño, quien lo monta le pasa un ancla nueva (se re-ancla en vez de cerrarse).
  const pos = usePosicion(raizRef, ancla)
  return (
    <EnCapaFlotante>
      <div
        ref={raizRef}
        id={ID_LANZADOR_SSH}
        className="ssh-popover"
        role="dialog"
        aria-label="Conexiones SSH"
        style={{ left: pos.left, top: pos.top }}
        onKeyDown={(e) => alTeclear(e, onCerrar)}
      >
        {/* Una lista por perfil: el filtro y el grupo elegido no se llevan de un perfil al otro. */}
        <ListaConexionesSsh
          key={lista.perfilId}
          {...lista}
          modo="flotante"
          filtroRef={filtroRef}
          alAbrirDialogo={onCerrar}
          onConectar={(c) => {
            lista.onConectar(c)
            onCerrar()
          }}
          onAbrirSftp={(c) => {
            lista.onAbrirSftp(c)
            onCerrar()
          }}
          onIrASesion={(id) => {
            lista.onIrASesion(id)
            onCerrar()
          }}
        />
      </div>
    </EnCapaFlotante>
  )
}
