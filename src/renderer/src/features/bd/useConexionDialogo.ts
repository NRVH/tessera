// =============================================================================
// useConexionDialogo: todo lo que `DbConexionDialogo` sabe y hace, en el orden fijo de
// sus hooks (formulario, foco de la URI, clientes, `useDialogo`, efectos). Devuelve la
// VISTA que pinta el componente y las acciones ya atadas al render en curso.
// Decisiones: docs/decisiones/bd/ui-conexion-dialogo.md
// =============================================================================

import type { DbConnection, DriverRequerido, DriverStatus } from '../../../../shared/db-ipc'
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
import { useDialogo, type Dialogo } from '../../comun/useDialogo'
import {
  useEstadoDrivers,
  useEstadoFormularioConexion,
  useFocoBotonUri,
  useListaDrivers,
  useOcultarPassword,
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
  conexion: DbConnection | null
  archivoInicial: ArchivoInicial | null
  abrirClientes: boolean
  requiereDriver: DriverRequerido | null
  onGuardada?: (c: DbConnection, esNueva: boolean) => void
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
  instalarDriver: (packId: string) => Promise<void>
  usarDriverExistente: (packId: string) => Promise<void>
}

/** Lo que pinta `DbConexionDialogo`. */
export interface VistaConexion {
  e: EstadoFormularioConexion
  d: EstadoDrivers
  dialogo: Dialogo
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
  packRequerido: DriverStatus | null
  /** Aviso de contraseña de lo guardado; desaparece en cuanto se escribe una nueva. */
  avisoPassword: string | null
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
    instalarDriver: (packId) => acciones.instalarDriver(c, packId),
    usarDriverExistente: (packId) => acciones.usarDriverExistente(c, packId)
  }
}

function avisoDePassword(e: EstadoFormularioConexion): string | null {
  const almacen = nombresSistema(window.tessera.plataforma).almacenSecretos
  return e.guardada && e.borrador.id !== undefined && !(e.borrador.password ?? '') ? avisoSecreto(e.guardada, almacen) : null
}

/** El estado, los efectos y las acciones del diálogo de conexión; el orden de declaración fija el de los efectos. */
export function useConexionDialogo(p: OpcionesConexionDialogo): VistaConexion {
  const e = useEstadoFormularioConexion(p.perfilId, p.conexion, p.archivoInicial)
  const botonUriRef = useFocoBotonUri(e.uri.abierta)
  const d = useEstadoDrivers(p.requiereDriver, p.abrirClientes)
  const dialogo = useDialogo({ onClose: p.onCerrar, cerrable: !e.guardando })
  const cambios = hayCambios(e.borrador, e.original)
  const descriptor = descriptorDe(e.borrador.motor)
  useOcultarPassword(e.borrador.id ?? 'nuevo', e.setVerPassword)
  useListaDrivers(d.setDrivers, d.setProgreso)
  const verClientes = mostrarClientes(e.borrador.motor, {
    drivers: d.drivers,
    requierePackId: d.requiere?.packId ?? null,
    abiertoPara: p.abrirClientes ? e.inicial.motor : null
  })
  const packRequerido = useSeccionClientes({
    verClientes,
    drivers: d.drivers,
    requiere: d.requiere,
    abrirClientes: p.abrirClientes,
    requiereDriver: p.requiereDriver,
    clientesRef: d.clientesRef
  })
  const a = atarAcciones({ e, d, descriptor, cambios, refDialogo: dialogo.ref, onGuardada: p.onGuardada, onCerrar: p.onCerrar })
  useProbarTrasEditar(e.probarTrasEditar, e.setProbarTrasEditar, a.probar)
  return {
    e, d, dialogo, botonUriRef, cambios, descriptor, a, verClientes, packRequerido,
    conCredenciales: pideUsuarioYClave(descriptorMotor(e.borrador.motor)),
    pistaCredencial: placeholderCredencial(e.borrador.motor),
    marcados: e.marcarInvalidos ? camposAMarcar(e.borrador) : [],
    verRequiere: d.requiere !== null && requiereAplica(e.borrador.motor, d.requiere.packId, d.drivers),
    avisoPassword: avisoDePassword(e)
  }
}
