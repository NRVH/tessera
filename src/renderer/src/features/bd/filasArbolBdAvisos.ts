// =============================================================================
// filasArbolBdAvisos — lo que dicen las tres superficies de conexiones (cabecera del árbol,
// área vacía y popover de montaje del agente) cuando no hay nada que abrir: sin perfil, sin
// conexiones, solo ajenas o un registro que no se puede usar (aviso persistente, altas
// apagadas con su porqué). Y si una familia ofrece consola. Puro; lo reexporta `filasArbolBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-filas-y-carga.md
// =============================================================================

import { descriptor, etiquetaMotor, extensionConsola } from '../../../../shared/motores/index.ts'
import { txFilasArbol } from './textosFilasArbol.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'

/**
 * Título del área vacía de un perfil que solo tiene ajenas, y motivo de los botones que el
 * lateral apaga entonces: SÍ hay conexiones (se ven); ninguna que esta versión pueda abrir.
 */
export const tituloSoloAjenas = (): string => txFilasArbol().tituloSoloAjenas

/** La pista de esa área vacía: no afirma ninguna causa (puede haber de varias); remite a cada fila. */
export const pistaSoloAjenas = (): string => txFilasArbol().pistaSoloAjenas

/**
 * El vacío del popover de montaje del agente: nada que ofrecer y nada montado. Con ajenas no
 * dice que el perfil no tiene conexiones (el árbol las enseña): remite al árbol.
 */
export function textoVacioMontaje(hayAjenas: boolean): string {
  const t = txFilasArbol()
  return hayAjenas ? t.vacioMontajeConAjenas(t.tituloSoloAjenas) : t.vacioMontajeSinConexiones
}

// --- El registro entero con un FORMATO que esta versión no reconoce (`formatoAjeno`) -----
// El main no interpreta NINGUNA entrada y las listas llegan vacías aunque el archivo esté
// lleno; la misma marca llega con un archivo que no se puede leer. El qué pasa y el qué hacer
// los dice el aviso del main (`aviso`); aquí va lo de la UI, sin nombrar la causa.

/** Título del aviso, el mismo en el árbol, el área vacía y el popover de montaje. */
export const tituloFormatoAjeno = (): string => txFilasArbol().tituloFormatoAjeno

/** Lo que pasa mientras tanto, detrás del aviso del main: sobre todo, que no se pierde nada. */
export const notaFormatoAjeno = (): string => txFilasArbol().notaFormatoAjeno

/** El porqué de los botones que se apagan (Nueva conexión, Nueva consola, Refrescar…), sin causa. */
export const motivoFormatoAjeno = (): string => txFilasArbol().motivoFormatoAjeno

/** La nota del popover de montaje: allí importa que el MONTAJE se conserva aunque no se pueda enseñar. */
export const notaMontajeFormatoAjeno = (): string => txFilasArbol().notaMontajeFormatoAjeno

/**
 * El porqué de cada botón de la cabecera del árbol que se apaga, o `null` si está vivo. Sin
 * perfil manda eso; luego el formato ajeno, que apaga también las ALTAS (el main las rechazaría).
 * Con solo ajenas SÍ hay conexiones: lo que no hay es ninguna que refrescar o desplegar.
 */
export function motivosCabeceraArbol(e: {
  perfilId: string | null
  conexiones: number
  ajenas: number
  avisoFormato: string | null
}): { nuevaConexion: string | null; nuevaConsola: string | null; sinConexiones: string | null } {
  const t = txFilasArbol()
  const sinPerfil = e.perfilId === null ? t.abrePerfil : null
  const formato = e.avisoFormato !== null ? t.motivoFormatoAjeno : null
  return {
    nuevaConexion: sinPerfil ?? formato,
    nuevaConsola: sinPerfil ?? formato,
    sinConexiones:
      sinPerfil ?? formato ?? (e.conexiones > 0 ? null : e.ajenas > 0 ? t.tituloSoloAjenas : t.sinConexionesTodavia)
  }
}

/**
 * Por qué no se ofrece una consola en esta conexión, o null si se ofrece. Hoy todas las
 * familias tienen consola; es el sitio único que decide si una futura llega sin ella, por la
 * familia del descriptor y no comparando el motor.
 */
export function motivoSinConsola(c: Pick<DbConnection, 'motor'> | null | undefined): string | null {
  if (!c || extensionConsola(descriptor(c.motor)) !== null) return null
  return txFilasArbol().consolaNoDisponible(etiquetaMotor(c.motor))
}

/**
 * El área vacía de la vista Bases de datos con el perfil sin conexiones que abrir: su título,
 * su pista, la nota (solo con formato ajeno) y si ofrece «Nueva conexión…».
 */
export function vacioAreaSinConexiones(e: { hayAjenas: boolean; avisoFormato: string | null }): {
  titulo: string
  pista: string
  nota: string | null
  ofrecerAlta: boolean
} {
  const t = txFilasArbol()
  if (e.avisoFormato !== null) {
    return { titulo: t.tituloFormatoAjeno, pista: e.avisoFormato, nota: t.notaFormatoAjeno, ofrecerAlta: false }
  }
  if (e.hayAjenas) return { titulo: t.tituloSoloAjenas, pista: t.pistaSoloAjenas, nota: null, ofrecerAlta: true }
  return { titulo: t.sinConexionesTitulo, pista: t.sinConexionesPista, nota: null, ofrecerAlta: true }
}

/** Qué pinta el popover de montaje del agente (ver `vistaPopoverMontaje`). */
export type VistaPopoverMontaje =
  | { tipo: 'cargando' }
  | { tipo: 'formato'; aviso: string }
  | { tipo: 'vacio'; texto: string }
  | { tipo: 'lista' }

/**
 * El estado del popover de montaje del agente. Con formato ajeno, el aviso gana a todo menos a
 * «Cargando…». El vacío, solo sin conexiones y sin ninguna ajena montada (las montadas SÍ se
 * listan, para poder desmontarlas).
 */
export function vistaPopoverMontaje(e: {
  conexiones: readonly unknown[] | null
  ajenas: readonly { id: string }[]
  montadas: readonly string[]
  avisoFormato: string | null
}): VistaPopoverMontaje {
  if (e.conexiones === null) return { tipo: 'cargando' }
  if (e.avisoFormato !== null) return { tipo: 'formato', aviso: e.avisoFormato }
  if (e.conexiones.length === 0 && !e.ajenas.some((a) => e.montadas.includes(a.id))) {
    return { tipo: 'vacio', texto: textoVacioMontaje(e.ajenas.length > 0) }
  }
  return { tipo: 'lista' }
}
