// =============================================================================
// El cuerpo del lateral de BD: el aviso de la última acción, la barra de búsqueda (arriba y
// en el flujo, no superpuesta a las filas) y la lista virtual con el foco en el CONTENEDOR
// (`listbox` + `aria-activedescendant`), o el estado que toque. El cuerpo es destino de un
// ARCHIVO soltado (alta precargada) y abre el menú del hueco o, desde el teclado, el de la fila.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import type { MouseEvent, ReactNode } from 'react'
import { VirtualList } from '../../comun/VirtualList'
import { NOTA_FORMATO_AJENO, TITULO_FORMATO_AJENO, contarCoincidencias, type FilaArbol } from './filasArbolBd'
import { abrirMenu, itemsVacio } from './arbolMenu'
import { arrastraArchivos, cerrarBusqueda, idFila, soltarArchivos } from './DbArbolNavegacion'
import { alTeclear, alTeclearBusqueda } from './DbArbolTeclado'
import { pintarFila } from './FilaArbol'
import type { AvisoArbol, CtxArbol } from './DbArbolTipos'

/** Ventana para decidir que un `contextmenu` vino de Mayús+F10 / la tecla Menú. */
const MENU_POR_TECLADO_MS = 500

function IconoCerrar(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

/** El aviso de la última acción (probar, desconectar, errores), con su acción si la tiene. */
export function AvisoArbolVista({ a, aviso }: { a: CtxArbol; aviso: AvisoArbol }): React.JSX.Element {
  return (
    <div className={`db-arbol-aviso ${aviso.tono}`} role={aviso.tono === 'error' ? 'alert' : 'status'}>
      <div className="db-arbol-aviso-texto">
        {aviso.texto}
        {aviso.detalle && <div className="db-arbol-aviso-detalle">{aviso.detalle}</div>}
        {aviso.accion && (
          <button
            type="button"
            className="db-fila-accion"
            onClick={() => {
              aviso.accion?.hacer()
              a.e.setAviso(null)
            }}
          >
            {aviso.accion.etiqueta}
          </button>
        )}
      </div>
      <button type="button" className="sidebar-icon-btn db-arbol-aviso-cerrar" title="Cerrar el aviso" aria-label="Cerrar el aviso" onClick={() => a.e.setAviso(null)}>
        <IconoCerrar />
      </button>
    </div>
  )
}

/** La barra de la búsqueda al teclear: filtra solo lo ya cargado. */
export function BusquedaArbol({ a, busqueda }: { a: CtxArbol; busqueda: string }): React.JSX.Element {
  const nCoincidencias = busqueda ? contarCoincidencias(a.d.filas) : 0
  return (
    <div className="db-arbol-busqueda" role="search">
      <input
        ref={a.e.busquedaRef}
        value={busqueda}
        spellCheck={false}
        placeholder="Buscar en lo cargado"
        aria-label="Buscar en el árbol (solo lo ya cargado)"
        onChange={(e) => a.e.setBusqueda(e.target.value)}
        onKeyDown={(e) => alTeclearBusqueda(a, e)}
        onBlur={(e) => {
          // Vacía y sin foco no sirve de nada: se cierra sola.
          if (e.currentTarget.value === '' && e.relatedTarget !== a.e.listaRef.current) a.e.setBusqueda(null)
        }}
      />
      <span className="db-arbol-busqueda-cuenta" aria-live="polite">
        {busqueda === '' ? '' : nCoincidencias === 0 ? 'Sin coincidencias' : `${nCoincidencias}`}
      </span>
      <button type="button" className="sidebar-icon-btn" title="Cerrar la búsqueda (Esc)" aria-label="Cerrar la búsqueda" onClick={() => cerrarBusqueda(a)}>
        <IconoCerrar />
      </button>
    </div>
  )
}

/** La lista virtual del árbol, con el teclado y el foco en el contenedor. */
function ListaArbol({ a }: { a: CtxArbol }): React.JSX.Element {
  const { idxSel, filas } = a.d
  return (
    <VirtualList<FilaArbol>
      className="db-arbol-lista"
      ariaLabel="Bases de datos"
      items={filas}
      itemHeight={a.p.altoFila}
      getKey={(f) => f.key}
      renderItem={(f, i) => pintarFila(a, f, i)}
      scrollRef={a.e.listaRef}
      scrollToIndex={a.e.idxDesplazar >= 0 ? a.e.idxDesplazar : null}
      scrollToken={a.e.desplazar?.token}
      role="listbox"
      aria-activedescendant={idxSel >= 0 ? idFila(a, idxSel) : undefined}
      // UNA parada de tabulador para todo el árbol (las filas no son enfocables).
      tabIndex={0}
      onKeyDown={(e) => alTeclear(a, e)}
      // `onMouseDown` y no `onClick`: el foco tiene que llegar antes que el clic de
      // la fila. Sin `preventDefault`, que rompería el doble clic y el arrastre.
      onMouseDown={(e) => e.currentTarget.focus()}
    />
  )
}

/**
 * El registro ENTERO tiene un formato que esta versión no reconoce, o no se pudo leer: un
 * aviso PERSISTENTE (es el estado del árbol, no el resultado de una acción) y en ámbar.
 */
function AvisoFormato({ aviso }: { aviso: string }): React.JSX.Element {
  return (
    <div className="db-arbol-aviso advertencia db-arbol-formato" role="status">
      <div className="db-arbol-aviso-texto">
        <div className="db-arbol-aviso-titulo">{TITULO_FORMATO_AJENO}</div>
        {aviso}
        <div className="db-arbol-aviso-detalle">{NOTA_FORMATO_AJENO}</div>
      </div>
    </div>
  )
}

function contenidoCuerpo(a: CtxArbol): ReactNode {
  const { perfilId, conexiones, cargandoConexiones, avisoFormato, ajenas } = a.p
  if (perfilId === null) return <div className="db-arbol-estado">Sin perfil activo.</div>
  if (conexiones.length === 0 && cargandoConexiones) return <div className="db-arbol-estado">Cargando…</div>
  if (avisoFormato !== null) return <AvisoFormato aviso={avisoFormato} />
  // Con solo AJENAS no es un perfil vacío: se pinta la lista, con sus filas atenuadas.
  if (conexiones.length === 0 && ajenas.length === 0) {
    return (
      <div className="db-arbol-estado">
        Sin conexiones en este perfil.{' '}
        <button type="button" className="db-arbol-enlace" onClick={() => a.e.setDialogo({ conexionId: null })}>
          Nueva conexión…
        </button>
      </div>
    )
  }
  return <ListaArbol a={a} />
}

/**
 * Mayús+F10 o la tecla Menú sobre la lista abren el menú de la fila seleccionada, anclado a
 * ella. Un `contextmenu` de teclado llega con `button` 0 (el del ratón, con 2): eso cubre
 * también al lector de pantalla de Mac (VO+⇧+M), que no pasa por el keydown.
 */
function alMenuContextual(a: CtxArbol, e: MouseEvent<HTMLDivElement>): void {
  e.preventDefault()
  const { filaSel, idxSel } = a.d
  const deTeclado =
    performance.now() - a.e.menuPorTeclado.current < MENU_POR_TECLADO_MS || (e.button === 0 && !e.ctrlKey && e.target === a.e.listaRef.current)
  if (filaSel && deTeclado) {
    a.e.menuPorTeclado.current = 0
    const el = document.getElementById(idFila(a, idxSel))
    const r = el?.getBoundingClientRect()
    abrirMenu(a, filaSel, r ? r.left + 24 : e.clientX, r ? r.bottom : e.clientY)
    return
  }
  a.e.setMenu({ x: e.clientX, y: e.clientY, items: itemsVacio(a) })
}

/** El cuerpo del lateral: destino de archivos soltados y dueño del menú del hueco. */
export function CuerpoArbol({ a }: { a: CtxArbol }): React.JSX.Element {
  const { soltandoArchivo, setSoltandoArchivo } = a.e
  return (
    <div
      className={`db-arbol-cuerpo${soltandoArchivo ? ' db-arbol-soltando' : ''}`}
      // El arrastre de una conexión del propio árbol no pasa por aquí (`arrastraArchivos`
      // lo excluye): lo llevan sus filas.
      onDragOver={(e) => {
        if (!arrastraArchivos(a, e)) return
        e.preventDefault() // sin esto el navegador no admite el soltado
        e.dataTransfer.dropEffect = 'copy'
        if (!soltandoArchivo) setSoltandoArchivo(true)
      }}
      onDragLeave={(e) => {
        // Solo al salir del cuerpo, no al pasar de una fila a otra dentro de él.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSoltandoArchivo(false)
      }}
      onDrop={(e) => {
        setSoltandoArchivo(false)
        if (!arrastraArchivos(a, e)) return
        e.preventDefault()
        void soltarArchivos(a, e.dataTransfer.files)
      }}
      onContextMenu={(e) => alMenuContextual(a, e)}
    >
      {contenidoCuerpo(a)}
    </div>
  )
}
