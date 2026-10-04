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
import { useArchivoConsolaDocs, useIndicadorConsolaDocs } from './useArchivoConsolaDocs'
import { useCierreConsolaDocs } from './useCierreConsolaDocs'
import { useEditorConsola, useAccionesConsola } from './useEditorConsola'
import { useEjecucionDocs } from './useEjecucionDocs'
import { useRepartoAlto } from './useRepartoAlto'
import '../consola.css'


function textoEstado(e: EstadoConsolaDocs): string | null {
  if (e.cargado) return e.pista
  return e.errorCarga !== null ? `No se pudo leer la consola: ${e.errorCarga}` : 'Cargando…'
}

function useAccionesBarra(p: PropsConsolaDocs, e: EstadoConsolaDocs): { editarConexion: () => void; elegirBase: (b: string) => void } {
  const { onEditarConexion } = p
  const editarConexion = useCallback(() => onEditarConexion?.(p.conexion.id), [onEditarConexion, p.conexion.id])
  const { baseRef, cambiarBase, anotar } = e
  const elegirBase = useCallback(
    (b: string): void => {
      if (b === baseRef.current) return
      cambiarBase(b)
      anotar([{ tipo: 'info', texto: `Base de la consola: ${b}` }])
    },
    [baseRef, cambiarBase, anotar]
  )
  return { editarConexion, elegirBase }
}

/** La pestaña de consola de una conexión de MongoDB. */
export function DbConsolaDocsPane(p: PropsConsolaDocs): React.JSX.Element {
  const e = useEstadoConsolaDocs(p)
  const archivo = useArchivoConsolaDocs(e)
  useIndicadorConsolaDocs(e)
  const { hostRef, ed, edRef } = useEditorConsola(e.modelo, p.visible, e.cargado)
  const x = useEjecucionDocs(e, edRef)
  useAccionesConsola(ed, registrarAccionesConsolaDocs, x, archivo.guardar, e.quitarPista)
  useCierreConsolaDocs(e, p.paneKey, x.detener, archivo.vaciar)
  const { colRef, maxResultados, altoEfectivo } = useRepartoAlto(p.altoResultados)

  const d = descriptor(p.conexion.motor)
  const { editarConexion, elegirBase } = useAccionesBarra(p, e)

  return (
    <CarcasaConsola colRef={colRef} visible={p.visible} nombre={p.consola.nombre} dialogo={e.dialogo} onDetener={x.detener}>
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

      <ResultadosDocs
        alto={altoEfectivo}
        altoFila={p.altoFila}
        visible={p.visible}
        pestana={e.pestana}
        onPestana={e.setPestana}
        salida={e.salida}
        loteMarcado={e.loteMarcado}
        vista={e.vista}
        seleccionado={e.seleccionado}
        onSeleccionar={e.setSeleccionado}
        cargandoMas={e.cargandoMas}
        onCargarMas={() => void x.cargarMas()}
        onIrA={x.irA}
        onAccionSalida={(a) => void x.accionSalida(a)}
        onLimpiarSalida={() => e.setSalida((s) => limpiarSalida(s))}
      />
    </CarcasaConsola>
  )
}
