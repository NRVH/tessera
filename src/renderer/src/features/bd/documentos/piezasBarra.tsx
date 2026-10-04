// =============================================================================
// Las piezas idénticas de las barras de las consolas de MongoDB y de Redis: el botón de icono,
// la identidad (alias, entorno, estado y región viva), el botón de la base y el candado (el
// botón de icono y el candado, también de la SQL). A la izquierda solo texto que describe y a
// la derecha solo iconos grises agrupados.
// Depende de `MarcaEntorno` y de los iconos de `bd`.
// =============================================================================

import type { DbConnection } from '../../../../../shared/db-ipc'
import { TITULO_SOLO_LECTURA_AGENTES } from '../camposConexion'
import { IconoCandado, IconoEsquema } from '../iconosBd'
import { MarcaEntorno } from '../MarcaEntorno'

/** Botón de icono; deshabilitado, su motivo lo lleva una envoltura (Chromium no dispara el tooltip de un control deshabilitado). */
export function BotonIcono({
  className,
  titulo,
  etiqueta,
  habilitado,
  motivo,
  pulsado,
  onClick,
  children
}: {
  className?: string
  titulo: string
  etiqueta: string
  habilitado: boolean
  motivo?: string
  /** Interruptor (`aria-pressed`); sin él, un botón normal. */
  pulsado?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const boton = (
    <button
      type="button"
      className={`btn btn-icon${className ? ` ${className}` : ''}`}
      title={habilitado ? titulo : undefined}
      aria-label={etiqueta}
      aria-pressed={pulsado}
      disabled={!habilitado}
      onClick={onClick}
    >
      {children}
    </button>
  )
  if (habilitado) return boton
  return (
    <span className="btn-envoltura" title={motivo ?? titulo}>
      {boton}
    </span>
  )
}

/** El candado «Solo lectura»: informa de la casilla de los agentes y abre la edición de la conexión. */
export function BotonCandado({ onEditarConexion }: { onEditarConexion: () => void }): React.JSX.Element {
  return (
    <>
      <span className="panel-actions-sep" aria-hidden="true" />
      <BotonIcono
        className="db-consola-candado"
        titulo={`${TITULO_SOLO_LECTURA_AGENTES} · Editar conexión…`}
        etiqueta="Editar conexión…"
        habilitado
        onClick={onEditarConexion}
      >
        <IconoCandado />
      </BotonIcono>
    </>
  )
}

/** El botón que abre el selector de base; mientras corre algo se ve apagado, con su motivo. */
export function BotonBase({
  corriendo,
  titulo,
  etiqueta,
  abierto,
  botonRef,
  onAbrir
}: {
  corriendo: boolean
  titulo: string
  etiqueta: string
  abierto: boolean
  botonRef: React.RefObject<HTMLButtonElement>
  onAbrir: () => void
}): React.JSX.Element {
  if (corriendo) {
    return (
      <span className="btn-envoltura" title={titulo}>
        <button type="button" className="btn btn-icon db-consola-esquema-btn" aria-label="Base de la consola" disabled>
          <IconoEsquema />
        </button>
      </span>
    )
  }
  return (
    <button
      ref={botonRef}
      type="button"
      className={`btn btn-icon db-consola-esquema-btn${abierto ? ' activo' : ''}`}
      title={titulo}
      aria-label={etiqueta}
      aria-haspopup="dialog"
      aria-expanded={abierto}
      // Sin esto, el «clic fuera» del selector abierto lo cerraría y este clic lo reabriría.
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={onAbrir}
    >
      <IconoEsquema />
    </button>
  )
}

/** La parte izquierda de la barra: alias, entorno, la base (`children`), «RO agentes» y el estado vivo. */
export function IdentidadBarra({
  conexion,
  estado,
  anunciado,
  children
}: {
  conexion: DbConnection
  estado: string | null
  anunciado: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="db-consola-identidad">
      <span className="db-consola-alias" title={conexion.alias}>
        {conexion.alias}
      </span>
      <MarcaEntorno entorno={conexion.entorno} />
      {children}
      {/* Informa de la casilla de los agentes: no limita esta consola. */}
      {conexion.readonly && (
        <span className="db-consola-dato" title={TITULO_SOLO_LECTURA_AGENTES}>
          RO agentes
        </span>
      )}
      {estado && (
        <span className="db-consola-estado" title={estado}>
          {estado}
        </span>
      )}
      {/* Región viva SIEMPRE montada (sin el cronómetro: se anunciaría cada segundo). */}
      <span className="solo-lectores" aria-live="polite">
        {anunciado}
      </span>
    </div>
  )
}

/** La cabecera del selector de base y su campo de filtro. */
export function FiltroSelector({
  alias,
  filtroRef,
  filtro,
  placeholder,
  onFiltro
}: {
  alias: string
  filtroRef: React.RefObject<HTMLInputElement>
  filtro: string
  placeholder: string
  onFiltro: (f: string) => void
}): React.JSX.Element {
  return (
    <>
      <div className="db-pop-cabecera">
        Base de la consola en <span className="db-pop-alias">{alias}</span>
      </div>
      <input
        ref={filtroRef}
        className="db-pop-filtro"
        value={filtro}
        placeholder={placeholder}
        spellCheck={false}
        aria-label="Filtrar bases"
        onChange={(e) => onFiltro(e.target.value)}
      />
    </>
  )
}

/** El estado del selector de base: cargando, el error con «Reintentar» o «ninguna coincide». */
export function EstadoSelector({
  cargando,
  error,
  vacio,
  onReintentar
}: {
  cargando: boolean
  error: string | null
  vacio: boolean
  onReintentar: () => void
}): React.JSX.Element {
  return (
    <>
      {cargando && <div className="db-pop-estado">Cargando bases…</div>}
      {error && (
        <div className="db-pop-estado error">
          <span className="db-pop-error-texto" title={error}>
            {error}
          </span>
          <button type="button" className="db-fila-accion" onClick={onReintentar}>
            Reintentar
          </button>
        </div>
      )}
      {vacio && <div className="db-pop-estado">Ninguna base coincide.</div>}
    </>
  )
}
