// =============================================================================
// Pestañas del editor de la ventana: el target (perfil y proyecto CONFIRMADOS), la
// colección keep-alive de usePestanasEditor, el estado por pane del store y las
// acciones de abrir, cerrar, guardar y convertir. Fija el ámbito de la caché de
// blobs en el render. Lo llama App; depende de los stores de editor y layout.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// =============================================================================
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { extensionDeOficina } from '../../../../shared/documentosOficina'
import { abrirDocumentoOficina } from './abrirDocumentoOficina'
import { usePestanasEditor, type UsePestanasEditor } from './usePestanasEditor'
import { derivarIdPestana, claveDestinoEditor, clavePaneEditor, perfilDeDestino, nombreSinTitulo } from './modeloPestanasEditor'
import { siguienteMotivoCcOculto, type PaneCentral, type ArchivoAbierto, type ArchivoSinTitulo } from './paneCentral'
import { claveModeloTexto, modelosTexto } from './registroModelosTexto'
import type { EditorMeta } from './EditorPane'
import type { DestinoDiff } from './diffEditorTipos'
import { conMarca, podarConjunto, podarMapa, subirTokens, useStoreEditor } from './store'
import { fijarColumna, salirDePantallaCompleta, type VistasPorPerfil } from '../layout'
import type { UsePestanas } from '../pestanas'

/** Opciones de apertura de una pestaña del editor. */
export interface OpcionesApertura {
  /** `true` colapsa la columna del agente (un diff a pantalla completa). */
  colapsarAgente?: boolean
  revelar?: { linea: number; columna: number }
  /** Abre como vista previa: la siguiente efímera la sustituye en su hueco. */
  efimera?: boolean
}

/** Lo que el editor de la ventana expone a App y a sus paneles. */
export interface EditorApp {
  claveEditorActivo: string | null
  pestanasEditor: UsePestanasEditor
  clavePane: (claveDestino: string, pestanaId: string) => string
  archivoAbierto: ArchivoAbierto | null
  idsPestanasSuciasActivas: Set<string>
  idsPestanasBorradasActivas: Set<string>
  metaEditorActivo: EditorMeta | null
  /** ¿El proyecto optimista y el confirmado coinciden? (no hay cambio de proyecto en vuelo). */
  proyectoAsentado: boolean
  abrirPestana: (pane: PaneCentral, opts?: OpcionesApertura) => void
  cerrarPestana: (id: string) => void
  pedirCerrarPestana: (id: string) => void
  abrirFuenteDelDiff: (destino: DestinoDiff, linea: number) => void
  pedirGuardarPestana: (id: string) => void
  pedirConvertir: (datos: { encodingId?: string; eol?: 'CRLF' | 'LF' }) => void
  pedirReabrirEncoding: (encodingId: string) => void
  crearPestanaSinTitulo: () => void
  guardarPaneSinTitulo: (pestanaId: string, sinTitulo: ArchivoSinTitulo, contenido: string) => Promise<boolean>
}

/** Traduce un conjunto por clavePane a ids de pestaña del target activo. */
function idsDelActivo(marcados: Set<string>, pestanas: UsePestanasEditor['pestanas'], clave: string | null): Set<string> {
  const s = new Set<string>()
  if (clave === null) return s
  for (const pestana of pestanas) if (marcados.has(clavePaneEditor(clave, pestana.id))) s.add(pestana.id)
  return s
}

/**
 * Poda el estado por pane de los panes ya desmontados (los panes no reportan al desmontar). Las pestañas se
 * leen del store al podar, no de `todosLosPanes`: este efecto puede correr con la lista de un render anterior justo
 * después de que se añadieran pestañas con su estado (la sesión restaurada), y se lo llevaría por delante.
 */
function usePodaPorPane(pestanasEditor: UsePestanasEditor): void {
  useEffect(() => {
    useStoreEditor.setState((s) => {
      const montados = new Set<string>()
      for (const [claveDestino, st] of s.pestanasPorDestino) for (const pestana of st.pestanas) montados.add(clavePaneEditor(claveDestino, pestana.id))
      return {
        idsPestanasSucias: podarConjunto(s.idsPestanasSucias, montados),
        idsPestanasBorradas: podarConjunto(s.idsPestanasBorradas, montados),
        tokensRecarga: podarMapa(s.tokensRecarga, montados),
        tokensGuardado: podarMapa(s.tokensGuardado, montados),
        metaEditorPorClave: podarMapa(s.metaEditorPorClave, montados),
        peticionesConversionPorClave: podarMapa(s.peticionesConversionPorClave, montados),
        peticionesReaperturaPorClave: podarMapa(s.peticionesReaperturaPorClave, montados),
        revelarPorPane: podarMapa(s.revelarPorPane, montados),
        // Aquí importa más: reabrir el mismo archivo recupera la misma clave.
        modoVistaPorPane: podarMapa(s.modoVistaPorPane, montados)
      }
    })
  }, [pestanasEditor.todosLosPanes])
}

/** Cierra una pestaña del target activo limpiando su sucio y su modo de vista. */
function useCerrarPestana(pestanasEditor: UsePestanasEditor, claveEditorActivo: string | null): (id: string) => void {
  return useCallback(
    (id: string) => {
      // Sin título: el main suelta el destino que recordaba para el siguiente guardado.
      const pestana = pestanasEditor.pestanas.find((t) => t.id === id)
      if (pestana?.pane.tipo === 'untitled') {
        void window.tessera.files
          .olvidarSinTitulo(pestana.pane.sinTitulo.id)
          .catch((err) => console.error('[app] olvidarSinTitulo falló:', err))
      }
      pestanasEditor.cerrarPestana(id)
      if (claveEditorActivo === null) return
      const pk = clavePaneEditor(claveEditorActivo, id)
      useStoreEditor.setState((s) => {
        const cambios: Partial<typeof s> = { idsPestanasSucias: conMarca(s.idsPestanasSucias, pk, false) }
        if (s.modoVistaPorPane.has(pk)) {
          const siguiente = new Map(s.modoVistaPorPane)
          siguiente.delete(pk)
          cambios.modoVistaPorPane = siguiente
        }
        return cambios
      })
    },
    [pestanasEditor, claveEditorActivo]
  )
}

/** Único punto de apertura de pestañas: sale del maximizado y de la pantalla completa de la franja, ajusta el oculto y la vista de BD. */
function useAbrirPestana(
  pestanasEditor: UsePestanasEditor,
  claveEditorActivo: string | null,
  raiz: string | null,
  salirDeBd: () => void
): EditorApp['abrirPestana'] {
  return useCallback(
    (pane: PaneCentral, opts?: OpcionesApertura) => {
      if (pane.tipo === 'file') {
        const extension = extensionDeOficina(pane.archivo.ruta)
        if (extension !== null) {
          if (raiz !== null) void abrirDocumentoOficina(raiz, pane.archivo, extension)
          return
        }
      }
      // En el mismo handler que `abrirPestana`, no en un efecto: llegan en el mismo commit. Con la
      // franja a pantalla completa el editor está tapado: abrir una pestaña sale del modo. La
      // columna que cambia es la del perfil de las pestañas, no la de los demás.
      fijarColumna(
        (c) => ({ maximizada: false, oculta: siguienteMotivoCcOculto(c.oculta, pane, opts?.colapsarAgente === true) }),
        perfilDeDestino(claveEditorActivo)
      )
      salirDePantallaCompleta()
      salirDeBd()
      pestanasEditor.abrirPestana(pane, opts?.efimera === true)
      // Por token y no por el pane: dos coincidencias del mismo archivo son la misma pestaña.
      if (opts?.revelar && claveEditorActivo !== null) {
        const pk = clavePaneEditor(claveEditorActivo, derivarIdPestana(pane))
        const revelar = opts.revelar
        useStoreEditor.setState((s) => {
          const siguiente = new Map(s.revelarPorPane)
          siguiente.set(pk, { ...revelar, token: (s.revelarPorPane.get(pk)?.token ?? 0) + 1 })
          return { revelarPorPane: siguiente }
        })
      }
    },
    [pestanasEditor, claveEditorActivo, raiz, salirDeBd]
  )
}

/** Peticiones a un pane por token: guardar, convertir y reabrir con otra codificación. */
function usePeticionesPane(
  pestanasEditor: UsePestanasEditor,
  claveEditorActivo: string | null
): Pick<EditorApp, 'pedirGuardarPestana' | 'pedirConvertir' | 'pedirReabrirEncoding'> {
  const pestanaActivaId = pestanasEditor.pestanaActivaId
  const pedirGuardarPestana = useCallback(
    (id: string) => {
      if (claveEditorActivo === null) return
      const pk = clavePaneEditor(claveEditorActivo, id)
      useStoreEditor.setState((s) => ({ tokensGuardado: subirTokens(s.tokensGuardado, [pk]) }))
    },
    [claveEditorActivo]
  )
  const pedirConvertir = useCallback(
    (datos: { encodingId?: string; eol?: 'CRLF' | 'LF' }) => {
      if (claveEditorActivo === null || pestanaActivaId == null) return
      const pk = clavePaneEditor(claveEditorActivo, pestanaActivaId)
      useStoreEditor.setState((s) => {
        const siguiente = new Map(s.peticionesConversionPorClave)
        siguiente.set(pk, { token: (s.peticionesConversionPorClave.get(pk)?.token ?? 0) + 1, ...datos })
        return { peticionesConversionPorClave: siguiente }
      })
    },
    [claveEditorActivo, pestanaActivaId]
  )
  const pedirReabrirEncoding = useCallback(
    (encodingId: string) => {
      if (claveEditorActivo === null || pestanaActivaId == null) return
      const pk = clavePaneEditor(claveEditorActivo, pestanaActivaId)
      useStoreEditor.setState((s) => {
        const siguiente = new Map(s.peticionesReaperturaPorClave)
        siguiente.set(pk, { token: (s.peticionesReaperturaPorClave.get(pk)?.token ?? 0) + 1, encodingId })
        return { peticionesReaperturaPorClave: siguiente }
      })
    },
    [claveEditorActivo, pestanaActivaId]
  )
  return { pedirGuardarPestana, pedirConvertir, pedirReabrirEncoding }
}

/** Archivos sin título: crear uno y guardarlo (dentro del proyecto pasa a ser un archivo). */
function useSinTitulo(
  pestanasEditor: UsePestanasEditor,
  claveEditorActivo: string | null,
  abrirPestana: EditorApp['abrirPestana']
): Pick<EditorApp, 'crearPestanaSinTitulo' | 'guardarPaneSinTitulo'> {
  // Identidad opaca de los buffers: nunca se reutiliza (el número del nombre sí).
  const secuenciaSinTitulo = useRef(0)
  const crearPestanaSinTitulo = useCallback(() => {
    if (claveEditorActivo === null) return
    secuenciaSinTitulo.current += 1
    const sinTitulo: ArchivoSinTitulo = {
      id: `untitled-${secuenciaSinTitulo.current}`,
      nombre: nombreSinTitulo(pestanasEditor.siguienteNumeroSinTitulo())
    }
    abrirPestana({ tipo: 'untitled', sinTitulo })
  }, [claveEditorActivo, pestanasEditor, abrirPestana])
  const guardarPaneSinTitulo = useCallback(
    async (pestanaId: string, sinTitulo: ArchivoSinTitulo, contenido: string): Promise<boolean> => {
      try {
        const res = await window.tessera.files.guardarSinTitulo(sinTitulo.id, contenido, sinTitulo.nombre)
        if (res.canceled) return false
        const nombre = res.nombre ?? sinTitulo.nombre
        if (res.ruta) pestanasEditor.reemplazarPestana(pestanaId, { tipo: 'file', archivo: { ruta: res.ruta, nombre } })
        else pestanasEditor.reemplazarPestana(pestanaId, { tipo: 'untitled', sinTitulo: { ...sinTitulo, nombre, guardado: true } })
        return true
      } catch (err) {
        console.error('[app] guardar sin título falló:', err)
        return false
      }
    },
    [pestanasEditor]
  )
  return { crearPestanaSinTitulo, guardarPaneSinTitulo }
}

/** Confirma el cierre solo si pierde trabajo: sin título sucio, o el último titular de un diff sucio. */
function usePedirCierre(
  pestanasEditor: UsePestanasEditor,
  claveEditorActivo: string | null,
  idsPestanasSucias: Set<string>,
  cerrarPestana: (id: string) => void
): (id: string) => void {
  return useCallback(
    (id: string) => {
      const pestana = pestanasEditor.pestanas.find((t) => t.id === id)
      const sucio = claveEditorActivo !== null && idsPestanasSucias.has(clavePaneEditor(claveEditorActivo, id))
      const fijar = useStoreEditor.setState
      if (pestana?.pane.tipo === 'untitled' && sucio) {
        fijar({ cierrePendiente: { id, nombre: pestana.pane.sinTitulo.nombre, tipo: 'untitled' } })
        return
      }
      if (pestana?.pane.tipo === 'diff' && sucio && claveEditorActivo !== null) {
        const mk = claveModeloTexto(claveEditorActivo, pestana.pane.destino.despues.ruta)
        if (modelosTexto.estaSucio(mk) && modelosTexto.contarRefs(mk) <= 1) {
          const nombre = pestana.pane.destino.ruta.split('/').pop() ?? pestana.pane.destino.ruta
          fijar({ cierrePendiente: { id, nombre, tipo: 'diff' } })
          return
        }
      }
      cerrarPestana(id)
    },
    [pestanasEditor.pestanas, claveEditorActivo, idsPestanasSucias, cerrarPestana]
  )
}

/** Target, pestañas y acciones del editor de la ventana. */
export function useEditorApp(pestanas: UsePestanas, vistas: Pick<VistasPorPerfil, 'salirDeBd'>): EditorApp {
  // Las pestañas que se ven son las del proyecto que se ve: cada pane pide al main con su proyecto.
  const visto = pestanas.objetivoVisto
  const claveEditorActivo = visto ? claveDestinoEditor(visto.perfilId, visto.proyecto.rutaHostProyecto) : null
  // Los avisos del vigilante son del proyecto anclado: solo valen cuando es el que se ve.
  const proyectoAsentado =
    (visto?.proyecto.rutaHostProyecto ?? null) === (pestanas.objetivoConfirmado?.proyecto.rutaHostProyecto ?? null)
  // Proyectos abiertos (hibernados incluidos) sin la dimensión de agente; memo = identidad estable.
  const clavesEditorValidas = useMemo(() => {
    const claves = new Set<string>()
    for (const t of pestanas.todosLosDestinosAbiertos) claves.add(claveDestinoEditor(t.profileId, t.projectHostPath))
    return [...claves]
  }, [pestanas.todosLosDestinosAbiertos])
  const pestanasEditor = usePestanasEditor(claveEditorActivo, clavesEditorValidas)
  const clavePane = useCallback(clavePaneEditor, [])
  const { idsPestanasSucias, idsPestanasBorradas, metaEditorPorClave } = useStoreEditor(
    useShallow((s) => ({ idsPestanasSucias: s.idsPestanasSucias, idsPestanasBorradas: s.idsPestanasBorradas, metaEditorPorClave: s.metaEditorPorClave }))
  )
  const idsPestanasSuciasActivas = useMemo(
    () => idsDelActivo(idsPestanasSucias, pestanasEditor.pestanas, claveEditorActivo),
    [idsPestanasSucias, pestanasEditor.pestanas, claveEditorActivo]
  )
  const idsPestanasBorradasActivas = useMemo(
    () => idsDelActivo(idsPestanasBorradas, pestanasEditor.pestanas, claveEditorActivo),
    [idsPestanasBorradas, pestanasEditor.pestanas, claveEditorActivo]
  )
  usePodaPorPane(pestanasEditor)
  const cerrarPestana = useCerrarPestana(pestanasEditor, claveEditorActivo)
  const abrirPestana = useAbrirPestana(pestanasEditor, claveEditorActivo, visto?.proyecto.rutaHostProyecto ?? null, vistas.salirDeBd)
  // Saltar al fuente desde un diff: abre el archivo de hoy (`path`, el destino en un rename).
  const abrirFuenteDelDiff = useCallback(
    (destino: DestinoDiff, linea: number): void => {
      const nombre = destino.ruta.split('/').pop() ?? destino.ruta
      abrirPestana({ tipo: 'file', archivo: { ruta: destino.ruta, nombre } }, { revelar: { linea, columna: 1 } })
    },
    [abrirPestana]
  )
  const peticiones = usePeticionesPane(pestanasEditor, claveEditorActivo)
  const pestanaActivaId = pestanasEditor.pestanaActivaId
  const metaEditorActivo = useMemo(() => {
    if (claveEditorActivo === null || pestanaActivaId == null) return null
    return metaEditorPorClave.get(clavePaneEditor(claveEditorActivo, pestanaActivaId)) ?? null
  }, [metaEditorPorClave, claveEditorActivo, pestanaActivaId])
  const sinTitulo = useSinTitulo(pestanasEditor, claveEditorActivo, abrirPestana)
  const pedirCerrarPestana = usePedirCierre(pestanasEditor, claveEditorActivo, idsPestanasSucias, cerrarPestana)
  const panePestanaActiva = pestanasEditor.pestanaActiva?.pane ?? null
  return {
    claveEditorActivo,
    pestanasEditor,
    clavePane,
    archivoAbierto: panePestanaActiva?.tipo === 'file' ? panePestanaActiva.archivo : null,
    idsPestanasSuciasActivas,
    idsPestanasBorradasActivas,
    metaEditorActivo,
    proyectoAsentado,
    abrirPestana,
    cerrarPestana,
    pedirCerrarPestana,
    abrirFuenteDelDiff,
    ...peticiones,
    ...sinTitulo
  }
}
