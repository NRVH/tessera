// =============================================================================
// Panel del explorador de archivos: elige entre el estado vacío y los `ArbolArchivos` de las
// contenedoras (no de los repos: cambiar de repo es asunto de git). Mantiene montados los árboles
// de los últimos proyectos vistos (`comun/useVivosRecientes`) y enseña solo el del que se ve: al
// volver a uno, está tal cual se dejó. Recuerda las carpetas abiertas de los que salen de la lista.
// Decisiones: docs/decisiones/explorador/arbol-de-archivos.md
// =============================================================================
import { memo, useCallback } from 'react'
import { useCapaVisible } from '../../comun/capaVisible'
import { EstadoVacio, IconoCarpetaVacia } from '../../comun/EstadoVacio'
import { CapaViva, useVivosRecientes } from '../../comun/useVivosRecientes'
import type { Vivo } from '../../comun/vivosRecientes'
import type { ArchivoAbierto } from '../editor'
import type { ProyectoAbiertoDePerfil } from '../pestanas'
import type { DecoracionesWorktree } from '../git'
import { txExplorador } from './textos.ts'
import { ArbolArchivos } from './ArbolArchivos'
import { recordarCarpetas, useStoreExplorador } from './store'
import type { BasesDeArchivoLateral } from './tiposArbol'

export type { BasesDeArchivoLateral } from './tiposArbol'

interface PropsLateralExplorador {
  /** Alto de fila en px; lo decide el tamaño de letra de la interfaz (theme/densidad). */
  altoFila: number
  /** Perfil del proyecto que se ve: con la contenedora, la clave de su árbol. */
  perfilId: string | null
  /** Contenedora que se ve, o null si no hay ninguna abierta. */
  proyectoActivo: ProyectoAbiertoDePerfil | null
  /** Claves (`perfil|contenedora`) de los proyectos abiertos: el árbol de uno cerrado se desmonta. */
  abiertos: ReadonlySet<string>
  /** Archivo abierto ahora mismo (para resaltar la fila activa). */
  archivoAbierto: ArchivoAbierto | null
  /** Decoraciones git del working-tree, o null si no se conocen. Solo lectura. */
  decoraciones: DecoracionesWorktree | null
  /** Abre un archivo en el editor. */
  onAbrirArchivo: (archivo: ArchivoAbierto) => void
  /** Abre el panel de historial de git de un archivo (menú contextual). */
  onAbrirHistorialArchivo: (ruta: string) => void
  /** Descarta los cambios del working-tree de un archivo (menú contextual). */
  onDescartarCambios: (ruta: string) => void
  /** Ruta a desplegar y traer a la vista; con token para poder pedir la misma dos veces. */
  revelarRuta?: { ruta: string; token: number }
  /**
   * Variables CSS de densidad de esta superficie. Se escriben en la raíz del panel y no en
   * `:root`, y salen del mismo número que `altoFila` o el scroll de las listas se descuadra.
   */
  variablesDensidad?: React.CSSProperties
  /** «Montar como base de datos» sobre un archivo del proyecto. Ausente = no se ofrece. */
  basesDeArchivo?: BasesDeArchivoLateral
}

/** El árbol de un proyecto montado: su clave (`perfil|contenedora`) y su proyecto. */
interface ArbolVivo extends Vivo {
  rutaHostProyecto: string
  nombre: string
}

/** Un proyecto renombrado repinta su árbol, aunque ya fuera el último visto. */
const mismoArbol = (a: ArbolVivo, b: ArbolVivo): boolean => a.clave === b.clave && a.nombre === b.nombre

/**
 * Un árbol oculto no se repinta por lo que le llega de fuera (callbacks nuevos en cada render del
 * lateral, el archivo abierto…): nadie lo ve ni puede tocarlo. Al volver a verse recibe las props
 * vigentes. Su propio estado (cargas, cambios) sí lo repinta.
 */
const ArbolArchivosVivo = memo(
  ArbolArchivos,
  (antes, ahora) =>
    !antes.activo &&
    !ahora.activo &&
    antes.altoFila === ahora.altoFila &&
    antes.revelarRuta?.token === ahora.revelarRuta?.token
)

/** Panel lateral con el árbol de archivos del proyecto que se ve. */
export function LateralExplorador(props: PropsLateralExplorador): React.JSX.Element {
  const { altoFila, variablesDensidad, perfilId, proyectoActivo, abiertos } = props
  // Carpetas abiertas de cada árbol: si se vuelve a él, o en el próximo arranque, se restauran (se guardan
  // con la sesión del proyecto). Se leen sin suscribirse: solo cuentan al montarse el árbol.
  const recordarExpandidas = useCallback(
    (rutaHostProyecto: string, expandidas: Set<string>) => {
      if (perfilId !== null) recordarCarpetas(`${perfilId}|${rutaHostProyecto}`, expandidas)
    },
    [perfilId]
  )
  const carpetasDe = (rutaHostProyecto: string): Set<string> | undefined => {
    const c = perfilId === null ? undefined : useStoreExplorador.getState().carpetasPorProyecto[`${perfilId}|${rutaHostProyecto}`]
    return c ? new Set(c) : undefined
  }
  const activo: ArbolVivo | null =
    proyectoActivo && perfilId !== null
      ? { clave: `${perfilId}|${proyectoActivo.rutaHostProyecto}`, rutaHostProyecto: proyectoActivo.rutaHostProyecto, nombre: proyectoActivo.nombre }
      : null
  const vivos = useVivosRecientes(activo, abiertos, mismoArbol)
  // Un árbol montado antes de que lleguen las carpetas guardadas nacería plegado (es un instante al arrancar).
  const carpetasListas = useStoreExplorador((s) => s.carpetasListas)
  // Con el lateral de archivos oculto (se mira otra vista), el árbol del proyecto tampoco se ve: no
  // escucha cambios ni atiende menús, y se recarga al volver a verse.
  const lateralSeVe = useCapaVisible()

  const t = txExplorador()
  return (
    <aside className="sidebar" aria-label={t.titulo} style={variablesDensidad}>
      {activo === null && (
        <>
          <div className="sidebar-header">
            <span className="sidebar-title">{t.titulo}</span>
          </div>
          <div className="sidebar-body">
            <EstadoVacio icono={<IconoCarpetaVacia />} titulo={t.sinProyecto} pista={t.sinProyectoPista} />
          </div>
        </>
      )}
      {carpetasListas && vivos.map((a) => {
        const visto = a.clave === activo?.clave
        return (
          <CapaViva key={a.clave} visible={visto}>
            <ArbolArchivosVivo
              rutaHostProyecto={a.rutaHostProyecto}
              nombreProyecto={a.nombre}
              activo={visto && lateralSeVe}
              altoFila={altoFila}
              expandidasIniciales={carpetasDe(a.rutaHostProyecto)}
              onCambioExpandidas={recordarExpandidas}
              archivoAbierto={visto ? props.archivoAbierto : null}
              decoraciones={visto ? props.decoraciones : null}
              onAbrirArchivo={props.onAbrirArchivo}
              onAbrirHistorialArchivo={props.onAbrirHistorialArchivo}
              onDescartarCambios={props.onDescartarCambios}
              revelarRuta={props.revelarRuta}
              basesDeArchivo={visto ? props.basesDeArchivo : undefined}
            />
          </CapaViva>
        )
      })}
    </aside>
  )
}
