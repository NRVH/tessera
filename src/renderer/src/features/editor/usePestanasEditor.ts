// =============================================================================
// Puente entre el modelo puro `modeloPestanasEditor` y el store del editor (`pestanasPorDestino`).
// Las pestañas viven por target (perfil, proyecto): al cerrar un proyecto se poda su entrada, y
// `todosLosPanes` expone las de todos los targets válidos para que App las monte a la vez (keep-alive).
// Si una acción no cambia nada, el Map es el mismo y el store no avisa a nadie.
// Sin IPC, sin Monaco, sin efectos de carga.
// =============================================================================

import { useCallback, useEffect, useMemo } from 'react'
import {
  cerrarPestanaEditor as accionCerrarPestana,
  obtenerPestanaActiva,
  estadoInicialPestanasEditor,
  siguienteNumeroSinTitulo,
  abrirPestanaEditor as accionAbrirPestana,
  reemplazarPestanaEditor as accionReemplazarPestana,
  activarPestanaEditor as accionActivarPestana,
  type PestanaEditor,
  type EstadoPestanasEditor
} from './modeloPestanasEditor'
import type { PaneCentral } from './paneCentral'
import { actualizarPestanas, actualizarDestino, useStoreEditor } from './store'

/** Una tab abierta junto al target (perfil+proyecto) al que pertenece. */
export interface ReferenciaPaneAbierto {
  /** Clave del target dueño de la tab (claveDestinoEditor). */
  claveDestino: string
  /** La tab: id estable + su pane (file|diff). */
  pestana: PestanaEditor
}

/** Superficie que el hook expone a la UI: rebanada activa + todas las tabs. */
export interface UsePestanasEditor {
  /** Colección ORDENADA de tabs del target ACTIVO (lo que pinta la tira). */
  pestanas: PestanaEditor[]
  /** Id de la tab activa del target activo, o null si no tiene tabs. */
  pestanaActivaId: string | null
  /** La tab activa del target activo, o null si no hay ninguna. */
  pestanaActiva: PestanaEditor | null
  /** TODAS las tabs de TODOS los targets válidos (keep-alive: App las monta todas). */
  todosLosPanes: ReferenciaPaneAbierto[]
  /** Abre un pane en el target ACTIVO (o activa su tab); `efimera` la abre como vista previa. */
  abrirPestana: (pane: PaneCentral, efimera?: boolean) => void
  /** Activa la tab `id` dentro del target ACTIVO; no-op si no existe. */
  activarPestana: (id: string) => void
  /** Cierra la tab `id` del target ACTIVO; si era la activa, hereda una vecina. */
  cerrarPestana: (id: string) => void
  /** Reemplaza en su sitio el pane de la tab `id` del target ACTIVO (guardar un sin título). */
  reemplazarPestana: (id: string, pane: PaneCentral) => void
  /** Menor número libre para el próximo "Sin título-N" del target ACTIVO. */
  siguienteNumeroSinTitulo: () => number
}

/** Poda la entrada de los targets que ya no están abiertos (efecto, no render: evita setState en render). */
function usePodaDeDestinos(destinosValidos: ReadonlySet<string>): void {
  useEffect(() => {
    actualizarPestanas((prev) => {
      let hayCambio = false
      for (const k of prev.keys()) {
        if (!destinosValidos.has(k)) {
          hayCambio = true
          break
        }
      }
      if (!hayCambio) return prev
      const siguiente = new Map<string, EstadoPestanasEditor>()
      for (const [k, v] of prev) if (destinosValidos.has(k)) siguiente.set(k, v)
      return siguiente
    })
  }, [destinosValidos])
}

/** Las cuatro acciones sobre las pestañas del target activo; sin target no hacen nada. */
function useAccionesPestanas(
  claveDestinoActivo: string | null
): Pick<UsePestanasEditor, 'abrirPestana' | 'activarPestana' | 'cerrarPestana' | 'reemplazarPestana'> {
  const abrirPestana = useCallback(
    (pane: PaneCentral, efimera = false) => {
      if (claveDestinoActivo === null) return // sin proyecto activo no hay dónde abrir
      actualizarPestanas((prev) =>
        actualizarDestino(prev, claveDestinoActivo, (s) => accionAbrirPestana(s, pane, efimera))
      )
    },
    [claveDestinoActivo]
  )

  const activarPestana = useCallback(
    (id: string) => {
      if (claveDestinoActivo === null) return
      actualizarPestanas((prev) => actualizarDestino(prev, claveDestinoActivo, (s) => accionActivarPestana(s, id)))
    },
    [claveDestinoActivo]
  )

  const cerrarPestana = useCallback(
    (id: string) => {
      if (claveDestinoActivo === null) return
      actualizarPestanas((prev) => actualizarDestino(prev, claveDestinoActivo, (s) => accionCerrarPestana(s, id)))
    },
    [claveDestinoActivo]
  )

  const reemplazarPestana = useCallback(
    (id: string, pane: PaneCentral) => {
      if (claveDestinoActivo === null) return
      actualizarPestanas((prev) => actualizarDestino(prev, claveDestinoActivo, (s) => accionReemplazarPestana(s, id, pane)))
    },
    [claveDestinoActivo]
  )

  return { abrirPestana, activarPestana, cerrarPestana, reemplazarPestana }
}

/** Pestañas del editor por target sobre el store del editor (misma vía que los demás stores). */
export function usePestanasEditor(
  claveDestinoActivo: string | null,
  clavesDestinoValidas: readonly string[]
): UsePestanasEditor {
  const porDestino = useStoreEditor((s) => s.pestanasPorDestino)

  // Memo por el contenido: la lista viene de un memo de `useEditorApp`.
  const destinosValidos = useMemo(() => new Set(clavesDestinoValidas), [clavesDestinoValidas])

  usePodaDeDestinos(destinosValidos)
  const { abrirPestana, activarPestana, cerrarPestana, reemplazarPestana } = useAccionesPestanas(claveDestinoActivo)

  // Rebanada activa: la entrada del target confirmado (o vacía si aún no tiene tabs).
  const estadoActivo = (claveDestinoActivo !== null && porDestino.get(claveDestinoActivo)) || estadoInicialPestanasEditor

  // Todas las tabs de los targets válidos (keep-alive); el filtro evita montar un target ya
  // cerrado mientras la poda corre.
  const todosLosPanes = useMemo(() => {
    const salida: ReferenciaPaneAbierto[] = []
    for (const [claveDestino, st] of porDestino) {
      if (!destinosValidos.has(claveDestino)) continue
      for (const pestana of st.pestanas) salida.push({ claveDestino, pestana })
    }
    return salida
  }, [porDestino, destinosValidos])

  return {
    pestanas: estadoActivo.pestanas,
    pestanaActivaId: estadoActivo.pestanaActivaId,
    pestanaActiva: obtenerPestanaActiva(estadoActivo),
    todosLosPanes,
    abrirPestana,
    activarPestana,
    cerrarPestana,
    reemplazarPestana,
    // Se lee al crear la pestaña, no en render: función, no valor.
    siguienteNumeroSinTitulo: () => siguienteNumeroSinTitulo(estadoActivo)
  }
}
