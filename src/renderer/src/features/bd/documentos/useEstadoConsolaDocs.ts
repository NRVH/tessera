// =============================================================================
// El estado de la consola de MongoDB: sus props, lo que enseña el panel «Resultado», los
// refs que leen los callbacks asíncronos y el estado de React. Lo crea `useEstadoConsolaDocs`
// y lo reciben los hooks de la consola, que se llaman en el orden que fija el panel: los
// efectos corren en ese orden.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import { useCallback, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import type { DbConnection } from '../../../../../shared/db-ipc'
import type { DbConsolaInfo } from '../../../../../shared/db-explorador-ipc'
import type { DbDocDocumento } from '../../../../../shared/db-documentos-ipc'
import type { IndicadorPestana } from '../dbTabsModel'
import { agregarSalida, salidaVacia, type NuevaEntrada, type SalidaConsola as DatosSalida } from '../consola/salidaConsola'
import type { EnCurso } from './consolaComun'
import type { MarcasConsolaDocs } from './monacoConsolaDocs'
import { useDialogoConsola } from './useDialogoConsola'

export interface PropsConsolaDocs {
  paneKey: string
  perfilId: string
  consola: DbConsolaInfo
  conexion: DbConnection
  visible: boolean
  altoFila: number
  /** Alto del bloque de resultados (global, persistido; el mismo que el de la consola SQL). */
  altoResultados: number
  onAltoResultados: (alto: number) => void
  /** Documentos por página (el `batchSize` de «Cargar más»). */
  filasPorPagina: number
  /** El conjunto de indicadores de la pestaña, como `DbConsolaPane` (manda `DbArea`). */
  onIndicador: (i: ReadonlySet<IndicadorPestana>) => void
  /** Candado «Solo lectura»: abre el diálogo de edición de la conexión. */
  onEditarConexion?: (conexionId: string) => void
}

/** Lo que enseña el panel «Resultado». */
export type VistaResultado =
  | {
      tipo: 'documentos'
      columnas: string[]
      documentos: DbDocDocumento[]
      lector: string | null
      coleccion: string | null
      ms: number
    }
  | { tipo: 'valor'; texto: string }

/** La base de cada consola, en memoria (sobrevive a un remontaje, no a reiniciar). Clave: `perfil\u0000consola`. */
const basesPorConsola = new Map<string, string | null>()

/** Cierra el lector abierto de la vista de documentos, si lo hay. */
export function cerrarLectorDeVista(docs: typeof window.tessera.dbDocumentos, v: VistaResultado | null): void {
  if (v && v.tipo === 'documentos' && v.lector) docs.lectorCerrar(v.lector).catch(() => undefined)
}

function useRefsConsolaDocs(p: PropsConsolaDocs) {
  const conexionRef = useRef(p.conexion)
  conexionRef.current = p.conexion
  const consolaRef = useRef(p.consola)
  consolaRef.current = p.consola
  const filasPorPaginaRef = useRef(p.filasPorPagina)
  filasPorPaginaRef.current = p.filasPorPagina
  const onIndicadorRef = useRef(p.onIndicador)
  onIndicadorRef.current = p.onIndicador
  const visibleRef = useRef(p.visible)
  visibleRef.current = p.visible
  const vistaRef = useRef<VistaResultado | null>(null)
  return {
    conexionRef,
    consolaRef,
    filasPorPaginaRef,
    onIndicadorRef,
    visibleRef,
    vistaRef,
    modeloRef: useRef<editor.ITextModel | null>(null),
    marcasRef: useRef<MarcasConsolaDocs | null>(null),
    cargadoRef: useRef(false),
    guardadoRef: useRef<string | null>(null),
    conflictoRef: useRef<{ texto: string } | null>(null),
    escrituraRef: useRef<Promise<void> | null>(null),
    temporizadorRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    errorGuardadoRef: useRef<string | null>(null),
    aplicandoDiscoRef: useRef(false),
    leyendoRef: useRef(false),
    borradaRef: useRef(false),
    desmontadoRef: useRef(false),
    enCursoRef: useRef<EnCurso | null>(null),
    detenidoRef: useRef(false),
    stopRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    masRef: useRef<string | null>(null),
    siguienteIdRef: useRef(1)
  }
}

/** Refs, estado de React y los cambiadores que mantienen ref y estado a la vez. */
export function useEstadoConsolaDocs(p: PropsConsolaDocs) {
  const refs = useRefsConsolaDocs(p)
  const base = useBaseConsolaDocs(p)
  const [modelo, setModelo] = useState<editor.ITextModel | null>(null)
  const [cargado, setCargado] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState<{ texto: string } | null>(null)
  const [enCurso, setEnCurso] = useState<EnCurso | null>(null)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [conError, setConError] = useState(false)
  const [pista, setPista] = useState<string | null>(null)
  const [salida, setSalida] = useState<DatosSalida>(salidaVacia)
  const [vista, setVista] = useState<VistaResultado | null>(null)
  const [seleccionado, setSeleccionado] = useState<number | null>(null)
  const [pestana, setPestana] = useState<'salida' | 'resultado'>('salida')
  const [loteMarcado, setLoteMarcado] = useState<number | null>(null)
  refs.vistaRef.current = vista
  const dialogo = useDialogoConsola(refs.desmontadoRef)

  const anotar = useCallback((nuevas: NuevaEntrada[]): void => {
    if (nuevas.length === 0) return
    setSalida((s) => agregarSalida(s, nuevas, Date.now()))
  }, [])
  const quitarPista = useCallback((): void => setPista(null), [])
  const { conflictoRef, enCursoRef } = refs
  const cambiarConflicto = useCallback(
    (c: { texto: string } | null): void => {
      conflictoRef.current = c
      setConflicto(c)
    },
    [conflictoRef]
  )
  const cambiarEnCurso = useCallback(
    (e: EnCurso | null): void => {
      enCursoRef.current = e
      setEnCurso(e)
    },
    [enCursoRef]
  )

  return {
    ...refs, ...base, ...dialogo, anotar, cambiarConflicto, cambiarEnCurso, quitarPista,
    perfilId: p.perfilId, consolaId: p.consola.id, visible: p.visible,
    api: window.tessera.dbExplorador, docs: window.tessera.dbDocumentos,
    modelo, setModelo, cargado, setCargado, errorCarga, setErrorCarga, conflicto, enCurso,
    cargandoMas, setCargandoMas, conError, setConError, pista, setPista, salida, setSalida,
    vista, setVista, seleccionado, setSeleccionado, pestana, setPestana, loteMarcado, setLoteMarcado
  }
}

function useBaseConsolaDocs(p: PropsConsolaDocs): {
  base: string | null
  baseRef: React.MutableRefObject<string | null>
  cambiarBase: (b: string | null) => void
} {
  const claveBase = `${p.perfilId}\u0000${p.consola.id}`
  const [base, setBaseEstado] = useState<string | null>(() =>
    basesPorConsola.has(claveBase) ? (basesPorConsola.get(claveBase) ?? null) : p.conexion.database?.trim() || null
  )
  const baseRef = useRef(base)
  baseRef.current = base
  const cambiarBase = useCallback(
    (b: string | null): void => {
      baseRef.current = b
      basesPorConsola.set(claveBase, b)
      setBaseEstado(b)
    },
    [claveBase]
  )
  return { base, baseRef, cambiarBase }
}

/** Lo que crea `useEstadoConsolaDocs` y reciben los hooks de la consola. */
export type EstadoConsolaDocs = ReturnType<typeof useEstadoConsolaDocs>
