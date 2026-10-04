// =============================================================================
// El estado del diálogo de conexión, en hooks que `useConexionDialogo` llama SIEMPRE en
// el mismo orden: el formulario, el foco de «Pegar URI…», los clientes, y los efectos
// que ocultan la contraseña, cargan la lista de clientes, traen su sección a la vista y
// prueban tras «Confiar en el certificado». Todo es estado de `DbConexionDialogo`.
// Decisiones: docs/decisiones/bd/ui-conexion-dialogo.md
// =============================================================================

import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  DbArchivoElegido,
  DbConnection,
  DbMotor,
  DbTestResult,
  DriverProgress,
  DriverRequerido,
  DriverStatus
} from '../../../../shared/db-ipc'
import { borradorDesde, borradorNuevo, conArchivoElegido, type BorradorConexion } from './borradorConexion'

type Setter<T> = Dispatch<SetStateAction<T>>

/** El campo de «Pegar URI»: abierto o no, lo tecleado, el motivo si no se pudo descomponer y el aviso de lo descartado. */
export interface EstadoUri {
  abierta: boolean
  texto: string
  error: string | null
  aviso: string | null
}

/** El campo de «Pegar URI» cerrado y vacío (un objeto nuevo en cada llamada). */
export function uriCerrada(): EstadoUri {
  return { abierta: false, texto: '', error: null, aviso: null }
}

/** Un archivo con el que se abre un alta precargada. */
export interface ArchivoInicial {
  motor: DbMotor
  elegido: DbArchivoElegido
}

function borradorInicial(perfilId: string, conexion: DbConnection | null, archivoInicial: ArchivoInicial | null): BorradorConexion {
  if (conexion) return borradorDesde(conexion)
  if (archivoInicial) return conArchivoElegido(borradorNuevo(perfilId, archivoInicial.motor), archivoInicial.elegido)
  return borradorNuevo(perfilId)
}

/** Los identificadores, el borrador y el estado de guardar, probar y «Pegar URI» del diálogo. */
export function useEstadoFormularioConexion(
  perfilId: string,
  conexion: DbConnection | null,
  archivoInicial: ArchivoInicial | null
) {
  const idTitulo = useId()
  const nombreRadioEntorno = useId()
  const idAyudaEntorno = useId()
  /** El borrador con el que se abrió: de él salen el primer estado y el motor de «Instalar cliente…». */
  const [inicial] = useState<BorradorConexion>(() => borradorInicial(perfilId, conexion, archivoInicial))
  const [borrador, setBorrador] = useState<BorradorConexion>(inicial)
  /** Lo guardado, para saber si hay cambios. null en un alta que aún no se guardó. */
  const [original, setOriginal] = useState<BorradorConexion | null>(conexion ? inicial : null)
  /** Lo último que el main devolvió de esta conexión: de ahí salen los avisos de contraseña. */
  const [guardada, setGuardada] = useState<DbConnection | null>(conexion)
  const [verPassword, setVerPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  /** El diálogo nativo de elegir o crear el archivo está abierto (motores de archivo). */
  const [eligiendo, setEligiendo] = useState(false)
  /** Tras un intento de guardar, se marca lo que el main rechazaría. */
  const [marcarInvalidos, setMarcarInvalidos] = useState(false)
  const [probando, setProbando] = useState(false)
  const [resultado, setResultado] = useState<DbTestResult | null>(null)
  /** La prueba tras «Confiar en el certificado» sale en el render siguiente, cuando `probar` ya ve la casilla. */
  const [probarTrasEditar, setProbarTrasEditar] = useState(false)
  const [uri, setUri] = useState<EstadoUri>(uriCerrada)
  return {
    idTitulo, nombreRadioEntorno, idAyudaEntorno, inicial,
    borrador, setBorrador, original, setOriginal, guardada, setGuardada,
    verPassword, setVerPassword, error, setError, guardando, setGuardando,
    eligiendo, setEligiendo, marcarInvalidos, setMarcarInvalidos,
    probando, setProbando, resultado, setResultado,
    probarTrasEditar, setProbarTrasEditar, uri, setUri
  }
}

/** El estado del formulario del diálogo de conexión. */
export type EstadoFormularioConexion = ReturnType<typeof useEstadoFormularioConexion>

/** El botón «Pegar URI…»: el foco vuelve a él al cerrar el campo (si no, caería en <body>). */
export function useFocoBotonUri(abierta: boolean): React.RefObject<HTMLButtonElement> {
  const botonUriRef = useRef<HTMLButtonElement>(null)
  const uriEstuvoAbierta = useRef(false)
  useEffect(() => {
    if (abierta) uriEstuvoAbierta.current = true
    else if (uriEstuvoAbierta.current) botonUriRef.current?.focus()
  }, [abierta])
  return botonUriRef
}

/** La lista de clientes, la instalación en curso y la sección «Clientes de base de datos». */
export function useEstadoDrivers(requiereDriver: DriverRequerido | null, abrirClientes: boolean) {
  const [drivers, setDrivers] = useState<DriverStatus[]>([])
  const [progreso, setProgreso] = useState<DriverProgress | null>(null)
  const [instalando, setInstalando] = useState<string | null>(null)
  const [requiere, setRequiere] = useState<DriverRequerido | null>(requiereDriver)
  const [clientesAbierto, setClientesAbierto] = useState(abrirClientes || requiereDriver !== null)
  const clientesRef = useRef<HTMLDetailsElement>(null)
  return {
    drivers, setDrivers, progreso, setProgreso, instalando, setInstalando,
    requiere, setRequiere, clientesAbierto, setClientesAbierto, clientesRef
  }
}

/** El estado de los clientes del diálogo de conexión. */
export type EstadoDrivers = ReturnType<typeof useEstadoDrivers>

/**
 * La contraseña vuelve a ocultarse al cambiar de borrador (el alta pasa a edición al
 * guardarse): revelarla es un gesto puntual, no un estado que deba quedarse pegado.
 * El setter es estable: solo `borradorKey` decide cuándo corre.
 */
export function useOcultarPassword(borradorKey: string, setVerPassword: Setter<boolean>): void {
  useEffect(() => {
    setVerPassword(false)
  }, [borradorKey, setVerPassword])
}

/** Carga la lista de clientes al montar y la recarga al terminar una instalación (setters estables: corre una vez). */
export function useListaDrivers(setDrivers: Setter<DriverStatus[]>, setProgreso: Setter<DriverProgress | null>): void {
  useEffect(() => {
    let vivo = true
    const recargar = (): void => {
      window.tessera.db
        .driversList()
        .then((l) => {
          if (vivo) setDrivers(l)
        })
        .catch(() => undefined)
    }
    recargar()
    const baja = window.tessera.db.onDriverProgress((p) => {
      setProgreso(p)
      if (p.fase === 'listo' || p.fase === 'error') recargar()
    })
    return () => {
      vivo = false
      baja()
    }
  }, [setDrivers, setProgreso])
}

/** Lo que decide cuándo se trae a la vista la sección de clientes y qué pack pidió la prueba. */
export interface SeccionClientes {
  verClientes: boolean
  drivers: DriverStatus[]
  requiere: DriverRequerido | null
  abrirClientes: boolean
  requiereDriver: DriverRequerido | null
  clientesRef: React.RefObject<HTMLDetailsElement>
}

/**
 * Llegar desde «Instalar cliente…» es llegar a esa sección: se trae a la vista UNA vez,
 * cuando existe (la lista llega después de montar). Devuelve el pack que pidió la prueba.
 */
export function useSeccionClientes(s: SeccionClientes): DriverStatus | null {
  const { verClientes, drivers, requiere, abrirClientes, requiereDriver, clientesRef } = s
  const clientesALaVista = useRef(false)
  useEffect(() => {
    if (clientesALaVista.current || !(abrirClientes || requiereDriver)) return
    const el = clientesRef.current
    if (!el) return
    clientesALaVista.current = true
    el.scrollIntoView({ block: 'nearest' })
  }, [verClientes, drivers, abrirClientes, requiereDriver, clientesRef])
  return useMemo(
    () => (requiere ? (drivers.find((d) => d.id === requiere.packId) ?? null) : null),
    [requiere, drivers]
  )
}

/** «Confiar en el certificado y probar»: la prueba sale en el render que ya lleva la casilla marcada. */
export function useProbarTrasEditar(
  probarTrasEditar: boolean,
  setProbarTrasEditar: Setter<boolean>,
  probar: () => Promise<void>
): void {
  useEffect(() => {
    if (!probarTrasEditar) return
    setProbarTrasEditar(false)
    void probar()
    // `probar` se lee del render actual a propósito: es el que ya lleva la casilla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probarTrasEditar])
}
