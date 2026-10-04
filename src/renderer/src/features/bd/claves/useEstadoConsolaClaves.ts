// =============================================================================
// El estado de la consola de Redis: sus props, los refs que leen los callbacks asíncronos y
// el estado de React, con la base de cada consola en memoria. Lo crea `useEstadoConsolaClaves`
// y lo reciben los hooks de la consola, que se llaman en el orden que fija el panel: los
// efectos corren en ese orden. Comparte con la de MongoDB lo idéntico (`documentos/`).
// Decisiones: docs/decisiones/bd/ui-claves-consola.md
// =============================================================================

import { useCallback, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import type { DbConnection } from '../../../../../shared/db-ipc'
import type { DbConsolaInfo } from '../../../../../shared/db-explorador-ipc'
import type { IndicadorPestana } from '../dbTabsModel'
import { basePorDefectoClaves } from '../arbolClaves'
import type { AccionSalida } from '../consola/salidaConsola'
import type { EnCurso } from '../documentos/consolaComun'
import { useDialogoConsola } from '../documentos/useDialogoConsola'
import type { MarcasConsolaDocs } from '../documentos/monacoConsolaDocs'
import { agregarNota, registroVacio, type RegistroConsola, type TonoLinea } from './consolaClaves'

export interface PropsConsolaClaves {
  paneKey: string
  perfilId: string
  consola: DbConsolaInfo
  conexion: DbConnection
  visible: boolean
  altoFila: number
  /** Alto del bloque de resultados (global, persistido; el mismo que el de la consola SQL). */
  altoResultados: number
  onAltoResultados: (alto: number) => void
  /** El conjunto de indicadores de la pestaña, como `DbConsolaPane` (manda `DbArea`). */
  onIndicador: (i: ReadonlySet<IndicadorPestana>) => void
  /** Candado «Solo lectura»: abre el diálogo de edición de la conexión. */
  onEditarConexion?: (conexionId: string) => void
}

/** Lo ya confirmado por el usuario para un comando: se reenvía tal cual al main. */
export interface Confirmaciones {
  confirmado: boolean
  confirmadoPeligroso: boolean
}

/** La base de cada consola, en memoria (sobrevive a un remontaje, no a reiniciar). Clave: `perfil\u0000consola`. */
const basesPorConsola = new Map<string, number>()

function useRefsConsolaClaves(p: PropsConsolaClaves) {
  const conexionRef = useRef(p.conexion)
  conexionRef.current = p.conexion
  const consolaRef = useRef(p.consola)
  consolaRef.current = p.consola
  const onIndicadorRef = useRef(p.onIndicador)
  onIndicadorRef.current = p.onIndicador
  const visibleRef = useRef(p.visible)
  visibleRef.current = p.visible
  return {
    conexionRef,
    consolaRef,
    onIndicadorRef,
    visibleRef,
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
    siguienteIdRef: useRef(1)
  }
}

function useBaseConsolaClaves(p: PropsConsolaClaves): {
  base: number
  baseRef: React.MutableRefObject<number>
  cambiarBase: (b: number) => void
} {
  const claveBase = `${p.perfilId}\u0000${p.consola.id}`
  const [base, setBaseEstado] = useState<number>(() => basesPorConsola.get(claveBase) ?? basePorDefectoClaves(p.conexion))
  const baseRef = useRef(base)
  baseRef.current = base
  const cambiarBase = useCallback(
    (b: number): void => {
      baseRef.current = b
      basesPorConsola.set(claveBase, b)
      setBaseEstado(b)
    },
    [claveBase]
  )
  return { base, baseRef, cambiarBase }
}

/** El registro vive también en un ref: `agregarComando` devuelve el id de la entrada que después se completa, y hace falta en el mismo tick. */
function useRegistroConsola(): {
  registro: RegistroConsola
  actualizarRegistro: (f: (r: RegistroConsola) => RegistroConsola) => void
  anotar: (n: { tono: TonoLinea; texto: string; accion?: AccionSalida }) => void
} {
  const [registro, setRegistro] = useState<RegistroConsola>(registroVacio)
  const registroRef = useRef<RegistroConsola>(registro)
  const actualizarRegistro = useCallback((f: (r: RegistroConsola) => RegistroConsola): void => {
    const sig = f(registroRef.current)
    if (sig === registroRef.current) return
    registroRef.current = sig
    setRegistro(sig)
  }, [])
  const anotar = useCallback(
    (n: { tono: TonoLinea; texto: string; accion?: AccionSalida }): void => {
      actualizarRegistro((r) => agregarNota(r, n, Date.now()))
    },
    [actualizarRegistro]
  )
  return { registro, actualizarRegistro, anotar }
}

/** Refs, estado de React y los cambiadores que mantienen ref y estado a la vez. */
export function useEstadoConsolaClaves(p: PropsConsolaClaves) {
  const refs = useRefsConsolaClaves(p)
  const base = useBaseConsolaClaves(p)
  const [modelo, setModelo] = useState<editor.ITextModel | null>(null)
  const [cargado, setCargado] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState<{ texto: string } | null>(null)
  const [enCurso, setEnCurso] = useState<EnCurso | null>(null)
  const [conError, setConError] = useState(false)
  const [pista, setPista] = useState<string | null>(null)
  const [loteMarcado, setLoteMarcado] = useState<number | null>(null)
  const registro = useRegistroConsola()
  const dialogo = useDialogoConsola(refs.desmontadoRef)

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
    ...refs, ...base, ...registro, ...dialogo, cambiarConflicto, cambiarEnCurso, quitarPista,
    perfilId: p.perfilId, consolaId: p.consola.id, visible: p.visible, api: window.tessera.dbExplorador, claves: window.tessera.dbClaves,
    modelo, setModelo, cargado, setCargado, errorCarga, setErrorCarga, conflicto, enCurso, conError, setConError,
    pista, setPista, loteMarcado, setLoteMarcado
  }
}

/** Lo que crea `useEstadoConsolaClaves` y reciben los hooks de la consola. */
export type EstadoConsolaClaves = ReturnType<typeof useEstadoConsolaClaves>
