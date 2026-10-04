// =============================================================================
// Las acciones del diálogo de conexión: editar, «Pegar URI», elegir el archivo, guardar,
// probar (siempre lo GUARDADO) e instalar o registrar un cliente. Funciones que reciben
// el estado del render en curso (`ContextoAcciones`), igual que los cierres que eran.
// Decisiones: docs/decisiones/bd/ui-conexion-dialogo.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc'
import {
  borradorGuardado,
  conArchivoElegido,
  conUri,
  entradaDe,
  type BorradorConexion
} from './borradorConexion'
import { camposAMarcar, type CampoConexion, type CampoTextoFormulario, type FormularioMotor } from './camposConexion'
import { mensajeDeError } from './filasArbolBd'
import type { EstadoDrivers, EstadoFormularioConexion } from './useConexionDialogoEstado'

/** Lo que las acciones leen y escriben del render en curso. */
export interface ContextoAcciones {
  e: EstadoFormularioConexion
  d: EstadoDrivers
  descriptor: FormularioMotor
  cambios: boolean
  refDialogo: React.RefObject<HTMLDivElement>
  onGuardada?: (c: DbConnection, esNueva: boolean) => void
  onCerrar: () => void
}

/** Mezcla un parcial en el borrador. */
export function editarBorrador(c: ContextoAcciones, parcial: Partial<BorradorConexion>): void {
  c.e.setBorrador((b) => ({ ...b, ...parcial }))
}

/** Cambia un campo de texto del borrador. */
export function editarTextoBorrador(c: ContextoAcciones, campo: CampoTextoFormulario, valor: string): void {
  c.e.setBorrador((b) => ({ ...b, [campo]: valor }))
}

/**
 * «Pegar URI»: descompone la URI con el `uri` del motor y rellena el borrador (`conUri`).
 * Si no se puede, el motivo queda bajo el campo y lo pegado se queda para corregirlo; si se
 * puede, el campo se cierra y se vacía (lleva la contraseña) y se avisa de lo que se dejó fuera.
 */
export function aplicarUri(c: ContextoAcciones, texto: string): void {
  const esquema = c.descriptor.uri
  if (!esquema || texto.trim() === '') return
  const r = esquema.descomponer(texto)
  if (!r.ok) {
    c.e.setUri((u) => ({ ...u, texto, error: r.error }))
    return
  }
  c.e.setBorrador((b) => conUri(b, r.campos))
  c.e.setResultado(null)
  const fuera = r.campos.descartadas
  c.e.setUri({
    abierta: false,
    texto: '',
    error: null,
    aviso: fuera.length > 0 ? `Rellenado desde la URI. Estas opciones no se guardan y se dejaron fuera: ${fuera.join(', ')}.` : null
  })
}

/**
 * Elige (o crea) el archivo de un motor de archivo con el diálogo nativo del main. Vuelve
 * una FICHA y el nombre, nunca la ruta. Cancelar no toca nada; un archivo que no es de ese
 * motor (o no se deja leer) deja el error del main a la vista.
 */
export async function elegirArchivo(c: ContextoAcciones, crear: boolean): Promise<void> {
  const { e } = c
  if (e.eligiendo) return
  e.setError(null)
  e.setEligiendo(true)
  try {
    const motor = e.borrador.motor
    const r = crear ? await window.tessera.db.crearArchivo(motor) : await window.tessera.db.elegirArchivo(motor)
    if (r) {
      e.setBorrador((b) => (b.motor === motor ? conArchivoElegido(b, r) : b))
      e.setResultado(null)
    }
  } catch (err) {
    e.setError(mensajeDeError(err))
  } finally {
    e.setEligiendo(false)
  }
}

/** Lleva el foco a un campo del formulario por su `data-campo`. */
function enfocarCampo(c: ContextoAcciones, campo: CampoConexion): void {
  c.refDialogo.current?.querySelector<HTMLElement>(`[data-campo="${campo}"]`)?.focus()
}

/** Guarda el borrador. Devuelve lo guardado, o null si falló (el error queda a la vista). */
async function guardarBorrador(c: ContextoAcciones): Promise<DbConnection | null> {
  const { e } = c
  const borrador = e.borrador
  e.setError(null)
  e.setGuardando(true)
  e.setMarcarInvalidos(true)
  try {
    const entrada = entradaDe(borrador)
    const esNueva = borrador.id === undefined
    const conexion = borrador.id === undefined
      ? await window.tessera.db.create(entrada)
      : await window.tessera.db.update(borrador.id, entrada)
    const b = borradorGuardado(conexion)
    e.setBorrador(b)
    e.setOriginal(b)
    e.setGuardada(conexion)
    e.setMarcarInvalidos(false)
    c.onGuardada?.(conexion, esNueva)
    return conexion
  } catch (err) {
    e.setError(mensajeDeError(err))
    // El foco, al primer campo que el main rechaza. Si el motivo no es de un campo
    // (un nombre duplicado, una transacción pendiente), se queda donde estaba.
    const primero = camposAMarcar(borrador)[0]
    if (primero) enfocarCampo(c, primero)
    return null
  } finally {
    e.setGuardando(false)
  }
}

/** «Guardar»: sin cambios, cierra; con ellos, guarda y cierra si salió bien. */
export async function guardar(c: ContextoAcciones): Promise<void> {
  if (c.e.guardando) return
  if (!c.cambios) {
    c.onCerrar()
    return
  }
  const conexion = await guardarBorrador(c)
  if (conexion) c.onCerrar()
}

/** «Probar», o «Guardar y probar» si hay cambios: se prueba siempre lo GUARDADO. */
export async function probar(c: ContextoAcciones): Promise<void> {
  const { e, d } = c
  if (e.probando || e.guardando) return
  let id = e.borrador.id
  if (id === undefined || c.cambios) {
    const conexion = await guardarBorrador(c)
    if (!conexion) return
    id = conexion.id
  }
  e.setProbando(true)
  e.setResultado(null)
  try {
    const r = await window.tessera.db.test(id)
    e.setResultado(r)
    if (r.requiereDriver) {
      d.setRequiere(r.requiereDriver)
      d.setClientesAbierto(true)
    } else if (r.ok) {
      d.setRequiere(null)
    }
  } catch (err) {
    e.setResultado({ ok: false, mensaje: mensajeDeError(err) })
  } finally {
    e.setProbando(false)
  }
}

/** Descarga e instala un cliente; al terminar, recarga la lista y retira los fallos por falta de driver. */
export async function instalarDriver(c: ContextoAcciones, packId: string): Promise<void> {
  const { e, d } = c
  d.setInstalando(packId)
  e.setError(null)
  try {
    await window.tessera.db.driverInstall(packId)
    d.setDrivers(await window.tessera.db.driversList())
    d.setRequiere(null)
    e.setResultado(null)
  } catch (err) {
    e.setError(mensajeDeError(err))
  } finally {
    d.setInstalando(null)
    d.setProgreso(null)
  }
}

/** Registra un cliente que el usuario ya tiene descomprimido: la salida cuando la red bloquea la descarga. */
export async function usarDriverExistente(c: ContextoAcciones, packId: string): Promise<void> {
  const { e, d } = c
  e.setError(null)
  try {
    const ruta = await window.tessera.db.driverPickFolder()
    if (!ruta) return // canceló
    await window.tessera.db.driverUseExisting(packId, ruta)
    d.setDrivers(await window.tessera.db.driversList())
    d.setRequiere(null)
    e.setResultado(null)
  } catch (err) {
    e.setError(mensajeDeError(err))
  }
}
