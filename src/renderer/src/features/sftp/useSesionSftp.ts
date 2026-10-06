// =============================================================================
// La sesión SFTP de una pestaña y lo que se ve de ella: abrirla al montarse (y cerrarla al
// desmontarse), listar la carpeta, navegar, actualizar y reabrir tras un fallo o una caída
// volviendo a la carpeta en la que se estaba. Las respuestas de un listado viejo se descartan si
// ya hay otro en marcha. Depende de `window.tessera.sftp` y de los módulos puros de la feature.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SftpEntrada } from '../../../../shared/sftp-ipc'
import type { TerminalExitReason } from '../../../../shared/terminal-ipc'
import { ordenarEntradas } from './listadoSftp'
import { padreDe } from './rutasSftp'

/** Por qué no hay explorador: no abrió, no pudo listar la primera carpeta o la sesión se cayó. */
export interface FalloSftp {
  error: string
  motivo?: TerminalExitReason
  caida: boolean
}

export type FaseSftp = 'conectando' | 'lista' | 'error'

/** La carpeta que se ve: su ruta canónica y sus entradas ya ordenadas. */
export interface ListadoSftp {
  ruta: string
  entradas: SftpEntrada[]
}

export interface PeticionSesionSftp {
  sesionId: string
  profileId: string
  conexionId: string
}

type ResultadoCarga = { estado: 'ok' } | { estado: 'obsoleta' } | { estado: 'fallo'; error: string }

/** Lo que el resto del explorador necesita de la sesión. */
export interface SesionSftp {
  fase: FaseSftp
  fallo: FalloSftp | null
  listado: ListadoSftp | null
  cargando: boolean
  /** El último fallo de una acción puntual (listar una carpeta sin permiso…), no modal. */
  aviso: string | null
  avisar: (texto: string | null) => void
  navegar: (ruta: string) => void
  actualizar: () => void
  subirNivel: () => void
  /** Vuelve a abrir la sesión (tras un fallo o una caída) y a la carpeta en la que se estaba. */
  reabrir: () => void
}

/** Pide el listado de `ruta` y, si sigue siendo el último pedido, lo deja como lo que se ve. */
function useCarga(sesionId: string, viva: React.MutableRefObject<boolean>) {
  const generacion = useRef(0)
  const [listado, setListado] = useState<ListadoSftp | null>(null)
  const [cargando, setCargando] = useState(false)
  const rutaRef = useRef<string | null>(null)
  const cargar = useCallback(
    async (ruta: string): Promise<ResultadoCarga> => {
      const mia = ++generacion.current
      setCargando(true)
      const r = await window.tessera.sftp.listar({ sesionId, ruta })
      if (mia !== generacion.current || !viva.current) return { estado: 'obsoleta' }
      setCargando(false)
      if (!r.ok) return { estado: 'fallo', error: r.error }
      rutaRef.current = r.valor.ruta
      setListado({ ruta: r.valor.ruta, entradas: ordenarEntradas(r.valor.entradas) })
      return { estado: 'ok' }
    },
    [sesionId, viva]
  )
  /** Descarta lo que esté en vuelo (una caída, un cierre): su respuesta ya no cuenta. */
  const invalidar = useCallback(() => {
    generacion.current++
    setCargando(false)
  }, [])
  return { listado, cargando, rutaRef, cargar, invalidar }
}

/** La sesión SFTP de una pestaña, de su apertura a su cierre. */
export function useSesionSftp({ sesionId, profileId, conexionId }: PeticionSesionSftp): SesionSftp {
  const viva = useRef(true)
  const { listado, cargando, rutaRef, cargar, invalidar } = useCarga(sesionId, viva)
  const [fase, setFase] = useState<FaseSftp>('conectando')
  const [fallo, setFallo] = useState<FalloSftp | null>(null)
  const [aviso, avisar] = useState<string | null>(null)

  const fallar = useCallback((f: FalloSftp) => {
    setFallo(f)
    setFase('error')
  }, [])

  const conectar = useCallback(async () => {
    invalidar()
    setFase('conectando')
    setFallo(null)
    const abierta = await window.tessera.sftp.abrir({ sesionId, profileId, conexionId })
    if (!viva.current) return
    if (!abierta.ok) return fallar({ error: abierta.error, motivo: abierta.motivo, caida: false })
    // Tras una caída se vuelve a la carpeta en la que se estaba; si ya no se puede, a la de inicio.
    const previa = rutaRef.current
    let res: ResultadoCarga = previa === null ? { estado: 'fallo', error: '' } : await cargar(previa)
    if (res.estado === 'fallo') res = await cargar(abierta.valor.inicio)
    if (res.estado === 'fallo') return fallar({ error: res.error, caida: false })
    if (res.estado === 'ok') setFase('lista')
  }, [sesionId, profileId, conexionId, invalidar, cargar, rutaRef, fallar])

  useEffect(() => {
    viva.current = true
    void conectar()
    return () => {
      viva.current = false
      void window.tessera.sftp.cerrar({ sesionId })
    }
  }, [conectar, sesionId])

  useEffect(
    () =>
      window.tessera.sftp.onCaida((c) => {
        if (c.sesionId !== sesionId) return
        invalidar()
        fallar({ error: c.error, motivo: c.motivo, caida: true })
      }),
    [sesionId, invalidar, fallar]
  )

  const navegar = useCallback(
    (ruta: string) => {
      avisar(null)
      void cargar(ruta).then((r) => r.estado === 'fallo' && avisar(r.error))
    },
    [cargar]
  )
  const actualizar = useCallback(() => {
    if (rutaRef.current !== null) navegar(rutaRef.current)
  }, [navegar, rutaRef])
  const subirNivel = useCallback(() => {
    if (rutaRef.current !== null && rutaRef.current !== '/') navegar(padreDe(rutaRef.current))
  }, [navegar, rutaRef])

  return { fase, fallo, listado, cargando, aviso, avisar, navegar, actualizar, subirNivel, reabrir: () => void conectar() }
}
