// =============================================================================
// Zona de pestañas de la cabecera del panel de terminales: primero las pestañas SSH del perfil, un
// filete y las terminales del proyecto (con renombrado en línea), y el botón dividido «Nueva terminal
// | ▾» pegado a la última, cuya flecha abre el lanzador de conexiones y se va mientras el riel enseña la
// lista. Es presentación pura: el estado del renombrado y las acciones son del panel. Se pinta siempre:
// el botón dividido vive aquí y debe poder ofrecer una conexión SSH aunque no haya ni proyecto ni
// terminales.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/terminales/lanzador-de-conexiones.md
// =============================================================================

import type { Dispatch, RefObject, SetStateAction } from 'react'
import { BotonDividido } from '../../comun/BotonDividido'
import { CloseIcon, PlusIcon } from './IconosTerminales'
import { PestanaSsh } from './PestanaSsh'
import { CampoRenombrar, teclaDePestana, type Renombrando } from './renombradoPestana'
import { terminalName, terminalPaneKey, type ShellTerminal } from './shellTerminalsModel'
import { sshPaneKey, type SshTab } from './sshTabsModel'
import type { TerminalPaneInfo } from './terminalPaneTipos'

export type { Renombrando } from './renombradoPestana'

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
          texto={renombrando.texto}
          nombre={nombre}
          onTexto={(texto) => setRenombrando({ key: projectKey, id: t.id, texto })}
          onConfirmar={() => {
            p.onRename(projectKey, t.id, renombrando.texto)
            setRenombrando(null)
          }}
          onCancelar={() => setRenombrando(null)}
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

/** Las pestañas SSH del perfil y lo que se hace con ellas. */
export interface PropsZonaSsh {
  perfilId: string
  lista: readonly SshTab[]
  /** La que se ve, si lo que se ve es una SSH. */
  activaId: string | null
  onElegir: (id: string) => void
  onCerrar: (id: string) => void
  onRenombrar: (id: string, nombre: string) => void
}

/** El botón dividido «Nueva terminal | ▾»: la flecha abre el lanzador de conexiones, que monta quien aloja la zona. */
export interface PropsNuevaTerminal {
  /** Por qué la terminal local no se puede abrir (sin proyecto); ausente = se puede. */
  noDisponible?: string
  /** Sin flecha: con el riel a la vista la lista ya está al lado y el botón queda solo con el «+». */
  sinFlecha: boolean
  /** Sin perfil, la flecha no tiene nada que ofrecer. */
  flechaDeshabilitada: boolean
  /** El lanzador está a la vista. */
  flechaAbierta: boolean
  /** El id del lanzador, que nombra el `aria-controls` de la flecha. */
  flechaControla: string
  /** Abre o cierra el lanzador. */
  onFlecha: () => void
  /** El conjunto de los dos botones: de él cuelga el lanzador. */
  grupoRef: RefObject<HTMLSpanElement>
  /** A dónde va el foco si se quita la flecha con él puesto y la principal no se puede usar. */
  destinoFocoSinPrincipal: () => void
}

interface ZonaPestanasProps extends AccionesPestanas {
  /** El proyecto que se mira, o `null` sin proyecto. */
  projectKey: string | null
  lista: ShellTerminal[]
  /** La terminal local que se ve (`null` si se ve una SSH o nada). */
  localActivaId: string | null
  hostMode: boolean
  infoByPane: Record<string, TerminalPaneInfo>
  renombrando: Renombrando | null
  setRenombrando: Dispatch<SetStateAction<Renombrando | null>>
  ssh: PropsZonaSsh
  nueva: PropsNuevaTerminal
  /** «Nueva terminal» en el proyecto que se mira. */
  onAdd: (projectKey: string) => void
}

/**
 * Las pestañas SSH del perfil, un filete y las del proyecto, con el botón dividido. La ZONA es la que
 * crece; las pestañas dentro solo ocupan lo suyo y desbordan con scroll, y el botón dividido es hermano
 * del scroller y no hijo para no irse con las pestañas al desbordar.
 */
export function ZonaPestanas(p: ZonaPestanasProps): React.JSX.Element {
  const { ssh, projectKey } = p
  return (
    <div className="terminal-tabs-zona">
      <div className="terminal-tabs" role="tablist" aria-label="Terminales">
        {ssh.lista.map((t) => (
          <PestanaSsh
            key={t.id}
            tab={t}
            perfilId={ssh.perfilId}
            activa={t.id === ssh.activaId}
            info={p.infoByPane[sshPaneKey(ssh.perfilId, t.id)]}
            renombrando={p.renombrando}
            setRenombrando={p.setRenombrando}
            onSelect={ssh.onElegir}
            onClose={ssh.onCerrar}
            onRename={ssh.onRenombrar}
          />
        ))}
        {/* Separa las del perfil de las del proyecto sin gastar una palabra; no es una pestaña. */}
        {ssh.lista.length > 0 && p.lista.length > 0 && <div className="terminal-tabs-filete" aria-hidden="true" />}
        {projectKey !== null &&
          p.lista.map((t) => (
            <Pestana
              key={t.id}
              terminal={t}
              projectKey={projectKey}
              hostMode={p.hostMode}
              activa={t.id === p.localActivaId}
              info={p.infoByPane[terminalPaneKey(projectKey, t.id)]}
              renombrando={p.renombrando}
              setRenombrando={p.setRenombrando}
              onSelect={p.onSelect}
              onClose={p.onClose}
              onRename={p.onRename}
            />
          ))}
      </div>
      <BotonDividido
        className="terminal-tabs-add"
        grupoRef={p.nueva.grupoRef}
        etiquetaPrincipal="Nueva terminal"
        tituloPrincipal="Nueva terminal (las demás siguen corriendo)"
        iconoPrincipal={<PlusIcon />}
        onPrincipal={() => projectKey !== null && p.onAdd(projectKey)}
        principalNoDisponible={p.nueva.noDisponible}
        sinFlecha={p.nueva.sinFlecha}
        etiquetaFlecha="Conexiones SSH"
        tituloFlecha="Conexiones SSH: conectar, buscar o crear"
        flechaDeshabilitada={p.nueva.flechaDeshabilitada}
        flechaAbierta={p.nueva.flechaAbierta}
        flechaControla={p.nueva.flechaControla}
        onFlecha={p.nueva.onFlecha}
        destinoFocoSinPrincipal={p.nueva.destinoFocoSinPrincipal}
      />
    </div>
  )
}
