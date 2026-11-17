// =============================================================================
// Bases de datos montadas en cada proyecto: montar y desmontar (en caliente, el main
// lo aplica a las sesiones vivas), montar un archivo SQLite desde el explorador,
// olvidar una conexión borrada y la poda de arranque contra perfiles y conexiones.
// =============================================================================
import { useCallback, useEffect, useMemo } from 'react'
import { notify, notifyError } from '../../comun/notificaciones'
import { podarMontajes, quitarConexion, vivosParaPodar } from './montajesPorProyecto'
import { useStoreBd } from './store'
import { useStoreAjustes } from '../ajustes'
import type { BasesDeArchivoLateral } from '../explorador'
import type { UsePestanas } from '../pestanas'
import { claveDestinoEditor } from '../editor'
import { txArea } from './textosArea.ts'

/** Montajes de bases de datos por proyecto. */
export interface MontajesBd {
  fijarMontadasDeProyecto: (perfilId: string, rutaHostProyecto: string, ids: string[]) => void
  /** Acciones de «Montar como base de datos» del explorador, del proyecto que se ve (el del árbol). */
  basesDeArchivo: BasesDeArchivoLateral | undefined
  /** Quita una conexión borrada de los proyectos de SU perfil y lo propaga a las sesiones. */
  olvidarConexionMontada: (conexionId: string, perfilId: string) => void
}

/** Propaga al main los proyectos cuyo montaje cambió o desapareció. */
function propagarCambios(prev: Record<string, string[]>, siguiente: Record<string, string[]>): void {
  const enviar = (clave: string, ids: string[]): void => {
    const corte = clave.indexOf('|')
    if (corte < 0) return
    void window.tessera.db.fijarAmbito(clave.slice(0, corte), clave.slice(corte + 1), ids)
  }
  for (const [clave, ids] of Object.entries(siguiente)) if (prev[clave] !== ids) enviar(clave, ids)
  for (const clave of Object.keys(prev)) if (!(clave in siguiente)) enviar(clave, [])
}

/** Poda de arranque, una vez con perfiles y ajustes; nada si el registro tiene formato ajeno. */
function usePodaMontajes(claveIdsPerfiles: string): void {
  const ajustesCargados = useStoreAjustes((s) => s.ajustesCargados)
  useEffect(() => {
    if (!ajustesCargados) return
    const ids = claveIdsPerfiles ? claveIdsPerfiles.split('|') : []
    if (ids.length === 0) return
    let vivo = true
    // Conocidas y ajenas de UNA lectura del registro por perfil.
    void Promise.all(ids.map((id) => window.tessera.db.listarCompleta(id).then((lista) => [id, lista] as const)))
      .then((pares) => {
        if (!vivo) return
        const vivos = vivosParaPodar(pares)
        if (vivos === null) return
        useStoreBd.setState((s) => ({ montajesPorProyecto: podarMontajes(s.montajesPorProyecto, vivos) }))
      })
      .catch(() => {
        // Sin la lista no se poda: mejor conservar de más que borrar montajes buenos.
      })
    return () => {
      vivo = false
    }
  }, [ajustesCargados, claveIdsPerfiles])
}

/** Bases montadas por proyecto y sus acciones. */
export function useMontajesBd(pestanas: UsePestanas): MontajesBd {
  // El del árbol que se pinta; el main rechaza montar si aún no lo tiene anclado.
  const visto = pestanas.objetivoVisto
  const fijarMontadasDeProyecto = useCallback(
    (perfilId: string, rutaHostProyecto: string, ids: string[]) => {
      const clave = claveDestinoEditor(perfilId, rutaHostProyecto)
      useStoreBd.setState((s) => {
        const siguiente = { ...s.montajesPorProyecto }
        // Sin bases se BORRA la entrada: el archivo de ajustes no acumula ruido.
        if (ids.length === 0) delete siguiente[clave]
        else siguiente[clave] = ids
        return { montajesPorProyecto: siguiente }
      })
      // En caliente: la siguiente invocación de `tdb` ya lo ve.
      void window.tessera.db.fijarAmbito(perfilId, rutaHostProyecto, ids)
    },
    []
  )
  const basesDeArchivo = useMemo<BasesDeArchivoLateral | undefined>(() => {
    if (!visto) return undefined
    const perfilId = visto.perfilId
    const rutaHostProyecto = visto.proyecto.rutaHostProyecto
    const montadas = (): string[] => useStoreBd.getState().montajesPorProyecto[claveDestinoEditor(perfilId, rutaHostProyecto)] ?? []
    return {
      montadaDe: async (rutaRelativa) => {
        const r = await window.tessera.db.conexionDeArchivo({ profileId: perfilId, projectHostPath: rutaHostProyecto, relPath: rutaRelativa })
        return r !== null && montadas().includes(r.id) ? r.id : null
      },
      montar: async (rutaRelativa) => {
        try {
          const { conexion, reutilizada } = await window.tessera.db.montarArchivo({ profileId: perfilId, projectHostPath: rutaHostProyecto, relPath: rutaRelativa })
          const ids = montadas()
          if (!ids.includes(conexion.id)) fijarMontadasDeProyecto(perfilId, rutaHostProyecto, [...ids, conexion.id])
          const t = txArea()
          notify(
            'success',
            t.montadaEnProyecto(conexion.alias),
            (reutilizada ? t.yaEstabaEnConexiones : t.seAnadioAConexiones) +
              (conexion.readonly ? t.agenteConsultaSoloLeer : t.agenteConsulta)
          )
        } catch (err) {
          notifyError(txArea().noSePudoMontar, err)
        }
      },
      desmontar: (conexionId) =>
        fijarMontadasDeProyecto(perfilId, rutaHostProyecto, montadas().filter((id) => id !== conexionId))
    }
  }, [visto, fijarMontadasDeProyecto])
  // Solo en el perfil de la borrada: una copia pegada en otro perfil comparte el id.
  const olvidarConexionMontada = useCallback((conexionId: string, perfilId: string) => {
    useStoreBd.setState((s) => {
      const siguiente = quitarConexion(s.montajesPorProyecto, conexionId, perfilId)
      if (siguiente !== s.montajesPorProyecto) propagarCambios(s.montajesPorProyecto, siguiente)
      return { montajesPorProyecto: siguiente }
    })
  }, [])
  usePodaMontajes(pestanas.perfiles.map((p) => p.id).join('|'))
  return { fijarMontadasDeProyecto, basesDeArchivo, olvidarConexionMontada }
}
