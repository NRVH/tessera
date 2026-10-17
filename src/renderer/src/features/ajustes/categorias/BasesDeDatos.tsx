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
  ayudaTxInicial,
  DB_FILAS_POR_PAGINA_OPCIONES,
  DB_FILAS_POR_PAGINA_POR_DEFECTO,
  DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO,
  dbInactividadConsolaOpciones,
  DB_INACTIVIDAD_NUNCA,
  DB_TX_INICIAL_POR_DEFECTO,
  normalizarFilasPorPagina,
  normalizarInactividadConsolaMin
} from '../../../../../shared/ajustesBd'
import { formatoEntero } from '../../bd'
import { UI_FONT_MAX, UI_FONT_MIN, altoFila, resolverTamanoBd, tieneTamanoPropio } from '../../../theme/densidad'
import { Fila, Grupo, Radios, Selector, Stepper } from '../primitivas'
import { txBd } from '../textos.ts'
import type { PropsCategoria } from '../tipos'

/** «1000 filas»: con el MISMO formato de número que la píldora de la rejilla. */
function etiquetaFilas(n: number): string {
  return txBd().filas(formatoEntero(n))
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

function opcionesInactividad(): { label: string; value: string }[] {
  return dbInactividadConsolaOpciones().map((o) => ({ label: o.etiqueta, value: String(o.min) }))
}

function modosTx(): readonly { id: DbTxModo; label: string; hint: string }[] {
  const t = txBd()
  return [
    { id: 'auto', label: t.automatica, hint: t.automaticaAyuda },
    { id: 'manual', label: t.manual, hint: t.manualAyuda }
  ]
}

function GrupoApariencia({
  uiFontSize,
  explorerFontSize,
  dbFontSize,
  onChangeDbFontSize
}: PropsCategoria): React.JSX.Element {
  // El tamaño EFECTIVO de la vista: el suyo si lo tiene, si no el del Explorador (que a
  // su vez puede seguir a la interfaz). El stepper parte de aquí.
  const fuenteBd = resolverTamanoBd(uiFontSize, explorerFontSize, dbFontSize)
  const t = txBd()
  return (
    <Grupo titulo={t.grupoApariencia}>
      <Fila
        etiqueta={t.tamanoLetra}
        ayuda={tieneTamanoPropio(dbFontSize) ? t.ayudaArbolPropio(altoFila(fuenteBd)) : t.ayudaArbolIgual}
        modificado={tieneTamanoPropio(dbFontSize)}
        onRestablecer={() => onChangeDbFontSize(0)}
        tituloRestablecer={t.volverExplorador}
        control={
          <Stepper
            valor={fuenteBd}
            min={UI_FONT_MIN}
            max={UI_FONT_MAX}
            onChange={onChangeDbFontSize}
            etiqueta={t.letraVista}
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
  const t = txBd()
  return (
    <Grupo titulo={t.grupoResultados}>
      <Fila
        etiqueta={t.filasPorPagina}
        ayuda={t.filasAyuda}
        modificado={filas !== DB_FILAS_POR_PAGINA_POR_DEFECTO}
        onRestablecer={() => onChangeDbFilasPorPagina(DB_FILAS_POR_PAGINA_POR_DEFECTO)}
        tituloRestablecer={t.volverAFilas(etiquetaFilas(DB_FILAS_POR_PAGINA_POR_DEFECTO))}
        control={
          <Selector
            valor={String(filas)}
            opciones={opcionesFilas()}
            onChange={(v) => onChangeDbFilasPorPagina(normalizarFilasPorPagina(Number(v)))}
            etiqueta={t.filasPorPagina}
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
  const t = txBd()
  return (
    <Fila
      etiqueta={t.cerrarInactiva}
      ayuda={inactividad === DB_INACTIVIDAD_NUNCA ? t.inactividadNunca : t.inactividadAyuda}
      modificado={inactividad !== DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO}
      onRestablecer={() => onChangeDbConsolaInactividadMin(DB_INACTIVIDAD_CONSOLA_MIN_POR_DEFECTO)}
      tituloRestablecer={t.volver30}
      control={
        <Selector
          valor={String(inactividad)}
          opciones={opcionesInactividad()}
          onChange={(v) => onChangeDbConsolaInactividadMin(normalizarInactividadConsolaMin(Number(v)))}
          etiqueta={t.cerrarInactiva}
        />
      }
    />
  )
}

function GrupoConsolas(props: PropsCategoria): React.JSX.Element {
  const { ve, dbTxInicial, onChangeDbTxInicial } = props
  const t = txBd()
  return (
    <Grupo titulo={t.grupoConsolas}>
      {ve('db-tx-inicial') && (
        <>
          <Fila
            etiqueta={t.transaccion}
            ayuda={ayudaTxInicial()}
            modificado={dbTxInicial !== DB_TX_INICIAL_POR_DEFECTO}
            onRestablecer={() => onChangeDbTxInicial(DB_TX_INICIAL_POR_DEFECTO)}
            tituloRestablecer={t.volverAutomatica}
            control={null}
          />
          <Radios nombre="db-tx-inicial" valor={dbTxInicial} opciones={modosTx()} onChange={onChangeDbTxInicial} />
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
