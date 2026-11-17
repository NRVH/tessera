// =============================================================================
// usePersistenciaPestanas: carga inicial de perfiles y sesión restaurada (`init`) y
// guardado a disco, con debounce, de la lista de perfiles y del esqueleto del
// workspace. Lo llama `usePestanas` (usePestanas.ts); el estado vive en el store de pestañas.
// Decisiones: docs/decisiones/renderer/persistencia-de-pestanas.md
// =============================================================================

import { useEffect, useRef } from 'react'
import type { EstadoArbolPestanas } from './modeloPestanas'
import { sesionRestauradaDesdeEstado, serializeWorkspace } from './fotoWorkspace'
import { iniciarPestanas, marcarPestanasCargadas } from './store'

/**
 * Carga los perfiles y la sesión persistida al montar y despacha UN solo `init`. Si
 * `cargarEstado` falla o no hay archivo, el arranque es limpio; un fallo suyo nunca
 * impide cargar los perfiles.
 */
export function useCargaInicialPestanas(): void {
  useEffect(() => {
    let cancelado = false
    void (async () => {
      try {
        const perfiles = await window.tessera.obtenerPerfiles()
        const guardado = await window.tessera.workspace.cargarEstado().catch((err) => {
          console.error('[tabs] cargarEstado (workspace) falló; arranque limpio:', err)
          return null
        })
        if (!cancelado) iniciarPestanas(perfiles, sesionRestauradaDesdeEstado(guardado))
      } catch (err) {
        console.error('[tabs] obtenerPerfiles falló:', err)
        // Sin esto, lo que espera a las pestañas (las aperturas del sistema) esperaría para siempre.
        if (!cancelado) marcarPestanasCargadas()
      }
    })()
    return () => {
      cancelado = true
    }
  }, [])
}

/**
 * Guarda a disco cada cambio de la lista de perfiles (debounce 250 ms) y del
 * esqueleto del workspace (debounce 150 ms, deduplicado por proyección). Los dos
 * temporizadores solo se cancelan al desmontar.
 */
export function usePersistenciaPestanas(estado: EstadoArbolPestanas): void {
  const persistenciaActivaRef = useRef(false)
  const temporizadorPerfilesRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // Lista vacía antes de `init` = «aún no se leyó el disco»: nada que guardar.
    // Vacía DESPUÉS = «se borró el último perfil»: eso sí se persiste.
    if (!persistenciaActivaRef.current) {
      if (estado.perfiles.length === 0) return
      persistenciaActivaRef.current = true
      return // la carga inicial no se reescribe: es justo lo que `init` acaba de leer
    }
    const fotoPerfiles = estado.perfiles
    if (temporizadorPerfilesRef.current !== null) clearTimeout(temporizadorPerfilesRef.current)
    temporizadorPerfilesRef.current = setTimeout(() => {
      temporizadorPerfilesRef.current = null
      window.tessera.guardarPerfiles(fotoPerfiles).catch((err) => {
        console.error('[tabs] guardarPerfiles falló:', err)
      })
    }, 250)
  }, [estado.perfiles])

  // El temporizador vive en un ref y no en la limpieza del efecto: ver el ADR.
  const ultimoWorkspaceGuardadoRef = useRef<string | null>(null)
  const temporizadorGuardadoRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // Sin perfiles y sin nada guardado aún = antes de `init`: no hay nada que persistir.
    if (
      estado.perfilActivoId === null &&
      estado.perfiles.length === 0 &&
      ultimoWorkspaceGuardadoRef.current === null
    ) {
      return
    }
    const json = JSON.stringify(serializeWorkspace(estado))
    if (json === ultimoWorkspaceGuardadoRef.current) return // proyección sin cambios: no-op
    const esPrimero = ultimoWorkspaceGuardadoRef.current === null
    ultimoWorkspaceGuardadoRef.current = json
    if (esPrimero) return // snapshot post-init: el disco ya lo tiene (o arranque limpio)
    const foto = serializeWorkspace(estado)
    if (temporizadorGuardadoRef.current !== null) clearTimeout(temporizadorGuardadoRef.current)
    temporizadorGuardadoRef.current = setTimeout(() => {
      temporizadorGuardadoRef.current = null
      window.tessera.workspace.guardarEstado(foto).catch((err) => {
        console.error('[tabs] guardarEstado (workspace) falló:', err)
      })
    }, 150)
    // `serializeWorkspace` lee solo `byProfile` y `activeProfileId`: depender de `state`
    // entero reejecutaría este efecto (y su JSON.stringify) en cada cambio de estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.porPerfil, estado.perfilActivoId, estado.perfiles])

  // Lo pendiente se cancela SOLO al desmontar (deps vacías), no en cada re-ejecución.
  useEffect(() => {
    return () => {
      if (temporizadorGuardadoRef.current !== null) clearTimeout(temporizadorGuardadoRef.current)
      if (temporizadorPerfilesRef.current !== null) clearTimeout(temporizadorPerfilesRef.current)
    }
  }, [])
}
