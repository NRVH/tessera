// =============================================================================
// Zona de pestañas de la cabecera del panel de terminales: las pestañas SSH del perfil y las terminales
// del proyecto (con renombrado en línea) en una sola tira que se reordena arrastrando, y el botón
// dividido «Nueva terminal | ▾» pegado a la última, cuya flecha abre el lanzador de conexiones y se va
// mientras el riel enseña la lista. Es presentación pura: el estado del renombrado y las acciones son
// del panel. Se pinta siempre: el botón dividido vive aquí y debe poder ofrecer una conexión SSH aunque
// no haya ni proyecto ni terminales.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/terminales/lanzador-de-conexiones.md
// =============================================================================

import { useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { BotonDividido } from '../../comun/BotonDividido'
import { useArrastrePestanas } from '../../comun/useArrastrePestanas'
import { claseArrastre, propsArrastre, type TiraArrastrable } from './arrastreTira'
import { CloseIcon, PlusIcon } from './IconosTerminales'
import { PestanaSsh } from './PestanaSsh'
import { CampoRenombrar, teclaDePestana, type Renombrando } from './renombradoPestana'
import { terminalName, terminalPaneKey, type ShellTerminal } from './shellTerminalsModel'
import { sshPaneKey, type SshTab } from './sshTabsModel'
import type { TerminalPaneInfo } from './terminalPaneTipos'
import { txTerminales } from './textos.ts'
import { claveLocal, esClaveSsh, idDeClave, ordenVisible } from './tiraTerminalesModel'

export type { Renombrando } from './renombradoPestana'

/** Tipo propio del arrastre: solo lo nuestro pinta raya y se suelta en la tira. */
const TIPO_ARRASTRE = 'application/x-tessera-terminal-pestana'

interface AccionesPestanas {
  onSelect: (projectKey: string, terminalId: string) => void
  onClose: (projectKey: string, terminalId: string) => void
  onRename: (projectKey: string, terminalId: string, nombre: string) => void
}

interface PestanaProps extends AccionesPestanas {
  terminal: ShellTerminal
  projectKey: string
  activa: boolean
  info: TerminalPaneInfo | undefined
  renombrando: Renombrando | null
  setRenombrando: Dispatch<SetStateAction<Renombrando | null>>
  tira: TiraArrastrable
}

function Pestana(p: PestanaProps): React.JSX.Element {
  const { terminal: t, projectKey, info, renombrando, setRenombrando } = p
  const dead = info?.status === 'exited' || info?.status === 'error'
  const nombre = terminalName(t)
  // Las DOS mitades de la clave: ver `Renombrando`.
  const editando = renombrando?.id === t.id && renombrando.key === projectKey
  const abrirRenombrado = (): void => setRenombrando({ key: projectKey, id: t.id, texto: nombre })
  const clave = claveLocal(t.id)
  return (
    <div
      {...propsArrastre(p.tira, clave, editando)}
      className={`terminal-tab${p.activa ? ' active' : ''}${editando ? ' editando' : ''}${claseArrastre(p.tira.arrastre, clave)}`}
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
      title={editando ? undefined : `${nombre}\n${txTerminales().dobleClicRenombrar(txTerminales().teclaCerrar(window.tessera.plataforma === 'mac'))}`}
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
      <span className={`terminal-tab-dead${dead && !editando ? ' visible' : ''}`} aria-hidden={!dead || editando} title={txTerminales().shellTermino}>
          ●
        </span>
      {/* La ✕ de la pestaña NO se esconde en reposo: pertenece a la pestaña, no al panel. */}
      <button
        className="terminal-tab-kill"
        onClick={(e) => {
          e.stopPropagation() // no seleccionar la que estás cerrando
          p.onClose(projectKey, t.id)
        }}
        tabIndex={-1}
        title={txTerminales().cerrarTerminal}
        aria-label={txTerminales().cerrarNombre(nombre)}
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
  onReconectar: (id: string) => void
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
  infoByPane: Record<string, TerminalPaneInfo>
  renombrando: Renombrando | null
  setRenombrando: Dispatch<SetStateAction<Renombrando | null>>
  ssh: PropsZonaSsh
  nueva: PropsNuevaTerminal
  /** El orden propio del contexto que se mira, si lo tiene (`tiraTerminalesModel`). */
  ordenGuardado: readonly string[] | undefined
  /** Mueve una pestaña antes de otra (`null` = al final). */
  onMover: (clave: string, antesDe: string | null) => void
  /** «Nueva terminal» en el proyecto que se mira. */
  onAdd: (projectKey: string) => void
}

/** La pestaña de una clave de la tira: SSH o local. */
function PestanaDeTira({ clave, tira, zona: p }: { clave: string; tira: TiraArrastrable; zona: ZonaPestanasProps }): React.JSX.Element | null {
  const { ssh, projectKey } = p
  const id = idDeClave(clave)
  const comunes = { renombrando: p.renombrando, setRenombrando: p.setRenombrando, tira }
  if (esClaveSsh(clave)) {
    const tab = ssh.lista.find((s) => s.id === id)
    if (!tab) return null
    return (
      <PestanaSsh
        {...comunes}
        tab={tab}
        perfilId={ssh.perfilId}
        activa={id === ssh.activaId}
        info={p.infoByPane[sshPaneKey(ssh.perfilId, id)]}
        onSelect={ssh.onElegir}
        onClose={ssh.onCerrar}
        onRename={ssh.onRenombrar}
        onReconectar={ssh.onReconectar}
      />
    )
  }
  const terminal = p.lista.find((l) => l.id === id)
  if (!terminal || projectKey === null) return null
  return (
    <Pestana
      {...comunes}
      terminal={terminal}
      projectKey={projectKey}
      activa={id === p.localActivaId}
      info={p.infoByPane[terminalPaneKey(projectKey, id)]}
      onSelect={p.onSelect}
      onClose={p.onClose}
      onRename={p.onRename}
    />
  )
}

/**
 * Las pestañas SSH del perfil y las del proyecto en una sola tira, con el botón dividido. La ZONA es la
 * que crece; las pestañas dentro solo ocupan lo suyo y desbordan con scroll, y el botón dividido es
 * hermano del scroller y no hijo para no irse con las pestañas al desbordar.
 */
export function ZonaPestanas(p: ZonaPestanasProps): React.JSX.Element {
  const { ssh, projectKey } = p
  const t = txTerminales()
  const nodos = useRef(new Map<string, HTMLDivElement>())
  const claves = ordenVisible(p.ordenGuardado, ssh.lista, projectKey === null ? [] : p.lista)
  const arrastre = useArrastrePestanas(TIPO_ARRASTRE, claves.map((id) => ({ id })), p.onMover, nodos)
  const tira: TiraArrastrable = { arrastre, nodos, reordenable: claves.length > 1 }

  return (
    <div className="terminal-tabs-zona">
      <div className="terminal-tabs" role="tablist" aria-label={t.terminales} onDragOver={arrastre.alSobrevolarTira} onDragLeave={arrastre.alSalirTira} onDrop={arrastre.soltar}>
        {claves.map((clave) => (
          <PestanaDeTira key={clave} clave={clave} tira={tira} zona={p} />
        ))}
      </div>
      <BotonDividido
        className="terminal-tabs-add"
        grupoRef={p.nueva.grupoRef}
        etiquetaPrincipal={t.nuevaTerminal}
        tituloPrincipal={t.nuevaTerminalTitulo}
        iconoPrincipal={<PlusIcon />}
        onPrincipal={() => projectKey !== null && p.onAdd(projectKey)}
        principalNoDisponible={p.nueva.noDisponible}
        sinFlecha={p.nueva.sinFlecha}
        etiquetaFlecha={t.conexionesSsh}
        tituloFlecha={t.conexionesSshTitulo}
        flechaDeshabilitada={p.nueva.flechaDeshabilitada}
        flechaAbierta={p.nueva.flechaAbierta}
        flechaControla={p.nueva.flechaControla}
        onFlecha={p.nueva.onFlecha}
        destinoFocoSinPrincipal={p.nueva.destinoFocoSinPrincipal}
      />
    </div>
  )
}
