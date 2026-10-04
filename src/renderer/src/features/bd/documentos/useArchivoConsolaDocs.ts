// =============================================================================
// El archivo de la consola de MongoDB y su modelo de Monaco, sobre el protocolo común de las
// tres consolas (`consola/useArchivoConsola`): sus avisos van a la Salida. El modelo es del
// hook (se crea al montar, se dispone al desmontar) y el editor es del pane: al desmontar se
// lee el texto pendiente ANTES de disponer el modelo.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { editor } from 'monaco-editor'
import type { IndicadorPestana } from '../dbTabsModel'
import { mismosIndicadores } from '../consola/vivoConsola'
import { soltarModelo, tomarModelo, vaciarAlDesmontar } from '../consola/archivoConsola'
import { useArchivoConsola, type ArchivoConsolaHook } from '../consola/useArchivoConsola'
import { ensureMonaco } from '../../../comun/monacoSetup'
import { cerrarLectorDeVista, type EstadoConsolaDocs } from './useEstadoConsolaDocs'
import {
  LENGUAJE_CONSOLA_DOCS,
  MarcasConsolaDocs,
  registrarLenguajeConsolaDocs,
  uriConsolaDocs
} from './monacoConsolaDocs'

/** Lo que se suelta al desmontar: el texto pendiente, lo que corre, los cursores y el modelo. */
function liberarConsola(e: EstadoConsolaDocs, m: editor.ITextModel, marcas: MarcasConsolaDocs, clave: string): void {
  e.desmontadoRef.current = true
  vaciarAlDesmontar({ r: e, api: e.api, perfilId: e.perfilId, consolaId: e.consolaId }, m)
  if (e.stopRef.current !== null) clearTimeout(e.stopRef.current)
  const enCurso = e.enCursoRef.current
  if (enCurso) {
    e.api.cancelar({ rol: 'consola', perfilId: e.perfilId, consolaId: e.consolaId, ejecucionId: enCurso.peticionId }).catch(() => undefined)
  }
  const mas = e.masRef.current
  if (mas) e.api.cancelar({ rol: 'datos', conexionId: e.conexionRef.current.id, peticionId: mas }).catch(() => undefined)
  cerrarLectorDeVista(e.docs, e.vistaRef.current)
  e.dialogoRef.current?.resolver(false)
  marcas.dispose()
  e.marcasRef.current = null
  e.modeloRef.current = null
  soltarModelo(clave, m)
  e.setModelo(null)
}

function useModeloConsolaDocs(e: EstadoConsolaDocs): void {
  const { perfilId, consolaId } = e
  useEffect(() => {
    e.desmontadoRef.current = false
    const monaco = ensureMonaco()
    registrarLenguajeConsolaDocs(monaco)
    const uri = monaco.Uri.parse(uriConsolaDocs(consolaId))
    const clave = uri.toString()
    const previo = monaco.editor.getModel(uri)
    const m = previo && !previo.isDisposed() ? previo : monaco.editor.createModel('', LENGUAJE_CONSOLA_DOCS, uri)
    if (m.getLanguageId() !== LENGUAJE_CONSOLA_DOCS) monaco.editor.setModelLanguage(m, LENGUAJE_CONSOLA_DOCS)
    tomarModelo(clave)
    e.modeloRef.current = m
    e.cargadoRef.current = false
    e.guardadoRef.current = null
    e.borradaRef.current = false
    e.setModelo(m)
    e.setCargado(false)
    e.setErrorCarga(null)
    const marcas = new MarcasConsolaDocs(m)
    e.marcasRef.current = marcas
    return () => liberarConsola(e, m, marcas, clave)
    // El modelo es de la CONSOLA: solo se rehace si cambia cuál es.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfilId, consolaId])
}

/** Modelo, guardado y lectura del archivo de la consola; devuelve lo que el resto necesita. */
export function useArchivoConsolaDocs(e: EstadoConsolaDocs): ArchivoConsolaHook {
  useModeloConsolaDocs(e)
  const { anotar, enCursoRef } = e
  const avisar = useCallback((texto: string): void => anotar([{ tipo: 'error', texto }]), [anotar])
  const ejecutando = useCallback((): boolean => enCursoRef.current !== null, [enCursoRef])
  return useArchivoConsola({
    refs: e, api: e.api, perfilId: e.perfilId, consolaId: e.consolaId, modelo: e.modelo, visible: e.visible,
    cambiarConflicto: e.cambiarConflicto, setCargado: e.setCargado, setErrorCarga: e.setErrorCarga, avisar, ejecutando
  })
}

/** Avisa a la pestaña de si la consola ejecuta, carga o falló, sin repetir el mismo conjunto. */
export function useIndicadorConsolaDocs(e: EstadoConsolaDocs): void {
  const { enCurso, cargandoMas, cargado, errorCarga, conError, onIndicadorRef } = e
  const indicadores = useMemo(() => {
    const s = new Set<IndicadorPestana>()
    if (enCurso || cargandoMas) s.add('ejecutando')
    if (!cargado && errorCarga === null) s.add('cargando')
    if (conError) s.add('error')
    return s
  }, [enCurso, cargandoMas, cargado, errorCarga, conError])
  const ultimoIndicadorRef = useRef<ReadonlySet<IndicadorPestana> | null>(null)
  useEffect(() => {
    if (mismosIndicadores(ultimoIndicadorRef.current, indicadores)) return
    ultimoIndicadorRef.current = indicadores
    onIndicadorRef.current(indicadores)
  }, [indicadores, onIndicadorRef])
}
