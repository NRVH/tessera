// =============================================================================
// La lista de conexiones SSH de un perfil: un filtro (combobox) y un árbol de grupos plegables
// con las conexiones, en lista virtual. `modo` 'flotante' es el lanzador de la cabecera (un solo grupo
// abierto, sus recientes, pie de altas y alto acotado); 'fijo' llena su contenedor, para el riel de la
// terminal a pantalla completa. El foco real está en el filtro y la fila activa se nombra con
// `aria-activedescendant`. Las altas y el teclado salen de `useListaSsh`; el orden, el filtro y las
// teclas, de `listaSsh` (puro).
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/terminales/lanzador-de-conexiones.md
// =============================================================================

import './conexionesSsh.css'
import { useCallback, useId, useRef, type RefObject } from 'react'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { IconoCarpetaNueva } from '../../comun/iconosMenu'
import { VirtualList } from '../../comun/VirtualList'
import { FILAS_MAX } from '../../comun/popoverFlotante'
import { FilaConexionSsh, FilaGrupoSsh, FilaSeccionSsh } from './FilasListaSsh'
import { IconoServidorNuevo } from './iconosSsh'
import { textoSinCoincidencias, type FilaLista } from './listaSsh'
import { MenuFilaSsh } from './menuListaSsh'
import { useListaSsh, type OpcionesListaSsh, type VistaListaSsh } from './useListaSsh'

/** Lo que recibe la lista. */
export interface PropsListaConexionesSsh extends OpcionesListaSsh {
  /** Alto de una fila y de una cabecera, de `theme/densidad.ts`: la lista virtual los necesita en JS. */
  altoFila: number
  altoCabecera: number
  /** El filtro, para que quien aloje la lista le dé el foco y lo recupere al cerrar. */
  filtroRef?: RefObject<HTMLInputElement>
}

/** Lo que quien aloja la lista (el lanzador o el riel) le da: todo salvo cómo se muestra. */
export type DatosListaConexionesSsh = Omit<PropsListaConexionesSsh, 'modo' | 'filtroRef' | 'alAbrirDialogo'>

/** Lo que se enseña en lugar del árbol cuando no hay filas que pintar. */
function EstadoSinFilas({ v }: { v: VistaListaSsh }): React.JSX.Element | null {
  if (v.estado === 'cargando') return <div className="ssh-estado">Cargando conexiones…</div>
  if (v.estado === 'sinCoincidencias') return <div className="ssh-estado">{textoSinCoincidencias(v.filtro)}</div>
  if (v.estado === 'formatoAjeno') {
    return <AvisoCaja tono="error" titulo="No se pueden usar las conexiones SSH" sugerencia={v.avisos.ajeno ?? undefined} />
  }
  if (v.estado !== 'vacia') return null
  // Las altas no se repiten aquí: están en el pie del lanzador y en la cabecera del riel.
  return <div className="ssh-estado">Sin conexiones SSH en este perfil</div>
}

/** El alto de una fila: las conexiones, el de una fila; las cabeceras y los rótulos, el de una cabecera. */
function altoDeFila(f: FilaLista | undefined, altoFila: number, altoCabecera: number): number {
  return f?.tipo === 'conexion' ? altoFila : altoCabecera
}

/** El árbol de filas, en lista virtual. */
function ArbolConexiones({ v, p, idArbol }: { v: VistaListaSsh; p: PropsListaConexionesSsh; idArbol: string }): React.JSX.Element {
  const { altoFila, altoCabecera } = p
  const altoDe = useCallback((i: number): number => altoDeFila(v.filas[i], altoFila, altoCabecera), [v.filas, altoFila, altoCabecera])
  const total = v.filas.reduce((suma, f) => suma + altoDeFila(f, altoFila, altoCabecera), 0)
  const renderFila = (f: FilaLista, i: number): React.JSX.Element => {
    if (f.tipo === 'seccion') return <FilaSeccionSsh fila={f} alto={altoCabecera} />
    const comunes = {
      id: v.idFila(f),
      activa: i === v.indiceActivo,
      alto: f.tipo === 'grupo' ? altoCabecera : altoFila,
      onPulsar: () => v.alPulsar(f),
      onMenu: (x: number, y: number) => v.abrirMenu(f, x, y)
    }
    return f.tipo === 'grupo' ? (
      <FilaGrupoSsh fila={f} {...comunes} />
    ) : (
      <FilaConexionSsh
        fila={f}
        abiertas={p.abiertasPorConexion[f.conexion.id] ?? 0}
        enSesion={f.conexion.id === p.conexionActivaId}
        {...comunes}
      />
    )
  }
  return (
    <VirtualList<FilaLista>
      id={idArbol}
      role="tree"
      className="ssh-arbol"
      ariaLabel="Conexiones SSH"
      // Flotante: el alto justo de las filas, hasta un tope; fijo: lo que dé su contenedor.
      style={p.modo === 'flotante' ? { height: Math.min(total, FILAS_MAX * altoFila) } : undefined}
      items={v.filas}
      itemHeight={altoDe}
      getKey={(f) => f.clave}
      scrollToIndex={v.indiceActivo >= 0 ? v.indiceActivo : null}
      renderItem={renderFila}
    />
  )
}

/** El pie del lanzador: las dos altas («Importar desde OpenSSH…» vive en el formulario de alta). */
function PieAltas({ v }: { v: VistaListaSsh }): React.JSX.Element {
  return (
    <div className="ssh-pie">
      <button type="button" className="ssh-pie-boton" onClick={v.nuevaConexion}>
        <IconoServidorNuevo />
        Nueva conexión SSH…
      </button>
      <button type="button" className="ssh-pie-boton" onClick={v.nuevoGrupo}>
        <IconoCarpetaNueva />
        Nuevo grupo…
      </button>
    </div>
  )
}

/** La lista de conexiones SSH de un perfil. */
export function ListaConexionesSsh(p: PropsListaConexionesSsh): React.JSX.Element {
  const filtroPropio = useRef<HTMLInputElement>(null)
  const filtroRef = p.filtroRef ?? filtroPropio
  const idArbol = useId()
  const v = useListaSsh(p, filtroRef)
  const activa = v.filas[v.indiceActivo]
  const conArbol = v.estado === 'filas'
  return (
    <div className="ssh-lista" data-modo={p.modo}>
      <input
        ref={filtroRef}
        className="ssh-filtro"
        value={v.filtro}
        placeholder="Buscar conexión…"
        spellCheck={false}
        autoComplete="off"
        role="combobox"
        aria-label="Buscar conexión"
        aria-expanded={conArbol}
        aria-haspopup="tree"
        aria-controls={conArbol ? idArbol : undefined}
        aria-activedescendant={conArbol && activa ? v.idFila(activa) : undefined}
        onChange={(e) => v.cambiarFiltro(e.target.value)}
        onKeyDown={v.alTeclear}
      />
      {v.avisos.recuperado !== null && <AvisoCaja tono="info" titulo="Se usan las conexiones de la copia de respaldo" sugerencia={v.avisos.recuperado} />}
      {conArbol ? <ArbolConexiones v={v} p={p} idArbol={idArbol} /> : <EstadoSinFilas v={v} />}
      {p.modo === 'flotante' && (v.estado === 'filas' || v.estado === 'sinCoincidencias' || v.estado === 'vacia') && <PieAltas v={v} />}
      {v.menu && <MenuFilaSsh menu={v.menu} disparador={filtroRef} onClose={v.cerrarMenu} />}
    </div>
  )
}
