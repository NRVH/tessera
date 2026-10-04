// =============================================================================
// DbConsolaPane: la pestaña de CONSOLA SQL de la vista de bases de datos: la barra, el
// editor arriba, un divisor y los resultados («Salida» + una pestaña por conjunto de
// filas) abajo. La lógica vive en `useConsola`; el editor y el reparto de alto, en
// `consola/usePaneSql.ts`. Los diálogos van por portal a `document.body`: se puede
// pedir cerrar una consola cuya pestaña está oculta.
// Decisiones: docs/decisiones/bd/ui-consola-barra-y-pane.md
// =============================================================================

import { useCallback, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import type { DbConnection } from '../../../../shared/db-ipc'
import { useEditorDelPane, useSeccionDelPane } from './consola/usePaneSql'
import { atajoDeSeccion } from './consola/vivoConsola'
import { AvisoConflicto } from './documentos/CarcasaConsola'
import { MIN_RESULTADOS } from './documentos/consolaComun'
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { Splitter } from '../../comun/Splitter'
import { BarraConsola, type BarraConsolaProps } from './BarraConsola'
import { DbResultados } from './DbResultados'
import { DialogoParametros } from './DialogoParametros'
import { DialogoTxPendiente } from './DialogoTxPendiente'
import { HistorialConsultas } from './HistorialConsultas'
import type { DbConsolaPaneProps } from './propsBd'
import './consola.css'

type Consola = ReturnType<typeof useEditorDelPane>['c']
type Dialogo = NonNullable<Consola['dialogo']>

/**
 * Detener, explicar, historial y formatear con el foco FUERA del editor (la rejilla, la
 * Salida, la barra): dentro los consume su `addAction`. Nunca a través de un diálogo ni
 * desde un portal (`atajoDeSeccion`): React burbujea hasta aquí las teclas de uno.
 */
function atenderAtajo(e: React.KeyboardEvent<HTMLElement>, c: Consola): void {
  const a = atajoDeSeccion(
    e,
    {
      detenible: c.detenible,
      dialogoAbierto: c.dialogo !== null,
      desdePortal: !(e.target instanceof Node && e.currentTarget.contains(e.target))
    },
    window.tessera.plataforma
  )
  if (a === null) return
  e.preventDefault()
  if (a === 'detener') c.detener()
  else if (a === 'explicar') c.explicar()
  else if (a === 'historial') c.alternarHistorial()
  else c.formatear()
}

/** Lo que la barra recibe de la consola. */
function propsDeBarra(c: Consola, conexion: DbConnection, altoFila: number, onEditarConexion: () => void): BarraConsolaProps {
  return {
    alias: conexion.alias,
    conexion,
    altoFila,
    esquemaActual: c.esquemaActual,
    esquemaElegido: c.esquemaElegido,
    cambiandoEsquema: c.cambiandoEsquema,
    onElegirEsquema: c.elegirEsquema,
    barraTx: c.barraTx,
    lote: c.estado.lote,
    ejecutando: c.ejecutando,
    detenible: c.detenible,
    cargado: c.cargado,
    textoEstado: c.textoEstado,
    onEjecutar: c.ejecutar,
    onEjecutarTodo: c.ejecutarTodo,
    onDetener: c.detener,
    onAlternarTx: c.alternarModoTx,
    onCommit: c.commit,
    onRollback: c.rollback,
    onEditarConexion,
    onExplicar: c.explicar,
    onHistorial: c.alternarHistorial,
    historialAbierto: c.historialAbierto
  }
}

/** Lo que los resultados reciben de la consola y del pane. */
function propsDeResultados(p: DbConsolaPaneProps, c: Consola, alto: number): ComponentProps<typeof DbResultados> {
  return {
    perfilId: p.perfilId,
    consolaId: p.consola.id,
    txInicial: p.txInicial,
    conexionId: p.conexion.id,
    motor: p.conexion.motor,
    resultados: c.estado.resultados,
    salida: c.estado.salida,
    loteMarcado: c.loteMarcado,
    loteActual: c.estado.lote ? c.estado.lote.id : null,
    alto,
    visible: p.visible,
    altoFila: p.altoFila,
    cargandoMas: c.cargandoMas,
    contando: c.contando,
    totales: c.totales,
    onPestana: c.pestana,
    onCargarMas: c.cargarMas,
    onContar: c.contar,
    onVolverAEjecutar: c.volverAEjecutar,
    onIrA: c.irA,
    onAccionSalida: c.accionSalida,
    onLimpiarSalida: c.limpiarSalida,
    trayendo: c.trayendo,
    topes: c.topes,
    onTraerTodas: c.traerTodas,
    onDetenerTraerTodas: c.detenerTraerTodas
  }
}

/** El diálogo abierto de la consola, por portal a `document.body`. */
function DialogoConsola({ d }: { d: Dialogo }): React.ReactPortal {
  return createPortal(
    d.tipo === 'confirmar' ? (
      <ConfirmDialog
        title={d.titulo}
        message={d.mensaje}
        confirmLabel={d.confirmar}
        danger={d.peligro}
        onConfirm={() => d.resolver(true)}
        onCancel={() => d.resolver(false)}
      />
    ) : d.tipo === 'tx' ? (
      <DialogoTxPendiente
        tx={d.tx}
        sentencias={d.sentencias}
        contexto={d.contexto}
        onResolver={(r) => d.resolver(r)}
        onCancelar={() => d.resolver(null)}
      />
    ) : (
      <DialogoParametros
        campos={d.campos}
        iniciales={d.iniciales}
        mensaje={d.mensaje}
        accion={d.accion}
        dialecto={d.dialecto}
        alias={d.alias}
        onAceptar={(b) => d.resolver(b)}
        onCancelar={() => d.resolver(null)}
      />
    ),
    document.body
  )
}

/** La pestaña de consola SQL: barra, editor, divisor, resultados y sus diálogos. */
export function DbConsolaPane(props: DbConsolaPaneProps): React.JSX.Element {
  const { perfilId, consola, conexion, visible, altoFila, onAltoResultados } = props
  const { c, hostRef } = useEditorDelPane(props)
  const sec = useSeccionDelPane(props.altoResultados, visible, c.historialAbierto, c.cerrarHistorial)

  const onEditarConexion = props.onEditarConexion
  const editarConexion = useCallback(() => onEditarConexion(conexion.id), [onEditarConexion, conexion.id])

  return (
    <section
      ref={sec.colRef}
      className={`db-consola${visible ? '' : ' hidden'}`}
      aria-label={`Consola ${consola.nombre}`}
      aria-hidden={!visible}
      onKeyDown={(e) => atenderAtajo(e, c)}
    >
      <BarraConsola {...propsDeBarra(c, conexion, altoFila, editarConexion)} />

      {/* El guardado queda congelado hasta elegir. */}
      {c.conflicto && <AvisoConflicto onCargarDelDisco={c.cargarDelDisco} onConservarLaMia={c.conservarLaMia} />}

      <div ref={hostRef} className="db-consola-editor" />

      <Splitter
        orientation="horizontal"
        size={sec.altoEfectivo}
        min={MIN_RESULTADOS}
        max={sec.maxResultados}
        direction={-1}
        onResize={onAltoResultados}
        label="Reparto entre la consola y los resultados"
      />

      <DbResultados {...propsDeResultados(props, c, sec.altoEfectivo)} />

      {c.dialogo && <DialogoConsola d={c.dialogo} />}

      {c.historialAbierto && sec.anclaHistorial && (
        <HistorialConsultas
          perfilId={perfilId}
          conexion={conexion}
          ancla={sec.anclaHistorial}
          onInsertar={c.insertarSql}
          onCerrar={c.cerrarHistorial}
        />
      )}
    </section>
  )
}
