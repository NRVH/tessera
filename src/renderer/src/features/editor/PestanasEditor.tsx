// =============================================================================
// Tira de pestañas de la columna central: primer hijo de `.editor-area`, sin botón «+».
// El estado sucio y el de borrado llegan como Sets de ids desde App; ensucian archivos y los
// diffs editables del working tree, que comparten buffer con la pestaña del archivo.
// El menú contextual cierra por lotes (derecha, izquierda, todo), revela y guarda sin título.
// A la derecha, fijas: la flecha con las pestañas que no se ven y el hueco de acciones del pane.
// =============================================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconoAbrirFuera,
  IconoCerrarDerecha,
  IconoCerrarIzquierda,
  IconoCerrarTodo,
  IconoGuardar
} from '../../comun/iconosMenu'
import { notifyError } from '../../comun/notificaciones'
import type { PestanaEditor } from './modeloPestanasEditor'
import type { PaneCentral } from './paneCentral'
import { esRutaVirtual } from '../../../../shared/jarPath'
import { claseEstado } from '../git'
import { IconoTipoArchivo } from '../../comun/iconosArchivo'
import { MenuContextual, SEP } from '../../comun/MenuContextual'
import { txPestanas } from './textos.ts'
import { useRaizDelProyecto } from '../../comun/raizDelProyecto'
import { etiquetaModPrincipal } from '../../util/atajos'
import { nombresSistema } from '../../../../shared/nombresSistema'

interface PropsPestanasEditor {
  pestanas: PestanaEditor[]
  pestanaActivaId: string | null
  /** Ids de tabs sucias (solo kind==='file'); las provee App desde su Set. */
  idsSucios: Set<string>
  /** Ids de tabs cuyo archivo ya no existe en disco: el nombre se tacha y Ctrl+S lo recrea. */
  borradoIds: Set<string>
  /** Letra de status git por tab.id (solo archivos); colorea el nombre y convive con el dot. */
  estadoGitPorId: Map<string, string>
  onSeleccionarPestana: (id: string) => void
  onCerrarPestana: (id: string) => void
  /** Guarda la pestaña `id` (menú contextual); hoy solo se ofrece en las sin título. */
  onGuardarPestana: (id: string) => void
  /** Recibe el hueco de acciones de la derecha, donde el pane visible pinta las suyas. */
  huecoAccionesRef?: (el: HTMLElement | null) => void
}

/** Las dos flechas de comparar, en el sitio del icono de tipo. `aria-label` dice que es un diff. */
function IconoDiff(): React.JSX.Element {
  return (
    <span className="editor-tab-icon editor-tab-kind" role="img" aria-label={txPestanas().diferencias}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 4.5h11M10 2l2.5 2.5L10 7" />
        <path d="M14.5 11.5h-11M6 9l-2.5 2.5L6 14" />
      </svg>
    </span>
  )
}

function IconoCerrarPestana(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  )
}

/** Basename POSIX de una ruta relativa (las rutas del editor son siempre POSIX). */
function nombreBase(ruta: string): string {
  return ruta.split('/').pop() ?? ruta
}

/** Etiqueta a mostrar en la pestaña: nombre del archivo, o basename del diff. */
function etiquetaPestana(pane: PaneCentral): string {
  if (pane.tipo === 'file') return pane.archivo.nombre
  if (pane.tipo === 'untitled') return pane.sinTitulo.nombre
  return nombreBase(pane.destino.ruta)
}

/** Nombre con el que se resuelve el icono de tipo: el mismo dato del que sale la etiqueta. */
function nombreIconoPestana(pane: PaneCentral): string {
  if (pane.tipo === 'file') return pane.archivo.nombre
  if (pane.tipo === 'untitled') return pane.sinTitulo.nombre
  return nombreBase(pane.destino.ruta)
}

/** Tooltip completo: la ruta; para diff se marca explícitamente como tal. */
function tooltipPestana(pane: PaneCentral): string {
  if (pane.tipo === 'file') return pane.archivo.ruta
  const t = txPestanas()
  if (pane.tipo === 'untitled') {
    return pane.sinTitulo.guardado ? t.fueraDelProyecto(pane.sinTitulo.nombre) : t.sinGuardar(pane.sinTitulo.nombre)
  }
  return t.diffDe(pane.destino.ruta)
}

interface PropsPestana {
  pestana: PestanaEditor
  activo: boolean
  sucio: boolean
  borrado: boolean
  letraGit: string | undefined
  onSeleccionar: () => void
  onCerrar: () => void
  onMenu: (e: React.MouseEvent) => void
}

function Pestana({
  pestana,
  activo,
  sucio,
  borrado,
  letraGit,
  onSeleccionar,
  onCerrar,
  onMenu
}: PropsPestana): React.JSX.Element {
  const esDiff = pestana.pane.tipo === 'diff'
  const etiqueta = etiquetaPestana(pestana.pane)
  // Contenido de dentro de un .jar: se tinta igual que sus filas en el árbol (misma regla).
  const enArchivo = pestana.pane.tipo === 'file' && esRutaVirtual(pestana.pane.archivo.ruta)
  const t = txPestanas()
  return (
    <div
      role="tab"
      aria-selected={activo}
      data-tab-id={pestana.id}
      className={`editor-tab${activo ? ' active' : ''}${sucio ? ' dirty' : ''}${
        borrado ? ' borrado' : ''
      }${enArchivo ? ' in-archive' : ''}${pestana.efimera ? ' efimera' : ''}`}
      // Los sufijos van aquí y no en `tooltipPestana`, que solo ve el pane y no el flag ni el borrado.
      title={`${tooltipPestana(pestana.pane)}${borrado ? t.sufijoBorrado(etiquetaModPrincipal()) : ''}${pestana.efimera ? t.sufijoEfimera : ''}`}
      onClick={onSeleccionar}
      onContextMenu={onMenu}
    >
      {/* Un icono en todas las pestañas: una tira con glifo solo en algunas se lee peor. El de un
          diff son las dos flechas de comparar, en lugar del tipo: distingue el diff del archivo homónimo. */}
      {esDiff ? <IconoDiff /> : <IconoTipoArchivo nombre={nombreIconoPestana(pestana.pane)} className="editor-tab-icon" />}
      <span className={`editor-tab-name${letraGit ? ` ${claseEstado(letraGit)}` : ''}`}>
        {etiqueta}
      </span>
      {/* Slot de ancho fijo: dot (reposo, si dirty) <-> x (hover/cierre). */}
      <span className="editor-tab-slot">
        {/* El punto sale también sin cambios pendientes cuando el archivo desapareció. */}
        {(sucio || borrado) && <span className="editor-tab-dot" aria-hidden="true" />}
        <button
          className="editor-tab-close"
          aria-label={t.cerrarArchivo(etiqueta)}
          title={t.cerrar}
          // stopPropagation: la x cierra, NO selecciona la pestaña.
          onClick={(e) => {
            e.stopPropagation()
            onCerrar()
          }}
        >
          <IconoCerrarPestana />
        </button>
      </span>
    </div>
  )
}

/** Ítems del menú contextual de la pestaña `index` del proyecto `raiz`; `idsACerrar` cierra por lotes. */
function elementosMenuPestana(
  { pestanas, indice, raiz }: { pestanas: PestanaEditor[]; indice: number; raiz: string },
  idsACerrar: (ids: string[]) => void,
  onGuardarPestana: (id: string) => void
): React.ComponentProps<typeof MenuContextual>['items'] {
  const tipo = pestanas[indice]?.pane.tipo
  const t = txPestanas()
  const gestor = nombresSistema(window.tessera.plataforma).gestorArchivos
  return [
    // Solo en archivos: un sin título aún no existe en disco y un diff puede comparar
    // revisiones que no están, así que el explorador no tendría qué seleccionar.
    ...(tipo === 'file'
      ? [
          {
            icon: <IconoAbrirFuera />,
            label: t.abrirEnExplorador(gestor),
            onClick: () => {
              const pane = pestanas[indice]?.pane
              if (pane?.tipo !== 'file') return
              void window.tessera.files
                .revelar({ raiz, ruta: pane.archivo.ruta })
                .catch((err: unknown) => notifyError(t.noSePudoAbrirExplorador(gestor), err))
            }
          },
          SEP
        ]
      : []),
    // «Guardar como…» solo en las sin título: las de archivo ya tienen su Ctrl+S.
    ...(tipo === 'untitled'
      ? [
          {
            icon: <IconoGuardar />,
            label: t.guardarComo,
            onClick: () => onGuardarPestana(pestanas[indice].id)
          },
          SEP
        ]
      : []),
    {
      icon: <IconoCerrarDerecha />,
      label: t.cerrarDerecha,
      // Habilitada solo si hay pestañas DESPUÉS de la clicada.
      disabled: indice >= pestanas.length - 1,
      onClick: () => idsACerrar(pestanas.slice(indice + 1).map((t) => t.id))
    },
    {
      icon: <IconoCerrarIzquierda />,
      label: t.cerrarIzquierda,
      // Habilitada solo si hay pestañas ANTES de la clicada.
      disabled: indice <= 0,
      onClick: () => idsACerrar(pestanas.slice(0, indice).map((t) => t.id))
    },
    // «Cerrar todo» tiene el mayor alcance: separado, para no pulsarlo por inercia.
    SEP,
    {
      icon: <IconoCerrarTodo />,
      label: t.cerrarTodo,
      // Con una sola pestaña, las tres quedan inertes.
      disabled: pestanas.length <= 1,
      onClick: () => idsACerrar(pestanas.map((t) => t.id))
    }
  ]
}

/** Los elementos de las pestañas, en el orden de la lista (sus hijos son las pestañas). */
function elementosDe(lista: HTMLElement): HTMLElement[] {
  return Array.from(lista.children) as HTMLElement[]
}

/**
 * Las pestañas que no se ven enteras en la lista, en orden. Con cajas y no con `offsetLeft`:
 * con un zoom fraccionario los enteros redondean y una pestaña al borde contaría mal.
 */
function pestanasOcultas(lista: HTMLElement, pestanas: PestanaEditor[]): PestanaEditor[] {
  const caja = lista.getBoundingClientRect()
  const els = elementosDe(lista)
  return pestanas.filter((_, i) => {
    const r = els[i]?.getBoundingClientRect()
    return r !== undefined && (r.left < caja.left - 0.5 || r.right > caja.right + 0.5)
  })
}

/**
 * Si las pestañas desbordan la lista. Se mide tras cada render (dos lecturas): el ancho del
 * contenido cambia también sin que cambie el número de pestañas (un nombre más largo, el punto
 * de sucio), y un observador de tamaño solo ve la caja de la lista.
 */
function useDesborde(listaRef: React.RefObject<HTMLDivElement>): boolean {
  const [desborda, setDesborda] = useState(false)
  useLayoutEffect(() => {
    const lista = listaRef.current
    if (!lista) return
    const medir = (): void => setDesborda(lista.scrollWidth > lista.clientWidth + 1)
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(lista)
    // La tira conserva su ancho mientras las pestañas nuevas crecen dentro de ella.
    for (const elemento of elementosDe(lista)) observador.observe(elemento)
    return () => observador.disconnect()
  })
  return desborda
}

/**
 * La pestaña activa a la vista dentro de la tira. Se mueve la lista a mano: `scrollIntoView`
 * desplazaría también los antepasados con `overflow: hidden` (la tarjeta, el marco) y
 * descolocaría la ventana sin forma de volver. Corre al cambiar la activa o las pestañas
 * (otro proyecto puede tener activa una pestaña con el mismo id).
 */
function useActivaALaVista(listaRef: React.RefObject<HTMLDivElement>, pestanaActivaId: string | null, pestanas: PestanaEditor[]): void {
  useLayoutEffect(() => {
    const lista = listaRef.current
    const i = pestanas.findIndex((t) => t.id === pestanaActivaId)
    const el = i < 0 || !lista ? undefined : elementosDe(lista)[i]
    if (!lista || !el) return
    const mostrar = (): void => {
      const izquierda = el.offsetLeft
      const derecha = izquierda + el.offsetWidth
      if (izquierda < lista.scrollLeft) lista.scrollLeft = izquierda
      else if (derecha > lista.scrollLeft + lista.clientWidth) lista.scrollLeft = derecha - lista.clientWidth
    }
    mostrar()
    const observador = new ResizeObserver(mostrar)
    observador.observe(el)
    return () => observador.disconnect()
  }, [listaRef, pestanaActivaId, pestanas])
}

type MenuDesborde = { x: number; y: number; ocultas: PestanaEditor[] } | null

/** El menú de la flecha: es una foto de las ocultas, así que se cierra si las pestañas cambian. */
function useMenuDesborde(pestanas: PestanaEditor[]): [MenuDesborde, (m: MenuDesborde) => void] {
  const [menu, setMenu] = useState<MenuDesborde>(null)
  useEffect(() => setMenu(null), [pestanas])
  return [menu, setMenu]
}

function IconoChevron(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4.5 6.5L8 10l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Ítems del menú de la flecha: las pestañas ocultas, con su icono; elegir una la activa. */
function elementosDesborde(ocultas: PestanaEditor[], onSeleccionarPestana: (id: string) => void): React.ComponentProps<typeof MenuContextual>['items'] {
  return ocultas.map((pestana) => ({
    icon: pestana.pane.tipo === 'diff' ? <IconoDiff /> : <IconoTipoArchivo nombre={nombreIconoPestana(pestana.pane)} className="editor-tab-icon" />,
    label: etiquetaPestana(pestana.pane),
    onClick: () => onSeleccionarPestana(pestana.id)
  }))
}

/** Dónde se abrió el menú contextual y sobre qué pestaña. */
interface MenuDePestana {
  x: number
  y: number
  indice: number
}

/** Menú contextual de una pestaña, contra el proyecto de la tira. */
function MenuPestana(p: {
  menu: MenuDePestana
  pestanas: PestanaEditor[]
  onCerrarPestana: (id: string) => void
  onGuardarPestana: (id: string) => void
  onCerrar: () => void
}): React.JSX.Element {
  const raiz = useRaizDelProyecto()
  // Cierre por lotes: cada onCerrarPestana compone su updater funcional.
  const idsACerrar = (ids: string[]): void => {
    for (const id of ids) p.onCerrarPestana(id)
  }
  const elementos = elementosMenuPestana({ pestanas: p.pestanas, indice: p.menu.indice, raiz }, idsACerrar, p.onGuardarPestana)
  return <MenuContextual x={p.menu.x} y={p.menu.y} items={elementos} onCerrar={p.onCerrar} />
}

/** Tira de pestañas del editor con su menú contextual, la flecha de desborde y el hueco de acciones. */
export function PestanasEditor(props: PropsPestanasEditor): React.JSX.Element {
  const { pestanas, pestanaActivaId, onSeleccionarPestana, onCerrarPestana, onGuardarPestana } = props
  // Menú contextual: posición + índice de la pestaña sobre la que se abrió.
  const [menu, setMenu] = useState<MenuDePestana | null>(null)
  const [desborde, setDesborde] = useMenuDesborde(pestanas)
  const listaRef = useRef<HTMLDivElement>(null)
  const desborda = useDesborde(listaRef)
  useActivaALaVista(listaRef, pestanaActivaId, pestanas)

  function abrirDesborde(e: React.MouseEvent<HTMLButtonElement>): void {
    const lista = listaRef.current
    if (!lista) return
    const caja = e.currentTarget.getBoundingClientRect()
    const ocultas = pestanasOcultas(lista, pestanas)
    if (ocultas.length > 0) setDesborde({ x: caja.left, y: caja.bottom + 2, ocultas })
  }

  return (
    <div className="editor-tabs con-acciones">
      <div
        ref={listaRef}
        className="editor-tabs-lista"
        role="tablist"
        aria-label={txPestanas().archivosAbiertos}
        // Sin barra visible: la rueda vertical desplaza la tira en horizontal.
        onWheel={(e) => {
          if (e.deltaX === 0 && listaRef.current) listaRef.current.scrollLeft += e.deltaY
        }}
      >
        {pestanas.map((pestana, indice) => (
          <Pestana
            key={pestana.id}
            pestana={pestana}
            activo={pestana.id === pestanaActivaId}
            sucio={props.idsSucios.has(pestana.id)}
            borrado={props.borradoIds.has(pestana.id)}
            // Los diffs quedan fuera por la clave: su id (`diff:WORKTREE:<ruta>`) no casa con una ruta.
            letraGit={pestana.pane.tipo === 'diff' ? undefined : props.estadoGitPorId.get(pestana.id)}
            onSeleccionar={() => onSeleccionarPestana(pestana.id)}
            onCerrar={() => onCerrarPestana(pestana.id)}
            onMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, indice })
            }}
          />
        ))}
      </div>
      <div className="editor-tabs-acciones">
          <button type="button" className={`btn btn-icon editor-tabs-desborde${desborda ? ' visible' : ''}`} tabIndex={desborda ? 0 : -1} aria-hidden={!desborda} title={txPestanas().pestanasOcultas} aria-label={txPestanas().pestanasOcultas} onClick={abrirDesborde}>
            <IconoChevron />
          </button>
        <div ref={props.huecoAccionesRef} className="editor-tabs-slot" />
      </div>
      {menu && <MenuPestana menu={menu} pestanas={pestanas} onCerrarPestana={onCerrarPestana} onGuardarPestana={onGuardarPestana} onCerrar={() => setMenu(null)} />}
      {desborde && (
        <MenuContextual x={desborde.x} y={desborde.y} items={elementosDesborde(desborde.ocultas, onSeleccionarPestana)} onCerrar={() => setDesborde(null)} />
      )}
    </div>
  )
}
