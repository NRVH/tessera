// =============================================================================
// BarraFiltroGuiado: el filtro guiado de la pestaña de tabla (SQL) y de la de colección:
// filas «columna ▾ · operador ▾ · valor» unidas con «todas / cualquiera». No decide nada del
// servidor: el padre valida al aplicar (y el main otra vez) y sabe qué está aplicado.
// Contrato en `shared/filtroGuiado.ts`; lógica pura en `modeloFiltro.ts`.
// Decisiones: docs/decisiones/bd/ui-rejilla-filtro-guiado.md
// =============================================================================

import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import {
  aridad,
  ETIQUETA_OPERADOR,
  OPERADORES_POR_CATEGORIA,
  type DbCategoriaFiltro,
  type DbCondicionFiltro,
  type DbFiltroGuiado,
  type DbOperadorFiltro
} from '../../../../../shared/filtroGuiado.ts'
import {
  cambiarColumna,
  cambiarOperador,
  conCondicion,
  condicionNueva,
  conectorCondicion,
  sinCondicion,
  type ColumnaFiltrable
} from './modeloFiltro.ts'
import { esDeUnaListaDeSelect } from '../../../comun/useDialogo'
import './filtro.css'

export interface BarraFiltroGuiadoProps {
  /** Las columnas elegibles, en el orden en que se ven en la rejilla. */
  columnas: readonly ColumnaFiltrable[]
  /** Lo ESCRITO (puede estar a medias). */
  filtro: DbFiltroGuiado
  onCambiar: (f: DbFiltroGuiado) => void
  /** Aplicar lo escrito (Intro en un valor, o el botón). El padre valida y consulta. */
  onAplicar: () => void
  /** Esc: volver a lo último aplicado que funcionó. */
  onRestaurar: () => void
  /** El error a señalar: en la condición `condicion` (su fila) o en la barra entera (null). */
  error: { condicion: number | null; mensaje: string } | null
  /** Mientras llega una consulta o hay cambios sin enviar que el padre protege. */
  deshabilitado?: boolean
  /**
   * El botón del modo AVANZADO («SQL» en la tabla, «JSON» en la colección): lo pinta la barra
   * a la derecha y avisa al padre, que cambia de barra.
   */
  avanzado: { etiqueta: string; titulo: string; onClick: () => void }
}

/** La pista de cada categoría en el campo de valor. */
const PISTA: Readonly<Record<DbCategoriaFiltro, string>> = {
  texto: 'texto',
  numero: 'número (12.5)',
  fecha: 'AAAA-MM-DD [HH:MM]',
  booleano: '',
  id: 'ObjectId o texto',
  otro: ''
}

/** A dónde va el foco tras el próximo pintado (añadir o quitar una fila). */
type Foco = { fila: number; parte: 'columna' | 'quitar' } | 'anadir' | null

/** Cumple el foco pedido por «+ Condición» o el aspa, y lleva el foco a la fila de un error nuevo. */
function useFocoFiltro(
  raizRef: React.RefObject<HTMLDivElement>,
  anadirRef: React.RefObject<HTMLButtonElement>,
  error: BarraFiltroGuiadoProps['error']
): React.MutableRefObject<Foco> {
  /** El foco pedido; se cumple en el pintado siguiente. Un ref: el pedido no pinta nada. */
  const focoRef = useRef<Foco>(null)

  // Sin dependencias a propósito: la fila nueva existe en el DOM en el pintado que sigue
  // a `onCambiar` (el padre pasa el filtro nuevo), no antes.
  useLayoutEffect(() => {
    const foco = focoRef.current
    if (foco === null) return
    focoRef.current = null
    if (foco === 'anadir') {
      anadirRef.current?.focus()
      return
    }
    raizRef.current?.querySelector<HTMLElement>(`[data-fila="${foco.fila}"] [data-parte="${foco.parte}"]`)?.focus()
  })

  // Un error NUEVO en una fila lleva el foco a su valor (o a su columna, si no lleva valor).
  // Por sus dos datos y no por el objeto: el padre puede crearlo en cada pintado. Un campo de
  // una pestaña oculta no toma el foco, así que no se roba desde el fondo.
  const filaError = error?.condicion ?? null
  const mensajeError = error?.mensaje ?? null
  useEffect(() => {
    if (filaError === null || mensajeError === null) return
    const fila = raizRef.current?.querySelector(`[data-fila="${filaError}"]`)
    const destino =
      fila?.querySelector<HTMLElement>('[data-parte="valor"]') ?? fila?.querySelector<HTMLElement>('[data-parte="columna"]')
    destino?.focus()
  }, [filaError, mensajeError, raizRef])

  return focoRef
}

interface FilaCondicionProps {
  i: number
  c: DbCondicionFiltro
  union: DbFiltroGuiado['union']
  columnas: readonly ColumnaFiltrable[]
  /** El mensaje de error de ESTA fila, o null. */
  mensajeError: string | null
  idError: string
  deshabilitado: boolean
  cambiar: (i: number, c: DbCondicionFiltro) => void
  quitar: (i: number) => void
}

/** Desplegable de la columna de una condición; una columna que ya no está se conserva. */
function SelectColumna({ i, c, columnas, mensajeError, deshabilitado, cambiar }: FilaCondicionProps): React.JSX.Element {
  const conocida = columnas.some((col) => col.nombre === c.columna)
  return (
    <select
      data-parte="columna"
      className="filtro-guiado-control filtro-guiado-columna"
      aria-label="Columna"
      title={c.columna}
      value={c.columna}
      disabled={deshabilitado}
      aria-invalid={mensajeError !== null}
      onChange={(e) => {
        const col = columnas.find((x) => x.nombre === e.target.value)
        if (col) cambiar(i, cambiarColumna(c, col))
      }}
    >
      {columnas.map((col) => (
        <option key={col.nombre} value={col.nombre}>
          {col.nombre}
        </option>
      ))}
      {!conocida && <option value={c.columna}>{c.columna} (no está)</option>}
    </select>
  )
}

/** Desplegable del operador: los que admite la categoría de la columna. */
function SelectOperador({ i, c, deshabilitado, cambiar }: FilaCondicionProps): React.JSX.Element {
  return (
    <select
      data-parte="operador"
      className="filtro-guiado-control filtro-guiado-operador"
      aria-label="Operador"
      value={c.operador}
      disabled={deshabilitado}
      onChange={(e) => cambiar(i, cambiarOperador(c, e.target.value as DbOperadorFiltro))}
    >
      {OPERADORES_POR_CATEGORIA[c.categoria].map((op) => (
        <option key={op} value={op}>
          {ETIQUETA_OPERADOR[op]}
        </option>
      ))}
    </select>
  )
}

/** Una condición: conector, columna, operador, valor(es) y aspa; su error debajo. */
function FilaCondicion(p: FilaCondicionProps): React.JSX.Element {
  const { i, c, mensajeError, idError, deshabilitado, cambiar } = p
  const conError = mensajeError !== null
  const valores = aridad(c.operador)
  const campoValor = (cual: 'valor' | 'valor2', etiqueta: string): React.JSX.Element => (
    <CampoValor
      categoria={c.categoria}
      valor={c[cual] ?? ''}
      etiqueta={etiqueta}
      invalido={conError}
      idError={conError ? idError : undefined}
      deshabilitado={deshabilitado}
      onValor={(v) => cambiar(i, { ...c, [cual]: v })}
    />
  )
  return (
    <div className="filtro-guiado-bloque">
      <div className={`filtro-guiado-fila${conError ? ' con-error' : ''}`} role="group" aria-label={`Condición ${i + 1}`} data-fila={i}>
        <span className="filtro-guiado-conector" aria-hidden="true">
          {conectorCondicion(p.union, i)}
        </span>
        <SelectColumna {...p} />
        <SelectOperador {...p} />
        {valores >= 1 && campoValor('valor', valores === 2 ? 'Desde' : 'Valor')}
        {valores === 2 && (
          <>
            <span className="filtro-guiado-y" aria-hidden="true">
              y
            </span>
            {campoValor('valor2', 'Hasta')}
          </>
        )}
        <button
          type="button"
          data-parte="quitar"
          className="btn btn-icon filtro-guiado-quitar"
          aria-label={`Quitar la condición ${i + 1}`}
          title="Quitar la condición"
          disabled={deshabilitado}
          onClick={() => p.quitar(i)}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3l6 6M9 3L3 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {conError && (
        <div id={idError} className="filtro-guiado-error en-fila" role="alert">
          {mensajeError}
        </div>
      )}
    </div>
  )
}

/** El pie: «+ Condición», el conmutador de unión (con dos o más) y, a la derecha, Aplicar y el modo avanzado. */
function PieFiltro(props: {
  p: BarraFiltroGuiadoProps
  anadirRef: React.RefObject<HTMLButtonElement>
  anadir: () => void
}): React.JSX.Element {
  const { filtro, columnas, onCambiar, onAplicar, avanzado } = props.p
  const deshabilitado = props.p.deshabilitado ?? false
  const n = filtro.condiciones.length
  const sinColumnas = columnas.length === 0
  return (
    <div className={`filtro-guiado-pie${n > 0 ? ' con-condiciones' : ''}`}>
      <button
        ref={props.anadirRef}
        type="button"
        className="btn btn-ghost filtro-guiado-anadir"
        title={sinColumnas ? 'Todavía no hay columnas que elegir' : 'Añadir una condición'}
        disabled={deshabilitado || sinColumnas}
        onClick={props.anadir}
      >
        + Condición
      </button>
      {n === 0 && <span className="filtro-guiado-vacio">Sin filtro</span>}
      {n >= 2 && (
        <span
          className="filtro-guiado-union"
          role="group"
          aria-label="Cómo se unen las condiciones"
          title="Filas que cumplan TODAS las condiciones (Y) o CUALQUIERA de ellas (O)"
        >
          {(['todas', 'cualquiera'] as const).map((u) => (
            <button
              key={u}
              type="button"
              className={`btn${filtro.union === u ? ' btn-active' : ''}`}
              aria-pressed={filtro.union === u}
              disabled={deshabilitado}
              onClick={() => {
                if (filtro.union !== u) onCambiar({ ...filtro, union: u })
              }}
            >
              {u}
            </button>
          ))}
        </span>
      )}
      <span className="filtro-guiado-acciones">
        <button type="button" className="btn filtro-guiado-aplicar" title="Aplicar el filtro (Intro)" disabled={deshabilitado} onClick={onAplicar}>
          Aplicar
        </button>
        <button type="button" className="btn filtro-guiado-avanzado" title={avanzado.titulo} onClick={avanzado.onClick}>
          {avanzado.etiqueta}
        </button>
      </span>
    </div>
  )
}

export function BarraFiltroGuiado(p: BarraFiltroGuiadoProps): React.JSX.Element {
  const { columnas, filtro, onCambiar, onAplicar, onRestaurar, error, deshabilitado = false } = p
  const idBase = useId()
  const raizRef = useRef<HTMLDivElement>(null)
  const anadirRef = useRef<HTMLButtonElement>(null)
  const focoRef = useFocoFiltro(raizRef, anadirRef, error)
  const n = filtro.condiciones.length

  const cambiar = (i: number, c: DbCondicionFiltro): void => onCambiar(conCondicion(filtro, i, c))

  const anadir = (): void => {
    const c = condicionNueva(columnas)
    if (c === null) return
    focoRef.current = { fila: n, parte: 'columna' }
    onCambiar({ ...filtro, condiciones: [...filtro.condiciones, c] })
  }

  const quitar = (i: number): void => {
    // La que ocupa su sitio (o la de encima, si era la última); sin ninguna, «+ Condición».
    const queda = n - 1
    focoRef.current = queda === 0 ? 'anadir' : { fila: Math.min(i, queda - 1), parte: 'quitar' }
    onCambiar(sinCondicion(filtro, i))
  }

  // Intro en un campo o desplegable aplica; Esc pide volver a lo aplicado y sigue su camino.
  const tecla = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.nativeEvent.isComposing) return
    // Con la lista de un select desplegada, Intro elige y Esc la cierra: no son de la barra (burbujean desde el DOM).
    if (esDeUnaListaDeSelect(e.target)) return
    const t = e.target as HTMLElement
    if (t.tagName !== 'INPUT' && t.tagName !== 'SELECT') return
    if (e.key === 'Enter' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      onAplicar()
    } else if (e.key === 'Escape') {
      onRestaurar()
    }
  }

  // Un error cuya fila ya no existe (se quitó) se enseña bajo la barra: mejor que perderlo.
  const errorDeBarra = error !== null && (error.condicion === null || error.condicion >= n) ? error.mensaje : null

  return (
    <div className="filtro-guiado" role="group" aria-label="Filtro" ref={raizRef} onKeyDown={tecla}>
      {filtro.condiciones.map((c, i) => (
        <FilaCondicion
          key={i}
          i={i}
          c={c}
          union={filtro.union}
          columnas={columnas}
          mensajeError={error !== null && error.condicion === i ? error.mensaje : null}
          idError={`${idBase}-error-${i}`}
          deshabilitado={deshabilitado}
          cambiar={cambiar}
          quitar={quitar}
        />
      ))}
      <PieFiltro p={p} anadirRef={anadirRef} anadir={anadir} />
      {errorDeBarra !== null && (
        <div className="filtro-guiado-error" role="alert">
          {errorDeBarra}
        </div>
      )}
    </div>
  )
}

interface CampoValorProps {
  categoria: DbCategoriaFiltro
  valor: string
  etiqueta: string
  invalido: boolean
  idError: string | undefined
  deshabilitado: boolean
  onValor: (v: string) => void
}

/** Verdadero/falso en un desplegable; un valor desconocido se conserva como opción. */
function SelectBooleano({ valor, etiqueta, invalido, idError, deshabilitado, onValor }: CampoValorProps): React.JSX.Element {
  const conocido = valor === '' || valor === 'true' || valor === 'false'
  return (
    <select
      data-parte="valor"
      className="filtro-guiado-control filtro-guiado-valor es-booleano"
      aria-label={etiqueta}
      aria-invalid={invalido}
      aria-describedby={idError}
      value={valor}
      disabled={deshabilitado}
      onChange={(e) => onValor(e.target.value)}
    >
      {valor === '' && (
        <option value="" disabled>
          elige…
        </option>
      )}
      <option value="true">verdadero</option>
      <option value="false">falso</option>
      {!conocido && <option value={valor}>{valor}</option>}
    </select>
  )
}

/** El campo del valor según la categoría de la columna. */
function CampoValor(props: CampoValorProps): React.JSX.Element {
  const { categoria, valor, etiqueta, invalido, idError, deshabilitado, onValor } = props
  if (categoria === 'booleano') return <SelectBooleano {...props} />
  return (
    <input
      data-parte="valor"
      type="text"
      className={`filtro-guiado-control filtro-guiado-valor es-${categoria}`}
      aria-label={etiqueta}
      aria-invalid={invalido}
      aria-describedby={idError}
      value={valor}
      placeholder={PISTA[categoria]}
      inputMode={categoria === 'numero' ? 'decimal' : undefined}
      disabled={deshabilitado}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      onChange={(e) => onValor(e.target.value)}
    />
  )
}
