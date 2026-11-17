// =============================================================================
// RielActividadPuro: barra de actividad izquierda en dos grupos separados por un filete. Los
// iconos de vista abren la columna lateral (radio: siempre hay una activa) y los de panel
// la franja inferior (toggle). Un icono se arrastra dentro de su grupo o al otro: el grupo
// decide dónde está el botón, no qué abre. Un grupo no puede quedarse vacío. Con la franja a
// pantalla completa lleva las acciones del modo: ocultar, restaurar y pasar al otro panel.
// Depende de `util/reordenarPorArrastre`, `util/gruposRiel` (la guarda del cruce) y los iconos de `../git` y `../bd`.
// =============================================================================

import { Insignia } from '../../comun/Presente'
import { useState } from 'react'
import { reordenarPorArrastre } from '../../util/reordenarPorArrastre'
import { moverEntreGrupos } from '../../util/gruposRiel'
import { IconoCambios, IconoRama } from '../git'
import { IconoBd } from '../bd'
import { IconoArchivos, IconoOcultarPanel, IconoRestaurar, IconoTerminal } from '../../comun/iconosPanel'
import { etiquetaAcorde } from '../../util/atajos'
import type { ZonaEnfocada } from '../../util/zonaEnfocada'
import { txLayout } from './textos.ts'
import { panelConColor, vistaConColor } from './resaltadoRiel'
import { fijarMaximizado, pasarPantallaCompleta, useStoreLayout } from './store'

/** Vistas de la columna lateral. */
export type VistaActividad = 'files' | 'git' | 'db'

/** Qué panel ocupa la franja inferior, o null si está cerrada. */
export type PanelInferior = 'terminal' | 'gitlog'

/** Ids válidos de cada familia: qué ABRE cada icono, esté en el grupo que esté. */
const VISTAS: VistaActividad[] = ['files', 'git', 'db']

/**
 * ¿Es una vista lateral de las que existen hoy? La vista recordada de cada perfil sale de
 * un archivo: con esta guarda un id que ya no existe cae a «Archivos» en vez de pintar el
 * panel equivocado con el riel sin ningún icono marcado.
 */
export function esVistaLateral(v: unknown): v is VistaActividad {
  return typeof v === 'string' && (VISTAS as string[]).includes(v)
}
const PANELES_IDS: PanelInferior[] = ['terminal', 'gitlog']
/** Único discriminante: el riel solo tiene dos familias, así que «no es panel» es «es vista». */
function esPanel(id: string): id is PanelInferior {
  return (PANELES_IDS as string[]).includes(id)
}
/** Todos los iconos del riel, en su reparto por defecto. */
const CANONICOS: string[] = [...VISTAS, ...PANELES_IDS]

/** Cuál de los dos grupos: solo para saber de dónde sale y a dónde entra. */
type Grupo = 'arriba' | 'abajo'

/** ¿Las mismas ids en el mismo orden? Evita persistir de más. */
function mismaLista(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

interface PropsRielActividadPuro {
  vistaActiva: VistaActividad
  onSeleccionar: (vista: VistaActividad) => void
  /**
   * Orden de los íconos de la columna lateral (ids de vista). Lo posee el store del
   * layout (persistido en ajustes); la barra solo lo pinta y notifica reordenamientos.
   */
  orden: string[]
  onReordenar: (orden: string[]) => void
  /** Orden de los conmutadores de la franja inferior. Grupo INDEPENDIENTE. */
  ordenInferior: string[]
  onReordenarInferior: (orden: string[]) => void
  /**
   * Zona de la ventana que tiene el foco. Separa los dos niveles del resaltado: el icono
   * de la zona donde estás escribiendo se pinta con el color del perfil; el de la que está
   * abierta pero sin foco, en gris.
   */
  zonaEnfocada?: ZonaEnfocada
  /** Panel visible en la franja inferior, o null si está cerrada. */
  panelInferior: PanelInferior | null
  /** Alterna la franja: el mismo panel la cierra; otro la sustituye. */
  onAlternarPanelInferior: (panel: PanelInferior) => void
  /**
   * Conteo de cambios del working-tree a pintar sobre el ícono de git. Lo pasa
   * quien monta la barra (única fuente de verdad). null/undefined o 0 => sin badge.
   * Va en el icono de CAMBIOS, no en el del historial.
   */
  insigniaGit?: number | null
}

// Glifos de línea: trazo redondeado y coherente. Archivos y terminal viven en `comun/iconosPanel`
// porque el pie del agente los repite para decir dónde vive.
const IconoArchivosRiel = IconoArchivos
const IconoTerminalRiel = IconoTerminal

/**
 * Rama de git: el historial (franja inferior). Reutiliza `IconoRama`, el mismo glifo de
 * las filas de ramas de la vista de git; `tamaño={null}` deja que el CSS del riel fije el
 * tamaño, como al resto.
 */
function IconoHistorialRiel(): React.JSX.Element {
  return <IconoRama tamaño={null} />
}

/** Bases de datos: `IconoBd`, el cilindro que pintan también el árbol de la vista y el montaje del agente. */
function IconoBdRiel(): React.JSX.Element {
  return <IconoBd />
}

/** Metadatos de cada vista lateral (icono + etiqueta). El badge lo decide el render. */
function vistasDelRiel(): Record<VistaActividad, { etiqueta: string; icono: () => React.JSX.Element }> {
  const t = txLayout().riel
  return {
    files: { etiqueta: t.archivos, icono: IconoArchivosRiel },
    // Dos entradas de git con iconos distintos: el mismo glifo en dos sitios se lee como la misma ventana.
    git: { etiqueta: t.gitCambios, icono: IconoCambios },
    db: { etiqueta: t.conexiones, icono: IconoBdRiel }
  }
}

/** Metadatos de cada panel inferior. */
function panelesDelRiel(): Record<PanelInferior, { etiqueta: string; icono: () => React.JSX.Element; titulo: string }> {
  const t = txLayout().riel
  return {
    terminal: { etiqueta: t.terminal, icono: IconoTerminalRiel, titulo: t.terminalTitulo },
    gitlog: { etiqueta: t.gitLog, icono: IconoHistorialRiel, titulo: t.gitLogTitulo }
  }
}

/** Resultado de soltar: las dos listas del riel ya resueltas. */
interface ListasRiel {
  arriba: string[]
  abajo: string[]
}

/**
 * Qué listas resultan de soltar `arrastre` sobre `destino` (sobre `destinoId`, o al final si es
 * null), o null si no procede: mismo grupo sin target, orden sin cambio, o un cruce que
 * dejaría vacío el grupo de origen (no se avisa: el icono vuelve a su sitio).
 */
function resolverSoltar(
  arrastre: { id: string; grupo: Grupo },
  destino: Grupo,
  destinoId: string | null,
  arriba: string[],
  abajo: string[]
): ListasRiel | null {
  if (arrastre.grupo === destino) {
    // Mismo grupo: reordenar. Sin target (el hueco) no hay nada que hacer: `reordenarPorArrastre` es de dos ids.
    if (destinoId === null) return null
    const siguiente = reordenarPorArrastre(destino === 'arriba' ? arriba : abajo, arrastre.id, destinoId)
    if (!siguiente) return null
    return destino === 'arriba' ? { arriba: siguiente, abajo } : { arriba, abajo: siguiente }
  }
  const mov = moverEntreGrupos(
    arrastre.grupo === 'arriba' ? arriba : abajo,
    destino === 'arriba' ? arriba : abajo,
    arrastre.id,
    destinoId
  )
  if (!mov) return null
  return destino === 'arriba' ? { arriba: mov.hasta, abajo: mov.desde } : { arriba: mov.desde, abajo: mov.hasta }
}

type PropsIcono = React.HTMLAttributes<HTMLButtonElement> & { draggable: boolean }

interface ArrastreRiel {
  arrastreId: string | null
  destinoArrastreId: string | null
  /** Grupo sobre el que se está soltando "al final" (el hueco, no un icono). */
  sobreHueco: Grupo | null
  props: (id: string, grupo: Grupo) => PropsIcono
  propsHueco: (grupo: Grupo) => React.HTMLAttributes<HTMLDivElement>
}

/**
 * Una sola sesión de arrastre para los dos grupos: lleva también de qué grupo viene, que
 * es lo único que hace falta para decidir si el drop reordena o cruza. El id viaja por
 * estado y no por `dataTransfer`, porque `dragOver` no puede leer el payload y haría falta
 * el estado igualmente para saber si el drop es válido.
 */
function useArrastreRiel(
  arriba: string[],
  abajo: string[],
  onCambio: (arriba: string[], abajo: string[]) => void
): ArrastreRiel {
  const [arrastre, setArrastre] = useState<{ id: string; grupo: Grupo } | null>(null)
  const [destinoArrastreId, setDestinoArrastreId] = useState<string | null>(null)
  const [sobreHueco, setSobreHueco] = useState<Grupo | null>(null)

  const limpiar = (): void => {
    setArrastre(null)
    setDestinoArrastreId(null)
    setSobreHueco(null)
  }

  /** Aplica el drop: reordena si es el mismo grupo, cruza si no. */
  const soltar = (destino: Grupo, destinoId: string | null): void => {
    if (!arrastre) return
    const listas = resolverSoltar(arrastre, destino, destinoId, arriba, abajo)
    if (listas) onCambio(listas.arriba, listas.abajo)
  }

  const props = (id: string, grupo: Grupo): PropsIcono => ({
    draggable: true,
    onDragStart: (e) => {
      setArrastre({ id, grupo })
      e.dataTransfer.effectAllowed = 'move'
    },
    // Los tres `stopPropagation` hacen falta: los iconos de abajo viven dentro de la zona de
    // drop de su grupo (`propsHueco`) y los eventos de arrastre burbujean. Sin cortarlos, soltar
    // sobre un icono de abajo aplicaba el movimiento dos veces y el icono acababa siempre el último.
    onDragOver: (e) => {
      if (!arrastre) return
      e.preventDefault()
      e.stopPropagation()
      if (destinoArrastreId !== id) setDestinoArrastreId(id)
      if (sobreHueco !== null) setSobreHueco(null)
    },
    onDragLeave: (e) => {
      e.stopPropagation()
      setDestinoArrastreId((prev) => (prev === id ? null : prev))
    },
    onDrop: (e) => {
      e.preventDefault()
      e.stopPropagation()
      soltar(grupo, id)
      limpiar()
    },
    onDragEnd: limpiar
  })

  /** Zona de drop del hueco de cada grupo: soltar ahí manda el icono al final. */
  const propsHueco = (grupo: Grupo): React.HTMLAttributes<HTMLDivElement> => ({
    onDragOver: (e) => {
      if (!arrastre || arrastre.grupo === grupo) return
      e.preventDefault()
      if (sobreHueco !== grupo) setSobreHueco(grupo)
      if (destinoArrastreId !== null) setDestinoArrastreId(null)
    },
    onDragLeave: () => setSobreHueco((prev) => (prev === grupo ? null : prev)),
    onDrop: (e) => {
      e.preventDefault()
      soltar(grupo, null)
      limpiar()
    }
  })

  return { arrastreId: arrastre?.id ?? null, destinoArrastreId, sobreHueco, props, propsHueco }
}

/**
 * Reparte los iconos canónicos en dos grupos que son una partición: cada uno aparece
 * exactamente una vez. Respeta lo guardado, quita repetidos y devuelve a su grupo de
 * origen lo que falte, para que un ajuste corrupto no pueda dejar la barra sin un icono.
 */
function particionarIconos(orden: string[], ordenInferior: string[]): { ids: string[]; idsAbajo: string[] } {
  const vistos = new Set<string>()
  const limpiar = (lista: string[]): string[] => {
    const salida: string[] = []
    for (const id of lista) {
      if (!CANONICOS.includes(id) || vistos.has(id)) continue
      vistos.add(id)
      salida.push(id)
    }
    return salida
  }
  const ids = limpiar(orden)
  const idsAbajo = limpiar(ordenInferior)
  for (const id of CANONICOS) {
    if (vistos.has(id)) continue
    ;(esPanel(id) ? idsAbajo : ids).push(id)
  }
  return { ids, idsAbajo }
}

/** Clases de un icono del riel: activo, enfocado, sobre el que se suelta y el que se arrastra. */
function claseElemento(activo: boolean, enfocado: boolean, id: string, riel: ArrastreRiel): string {
  return (
    `activity-item${activo ? ' active' : ''}` +
    `${enfocado ? ' enfocada' : ''}` +
    `${riel.destinoArrastreId === id ? ' drag-over' : ''}` +
    `${riel.arrastreId === id ? ' dragging' : ''}`
  )
}

/** Lo que necesita pintar un icono del riel, sea de la familia que sea. */
interface ContextoRiel {
  riel: ArrastreRiel
  vistaActiva: VistaActividad
  onSeleccionar: (vista: VistaActividad) => void
  zonaEnfocada: ZonaEnfocada
  panelInferior: PanelInferior | null
  onAlternarPanelInferior: (panel: PanelInferior) => void
  insigniaGit?: number | null
}

/** Icono de un panel inferior: toggle (pulsar el abierto cierra la franja, viva el icono donde viva). */
function pintarPanel(id: PanelInferior, grupo: Grupo, ctx: ContextoRiel): React.JSX.Element {
  const meta = panelesDelRiel()[id]
  const Icono = meta.icono
  const abierto = ctx.panelInferior === id
  return (
    <button
      key={id}
      className={claseElemento(abierto, panelConColor(abierto, ctx.zonaEnfocada), id, ctx.riel)}
      title={meta.titulo}
      aria-label={meta.etiqueta}
      aria-pressed={abierto}
      onClick={() => ctx.onAlternarPanelInferior(id)}
      {...ctx.riel.props(id, grupo)}
    >
      <Icono />
    </button>
  )
}

/** El único badge del riel: cambios de git sin confirmar (99+ como tope), o null. */
function insigniaDeVista(vista: VistaActividad, insigniaGit: number | null | undefined): { texto: string; aria: string } | null {
  if (vista !== 'git' || insigniaGit == null || insigniaGit <= 0) return null
  return { texto: insigniaGit > 99 ? '99+' : String(insigniaGit), aria: txLayout().riel.cambiosSinConfirmar(insigniaGit) }
}

/** Icono de una vista lateral: radio (siempre hay exactamente una activa). */
function pintarVista(vista: VistaActividad, grupo: Grupo, ctx: ContextoRiel): React.JSX.Element {
  const meta = vistasDelRiel()[vista]
  const Icono = meta.icono
  const esActiva = ctx.vistaActiva === vista
  const insignia = insigniaDeVista(vista, ctx.insigniaGit)
  // El badge entra en la etiqueta accesible del botón (su <span> es decorativo): así el
  // lector de pantalla anuncia el conteo.
  const etiquetaAria = insignia ? `${meta.etiqueta}, ${insignia.aria}` : meta.etiqueta
  return (
    <button
      key={vista}
      // El color del perfil: el foco en la columna o en el agente que la acompaña (`resaltadoRiel.ts`).
      className={claseElemento(esActiva, vistaConColor(vista, esActiva, ctx.zonaEnfocada), vista, ctx.riel)}
      title={meta.etiqueta}
      aria-label={etiquetaAria}
      aria-pressed={esActiva}
      onClick={() => ctx.onSeleccionar(vista)}
      {...ctx.riel.props(vista, grupo)}
    >
      <Icono />
      <Insignia visible={!!(insignia)} className="activity-badge">{insignia?.texto}</Insignia>
    </button>
  )
}

/** La clase del riel a pantalla completa: la usan el atajo del modo y la búsqueda del icono tras salir. */
export const CLASE_RIEL_MODO = 'riel-pantalla-completa'

/** Lo enfocable de cada panel de la franja: la terminal que se ve y la lista de commits. */
const FOCO_DEL_PANEL: Record<PanelInferior, string> = {
  terminal: 'section.terminal-panel .terminal-pane[aria-hidden="false"] .xterm-helper-textarea',
  gitlog: '.git-log-panel [role="listbox"]'
}

/** Cuántos fotogramas se espera al riel entero: el reparto nuevo se aplica cuando arranca su transición. */
const FOTOGRAMAS_HASTA_EL_RIEL = 40

/** Enfoca el icono del panel en el riel entero (no en el de pantalla completa, que se está desmontando). */
function enfocarIconoDelPanel(panel: PanelInferior, restantes = FOTOGRAMAS_HASTA_EL_RIEL): void {
  requestAnimationFrame(() => {
    const etiqueta = CSS.escape(panelesDelRiel()[panel].etiqueta)
    const icono = document.querySelector<HTMLElement>(`.activity-bar:not(.${CLASE_RIEL_MODO}) .activity-item[aria-label="${etiqueta}"]`)
    if (icono) icono.focus()
    else if (restantes > 0) enfocarIconoDelPanel(panel, restantes - 1)
  })
}

/**
 * Lleva el foco al panel tras restaurarlo o pasar a él, para seguir trabajando donde se estaba: dejarlo en el
 * riel haría que Intro o Espacio pulsaran el icono. Si el panel aún no tiene nada enfocable, al icono.
 */
function enfocarPanel(panel: PanelInferior): void {
  requestAnimationFrame(() => {
    const destino = document.querySelector<HTMLElement>(FOCO_DEL_PANEL[panel])
    if (destino) destino.focus()
    else enfocarIconoDelPanel(panel)
  })
}

/**
 * El riel a pantalla completa lleva las acciones del modo, que así no compiten con las de las cabeceras: restaurar
 * (baja el panel a su alto), ocultar (cierra la franja; al reabrirla sigue maximizada) y pasar al otro panel de la
 * franja sin salir del modo. Las vistas laterales no están: llevarían a lo que el modo tapa.
 */
function RielPantallaCompleta({ panel, onAlternarPanel }: { panel: PanelInferior; onAlternarPanel: (panel: PanelInferior) => void }): React.JSX.Element {
  const t = txLayout().riel
  const restaurar = (): void => {
    fijarMaximizado(panel, false)
    enfocarPanel(panel)
  }
  // Ocultar desmonta este riel y el panel: el foco pasa al icono del panel en el riel entero, para que el
  // teclado no se quede en el cuerpo de la ventana.
  const ocultar = (): void => {
    onAlternarPanel(panel)
    enfocarIconoDelPanel(panel)
  }
  const pasarA = (otro: PanelInferior): void => {
    if (otro === panel) return
    pasarPantallaCompleta(panel, otro)
    onAlternarPanel(otro)
    enfocarPanel(otro)
  }
  return (
    <nav className={`activity-bar ${CLASE_RIEL_MODO}`} aria-label={t.barra}>
      <div className="activity-grupo-arriba" role="group" aria-label={t.grupoPantallaCompleta}>
        <button type="button" className="activity-item mov-aparece" title={t.ocultarTitulo[panel]} aria-label={t.ocultar[panel]} onClick={ocultar}>
          <IconoOcultarPanel />
        </button>
        <button
          type="button"
          className="activity-item mov-aparece"
          title={t.restaurarTitulo[panel](etiquetaAcorde('pantallaCompleta'))}
          aria-label={t.restaurar[panel]}
          onClick={restaurar}
        >
          <IconoRestaurar />
        </button>
      </div>
      <div className="activity-sep" role="separator" aria-orientation="horizontal" />
      <PanelesPantallaCompleta panel={panel} onElegir={pasarA} />
    </nav>
  )
}

/** Los paneles de la franja en el riel a pantalla completa: el que se ve, con el color del perfil; el otro, para pasar a él. */
function PanelesPantallaCompleta({ panel, onElegir }: { panel: PanelInferior; onElegir: (panel: PanelInferior) => void }): React.JSX.Element {
  const t = txLayout().riel
  return (
    <div className="activity-grupo-arriba" role="group" aria-label={t.grupoPaneles}>
      {PANELES_IDS.map((id) => {
        const meta = panelesDelRiel()[id]
        const Icono = meta.icono
        const actual = id === panel
        return (
          <button
            key={id}
            type="button"
            // El panel que se ve lleva el relleno del perfil, como en el riel entero el icono de la zona donde se trabaja.
            className={`activity-item mov-aparece${actual ? ' active enfocada' : ''}`}
            title={t.cambiarA[id]}
            aria-label={meta.etiqueta}
            aria-pressed={actual}
            onClick={() => onElegir(id)}
          >
            <Icono />
          </button>
        )
      })}
    </div>
  )
}

/** Barra de actividad izquierda: vistas laterales arriba, paneles inferiores al pie. */
export function RielActividadPuro({
  vistaActiva,
  onSeleccionar,
  orden,
  onReordenar,
  ordenInferior,
  onReordenarInferior,
  zonaEnfocada = null,
  panelInferior,
  onAlternarPanelInferior,
  insigniaGit
}: PropsRielActividadPuro): React.JSX.Element {
  const { ids, idsAbajo } = particionarIconos(orden, ordenInferior)

  // Se avisa solo del grupo que de verdad cambió: `ids` e `idsAbajo` se reconstruyen en cada
  // render, así que devolver el otro tal cual sería una referencia nueva y el efecto que
  // persiste el workspace reescribiría el archivo por un grupo que nadie tocó.
  const riel = useArrastreRiel(ids, idsAbajo, (arribaNuevo, abajoNuevo) => {
    if (!mismaLista(arribaNuevo, ids)) onReordenar(arribaNuevo)
    if (!mismaLista(abajoNuevo, idsAbajo)) onReordenarInferior(abajoNuevo)
  })
  const pantallaCompleta = useStoreLayout((s) => s.franjaPantallaCompleta)
  const ctx: ContextoRiel = {
    riel,
    vistaActiva,
    onSeleccionar,
    zonaEnfocada,
    panelInferior,
    onAlternarPanelInferior,
    insigniaGit
  }
  // Lo que decide cómo se comporta un icono es su familia, no el grupo donde vive.
  const pintar = (id: string, grupo: Grupo): React.JSX.Element =>
    esPanel(id) ? pintarPanel(id, grupo, ctx) : pintarVista(id as VistaActividad, grupo, ctx)

  if (pantallaCompleta !== null) return <RielPantallaCompleta panel={pantallaCompleta} onAlternarPanel={onAlternarPanelInferior} />

  return (
    <nav className="activity-bar" aria-label={txLayout().riel.barra}>
      <div className="activity-grupo-arriba" role="group" aria-label={txLayout().riel.grupoSuperior}>
        {ids.map((id) => pintar(id, 'arriba'))}
      </div>

      {/* El espaciador empuja el segundo grupo al pie y es la zona de drop «al final del
          grupo de arriba». */}
      <div
        className={`activity-spacer${riel.sobreHueco === 'arriba' ? ' drop-zona' : ''}`}
        {...riel.propsHueco('arriba')}
      />
      <div className="activity-sep" role="separator" aria-orientation="horizontal" />
      <div
        className={`activity-grupo-abajo${riel.sobreHueco === 'abajo' ? ' drop-zona' : ''}`}
        role="group"
        aria-label={txLayout().riel.grupoInferior}
        {...riel.propsHueco('abajo')}
      >
        {idsAbajo.map((id) => pintar(id, 'abajo'))}
      </div>
    </nav>
  )
}
