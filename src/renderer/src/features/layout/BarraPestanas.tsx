// =============================================================================
// BarraPestanas: el bloque superior del shell, en tres franjas: `.titlebar` (mosaico, agentes,
// asa de arrastre, aviso y engranaje), las pestañas de perfil y las de proyecto. En el modo
// minimalista de perfiles no hay banda: el selector de perfil va en `.titlebar`.
// Los botones de ventana no se pintan aquí: solo se reserva su hueco en `.titlebar`.
// Depende de `../pestanas` (PestanasPerfil, PestanasProyecto), `../actualizaciones` y `util/atajos`.
// Decisiones: docs/decisiones/layout/barra-superior-en-tres-franjas.md
// =============================================================================

import {
  PestanasPerfil,
  PestanasProyecto,
  SelectorPerfil,
  type UsePestanas,
  type EstadoPuntoPerfil,
  type EstadoPuntoProyecto
} from '../pestanas'
import { BotonActualizacion } from '../actualizaciones'
import { abrirContexto } from '../agentes'
import { etiquetaModPrincipal } from '../../util/atajos'
import { txLayout } from './textos.ts'

interface PropsBarraPestanas {
  pestanas: UsePestanas
  /** Estado visual del dot por perfil (hibernación): spinner / gris / color. */
  estadosPuntoPerfil: Record<string, EstadoPuntoPerfil>
  /** Estado visual del dot por proyecto (del perfil activo): spinner / gris / verde. */
  estadosPuntoProyecto: Record<string, EstadoPuntoProyecto>
  /**
   * ids de perfil con algún agente que TERMINÓ y no revisas (pip de atención en la
   * pestaña, con el panel de progreso cerrado). Inspector de progreso.
   */
  perfilesConAtencion: Set<string>
  /** ids de perfil con alguna sesión TRABAJANDO: pulsa su dot en su propio color. */
  perfilesTrabajando: Set<string>
  /** ids de perfil con algún agente que TE ESPERA: un anillo parpadea en su dot. */
  perfilesEsperando: Set<string>
  /** Modo minimalista de perfiles: sin banda; un selector en la barra de título. */
  ocultarNombresPerfil: boolean
  /** ¿El modal de Configuración está abierto? (engranaje presionado). */
  ajustesActivos: boolean
  /** Abre o CIERRA Configuración. Mismo handler que el atajo Ctrl+,. */
  onAlternarAjustes: () => void
  /** ¿Está abierto el mosaico de agentes? (botón pulsado, bandas escondidas). */
  mosaicoActivo: boolean
  /** ¿Hay algo que enseñar en el mosaico? Sin agentes en marcha el botón no entra. */
  mosaicoDisponible: boolean
  /** Entra o sale del mosaico. Mismo handler que el atajo Mod+Shift+M. */
  onAlternarMosaico: () => void
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
export function BarraPestanas({
  pestanas,
  estadosPuntoPerfil,
  estadosPuntoProyecto,
  perfilesConAtencion,
  perfilesTrabajando,
  perfilesEsperando,
  ocultarNombresPerfil,
  ajustesActivos,
  onAlternarAjustes,
  mosaicoActivo,
  mosaicoDisponible,
  onAlternarMosaico,
  barraMosaico,
  botonAgentes
}: PropsBarraPestanas): React.JSX.Element {
  return (
    // En el mosaico las bandas de perfiles y de proyectos se esconden con una clase (no se
    // desmontan): cada casilla dice ya de quién es y el alto liberado son filas de terminal.
    <div className={`tabs-bar${mosaicoActivo ? ' mosaico' : ''}`}>
      <FranjaTitulo
        mosaicoActivo={mosaicoActivo}
        mosaicoDisponible={mosaicoDisponible}
        onAlternarMosaico={onAlternarMosaico}
        barraMosaico={barraMosaico}
        botonAgentes={botonAgentes}
        selectorPerfil={
          ocultarNombresPerfil && !mosaicoActivo ? (
            <SelectorPerfil
              {...propsDePerfiles(pestanas)}
              estadosPunto={estadosPuntoPerfil}
              atencion={perfilesConAtencion}
              working={perfilesTrabajando}
              esperando={perfilesEsperando}
            />
          ) : null
        }
        ajustesActivos={ajustesActivos}
        onAlternarAjustes={onAlternarAjustes}
      />
      {!ocultarNombresPerfil && (
        <PestanasPerfil
          {...propsDePerfiles(pestanas)}
          estadosPunto={estadosPuntoPerfil}
          atencion={perfilesConAtencion}
          working={perfilesTrabajando}
          esperando={perfilesEsperando}
        />
      )}
      <FranjaProyectos pestanas={pestanas} estadosPunto={estadosPuntoProyecto} />
    </div>
  )
}

interface PropsFranjaTitulo {
  mosaicoActivo: boolean
  mosaicoDisponible: boolean
  onAlternarMosaico: () => void
  barraMosaico?: React.ReactNode
  botonAgentes?: React.ReactNode
  /** El selector del modo minimalista de perfiles, o null (banda visible o mosaico abierto). */
  selectorPerfil: React.ReactNode
  ajustesActivos: boolean
  onAlternarAjustes: () => void
}

/**
 * Mosaico de agentes: primer control de la barra, centrado sobre el eje del riel de iconos
 * (`.titlebar-inicio`). Pulsado mientras está abierto, el mismo botón es la salida; sin nada
 * en marcha se deshabilita diciendo por qué.
 */
function BotonMosaico(p: Pick<PropsFranjaTitulo, 'mosaicoActivo' | 'mosaicoDisponible' | 'onAlternarMosaico'>): React.JSX.Element {
  const t = txLayout().titulo
  return (
    <div className="titlebar-inicio">
      <button
        className={`titlebar-btn${p.mosaicoActivo ? ' active' : ''}`}
        onClick={p.onAlternarMosaico}
        disabled={!p.mosaicoActivo && !p.mosaicoDisponible}
        aria-pressed={p.mosaicoActivo}
        title={
          p.mosaicoActivo
            ? t.salirMosaico(etiquetaModPrincipal())
            : p.mosaicoDisponible
              ? t.mosaicoDisponible(etiquetaModPrincipal())
              : t.mosaicoNoDisponible
        }
        aria-label={t.mosaico}
      >
        <IconoMosaico />
      </button>
    </div>
  )
}

/** `.titlebar`: mosaico, agentes nativos, selector de perfil, controles del mosaico, asa de arrastre, aviso y engranaje. */
function FranjaTitulo({
  mosaicoActivo,
  mosaicoDisponible,
  onAlternarMosaico,
  barraMosaico,
  botonAgentes,
  selectorPerfil,
  ajustesActivos,
  onAlternarAjustes
}: PropsFranjaTitulo): React.JSX.Element {
  return (
    <div className="titlebar">
      <BotonMosaico mosaicoActivo={mosaicoActivo} mosaicoDisponible={mosaicoDisponible} onAlternarMosaico={onAlternarMosaico} />
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
          className={`titlebar-btn${ajustesActivos ? ' active' : ''}`}
          onClick={onAlternarAjustes}
          aria-pressed={ajustesActivos}
          title={txLayout().titulo.configuracionTitulo(etiquetaModPrincipal())}
          aria-label={txLayout().titulo.configuracion}
        >
          <IconoAjustesBarra />
        </button>
      </div>
    </div>
  )
}

/** Los perfiles y sus acciones, lo mismo para la banda y para el selector del modo minimalista. */
function propsDePerfiles(pestanas: UsePestanas): {
  perfiles: UsePestanas['perfiles']
  perfilActivoId: string | null
  onSeleccionarPerfil: UsePestanas['setActiveProfile']
  onAnadirPerfil: UsePestanas['addProfile']
  onRenombrarPerfil: UsePestanas['renameProfile']
  onCambiarColorPerfil: UsePestanas['recolorProfile']
  onAlternarRedHost: UsePestanas['setProfileRedHost']
  onAbrirReglas: (perfilId: string) => void
  onEliminarPerfil: UsePestanas['deleteProfile']
  onReordenarPerfiles: UsePestanas['reorderProfiles']
  onHibernarPerfil: UsePestanas['hibernateProfile']
} {
  return {
    perfiles: pestanas.perfiles,
    perfilActivoId: pestanas.perfilActivo?.id ?? null,
    onSeleccionarPerfil: pestanas.setActiveProfile,
    onAnadirPerfil: pestanas.addProfile,
    onRenombrarPerfil: pestanas.renameProfile,
    onCambiarColorPerfil: pestanas.recolorProfile,
    onAlternarRedHost: pestanas.setProfileRedHost,
    onAbrirReglas: (perfilId) => abrirContexto({ nivel: { tipo: 'perfil', perfilId }, seccion: 'reglas' }),
    onEliminarPerfil: pestanas.deleteProfile,
    onReordenarPerfiles: pestanas.reorderProfiles,
    onHibernarPerfil: pestanas.hibernateProfile
  }
}

interface PropsFranjaProyectos {
  pestanas: UsePestanas
  estadosPunto: Record<string, EstadoPuntoProyecto>
}

/** Banda de proyectos del perfil activo. */
function FranjaProyectos({ pestanas, estadosPunto }: PropsFranjaProyectos): React.JSX.Element {
  const {
    perfilActivo: activeProfile,
    proyectosAbiertos: openProjects,
    proyectoActivo: activeProject,
    abrirProyectoEnPerfilActivo: openProjectInActiveProfile,
    reemplazarProyectoEnPerfilActivo: replaceProjectInActiveProfile,
    setActiveProject,
    closeProject,
    reordenarProyectos
  } = pestanas
  const perfilActivoId = activeProfile?.id ?? null
  return (
    <PestanasProyecto
      proyectos={openProjects}
      rutaActiva={activeProject?.rutaHostProyecto ?? null}
      hayPerfilActivo={perfilActivoId !== null}
      nombrePerfil={activeProfile?.nombre ?? null}
      onSeleccionarProyecto={(ruta) => {
        // El perfil activo es el dueño de estas subpestañas; guardia por si el perfil
        // cambió entre render y clic.
        if (perfilActivoId !== null) setActiveProject(perfilActivoId, ruta)
      }}
      onCerrarProyecto={(ruta) => {
        if (perfilActivoId !== null) closeProject(perfilActivoId, ruta)
      }}
      onAbrirProyecto={() => void openProjectInActiveProfile()}
      onReemplazarProyecto={(ruta, confirmar) => {
        void replaceProjectInActiveProfile(ruta, confirmar)
      }}
      estadosPunto={estadosPunto}
      perfilActivoId={perfilActivoId}
      onReordenarProyectos={reordenarProyectos}
    />
  )
}

/** Mosaico de agentes: cuatro casillas redondeadas (una cuadrícula de puntos se lee como «más opciones»). */
function IconoMosaico(): React.JSX.Element {
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
function IconoAjustesBarra(): React.JSX.Element {
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
