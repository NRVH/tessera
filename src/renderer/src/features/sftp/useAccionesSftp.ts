// =============================================================================
// Lo que se puede hacer en el explorador SFTP con la selección: entrar en una carpeta o bajar un
// archivo, descargar, subir (por diálogo o soltando), crear una carpeta, renombrar y eliminar, con el
// diálogo que cada una pide y su error dentro cuando el servidor la rechaza. Las rutas que viajan son
// remotas: la carpeta que se ve más el nombre de cada fila. Depende de `window.tessera.sftp`, de
// la sesión y de las operaciones.
// =============================================================================

import { useCallback, useState } from 'react'
import type { SftpEntrada } from '../../../../shared/sftp-ipc'
import { esDescargable, esNavegable } from './listadoSftp'
import type { OperacionesSftp } from './useOperacionesSftp'
import { destinoDeSoltar, unirRuta, validarNombre } from './rutasSftp'
import type { SesionSftp } from './useSesionSftp'

/** El diálogo abierto (o ninguno): uno solo a la vez. */
export type DialogoSftp =
  | { tipo: 'carpeta' }
  // `carpeta`: la de cuando se abrió el diálogo. Se navega sin esperar al listado, y unir los nombres con la
  // carpeta de AL CONFIRMAR borraría (o renombraría) en otra.
  | { tipo: 'renombrar'; nombre: string; carpeta: string }
  | { tipo: 'borrar'; nombres: string[]; hayCarpetas: boolean; carpeta: string }

export interface EntradaAcciones {
  sesionId: string
  /** La carpeta que se ve; `null` mientras no hay ninguna. */
  ruta: string | null
  entradas: readonly SftpEntrada[]
  /** Los nombres elegidos, en el orden de la lista. */
  seleccion: readonly string[]
  sesion: SesionSftp
  operaciones: OperacionesSftp
}

export interface AccionesSftp {
  dialogo: DialogoSftp | null
  errorDialogo: string | null
  cerrarDialogo: () => void
  abrirEntrada: (e: SftpEntrada) => void
  abrirSeleccion: () => void
  descargar: () => void
  subir: (carpeta: boolean) => void
  /** `carpeta`: la de la lista sobre la que se soltó, o `null` para la que se ve. */
  soltar: (archivos: File[], carpeta: string | null) => void
  pedirCarpeta: () => void
  pedirRenombrar: () => void
  pedirBorrar: () => void
  crearCarpeta: (nombre: string) => void
  renombrar: (nombre: string) => void
  borrar: () => void
}

/** Las acciones sobre la carpeta que se ve y la selección. */
export function useAccionesSftp(e: EntradaAcciones): AccionesSftp {
  const { sesionId, ruta, entradas, seleccion, sesion, operaciones } = e
  const [dialogo, setDialogo] = useState<DialogoSftp | null>(null)
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null)
  const { alIniciar } = operaciones
  const { avisar, navegar, actualizar } = sesion

  const abrirDialogo = (d: DialogoSftp): void => {
    setErrorDialogo(null)
    setDialogo(d)
  }
  const cerrarDialogo = useCallback(() => setDialogo(null), [])
  const deNombres = (nombres: readonly string[]): SftpEntrada[] => entradas.filter((x) => nombres.includes(x.nombre))

  const descargarNombres = (nombres: readonly string[]): void => {
    if (ruta === null) return
    const rutas = deNombres(nombres).filter(esDescargable).map((x) => unirRuta(ruta, x.nombre))
    if (rutas.length > 0) void window.tessera.sftp.descargar({ sesionId, rutas }).then(alIniciar)
  }
  const abrirEntrada = (x: SftpEntrada): void => {
    if (ruta === null) return
    if (esNavegable(x)) navegar(unirRuta(ruta, x.nombre))
    else descargarNombres([x.nombre])
  }
  const abrirSeleccion = (): void => {
    const unica = seleccion.length === 1 ? deNombres(seleccion)[0] : undefined
    if (unica) abrirEntrada(unica)
    else descargarNombres(seleccion)
  }

  return {
    dialogo,
    errorDialogo,
    cerrarDialogo,
    abrirEntrada,
    abrirSeleccion,
    descargar: () => descargarNombres(seleccion),
    subir: (carpeta) => {
      if (ruta !== null) void window.tessera.sftp.subir({ sesionId, destino: ruta, carpeta }).then(alIniciar)
    },
    soltar: (archivos, carpeta) => {
      if (ruta === null || archivos.length === 0) return
      void window.tessera.sftp.subirSoltados({ sesionId, destino: destinoDeSoltar(ruta, carpeta) }, archivos).then(alIniciar)
    },
    pedirCarpeta: () => abrirDialogo({ tipo: 'carpeta' }),
    pedirRenombrar: () => seleccion.length === 1 && ruta !== null && abrirDialogo({ tipo: 'renombrar', nombre: seleccion[0], carpeta: ruta }),
    pedirBorrar: () => {
      // Un enlace a una carpeta se quita sin tocar lo que hay al otro lado: solo las carpetas de verdad avisan.
      const hayCarpetas = deNombres(seleccion).some((x) => x.tipo === 'carpeta')
      if (seleccion.length > 0 && ruta !== null) abrirDialogo({ tipo: 'borrar', nombres: [...seleccion], hayCarpetas, carpeta: ruta })
    },
    crearCarpeta: (nombre) => {
      const invalido = validarNombre(nombre)
      if (invalido !== null || ruta === null) return setErrorDialogo(invalido)
      void window.tessera.sftp.crearCarpeta({ sesionId, ruta: unirRuta(ruta, nombre) }).then((r) => {
        if (!r.ok) return setErrorDialogo(r.error)
        setDialogo(null)
        actualizar()
      })
    },
    renombrar: (nombre) => {
      const invalido = validarNombre(nombre)
      if (dialogo?.tipo !== 'renombrar') return
      if (invalido !== null) return setErrorDialogo(invalido)
      if (nombre === dialogo.nombre) return setDialogo(null)
      const { carpeta } = dialogo
      void window.tessera.sftp.renombrar({ sesionId, desde: unirRuta(carpeta, dialogo.nombre), a: unirRuta(carpeta, nombre) }).then((r) => {
        if (!r.ok) return setErrorDialogo(r.error)
        setDialogo(null)
        actualizar()
      })
    },
    borrar: () => {
      if (dialogo?.tipo !== 'borrar') return
      setDialogo(null)
      const { carpeta } = dialogo
      const rutas = dialogo.nombres.map((n) => unirRuta(carpeta, n))
      void window.tessera.sftp.borrar({ sesionId, rutas }).then((r) => {
        if (!r.ok) avisar(r.error)
      })
    }
  }
}
