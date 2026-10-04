// =============================================================================
// Categoría BASES DE DATOS: los ajustes del explorador de bases de datos (tamaño de
// letra, filas por página, transacción al abrir e inactividad de la consola).
// El saneado, los valores por defecto y el porqué de cada uno viven en
// `shared/ajustesBd.ts`; aquí solo cómo se enseñan. El tamaño de letra hereda del
// EXPLORADOR (no de la interfaz); filas por página e inactividad son selectores porque
// sus saltos no son de uno en uno; la transacción son radios (dos opciones excluyentes).
// El texto de la ayuda de la transacción vive en `shared/ajustesBd.ts` para fijarlo con su prueba.
// =============================================================================

import type { DbTxModo } from '../../../../../shared/db-explorador-ipc'
import {
  AYUDA_TX_INICIAL,
  DB_FILAS_POR_PAGINA_OPCIONES,
  DB_FILAS_POR_PAGINA_POR_DEFECTO,
  DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO,
  DB_INACTIVIDAD_CONSOLA_OPCIONES,
  DB_INACTIVIDAD_NUNCA,
  DB_TX_INICIAL_POR_DEFECTO,
  normalizarFilasPorPagina,
  normalizarInactividadConsolaMin
} from '../../../../../shared/ajustesBd'
import { formatoEntero } from '../../bd'
import { UI_FONT_MAX, UI_FONT_MIN, altoFila, resolverTamanoBd, tieneTamanoPropio } from '../../../theme/densidad'
import { Fila, Grupo, Radios, Selector, Stepper } from '../primitivas'
import type { PropsCategoria } from '../tipos'

/** «1000 filas»: con el MISMO formato de número que la píldora de la rejilla. */
function etiquetaFilas(n: number): string {
  return `${formatoEntero(n)} filas`
}

let opcionesFilasCalculadas: { label: string; value: string }[] | undefined

/**
 * Se calculan al primer uso y no al cargar: `formatoEntero` llega por el ciclo de importación
 * bd↔ajustes y su módulo puede no haberse evaluado todavía (`npm run test:ciclos`).
 */
function opcionesFilas(): { label: string; value: string }[] {
  opcionesFilasCalculadas ??= DB_FILAS_POR_PAGINA_OPCIONES.map((n) => ({ label: etiquetaFilas(n), value: String(n) }))
  return opcionesFilasCalculadas
}

const OPCIONES_INACTIVIDAD = DB_INACTIVIDAD_CONSOLA_OPCIONES.map((o) => ({ label: o.etiqueta, value: String(o.min) }))

const MODOS_TX: readonly { id: DbTxModo; label: string; hint: string }[] = [
  {
    id: 'auto',
    label: 'Automática',
    hint: 'Cada sentencia se confirma sola al terminar.'
  },
  {
    id: 'manual',
    label: 'Manual',
    hint: 'Los cambios esperan a «Confirmar (Commit)» o «Revertir».'
  }
]

function GrupoApariencia({
  uiFontSize,
  explorerFontSize,
  dbFontSize,
  onChangeDbFontSize
}: PropsCategoria): React.JSX.Element {
  // El tamaño EFECTIVO de la vista: el suyo si lo tiene, si no el del Explorador (que a
  // su vez puede seguir a la interfaz). El stepper parte de aquí.
  const fuenteBd = resolverTamanoBd(uiFontSize, explorerFontSize, dbFontSize)
  return (
    <Grupo titulo="Apariencia">
      <Fila
        etiqueta="Tamaño de letra"
        ayuda={
          tieneTamanoPropio(dbFontSize)
            ? `Árbol de conexiones, rejillas y resultados. Tamaño propio · filas de ${altoFila(fuenteBd)} px.`
            : 'Árbol de conexiones, rejillas y resultados. Igual que el Explorador.'
        }
        modificado={tieneTamanoPropio(dbFontSize)}
        onRestablecer={() => onChangeDbFontSize(0)}
        tituloRestablecer="Volver a seguir el tamaño del Explorador"
        control={
          <Stepper
            valor={fuenteBd}
            min={UI_FONT_MIN}
            max={UI_FONT_MAX}
            onChange={onChangeDbFontSize}
            etiqueta="el tamaño de letra de la vista de bases de datos"
          />
        }
      />
    </Grupo>
  )
}

function GrupoResultados({
  dbFilasPorPagina,
  onChangeDbFilasPorPagina
}: PropsCategoria): React.JSX.Element {
  const filas = normalizarFilasPorPagina(dbFilasPorPagina)
  return (
    <Grupo titulo="Resultados">
      <Fila
        etiqueta="Filas por página"
        ayuda="Cuántas filas se leen de cada vez en las tablas y en los resultados de la consola. Vale para la siguiente lectura; lo ya cargado no cambia."
        modificado={filas !== DB_FILAS_POR_PAGINA_POR_DEFECTO}
        onRestablecer={() => onChangeDbFilasPorPagina(DB_FILAS_POR_PAGINA_POR_DEFECTO)}
        tituloRestablecer={`Volver a ${etiquetaFilas(DB_FILAS_POR_PAGINA_POR_DEFECTO)}`}
        control={
          <Selector
            valor={String(filas)}
            opciones={opcionesFilas()}
            onChange={(v) => onChangeDbFilasPorPagina(normalizarFilasPorPagina(Number(v)))}
            etiqueta="Filas por página"
          />
        }
      />
    </Grupo>
  )
}

function FilaInactividad({
  dbConsolaInactividadMin,
  onChangeDbConsolaInactividadMin
}: PropsCategoria): React.JSX.Element {
  const inactividad = normalizarInactividadConsolaMin(dbConsolaInactividadMin)
  return (
    <Fila
      etiqueta="Cerrar la sesión inactiva tras"
      ayuda={
        inactividad === DB_INACTIVIDAD_NUNCA
          ? 'La sesión de una consola no se cierra sola. Una con cambios sin confirmar no se cierra nunca.'
          : 'Una consola ociosa suelta su sesión y la reabre al volver a usarla; se pierde lo fijado con ALTER SESSION o SET. Una con cambios sin confirmar no se cierra nunca.'
      }
      modificado={inactividad !== DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO}
      onRestablecer={() => onChangeDbConsolaInactividadMin(DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO)}
      tituloRestablecer="Volver a 30 minutos"
      control={
        <Selector
          valor={String(inactividad)}
          opciones={OPCIONES_INACTIVIDAD}
          onChange={(v) => onChangeDbConsolaInactividadMin(normalizarInactividadConsolaMin(Number(v)))}
          etiqueta="Cerrar la sesión inactiva tras"
        />
      }
    />
  )
}

function GrupoConsolas(props: PropsCategoria): React.JSX.Element {
  const { ve, dbTxInicial, onChangeDbTxInicial } = props
  return (
    <Grupo titulo="Consolas">
      {ve('db-tx-inicial') && (
        <>
          <Fila
            etiqueta="Transacción al abrir"
            ayuda={AYUDA_TX_INICIAL}
            modificado={dbTxInicial !== DB_TX_INICIAL_POR_DEFECTO}
            onRestablecer={() => onChangeDbTxInicial(DB_TX_INICIAL_POR_DEFECTO)}
            tituloRestablecer="Volver a Automática"
            control={null}
          />
          <Radios nombre="db-tx-inicial" valor={dbTxInicial} opciones={MODOS_TX} onChange={onChangeDbTxInicial} />
        </>
      )}
      {ve('db-inactividad-consola') && <FilaInactividad {...props} />}
    </Grupo>
  )
}

export function BasesDeDatos(props: PropsCategoria): React.JSX.Element {
  const { ve } = props
  return (
    <>
      {ve('db-font') && <GrupoApariencia {...props} />}

      {ve('db-filas-pagina') && <GrupoResultados {...props} />}

      {(ve('db-tx-inicial') || ve('db-inactividad-consola')) && <GrupoConsolas {...props} />}
    </>
  )
}
