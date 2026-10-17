// =============================================================================
// DbConsolaDocsPane: la pestaña de CONSOLA de MongoDB. Hermana de la consola SQL: la misma
// barra, los mismos acordes, el mismo reparto editor / divisor / resultados y las mismas
// marcas en el margen. Compone los hooks de esta carpeta EN ESTE ORDEN, que es el de sus
// efectos; el estado y la base de la consola viven en `useEstadoConsolaDocs.ts`.
// Interpreta, nunca evalúa: cada sentencia viaja tal cual y el main aplica las barreras.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import { useCallback } from 'react'
import { descriptor, esDeDocumentos, tieneNivelBases } from '../../../../../shared/motores/index'
import { Splitter } from '../../../comun/Splitter'
import { limpiarSalida } from '../consola/salidaConsola'
import { BarraConsolaDocs } from './BarraConsolaDocs'
import { AvisoConflicto, CarcasaConsola } from './CarcasaConsola'
import { MIN_RESULTADOS } from './consolaComun'
import { useEstadoConsolaDocs, type EstadoConsolaDocs, type PropsConsolaDocs } from './useEstadoConsolaDocs'
import { registrarAccionesConsolaDocs } from './monacoConsolaDocs'
import { ResultadosDocs } from './ResultadosDocs'
import { seleccionarDocumento } from './resultadosConsolaDocs'
import { aplicarAccionPestana, sinLectores, type AccionPestanaResultado } from '../resultados/pestanasResultado'
import { useArchivoConsolaDocs, useIndicadorConsolaDocs } from './useArchivoConsolaDocs'
import { useCierreConsolaDocs } from './useCierreConsolaDocs'
import { useEditorConsola, useAccionesConsola } from './useEditorConsola'
import { useEjecucionDocs } from './useEjecucionDocs'
import { useHistorialConsolaDocs, type HistorialConsolaDocs } from './useHistorialConsolaDocs'
import { useAutocompletadoDocs } from './proveedorDocsMonaco'
import { HistorialConsultas } from '../HistorialConsultas'
import { useRepartoAlto } from './useRepartoAlto'
import { txConsolaDocs } from './textosConsolaDocs'
import '../consola.css'


function textoEstado(e: EstadoConsolaDocs): string | null {
  if (e.cargado) return e.pista
  const t = txConsolaDocs()
  return e.errorCarga !== null ? t.noSePudoLeer(e.errorCarga) : t.cargando
}

function useAccionesBarra(p: PropsConsolaDocs, e: EstadoConsolaDocs): { editarConexion: () => void; elegirBase: (b: string) => void } {
  const { onEditarConexion } = p
  const editarConexion = useCallback(() => onEditarConexion?.(p.conexion.id), [onEditarConexion, p.conexion.id])
  const { baseRef, cambiarBase, anotar } = e
  const elegirBase = useCallback(
    (b: string): void => {
      if (b === baseRef.current) return
      cambiarBase(b)
      anotar([{ tipo: 'info', texto: txConsolaDocs().cambioBase(b) }])
    },
    [baseRef, cambiarBase, anotar]
  )
  return { editarConexion, elegirBase }
}

/** Lo que hacen la tira y las tablas de resultados; estables, para no repintar los paneles. */
function useAccionesResultados(e: EstadoConsolaDocs): {
  onPestana: (accion: AccionPestanaResultado, id: string) => void
  onSeleccionar: (id: string, i: number) => void
} {
  const { cambiarResultados } = e
  const onPestana = useCallback(
    (accion: AccionPestanaResultado, id: string): void => cambiarResultados((est) => aplicarAccionPestana(est, accion, id)),
    [cambiarResultados]
  )
  const onSeleccionar = useCallback(
    (id: string, i: number): void => cambiarResultados((est) => sinLectores(seleccionarDocumento(est, id, i))),
    [cambiarResultados]
  )
  return { onPestana, onSeleccionar }
}

/** La mitad de abajo: la Salida y las pestañas de resultado. */
function ResultadosConsolaDocs({ p, e, x, alto }: { p: PropsConsolaDocs; e: EstadoConsolaDocs; x: ReturnType<typeof useEjecucionDocs>; alto: number }): React.JSX.Element {
  const { onPestana, onSeleccionar } = useAccionesResultados(e)
  return (
    <ResultadosDocs
      conexion={p.conexion}
      alto={alto}
      altoFila={p.altoFila}
      visible={p.visible}
      resultados={e.resultados}
      onPestana={onPestana}
      salida={e.salida}
      loteMarcado={e.loteMarcado}
      onSeleccionar={onSeleccionar}
      cargandoMas={e.cargandoMas}
      onCargarMas={() => void x.cargarMas()}
      onIrA={x.irA}
      onAccionSalida={(a) => void x.accionSalida(a)}
      onLimpiarSalida={() => e.setSalida((s) => limpiarSalida(s))}
    />
  )
}

/** El historial de órdenes, colgado del reloj de la barra mientras está abierto. */
function PopoverHistorialDocs({ p, h }: { p: PropsConsolaDocs; h: HistorialConsolaDocs }): React.JSX.Element | null {
  if (!h.historialAbierto || !h.anclaHistorial) return null
  return (
    <HistorialConsultas
      perfilId={p.perfilId}
      conexion={p.conexion}
      ancla={h.anclaHistorial}
      lenguaje="mongosh"
      onInsertar={h.insertar}
      onCerrar={h.cerrarHistorial}
    />
  )
}

/** La pestaña de consola de una conexión de MongoDB. */
export function DbConsolaDocsPane(p: PropsConsolaDocs): React.JSX.Element {
  const e = useEstadoConsolaDocs(p)
  const archivo = useArchivoConsolaDocs(e)
  useIndicadorConsolaDocs(e)
  const { hostRef, ed, edRef } = useEditorConsola(e.modelo, p.visible, e.cargado)
  const x = useEjecucionDocs(e, edRef)
  const { colRef: colReparto, maxResultados, altoEfectivo } = useRepartoAlto(p.altoResultados)
  const h = useHistorialConsolaDocs(e, edRef, colReparto)
  useAccionesConsola(ed, registrarAccionesConsolaDocs, { ...x, historial: h.alternarHistorial }, archivo.guardar, e.quitarPista)
  useCierreConsolaDocs(e, p.paneKey, x.detener, archivo.vaciar)
  useAutocompletadoDocs(ed, e.modelo, e.conexionRef, e.baseRef)

  const d = descriptor(p.conexion.motor)
  const { editarConexion, elegirBase } = useAccionesBarra(p, e)

  return (
    <CarcasaConsola
      colRef={h.colRef}
      visible={p.visible}
      nombre={p.consola.nombre}
      dialogo={e.dialogo}
      onDetener={x.detener}
      onHistorial={h.alternarHistorial}
    >
      <BarraConsolaDocs
        conexion={p.conexion}
        base={e.base}
        altoFila={p.altoFila}
        conSelectorBase={esDeDocumentos(d) && tieneNivelBases(d, p.conexion)}
        enCurso={e.enCurso}
        detenible={e.enCurso !== null || e.cargandoMas}
        cargado={e.cargado}
        textoEstado={textoEstado(e)}
        onEjecutar={x.ejecutar}
        onEjecutarTodo={x.ejecutarTodo}
        onDetener={x.detener}
        onElegirBase={elegirBase}
        onEditarConexion={editarConexion}
        onHistorial={h.alternarHistorial}
        historialAbierto={h.historialAbierto}
      />

      {e.conflicto && <AvisoConflicto onCargarDelDisco={archivo.cargarDelDisco} onConservarLaMia={archivo.conservarLaMia} />}

      <div ref={hostRef} className="db-consola-editor" />

      <Splitter
        orientation="horizontal"
        className="splitter-hueco"
        size={altoEfectivo}
        min={MIN_RESULTADOS}
        max={maxResultados}
        direction={-1}
        onResize={p.onAltoResultados}
        label={txConsolaDocs().repartoAria}
      />

      <ResultadosConsolaDocs p={p} e={e} x={x} alto={altoEfectivo} />

      <PopoverHistorialDocs p={p} h={h} />
    </CarcasaConsola>
  )
}
