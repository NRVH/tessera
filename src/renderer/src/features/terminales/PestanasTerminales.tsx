// =============================================================================
// Zona de pestañas de la cabecera del panel de terminales: una pestaña por ranura
// (con renombrado en línea), el «+» pegado a la última y el botón de reinicio. Es
// presentación pura: el estado del renombrado y las acciones son del panel, que no
// monta esta zona sin proyecto ni terminales.
// =============================================================================

import type { Dispatch, KeyboardEvent, SetStateAction } from 'react'
import { esBorrarPestanaEnfocada } from '../../util/atajos'
import { CloseIcon, PlusIcon, ReloadIcon } from './IconosTerminales'
import type { SalidaBotonReinicio } from './reloadButton'
import { terminalName, terminalPaneKey, type ShellTerminal } from './shellTerminalsModel'
import type { TerminalPaneInfo } from './terminalPaneTipos'

/** Nombre completo del botón de reinicio, el que se despliega al hover (gemelo del agente). */
const ETIQUETA_REINICIO = 'Reiniciar terminal'

/**
 * Ranura que se está renombrando ahora mismo. LLEVA LA CLAVE DEL PROYECTO: los ids son
 * únicos solo DENTRO de un proyecto (`t1` existe en todos), y sin la clave el texto a
 * medias de un proyecto acababa renombrando la terminal de otro al cambiar de proyecto.
 */
export interface Renombrando {
  key: string
  id: string
  texto: string
}

interface AccionesPestanas {
  onSelect: (projectKey: string, terminalId: string) => void
  onClose: (projectKey: string, terminalId: string) => void
  onRename: (projectKey: string, terminalId: string, nombre: string) => void
}

interface PestanaProps extends AccionesPestanas {
  terminal: ShellTerminal
  projectKey: string
  hostMode: boolean
  activa: boolean
  info: TerminalPaneInfo | undefined
  renombrando: Renombrando | null
  setRenombrando: Dispatch<SetStateAction<Renombrando | null>>
}

interface CampoProps {
  renombrando: Renombrando
  terminalId: string
  nombre: string
  setRenombrando: Dispatch<SetStateAction<Renombrando | null>>
  onRename: AccionesPestanas['onRename']
}

/** Input de renombrado: confirma al salir (perder lo escrito por hacer clic fuera enfada); Esc descarta. */
function CampoRenombrar({ renombrando, terminalId, nombre, setRenombrando, onRename }: CampoProps): React.JSX.Element {
  const confirmar = (): void => {
    onRename(renombrando.key, terminalId, renombrando.texto)
    setRenombrando(null)
  }
  return (
    <input
      className="terminal-tab-input"
      // El ancho SIGUE al texto: uno fijo haría saltar las pestañas de la derecha al escribir.
      size={Math.max(4, renombrando.texto.length)}
      value={renombrando.texto}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) =>
        setRenombrando({ key: renombrando.key, id: terminalId, texto: e.target.value })
      }
      onBlur={confirmar}
      onKeyDown={(e) => {
        e.stopPropagation() // que las teclas no lleguen a la pestaña
        if (e.key === 'Enter') confirmar()
        else if (e.key === 'Escape') setRenombrando(null)
      }}
      aria-label={`Nombre de ${nombre}`}
    />
  )
}

/** Teclado de una pestaña: Enter/Espacio selecciona, F2 renombra y `esBorrarPestanaEnfocada` cierra (Supr; ⌘⌫ en Mac). */
function teclaDePestana(
  e: KeyboardEvent,
  acciones: { seleccionar: () => void; renombrar: () => void; cerrar: () => void }
): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    acciones.seleccionar()
  } else if (e.key === 'F2') {
    e.preventDefault()
    acciones.renombrar()
  } else if (esBorrarPestanaEnfocada(e)) {
    // La ✕ va a `tabIndex={-1}` para no meter dos paradas de tabulador por pestaña: sin
    // esta tecla, cerrar una terminal sería solo con el ratón. El gesto es el de cada
    // plataforma (`Supr`, o `⌘⌫` en Mac) y Mayús/Alt/Ctrl+Supr no cierran.
    e.preventDefault()
    acciones.cerrar()
  }
}

function Pestana(p: PestanaProps): React.JSX.Element {
  const { terminal: t, projectKey, info, renombrando, setRenombrando } = p
  const dead = info?.status === 'exited' || info?.status === 'error'
  const nombre = terminalName(t, p.hostMode)
  // Las DOS mitades de la clave: ver `Renombrando`.
  const editando = renombrando?.id === t.id && renombrando.key === projectKey
  const abrirRenombrado = (): void => setRenombrando({ key: projectKey, id: t.id, texto: nombre })
  return (
    <div
      className={`terminal-tab${p.activa ? ' active' : ''}${editando ? ' editando' : ''}`}
      role="tab"
      aria-selected={p.activa}
      tabIndex={editando ? -1 : 0}
      onClick={() => p.onSelect(projectKey, t.id)}
      // Doble clic = renombrar; el primer clic ya seleccionó, así renombras la que ves.
      onDoubleClick={abrirRenombrado}
      onKeyDown={(e) =>
        teclaDePestana(e, {
          seleccionar: () => p.onSelect(projectKey, t.id),
          renombrar: abrirRenombrado,
          cerrar: () => p.onClose(projectKey, t.id)
        })
      }
      title={editando ? undefined : `${nombre}\nDoble clic para renombrar · ${window.tessera.plataforma === 'mac' ? '⌘⌫' : 'Supr'} para cerrar`}
    >
      {editando ? (
        <CampoRenombrar
          renombrando={renombrando}
          terminalId={t.id}
          nombre={nombre}
          setRenombrando={setRenombrando}
          onRename={p.onRename}
        />
      ) : (
        <span className="terminal-tab-name">{nombre}</span>
      )}
      {dead && !editando && (
        <span className="terminal-tab-dead" title="El shell terminó">
          ●
        </span>
      )}
      {/* La ✕ de la pestaña NO se esconde en reposo: pertenece a la pestaña, no al panel. */}
      <button
        className="terminal-tab-kill"
        onClick={(e) => {
          e.stopPropagation() // no seleccionar la que estás cerrando
          p.onClose(projectKey, t.id)
        }}
        tabIndex={-1}
        title="Cerrar esta terminal (mata lo que esté corriendo dentro)"
        aria-label={`Cerrar ${nombre}`}
      >
        <CloseIcon />
      </button>
    </div>
  )
}

/** Botón de reinicio de la terminal activa; ya no vive en una barra propia al pie. */
function BotonReinicioTerminal({
  boton,
  onReload
}: {
  boton: SalidaBotonReinicio
  onReload: () => void
}): React.JSX.Element {
  return (
    <button
      className={`btn btn-icon boton-reinicio terminal-reload-btn${boton.soloIcono ? ' solo-icono' : ''}`}
      onClick={onReload}
      disabled={!boton.habilitado}
      title={`${boton.titulo} · solo esta terminal`}
      aria-label={boton.soloIcono ? ETIQUETA_REINICIO : boton.etiqueta}
    >
      <ReloadIcon />
      {boton.soloIcono ? (
        <span className="boton-reinicio-etiqueta">
          <span>{ETIQUETA_REINICIO}</span>
        </span>
      ) : (
        // ENVUELTA, no suelta como texto: aquí comparte fila con las pestañas y, sin poder
        // ocultarla, desbordaba sobre las acciones de la cabecera al pulsar el botón.
        <span className="terminal-reload-estado">{boton.etiqueta}</span>
      )}
    </button>
  )
}

interface ZonaPestanasProps extends AccionesPestanas {
  projectKey: string
  lista: ShellTerminal[]
  activeTerminalId: string | null
  hostMode: boolean
  infoByPane: Record<string, TerminalPaneInfo>
  renombrando: Renombrando | null
  setRenombrando: Dispatch<SetStateAction<Renombrando | null>>
  onAdd: (projectKey: string) => void
  boton: SalidaBotonReinicio
  onReload: () => void
}

/**
 * Pestañas del proyecto activo con el «+» y el reinicio. La ZONA es la que crece; las
 * pestañas dentro solo ocupan lo suyo y desbordan con scroll, y el «+» es hermano del
 * scroller y no hijo para no irse con las pestañas al desbordar.
 */
export function ZonaPestanas(p: ZonaPestanasProps): React.JSX.Element {
  return (
    <div className="terminal-tabs-zona">
      <div className="terminal-tabs" role="tablist" aria-label="Terminales del proyecto">
        {p.lista.map((t) => (
          <Pestana
            key={t.id}
            terminal={t}
            projectKey={p.projectKey}
            hostMode={p.hostMode}
            activa={t.id === p.activeTerminalId}
            info={p.infoByPane[terminalPaneKey(p.projectKey, t.id)]}
            renombrando={p.renombrando}
            setRenombrando={p.setRenombrando}
            onSelect={p.onSelect}
            onClose={p.onClose}
            onRename={p.onRename}
          />
        ))}
      </div>
      <button
        className="btn btn-icon terminal-tabs-add"
        onClick={() => p.onAdd(p.projectKey)}
        title="Nueva terminal (las demás siguen corriendo)"
        aria-label="Nueva terminal"
      >
        <PlusIcon />
      </button>
      <BotonReinicioTerminal boton={p.boton} onReload={p.onReload} />
    </div>
  )
}
