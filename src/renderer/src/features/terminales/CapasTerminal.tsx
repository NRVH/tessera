// =============================================================================
// Capas que un `TerminalPane` pinta sobre su xterm, como hermanas del hueco: el
// buscador, las miniaturas de las imágenes pegadas y el menú de Copiar/Pegar. Devuelve
// un fragmento (sin envoltorio: el CSS selecciona por la estructura del pane).
// =============================================================================

import { MenuContextual } from '../../comun/MenuContextual'
import { Presente } from '../../comun/Presente'
import './terminalSsh.css'
import { useRef } from 'react'
import { CajaBusqueda } from '../../comun/CajaBusqueda'
import { ChipsImagenTerminal } from './ChipsImagenTerminal'
import { txTerminales } from './textos.ts'
import type { InterfazTerminal } from './useInterfazTerminal'

interface PropsMenuContextualTerminalPuro {
  x: number
  y: number
  puedeCopiar: boolean
  onCopiar: () => void
  onPegar: () => void
  onCerrar: () => void
}

/**
 * Popover de Copiar/Pegar (clic derecho): `position: fixed` en (x, y), se cierra al hacer
 * clic fuera o con Escape y detiene su propio mousedown para no auto-cerrarse.
 */
function MenuContextualTerminalPuro({
  x,
  y,
  puedeCopiar,
  onCopiar,
  onPegar,
  onCerrar
}: PropsMenuContextualTerminalPuro): React.JSX.Element {
  const t = txTerminales()
  return <MenuContextual x={x} y={y} onCerrar={onCerrar} items={[
    { label: t.copiar, onClick: onCopiar, disabled: !puedeCopiar },
    { label: t.pegar, onClick: onPegar }
  ]} />
}

/** Lo que una sesión SSH pinta sobre su xterm; los dos `null` en una local. */
export interface CapasSsh {
  /** Mientras no ha dicho nada: su texto y cómo cancelarla (`null` si aún no hay sesión que cancelar). */
  conectando: { texto: string; onCancelar: (() => void) | null } | null
  /** Terminada: qué pasó y cómo reconectar (`null` si su conexión se eliminó). */
  fin: { motivo: string; enVuelo: boolean; onReconectar: (() => void) | null } | null
}

/** La franja de una sesión SSH terminada: qué pasó y «Reconectar», que también hace Intro. */
function FranjaFinSsh({ fin }: { fin: NonNullable<CapasSsh['fin']> }): React.JSX.Element {
  const t = txTerminales()
  return (
    <>
      <span className="terminal-fin-ssh-motivo">{fin.motivo}</span>
      {fin.onReconectar ? (
        <button className="btn terminal-fin-ssh-boton" onClick={fin.onReconectar} disabled={fin.enVuelo} title={t.reconectarIntro}>
          {fin.enVuelo ? t.reconectando : t.reconectar}
        </button>
      ) : (
        <span className="terminal-fin-ssh-nota">{t.conexionEliminada}</span>
      )}
    </>
  )
}

const SIN_SSH: CapasSsh = { conectando: null, fin: null }

/**
 * Buscador, miniaturas pegadas y menú contextual de una terminal, según su `InterfazTerminal`; y, en una
 * sesión SSH, el «Conectando a…» mientras no ha dicho nada y la franja de reconexión al terminar.
 */
export function CapasTerminal({ ui, ssh = SIN_SSH }: { ui: InterfazTerminal; ssh?: CapasSsh }): React.JSX.Element {
  const { ctxMenu, setCtxMenu } = ui
  const { conectando, fin } = ssh
  const ultimoConectando = useRef(conectando)
  const ultimoFin = useRef(fin)
  if (conectando) ultimoConectando.current = conectando
  if (fin) ultimoFin.current = fin
  return (
    <>
      {/* Capa ABSOLUTA: no empuja ni encoge la xterm; solo «Cancelar» recibe el ratón. */}
      <Presente visible={conectando !== null} className="terminal-conectando mov-aparece terminal-fundido" role="status">
        <span className="terminal-conectando-texto">{ultimoConectando.current?.texto}</span>
        <button
          className="terminal-conectando-cancelar"
          onClick={conectando?.onCancelar ?? undefined}
          disabled={!conectando?.onCancelar}
          aria-hidden={!conectando?.onCancelar}
        >
          {txTerminales().cancelar}
        </button>
      </Presente>
      <Presente visible={fin !== null} className="terminal-fin-ssh mov-aparece terminal-fundido" role="status">
        {ultimoFin.current && <FranjaFinSsh fin={ultimoFin.current} />}
      </Presente>
      {/* Buscar y navegar van al mismo ejecutarBusqueda: el SearchAddon reancla desde la posición actual. */}
      <Presente visible={ui.buscadorAbierto} className="mov-aparece mov-desde-arriba" style={{ position: 'absolute', top: 0, right: 0, zIndex: 3 }}>
        <CajaBusqueda
          onBuscar={(q, o) => ui.ejecutarBusqueda(q, o, 'next')}
          onNavigate={ui.ejecutarBusqueda}
          resultados={ui.resultadosBusqueda}
          onCerrar={ui.cerrarBuscadorTerminal}
        />
      </Presente>
      <ChipsImagenTerminal
        elementos={ui.previasImagen}
        onDescartar={(id) => ui.setPreviasImagen((prev) => prev.filter((x) => x.id !== id))}
      />
      {ctxMenu && (
        <MenuContextualTerminalPuro
          x={ctxMenu.x}
          y={ctxMenu.y}
          puedeCopiar={ctxMenu.tieneSeleccion}
          onCopiar={() => {
            ui.copiarSeleccionTerminal()
            setCtxMenu(null)
            ui.enfocar()
          }}
          onPegar={() => {
            ui.pegarDesdePortapapeles()
            setCtxMenu(null)
            ui.enfocar()
          }}
          onCerrar={() => setCtxMenu(null)}
        />
      )}
    </>
  )
}
