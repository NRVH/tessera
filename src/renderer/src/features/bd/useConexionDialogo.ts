// =============================================================================
// useConexionDialogo: todo lo que `DbConexionDialogo` sabe y hace, en el orden fijo de
// sus hooks (formulario, foco de la URI, clientes y efectos). Devuelve la
// VISTA que pinta el componente y las acciones ya atadas al render en curso.
// Decisiones: docs/decisiones/bd/ui-conexion-dialogo.md
// =============================================================================

import { useRef } from 'react'
import type { ConexionBd, DriverRequerido, EstadoDriver } from '../../../../shared/db-ipc'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { descriptor as descriptorMotor, pideUsuarioYClave } from '../../../../shared/motores/index'
import { hayCambios, type BorradorConexion } from './borradorConexion'
import {
  camposAMarcar,
  descriptorDe,
  mostrarClientes,
  placeholderCredencial,
  requiereAplica,
  type CampoConexion,
  type CampoTextoFormulario,
  type DefCampo,
  type FormularioMotor
} from './camposConexion'
import { avisoSecreto } from './filasArbolBd'
import {
  useEstadoDrivers,
  useEstadoFormularioConexion,
  useFocoBotonUri,
  useListaDrivers,
  useOcultarContrasena,
  useProbarTrasEditar,
  useSeccionClientes,
  type ArchivoInicial,
  type EstadoDrivers,
  type EstadoFormularioConexion
} from './useConexionDialogoEstado'
import * as acciones from './useConexionDialogoAcciones'

/** Las props del diálogo, ya con sus valores por defecto. */
export interface OpcionesConexionDialogo {
  perfilId: string
  conexion: ConexionBd | null
  archivoInicial: ArchivoInicial | null
  abrirClientes: boolean
  requiereDriver: DriverRequerido | null
  onGuardada?: (c: ConexionBd, esNueva: boolean) => void
  onCerrar: () => void
}

/** Las acciones del diálogo, atadas al render en curso. */
export interface AccionesConexion {
  editar: (parcial: Partial<BorradorConexion>) => void
  editarTexto: (campo: CampoTextoFormulario, valor: string) => void
  aplicarUri: (texto: string) => void
  elegirArchivo: (crear: boolean) => Promise<void>
  guardar: () => Promise<void>
  probar: () => Promise<void>
  instalarDriver: (paqueteDriverId: string) => Promise<void>
  usarDriverExistente: (paqueteDriverId: string) => Promise<void>
}

/** Lo que pinta `DbConexionDialogo`. */
export interface VistaConexion {
  e: EstadoFormularioConexion
  d: EstadoDrivers
  camposRef: React.RefObject<HTMLDivElement>
  botonUriRef: React.RefObject<HTMLButtonElement>
  cambios: boolean
  descriptor: FormularioMotor
  /** Con usuario y contraseña; un motor de archivo no los tiene. */
  conCredenciales: boolean
  /** «opcional» en usuario y contraseña con un motor que no los exige. */
  pistaCredencial: string | undefined
  /** Lista de campos del FORMULARIO: la base de autenticación no es de la conexión, aunque nunca se marque. */
  marcados: readonly (CampoConexion | DefCampo['campo'])[]
  verClientes: boolean
  verRequiere: boolean
  paqueteDriverRequerido: EstadoDriver | null
  /** Aviso de contraseña de lo guardado; desaparece en cuanto se escribe una nueva. */
  avisoContrasena: string | null
  a: AccionesConexion
}

function atarAcciones(c: acciones.ContextoAcciones): AccionesConexion {
  return {
    editar: (parcial) => acciones.editarBorrador(c, parcial),
    editarTexto: (campo, valor) => acciones.editarTextoBorrador(c, campo, valor),
    aplicarUri: (texto) => acciones.aplicarUri(c, texto),
    elegirArchivo: (crear) => acciones.elegirArchivo(c, crear),
    guardar: () => acciones.guardar(c),
    probar: () => acciones.probar(c),
    instalarDriver: (paqueteDriverId) => acciones.instalarDriver(c, paqueteDriverId),
    usarDriverExistente: (paqueteDriverId) => acciones.usarDriverExistente(c, paqueteDriverId)
  }
}

function avisoDeContrasena(e: EstadoFormularioConexion): string | null {
  const almacen = nombresSistema(window.tessera.plataforma).almacenSecretos
  return e.guardada && e.borrador.id !== undefined && !(e.borrador.password ?? '') ? avisoSecreto(e.guardada, almacen) : null
}

/** El estado, los efectos y las acciones del diálogo de conexión; el orden de declaración fija el de los efectos. */
export function useConexionDialogo(p: OpcionesConexionDialogo): VistaConexion {
  const e = useEstadoFormularioConexion(p.perfilId, p.conexion, p.archivoInicial)
  const botonUriRef = useFocoBotonUri(e.uri.abierta)
  const d = useEstadoDrivers(p.requiereDriver, p.abrirClientes)
  const camposRef = useRef<HTMLDivElement>(null)
  const cambios = hayCambios(e.borrador, e.original)
  const descriptor = descriptorDe(e.borrador.motor)
  useOcultarContrasena(e.borrador.id ?? 'nuevo', e.setVerContrasena)
  useListaDrivers(d.setDrivers, d.setProgreso)
  const verClientes = mostrarClientes(e.borrador.motor, {
    drivers: d.drivers,
    requierePaqueteDriverId: d.requiere?.packId ?? null,
    abiertoPara: p.abrirClientes ? e.inicial.motor : null
  })
  const paqueteDriverRequerido = useSeccionClientes({
    verClientes,
    drivers: d.drivers,
    requiere: d.requiere,
    abrirClientes: p.abrirClientes,
    requiereDriver: p.requiereDriver,
    clientesRef: d.clientesRef
  })
  const a = atarAcciones({ e, d, descriptor, cambios, refDialogo: camposRef, onGuardada: p.onGuardada, onCerrar: p.onCerrar })
  useProbarTrasEditar(e.probarTrasEditar, e.setProbarTrasEditar, a.probar)
  return {
    e, d, camposRef, botonUriRef, cambios, descriptor, a, verClientes, paqueteDriverRequerido,
    conCredenciales: pideUsuarioYClave(descriptorMotor(e.borrador.motor)),
    pistaCredencial: placeholderCredencial(e.borrador.motor),
    marcados: e.marcarInvalidos ? camposAMarcar(e.borrador) : [],
    verRequiere: d.requiere !== null && requiereAplica(e.borrador.motor, d.requiere.packId, d.drivers),
    avisoContrasena: avisoDeContrasena(e)
  }
}
