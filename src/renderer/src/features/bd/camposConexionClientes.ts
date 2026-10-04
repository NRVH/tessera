// =============================================================================
// Cuándo enseña el diálogo de conexión los CLIENTES DE BASE DE DATOS y el aviso de
// «falta este driver»: primero por el motor elegido (`conexion.usaClientes`) y luego
// por los motivos. También la ayuda de la sección, con las etiquetas del registro.
// Decisiones: docs/decisiones/bd/ui-conexion-clientes.md
// =============================================================================

import { IDS_MOTORES, descriptor, listaLegible } from '../../../../shared/motores/index.ts'
import type { DbMotor } from '../../../../shared/db-ipc.ts'

/** ¿Necesita el motor clientes de base de datos? (`conexion.usaClientes` de su descriptor.) */
export function usaClientes(motor: DbMotor): boolean {
  return descriptor(motor).conexion.usaClientes
}

/** Lo mínimo de un cliente (pack de driver) para saber de qué motor es. */
export interface ClienteDeMotor {
  id: string
  motor: DbMotor
}

/** Los clientes de ESE motor: los de otro no pintan nada en su formulario. */
export function driversDelMotor<T extends ClienteDeMotor>(motor: DbMotor, drivers: readonly T[]): T[] {
  return drivers.filter((d) => d.motor === motor)
}

/**
 * ¿El cliente que pidió la última prueba (o el árbol) va con el motor ELEGIDO? Si la
 * lista aún no ha llegado no se sabe de qué motor es, y se da por bueno mientras el
 * motor use clientes: el aviso viene de probar esta misma conexión.
 */
export function requiereAplica(motor: DbMotor, packId: string | null, drivers: readonly ClienteDeMotor[]): boolean {
  if (packId === null || !usaClientes(motor)) return false
  const pack = drivers.find((d) => d.id === packId)
  return pack === undefined || pack.motor === motor
}

/** Por qué podría enseñarse la sección «Clientes de base de datos». */
export interface MotivosClientes {
  /** La lista del main: cuentan los clientes del motor elegido. */
  drivers: readonly ClienteDeMotor[]
  /** Cliente que pidió la última prueba (o la fila de error del árbol), pendiente. */
  requierePackId: string | null
  /** Motor con el que se abrió el diálogo desde «Instalar cliente…», o null. */
  abiertoPara: DbMotor | null
}

/** ¿Se enseña la sección? Solo si el motor elegido usa clientes, y entonces por cualquiera de los motivos. */
export function mostrarClientes(motor: DbMotor, m: MotivosClientes): boolean {
  if (!usaClientes(motor)) return false
  return (
    driversDelMotor(motor, m.drivers).length > 0 ||
    requiereAplica(motor, m.requierePackId, m.drivers) ||
    m.abiertoPara === motor
  )
}

/** «X no necesita ninguno.» / «X e Y no necesitan ninguno.» para unas etiquetas de motor; '' sin ninguna. */
export function fraseSinClientes(etiquetas: readonly string[]): string {
  if (etiquetas.length === 0) return ''
  return `${listaLegible(etiquetas)} ${etiquetas.length === 1 ? 'no necesita' : 'no necesitan'} ninguno.`
}

/** La segunda frase de la ayuda de «Clientes de base de datos»: los motores del registro que no los usan. */
export function ayudaSinClientes(): string {
  return fraseSinClientes(IDS_MOTORES.filter((m) => !descriptor(m).conexion.usaClientes).map((m) => descriptor(m).etiqueta))
}
