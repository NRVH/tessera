// =============================================================================
// PaneConsolaClavesBd: la pestaña de CONSOLA de Redis. Hermana de la consola de MongoDB, que es
// su molde: la misma barra, los mismos acordes y el mismo reparto editor / divisor / resultados.
// Compone los hooks de esta carpeta EN ESTE ORDEN, que es el de sus efectos; comparte con
// `documentos/` lo idéntico. Un comando por línea; el renderer no clasifica y el main decide.
// Decisiones: docs/decisiones/bd/ui-claves-consola.md
// =============================================================================

import { Presente } from '../../../comun/Presente'
import { useCallback } from 'react'
import { Divisor } from '../../../comun/Divisor'
import { AvisoConflicto, CarcasaConsola } from '../documentos/CarcasaConsola'
import { MIN_RESULTADOS } from '../documentos/consolaComun'
import { registrarAccionesConsolaClaves } from './monacoConsolaClaves'
import { useAccionesConsola, useEditorConsola } from '../documentos/useEditorConsola'
import { useRepartoAlto } from '../documentos/useRepartoAlto'
import { BarraConsolaClaves } from './BarraConsolaClaves'
import { limpiarRegistro, textoCambioBase } from './consolaClaves'
import { useEstadoConsolaClaves, type EstadoConsolaClaves, type PropsConsolaClaves } from './useEstadoConsolaClaves'
import { RegistroClaves } from './RegistroClaves'
import { useArchivoConsolaClaves, useIndicadorConsolaClaves } from './useArchivoConsolaClaves'
import { useCierreConsolaClaves } from './useCierreConsolaClaves'
import { useEjecucionClaves } from './useEjecucionClaves'
import { useHistorialConsolaClaves, type HistorialConsolaClaves } from './useHistorialConsolaClaves'
import { useAutocompletadoClaves } from './proveedorClavesMonaco'
import { HistorialConsultas } from '../HistorialConsultas'
import { txConsolaClaves } from './textosConsolaClaves'
import '../consola.css'
import './consolaClaves.css'


function textoEstado(e: EstadoConsolaClaves): string | null {
  if (e.cargado) return e.pista
  const t = txConsolaClaves()
  return e.errorCarga !== null ? t.noSePudoLeer(e.errorCarga) : t.cargando
}

function useAccionesBarra(p: PropsConsolaClaves, e: EstadoConsolaClaves): { editarConexion: () => void; elegirBase: (b: number) => void } {
  const { onEditarConexion } = p
  const editarConexion = useCallback(() => onEditarConexion?.(p.conexion.id), [onEditarConexion, p.conexion.id])
  const { baseRef, cambiarBase, anotar } = e
  const elegirBase = useCallback(
    (b: number): void => {
      if (b === baseRef.current) return
      cambiarBase(b)
      anotar({ tono: 'tenue', texto: textoCambioBase(b) })
    },
    [baseRef, cambiarBase, anotar]
  )
  return { editarConexion, elegirBase }
}

/** El historial de comandos, colgado del reloj de la barra mientras está abierto. */
function PopoverHistorialClaves({ p, h }: { p: PropsConsolaClaves; h: HistorialConsolaClaves }): React.JSX.Element | null {
  if (!h.historialAbierto || !h.anclaHistorial) return null
  return <HistorialConsultas perfilId={p.perfilId} conexion={p.conexion} ancla={h.anclaHistorial} lenguaje="comandos" onInsertar={h.insertar} onCerrar={h.cerrarHistorial} />
}

/** El divisor entre el editor y el registro de resultados. */
function DivisorResultados(p: { alto: number; max: number; onRedimensionar: (alto: number) => void }): React.JSX.Element {
  return (
    <Divisor
      orientacion="horizontal"
      className="splitter-hueco"
      tamano={p.alto}
      min={MIN_RESULTADOS}
      max={p.max}
      direccion={-1}
      onRedimensionar={p.onRedimensionar}
      etiqueta={txConsolaClaves().repartoAria}
    />
  )
}

/** La pestaña de consola de una conexión de Redis. */
export function PaneConsolaClavesBd(p: PropsConsolaClaves): React.JSX.Element {
  const e = useEstadoConsolaClaves(p)
  const archivo = useArchivoConsolaClaves(e)
  useIndicadorConsolaClaves(e)
  const { hostRef, editorMonaco, editorMonacoRef } = useEditorConsola(e.modelo, p.visible, e.cargado)
  const x = useEjecucionClaves(e, editorMonacoRef)
  const { colRef: colReparto, maxResultados, altoEfectivo } = useRepartoAlto(p.altoResultados)
  const h = useHistorialConsolaClaves(e, editorMonacoRef, colReparto)
  useAccionesConsola(editorMonaco, registrarAccionesConsolaClaves, { ...x, historial: h.alternarHistorial }, archivo.guardar, e.quitarPista)
  useCierreConsolaClaves(e, p.clavePane, x.detener, archivo.vaciar)
  useAutocompletadoClaves(editorMonaco, p.conexion.topologiaRedis?.modo === 'cluster')
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
      <BarraConsolaClaves
        conexion={p.conexion}
        base={e.base}
        altoFila={p.altoFila}
        enCurso={e.enCurso}
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

      <Presente visible={!!e.conflicto} className="mov-despliega">
        <AvisoConflicto onCargarDelDisco={archivo.cargarDelDisco} onConservarLaMia={archivo.conservarLaMia} />
      </Presente>

      <div ref={hostRef} className="db-consola-editor" />

      <DivisorResultados alto={altoEfectivo} max={maxResultados} onRedimensionar={p.onAltoResultados} />

      <RegistroClaves
        alto={altoEfectivo}
        visible={p.visible}
        registro={e.registro}
        loteMarcado={e.loteMarcado}
        onIrA={x.irA}
        onAccion={(a) => void x.accionRegistro(a)}
        onLimpiar={() => e.actualizarRegistro((r) => limpiarRegistro(r))}
      />

      <PopoverHistorialClaves p={p} h={h} />
    </CarcasaConsola>
  )
}
