// =============================================================================
// TabsBar: el bloque superior del shell, en tres franjas: `.titlebar` (mosaico, agentes,
// asa de arrastre, aviso y engranaje), las pestañas de perfil y las de proyecto. En el modo
// minimalista de perfiles no hay banda: el selector de perfil va en `.titlebar`.
// Los botones de ventana no se pintan aquí: solo se reserva su hueco en `.titlebar`.
// Depende de `../pestanas` (ProfileTabs, ProjectTabs), `../actualizaciones` y `util/atajos`.
// Decisiones: docs/decisiones/layout/barra-superior-en-tres-franjas.md
// =============================================================================

import {
  ProfileTabs,
  ProjectTabs,
  SelectorPerfil,
  type UseTabs,
  type DecideProjectMode,
  type ProfileDotState,
  type ProjectDotState
} from '../pestanas'
import { BotonActualizacion } from '../actualizaciones'
import { etiquetaModPrincipal } from '../../util/atajos'

interface TabsBarProps {
  tabs: UseTabs
  /** Estado visual del dot por perfil (hibernación): spinner / gris / color. */
  profileDotStates: Record<string, ProfileDotState>
  /** Estado visual del dot por proyecto (del perfil activo): spinner / gris / verde. */
  projectDotStates: Record<string, ProjectDotState>
  /**
   * ids de perfil con algún agente que TERMINÓ y no revisas (pip de atención en la
   * pestaña, con el panel de progreso cerrado). Inspector de progreso.
   */
  attentionProfiles: Set<string>
  /** ids de perfil con alguna sesión TRABAJANDO: pulsa su dot en su propio color. */
  workingProfiles: Set<string>
  /** ids de perfil con algún agente que TE ESPERA: un anillo parpadea en su dot. */
  waitingProfiles: Set<string>
  /** Modo minimalista de perfiles: sin banda; un selector en la barra de título. */
  hideProfileNames: boolean
  /** Claves `${profileId}|${projectHostPath}` de proyectos en modo Windows (host nativo). */
  windowsModeKeys: Set<string>
  /** Alterna el modo Windows de un proyecto (host nativo ⇄ Docker aislado). */
  onToggleWindowsMode: (profileId: string, projectHostPath: string) => void
  /** Decide/aplica el modo (Windows/Docker) de un proyecto NUEVO antes de abrirlo. */
  decideProjectMode: DecideProjectMode
  /** ¿El modal de Configuración está abierto? (engranaje presionado). */
  settingsActive: boolean
  /** Abre o CIERRA Configuración. Mismo handler que el atajo Ctrl+,. */
  onToggleSettings: () => void
  /** ¿Está abierto el mosaico de agentes? (botón pulsado, bandas escondidas). */
  mosaicoActivo: boolean
  /** ¿Hay algo que enseñar en el mosaico? Sin agentes en marcha el botón no entra. */
  mosaicoDisponible: boolean
  /** Entra o sale del mosaico. Mismo handler que el atajo Mod+Shift+M. */
  onToggleMosaico: () => void
  /** Controles del mosaico, que ocupan la barra de título mientras está abierto. */
  barraMosaico?: React.ReactNode
  /**
   * Botón «actualizar los agentes de tu equipo» (`BotonAgentesNativos`), YA
   * construido: su estado vive en `useActualizacionNativa` (el hook de la actualización, que también
   * registra los panes), y así esta barra no tiene que saber nada de él.
   */
  botonAgentes?: React.ReactNode
}

/** Bloque superior del shell: barra de título, pestañas de perfil y de proyecto. */
export function TabsBar({
  tabs,
  profileDotStates,
  projectDotStates,
  attentionProfiles,
  workingProfiles,
  waitingProfiles,
  hideProfileNames,
  windowsModeKeys,
  onToggleWindowsMode,
  decideProjectMode,
  settingsActive,
  onToggleSettings,
  mosaicoActivo,
  mosaicoDisponible,
  onToggleMosaico,
  barraMosaico,
  botonAgentes
}: TabsBarProps): React.JSX.Element {
  return (
    // En el mosaico las bandas de perfiles y de proyectos se esconden con una clase (no se
    // desmontan): cada casilla dice ya de quién es y el alto liberado son filas de terminal.
    <div className={`tabs-bar${mosaicoActivo ? ' mosaico' : ''}`}>
      <FranjaTitulo
        mosaicoActivo={mosaicoActivo}
        mosaicoDisponible={mosaicoDisponible}
        onToggleMosaico={onToggleMosaico}
        barraMosaico={barraMosaico}
        botonAgentes={botonAgentes}
        selectorPerfil={
          hideProfileNames && !mosaicoActivo ? (
            <SelectorPerfil
              {...propsDePerfiles(tabs)}
              dotStates={profileDotStates}
              attention={attentionProfiles}
              working={workingProfiles}
              waiting={waitingProfiles}
            />
          ) : null
        }
        settingsActive={settingsActive}
        onToggleSettings={onToggleSettings}
      />
      {!hideProfileNames && (
        <ProfileTabs
          {...propsDePerfiles(tabs)}
          dotStates={profileDotStates}
          attention={attentionProfiles}
          working={workingProfiles}
          waiting={waitingProfiles}
        />
      )}
      <FranjaProyectos
        tabs={tabs}
        dotStates={projectDotStates}
        windowsModeKeys={windowsModeKeys}
        onToggleWindowsMode={onToggleWindowsMode}
        decideProjectMode={decideProjectMode}
      />
    </div>
  )
}

interface FranjaTituloProps {
  mosaicoActivo: boolean
  mosaicoDisponible: boolean
  onToggleMosaico: () => void
  barraMosaico?: React.ReactNode
  botonAgentes?: React.ReactNode
  /** El selector del modo minimalista de perfiles, o null (banda visible o mosaico abierto). */
  selectorPerfil: React.ReactNode
  settingsActive: boolean
  onToggleSettings: () => void
}

/**
 * Mosaico de agentes: primer control de la barra, centrado sobre el eje del riel de iconos
 * (`.titlebar-inicio`). Pulsado mientras está abierto, el mismo botón es la salida; sin nada
 * en marcha se deshabilita diciendo por qué.
 */
function BotonMosaico(p: Pick<FranjaTituloProps, 'mosaicoActivo' | 'mosaicoDisponible' | 'onToggleMosaico'>): React.JSX.Element {
  return (
    <div className="titlebar-inicio">
      <button
        className={`titlebar-btn${p.mosaicoActivo ? ' active' : ''}`}
        onClick={p.onToggleMosaico}
        disabled={!p.mosaicoActivo && !p.mosaicoDisponible}
        aria-pressed={p.mosaicoActivo}
        title={
          p.mosaicoActivo
            ? `Salir del mosaico (${etiquetaModPrincipal()}+Shift+M)`
            : p.mosaicoDisponible
              ? `Mosaico de agentes: todas las terminales en marcha a la vista (${etiquetaModPrincipal()}+Shift+M)`
              : 'Mosaico de agentes: no hay ningún agente en marcha'
        }
        aria-label="Mosaico de agentes"
      >
        <MosaicoIcon />
      </button>
    </div>
  )
}

/** `.titlebar`: mosaico, agentes nativos, selector de perfil, controles del mosaico, asa de arrastre, aviso y engranaje. */
function FranjaTitulo({
  mosaicoActivo,
  mosaicoDisponible,
  onToggleMosaico,
  barraMosaico,
  botonAgentes,
  selectorPerfil,
  settingsActive,
  onToggleSettings
}: FranjaTituloProps): React.JSX.Element {
  return (
    <div className="titlebar">
      <BotonMosaico mosaicoActivo={mosaicoActivo} mosaicoDisponible={mosaicoDisponible} onToggleMosaico={onToggleMosaico} />
      {/* Botón de agentes nativos, justo tras el del mosaico y en el mosaico antes de sus
          controles, separado de los tipos de vista por un filete y sin desplegar su etiqueta
          (ver `.titlebar-agentes.en-mosaico`). Una sola ranura para los dos modos: con una por
          modo React lo desmonta al entrar y salir del mosaico y el panel abierto se cierra. */}
      {botonAgentes ? (
        <div className={`titlebar-agentes${mosaicoActivo ? ' en-mosaico' : ''}`}>{botonAgentes}</div>
      ) : null}
      {selectorPerfil}
      {mosaicoActivo && barraMosaico}
      {/* El asa ocupa la franja hasta el aviso de actualización: se arrastra la ventana y el
          doble clic la maximiza. */}
      <div className="titlebar-agarre" aria-hidden="true" />
      <div className="titlebar-acciones">
        <BotonActualizacion />
        {/* Engranaje: acción de la aplicación, a la izquierda de los botones de ventana. El
            título es fijo aunque el botón siga presionado con el modal abierto: con el overlay
            delante este clic no llega al botón, así que un «Cerrar» describiría un estado sobre
            el que no se puede actuar. */}
        <button
          className={`titlebar-btn${settingsActive ? ' active' : ''}`}
          onClick={onToggleSettings}
          aria-pressed={settingsActive}
          title={`Configuración (${etiquetaModPrincipal()}+,)`}
          aria-label="Configuración"
        >
          <GearIcon />
        </button>
      </div>
    </div>
  )
}

/** Los perfiles y sus acciones, lo mismo para la banda y para el selector del modo minimalista. */
function propsDePerfiles(tabs: UseTabs): {
  profiles: UseTabs['profiles']
  activeProfileId: string | null
  onSelectProfile: UseTabs['setActiveProfile']
  onAddProfile: UseTabs['addProfile']
  onRenameProfile: UseTabs['renameProfile']
  onRecolorProfile: UseTabs['recolorProfile']
  onToggleRedHost: UseTabs['setProfileRedHost']
  onDeleteProfile: UseTabs['deleteProfile']
  onReorderProfiles: UseTabs['reorderProfiles']
  onHibernateProfile: UseTabs['hibernateProfile']
} {
  return {
    profiles: tabs.profiles,
    activeProfileId: tabs.activeProfile?.id ?? null,
    onSelectProfile: tabs.setActiveProfile,
    onAddProfile: tabs.addProfile,
    onRenameProfile: tabs.renameProfile,
    onRecolorProfile: tabs.recolorProfile,
    onToggleRedHost: tabs.setProfileRedHost,
    onDeleteProfile: tabs.deleteProfile,
    onReorderProfiles: tabs.reorderProfiles,
    onHibernateProfile: tabs.hibernateProfile
  }
}

interface FranjaProyectosProps {
  tabs: UseTabs
  dotStates: Record<string, ProjectDotState>
  windowsModeKeys: Set<string>
  onToggleWindowsMode: (profileId: string, projectHostPath: string) => void
  decideProjectMode: DecideProjectMode
}

/** Rutas (del perfil activo) en modo Windows: el subconjunto de las claves que es del perfil visible. */
function rutasEnModoWindows(
  activeProfileId: string | null,
  rutas: string[],
  windowsModeKeys: Set<string>
): Set<string> {
  if (activeProfileId === null) return new Set<string>()
  return new Set(rutas.filter((path) => windowsModeKeys.has(`${activeProfileId}|${path}`)))
}

/** Banda de proyectos del perfil activo. */
function FranjaProyectos({
  tabs,
  dotStates,
  windowsModeKeys,
  onToggleWindowsMode,
  decideProjectMode
}: FranjaProyectosProps): React.JSX.Element {
  const {
    activeProfile,
    openProjects,
    activeProject,
    openProjectInActiveProfile,
    replaceProjectInActiveProfile,
    setActiveProject,
    closeProject,
    reordenarProyectos
  } = tabs
  const activeProfileId = activeProfile?.id ?? null
  const windowsModePaths = rutasEnModoWindows(
    activeProfileId,
    openProjects.map((p) => p.projectHostPath),
    windowsModeKeys
  )
  return (
    <ProjectTabs
      projects={openProjects}
      activePath={activeProject?.projectHostPath ?? null}
      hasActiveProfile={activeProfileId !== null}
      onSelectProject={(path) => {
        // El perfil activo es el dueño de estas subpestañas; guardia por si el perfil
        // cambió entre render y clic.
        if (activeProfileId !== null) setActiveProject(activeProfileId, path)
      }}
      onCloseProject={(path) => {
        if (activeProfileId !== null) closeProject(activeProfileId, path)
      }}
      onOpenProject={() => void openProjectInActiveProfile(decideProjectMode)}
      onReplaceProject={(path) => {
        void replaceProjectInActiveProfile(path, decideProjectMode)
      }}
      dotStates={dotStates}
      windowsModePaths={windowsModePaths}
      onToggleWindowsMode={(path) => {
        if (activeProfileId !== null) onToggleWindowsMode(activeProfileId, path)
      }}
      activeProfileId={activeProfileId}
      onReorderProjects={reordenarProyectos}
    />
  )
}

/** Mosaico de agentes: cuatro casillas redondeadas (una cuadrícula de puntos se lee como «más opciones»). */
function MosaicoIcon(): React.JSX.Element {
  return (
    // Ocupa lo mismo que el engranaje de su barra (unos 17-19 de los 24), para que los iconos se vean iguales.
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="2.2" />
      <rect x="13.2" y="3.2" width="7.6" height="7.6" rx="2.2" />
      <rect x="3.2" y="13.2" width="7.6" height="7.6" rx="2.2" />
      <rect x="13.2" y="13.2" width="7.6" height="7.6" rx="2.2" />
    </svg>
  )
}

/**
 * Configuración: un hexágono con el núcleo dentro. Seis lados rectos se resuelven a 24 px;
 * un engranaje de doce dientes se empasta en una silueta borrosa.
 */
function GearIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Hexágono regular de punta arriba (circunradio 9,4 sobre el centro 12,12): los
          vértices salen de cos30/sen30 para que los seis lados midan igual. Si se toca el
          radio hay que recalcular los seis. */}
      <path d="M12 2.6 20.1 7.3v9.4L12 21.4 3.9 16.7V7.3z" />
      <circle cx="12" cy="12" r="4.1" />
    </svg>
  )
}
