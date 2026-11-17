// =============================================================================
// useHistorialArchivo: el estado y las cargas de la historia de UN archivo: la lista
// de commits que lo tocaron y el diff del commit elegido. El repo dueño lo resuelve
// `leerHistorialArchivo` por la RUTA y lo devuelve; se guarda en un ref porque no se pinta.
// Ver docs/decisiones/git/cambios-historial-de-archivo.md.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRaizDelProyecto } from '../../comun/raizDelProyecto'
import type { DestinoDiff } from '../editor'
import type { ReferenciaCommitArchivo } from '../../../../shared/git-ipc'
import { resolverDestinoDiff } from './modelo/resolverDestinoDiff'

/** El diff del commit elegido: `null` preparándose, el target, o `'no-aparece'` si ese commit no lo tiene con este nombre. */
export type DestinoHistorial = DestinoDiff | 'no-aparece' | null

/** Lo que enseña `HistorialArchivo` y las dos acciones sobre un commit de la lista. */
export interface HistorialDeArchivo {
  commits: ReferenciaCommitArchivo[] | null
  error: string | null
  hashActivo: string | null
  destino: DestinoHistorial
  /** Fallo al preparar el diff de un commit; la lista sigue siendo buena. */
  errorDiff: string | null
  seleccionar: (hash: string) => Promise<void>
  /** Doble clic: abre ese diff como pestaña del editor central. */
  abrirEnGrande: (hash: string, onAbrirEnEditor: (destino: DestinoDiff) => void) => void
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Arma el diff de ESTE archivo en un commit (por la ruta actual o por `rutaAnterior` si lo
// renombró) o devuelve null si no aparece: pasa con renames más antiguos que el nombre pedido.
async function armarDestino(
  raiz: string,
  ruta: string,
  hash: string,
  repo: string | undefined
): Promise<DestinoDiff | null> {
  const [cambios, padre] = await Promise.all([
    window.tessera.git.obtenerArchivosCommit(raiz, hash, repo),
    window.tessera.git.obtenerPrimerPadre(raiz, hash, repo)
  ])
  const cambio = cambios.find((c) => c.ruta === ruta || c.rutaAnterior === ruta)
  if (!cambio) return null
  return resolverDestinoDiff(hash, padre.hashPadre, cambio)
}

// Con `catch`: `armarDestino` hace dos llamadas IPC que pueden fallar.
function abrirDestino(
  pendiente: Promise<DestinoDiff | null>,
  onAbrir: (destino: DestinoDiff) => void,
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
export function useHistorialArchivo(ruta: string): HistorialDeArchivo {
  const [commits, setCommits] = useState<ReferenciaCommitArchivo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hashActivo, setHashActivo] = useState<string | null>(null)
  const [destino, setDestino] = useState<DestinoHistorial>(null)
  const [errorDiff, setErrorDiff] = useState<string | null>(null)
  // Último commit PEDIDO: en un ref porque el guard corre dentro de una promesa.
  const pedidoRef = useRef<string | null>(null)
  // Repo dueño del archivo, tal cual lo resolvió `leerHistorialArchivo`.
  const repoRef = useRef<string | undefined>(undefined)
  const raiz = useRaizDelProyecto()

  // Carga la historia al cambiar de archivo; la bandera evita pintar la respuesta de uno anterior.
  useEffect(() => {
    let cancelado = false
    setCommits(null)
    setError(null)
    setHashActivo(null)
    setDestino(null)
    repoRef.current = undefined
    // SIN REPO, A PROPÓSITO: el dueño lo deduce el main por la RUTA (ver el ADR).
    window.tessera.git
      .leerHistorialArchivo(raiz, ruta)
      .then((r) => {
        if (cancelado) return
        repoRef.current = r.rutaHostRepo === '' ? undefined : r.rutaHostRepo
        setCommits(r.commits)
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeDe(err))
      })
    return () => {
      cancelado = true
    }
  }, [raiz, ruta])

  const destinoDe = useCallback(
    (hash: string): Promise<DestinoDiff | null> => armarDestino(raiz, ruta, hash, repoRef.current),
    [raiz, ruta]
  )

  // Selección: pinta el diff en la columna derecha, SIN abrir nada en el editor.
  const seleccionar = useCallback(
    async (hash: string) => {
      pedidoRef.current = hash
      setHashActivo(hash)
      setDestino(null)
      setErrorDiff(null)
      try {
        const t = await destinoDe(hash)
        // Solo pinta si sigue siendo el commit pedido: pinchando rápido llegan respuestas viejas.
        if (pedidoRef.current === hash) setDestino(t ?? 'no-aparece')
      } catch (err) {
        if (pedidoRef.current === hash) setErrorDiff(mensajeDe(err))
      }
    },
    [destinoDe]
  )

  // La primera selección es automática: el commit más reciente es el que se mira casi siempre.
  useEffect(() => {
    if (commits === null || commits.length === 0 || hashActivo !== null) return
    void seleccionar(commits[0].hash)
  }, [commits, hashActivo, seleccionar])

  const abrirEnGrande = (hash: string, onAbrirEnEditor: (destino: DestinoDiff) => void): void =>
    abrirDestino(destinoDe(hash), onAbrirEnEditor, setErrorDiff)

  return { commits, error, hashActivo, destino, errorDiff, seleccionar, abrirEnGrande }
}
