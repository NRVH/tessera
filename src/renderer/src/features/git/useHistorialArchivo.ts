// =============================================================================
// useHistorialArchivo: el estado y las cargas de la historia de UN archivo: la lista
// de commits que lo tocaron y el diff del commit elegido. El repo dueño lo resuelve
// `fileHistory` por la RUTA y lo devuelve; se guarda en un ref porque no se pinta.
// Ver docs/decisiones/git/cambios-historial-de-archivo.md.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiffTarget } from '../editor'
import type { FileRef } from '../../../../shared/git-ipc'
import { resolveDiffTarget } from './modelo/resolveDiffTarget'

/** El diff del commit elegido: `null` preparándose, el target, o `'no-aparece'` si ese commit no lo tiene con este nombre. */
export type TargetHistorial = DiffTarget | 'no-aparece' | null

/** Lo que enseña `HistorialArchivo` y las dos acciones sobre un commit de la lista. */
export interface HistorialDeArchivo {
  commits: FileRef[] | null
  error: string | null
  hashActivo: string | null
  target: TargetHistorial
  /** Fallo al preparar el diff de un commit; la lista sigue siendo buena. */
  errorDiff: string | null
  seleccionar: (hash: string) => Promise<void>
  /** Doble clic: abre ese diff como pestaña del editor central. */
  abrirEnGrande: (hash: string, onAbrirEnEditor: (target: DiffTarget) => void) => void
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Arma el diff de ESTE archivo en un commit (por la ruta actual o por `oldPath` si lo
// renombró) o devuelve null si no aparece: pasa con renames más antiguos que el nombre pedido.
async function armarTarget(
  path: string,
  hash: string,
  repo: string | undefined
): Promise<DiffTarget | null> {
  const [cambios, padre] = await Promise.all([
    window.tessera.git.filesForCommit(hash, repo),
    window.tessera.git.parentOf(hash, repo)
  ])
  const cambio = cambios.find((c) => c.path === path || c.oldPath === path)
  if (!cambio) return null
  return resolveDiffTarget(hash, padre.parentHash, cambio)
}

// Con `catch`: `armarTarget` hace dos llamadas IPC que pueden fallar.
function abrirTarget(
  pendiente: Promise<DiffTarget | null>,
  onAbrir: (target: DiffTarget) => void,
  alFallar: (mensaje: string) => void
): void {
  void pendiente
    .then((t) => {
      if (t) onAbrir(t)
    })
    .catch((err: unknown) => {
      alFallar(mensajeDe(err))
    })
}

/** Carga la historia del archivo y arma el diff del commit elegido (el primero, al empezar). */
export function useHistorialArchivo(path: string): HistorialDeArchivo {
  const [commits, setCommits] = useState<FileRef[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hashActivo, setHashActivo] = useState<string | null>(null)
  const [target, setTarget] = useState<TargetHistorial>(null)
  const [errorDiff, setErrorDiff] = useState<string | null>(null)
  // Último commit PEDIDO: en un ref porque el guard corre dentro de una promesa.
  const pedidoRef = useRef<string | null>(null)
  // Repo dueño del archivo, tal cual lo resolvió `fileHistory`.
  const repoRef = useRef<string | undefined>(undefined)

  // Carga la historia al cambiar de archivo; la bandera evita pintar la respuesta de uno anterior.
  useEffect(() => {
    let cancelado = false
    setCommits(null)
    setError(null)
    setHashActivo(null)
    setTarget(null)
    repoRef.current = undefined
    // SIN REPO, A PROPÓSITO: el dueño lo deduce el main por la RUTA (ver el ADR).
    window.tessera.git
      .fileHistory(path)
      .then((r) => {
        if (cancelado) return
        repoRef.current = r.repoHostPath === '' ? undefined : r.repoHostPath
        setCommits(r.commits)
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeDe(err))
      })
    return () => {
      cancelado = true
    }
  }, [path])

  const targetDe = useCallback(
    (hash: string): Promise<DiffTarget | null> => armarTarget(path, hash, repoRef.current),
    [path]
  )

  // Selección: pinta el diff en la columna derecha, SIN abrir nada en el editor.
  const seleccionar = useCallback(
    async (hash: string) => {
      pedidoRef.current = hash
      setHashActivo(hash)
      setTarget(null)
      setErrorDiff(null)
      try {
        const t = await targetDe(hash)
        // Solo pinta si sigue siendo el commit pedido: pinchando rápido llegan respuestas viejas.
        if (pedidoRef.current === hash) setTarget(t ?? 'no-aparece')
      } catch (err) {
        if (pedidoRef.current === hash) setErrorDiff(mensajeDe(err))
      }
    },
    [targetDe]
  )

  // La primera selección es automática: el commit más reciente es el que se mira casi siempre.
  useEffect(() => {
    if (commits === null || commits.length === 0 || hashActivo !== null) return
    void seleccionar(commits[0].hash)
  }, [commits, hashActivo, seleccionar])

  const abrirEnGrande = (hash: string, onAbrirEnEditor: (target: DiffTarget) => void): void =>
    abrirTarget(targetDe(hash), onAbrirEnEditor, setErrorDiff)

  return { commits, error, hashActivo, target, errorDiff, seleccionar, abrirEnGrande }
}
