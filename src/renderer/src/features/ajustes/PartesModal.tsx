// =============================================================================
// Piezas de presentación del modal de Configuración: la cabecera con el buscador
// y el riel vertical de categorías. Sin estado propio: el estado, las refs y los
// manejadores de teclado los posee `SettingsModal`.
// =============================================================================

import type { CategoriaId } from './catalogo'
import { ICONOS, IconoBuscarAjuste } from './iconos'

/** Cabecera del modal: título, buscador y botón de cerrar. */
export function CabeceraModal({
  consulta,
  onConsulta,
  buscadorRef,
  alPulsarEnBuscador,
  onClose
}: {
  consulta: string
  onConsulta: (valor: string) => void
  buscadorRef: React.RefObject<HTMLInputElement>
  alPulsarEnBuscador: (e: React.KeyboardEvent) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <header className="ajustes-modal-header">
      <h2 id="ajustes-titulo" className="ajustes-modal-titulo">
        Configuración
      </h2>
      <div className="ajustes-buscador">
        <IconoBuscarAjuste />
        <input
          ref={buscadorRef}
          type="search"
          value={consulta}
          onChange={(e) => onConsulta(e.target.value)}
          onKeyDown={alPulsarEnBuscador}
          placeholder="Buscar ajuste…"
          aria-label="Buscar ajuste"
          spellCheck={false}
        />
      </div>
      <button
        type="button"
        className="btn btn-icon ajustes-modal-cerrar"
        onClick={onClose}
        title="Cerrar (Esc)"
        aria-label="Cerrar"
      >
        ✕
      </button>
    </header>
  )
}

/** Riel de categorías: con consulta, cada una enseña su número de coincidencias. */
export function RielCategorias({
  rielRef,
  categorias,
  categoria,
  conteo,
  hayConsulta,
  onIrA,
  alPulsarEnRiel
}: {
  rielRef: React.RefObject<HTMLElement>
  categorias: readonly { id: CategoriaId; titulo: string }[]
  categoria: CategoriaId
  conteo: ReadonlyMap<string, number>
  hayConsulta: boolean
  onIrA: (id: CategoriaId) => void
  alPulsarEnRiel: (e: React.KeyboardEvent) => void
}): React.JSX.Element {
  return (
    <nav
      ref={rielRef}
      className="ajustes-riel"
      role="tablist"
      aria-orientation="vertical"
      aria-label="Categorías de configuración"
      onKeyDown={alPulsarEnRiel}
    >
      {categorias.map((c) => {
        const Icono = ICONOS[c.id]
        const n = conteo.get(c.id) ?? 0
        const activa = c.id === categoria
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            data-cat={c.id}
            id={`ajustes-tab-${c.id}`}
            aria-selected={activa}
            aria-controls={`ajustes-panel-${c.id}`}
            // Roving tabindex: Tab sale del riel en UNA pulsación en vez de recorrerlo entero.
            tabIndex={activa ? 0 : -1}
            className={`ajustes-riel-item${activa ? ' activa' : ''}${
              hayConsulta && n === 0 ? ' vacia' : ''
            }`}
            onClick={() => onIrA(c.id)}
            title={c.titulo}
          >
            <Icono />
            <span className="ajustes-riel-nombre">{c.titulo}</span>
            {hayConsulta && <span className="ajustes-riel-conteo">{n}</span>}
          </button>
        )
      })}
    </nav>
  )
}
