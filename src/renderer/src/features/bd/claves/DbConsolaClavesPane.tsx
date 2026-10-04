// =============================================================================
// DbConsolaClavesPane: la pestaña de CONSOLA de Redis. Hermana de la consola de MongoDB, que es
// su molde: la misma barra, los mismos acordes y el mismo reparto editor / divisor / resultados.
// Compone los hooks de esta carpeta EN ESTE ORDEN, que es el de sus efectos; comparte con
// `documentos/` lo idéntico. Un comando por línea; el renderer no clasifica y el main decide.
// Decisiones: docs/decisiones/bd/ui-claves-consola.md
// =============================================================================

import { useCallback } from 'react'
import { Splitter } from '../../../comun/Splitter'
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
import '../consola.css'
import './consolaClaves.css'


function textoEstado(e: EstadoConsolaClaves): string | null {
  if (e.cargado) return e.pista
  return e.errorCarga !== null ? `No se pudo leer la consola: ${e.errorCarga}` : 'Cargando…'
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

/** La pestaña de consola de una conexión de Redis. */
export function DbConsolaClavesPane(p: PropsConsolaClaves): React.JSX.Element {
  const e = useEstadoConsolaClaves(p)
  const archivo = useArchivoConsolaClaves(e)
  useIndicadorConsolaClaves(e)
  const { hostRef, ed, edRef } = useEditorConsola(e.modelo, p.visible, e.cargado)
  const x = useEjecucionClaves(e, edRef)
  useAccionesConsola(ed, registrarAccionesConsolaClaves, x, archivo.guardar, e.quitarPista)
  useCierreConsolaClaves(e, p.paneKey, x.detener, archivo.vaciar)
  const { colRef, maxResultados, altoEfectivo } = useRepartoAlto(p.altoResultados)
  const { editarConexion, elegirBase } = useAccionesBarra(p, e)

  return (
    <CarcasaConsola colRef={colRef} visible={p.visible} nombre={p.consola.nombre} dialogo={e.dialogo} onDetener={x.detener}>
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
      />

      {e.conflicto && <AvisoConflicto onCargarDelDisco={archivo.cargarDelDisco} onConservarLaMia={archivo.conservarLaMia} />}

      <div ref={hostRef} className="db-consola-editor" />

      <Splitter
        orientation="horizontal"
        size={altoEfectivo}
        min={MIN_RESULTADOS}
        max={maxResultados}
        direction={-1}
        onResize={p.onAltoResultados}
        label="Reparto entre la consola y los resultados"
      />

      <RegistroClaves
        alto={altoEfectivo}
        visible={p.visible}
        registro={e.registro}
        loteMarcado={e.loteMarcado}
        onIrA={x.irA}
        onAccion={(a) => void x.accionRegistro(a)}
        onLimpiar={() => e.actualizarRegistro((r) => limpiarRegistro(r))}
      />
    </CarcasaConsola>
  )
}
