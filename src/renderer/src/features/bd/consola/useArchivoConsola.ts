// =============================================================================
// Los hooks del protocolo de archivo de las tres consolas: guardado con debounce, lectura del
// disco al montar, al mostrarse y al recuperar la ventana el foco, guardado al ocultarse, y
// las dos salidas de un conflicto («Cargar la del disco», «Conservar la mía»). Cada consola
// pone adónde van sus avisos y qué cuenta como «ejecutando»; lo puro está en `archivoConsola.ts`.
// Decisiones: docs/decisiones/bd/ui-documentos-consola.md
// =============================================================================

import { useCallback, useEffect, useMemo } from 'react'
import type { editor } from 'monaco-editor'
import { DEBOUNCE_GUARDADO_MS } from '../documentos/consolaComun'
import {
  aplicarDisco,
  guardarArchivoConsola,
  leerArchivoConsola,
  type ApiArchivoConsola,
  type RefsArchivoConsola
} from './archivoConsola'

/** Lo que el hook lee de una consola. Las funciones tienen que ser estables (`useCallback`). */
export interface EntradaArchivoConsola {
  refs: RefsArchivoConsola & { visibleRef: { current: boolean } }
  api: ApiArchivoConsola
  perfilId: string
  consolaId: string
  modelo: editor.ITextModel | null
  visible: boolean
  cambiarConflicto: (c: { texto: string } | null) => void
  setCargado: (v: boolean) => void
  setErrorCarga: (msg: string | null) => void
  avisar: (texto: string) => void
  ejecutando: () => boolean
  alCargar?: () => void
  /** Tras cada tecleo que programa el guardado (la consola SQL revalida). */
  alEditar?: () => void
}

/** Guardar, vaciar y las dos salidas de un conflicto. */
export interface ArchivoConsolaHook {
  guardar: (forzar?: boolean) => Promise<void>
  programarGuardado: () => void
  /** Guarda y espera a la escritura en vuelo. */
  vaciar: () => Promise<void>
  cargarDelDisco: () => void
  conservarLaMia: () => void
}

/** Los refs son estables uno a uno, pero el objeto que los trae puede ser nuevo en cada render. */
function useRefsEstables(o: EntradaArchivoConsola['refs']): EntradaArchivoConsola['refs'] {
  const { modeloRef, cargadoRef, guardadoRef, conflictoRef, escrituraRef, temporizadorRef } = o
  const { errorGuardadoRef, aplicandoDiscoRef, leyendoRef, borradaRef, visibleRef } = o
  return useMemo(
    () => ({
      modeloRef, cargadoRef, guardadoRef, conflictoRef, escrituraRef, temporizadorRef,
      errorGuardadoRef, aplicandoDiscoRef, leyendoRef, borradaRef, visibleRef
    }),
    [
      modeloRef, cargadoRef, guardadoRef, conflictoRef, escrituraRef, temporizadorRef,
      errorGuardadoRef, aplicandoDiscoRef, leyendoRef, borradaRef, visibleRef
    ]
  )
}

/** Lee el disco al montar el modelo, al mostrarse y al recuperar el foco; guarda al ocultarse. */
function useEfectosLectura(
  o: EntradaArchivoConsola,
  r: EntradaArchivoConsola['refs'],
  leerDisco: () => Promise<void>,
  programarGuardado: () => void,
  guardar: () => Promise<void>
): void {
  const { modelo, visible, alEditar } = o
  useEffect(() => {
    if (!modelo) return
    void leerDisco()
    const sub = modelo.onDidChangeContent(() => {
      if (r.aplicandoDiscoRef.current || !r.cargadoRef.current) return
      programarGuardado()
      alEditar?.()
    })
    return () => sub.dispose()
  }, [modelo, leerDisco, programarGuardado, alEditar, r])

  // Visible: se comprueba el disco; oculto: se guarda ya.
  useEffect(() => {
    if (!modelo) return
    if (visible) void leerDisco()
    else void guardar()
  }, [visible, modelo, leerDisco, guardar])

  // La ventana recupera el foco: el agente pudo tocar el archivo mientras tanto.
  useEffect(() => {
    const alFoco = (): void => {
      if (r.visibleRef.current) void leerDisco()
    }
    window.addEventListener('focus', alFoco)
    return () => window.removeEventListener('focus', alFoco)
  }, [leerDisco, r])
}

/** El archivo de una consola: guardado, relecturas y conflicto. Un conflicto CONGELA el guardado hasta que el usuario elige. */
export function useArchivoConsola(o: EntradaArchivoConsola): ArchivoConsolaHook {
  const r = useRefsEstables(o.refs)
  const { api, perfilId, consolaId, cambiarConflicto, setCargado, setErrorCarga, avisar, ejecutando, alCargar } = o

  const guardar = useCallback(
    (forzar = false): Promise<void> => guardarArchivoConsola({ r, api, perfilId, consolaId, cambiarConflicto, avisar }, forzar),
    [r, api, perfilId, consolaId, cambiarConflicto, avisar]
  )
  const programarGuardado = useCallback((): void => {
    if (r.temporizadorRef.current !== null) clearTimeout(r.temporizadorRef.current)
    r.temporizadorRef.current = setTimeout(() => {
      r.temporizadorRef.current = null
      void guardar()
    }, DEBOUNCE_GUARDADO_MS)
  }, [guardar, r])
  const vaciar = useCallback(async (): Promise<void> => {
    await guardar()
    while (r.escrituraRef.current) await r.escrituraRef.current
  }, [guardar, r])

  const leerDisco = useCallback(
    (): Promise<void> =>
      leerArchivoConsola({ r, api, perfilId, consolaId, cambiarConflicto, avisar, ejecutando, setCargado, setErrorCarga, alCargar }),
    [r, api, perfilId, consolaId, cambiarConflicto, avisar, ejecutando, setCargado, setErrorCarga, alCargar]
  )
  useEfectosLectura(o, r, leerDisco, programarGuardado, guardar)

  const cargarDelDisco = useCallback((): void => {
    const c = r.conflictoRef.current
    const m = r.modeloRef.current
    if (!c || !m || m.isDisposed()) return
    aplicarDisco(r, m, c.texto, false)
    cambiarConflicto(null)
  }, [r, cambiarConflicto])
  const conservarLaMia = useCallback((): void => {
    if (!r.conflictoRef.current) return
    cambiarConflicto(null)
    // El main ya dio por leído lo del disco: volver a escribir es «conservar la mía».
    void guardar(true)
  }, [r, cambiarConflicto, guardar])

  return { guardar, programarGuardado, vaciar, cargarDelDisco, conservarLaMia }
}
