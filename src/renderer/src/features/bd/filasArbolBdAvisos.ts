// =============================================================================
// filasArbolBdAvisos — lo que dicen las tres superficies de conexiones (cabecera del árbol,
// área vacía y popover de montaje del agente) cuando no hay nada que abrir: sin perfil, sin
// conexiones, solo ajenas o un registro que no se puede usar (aviso persistente, altas
// apagadas con su porqué). Y si una familia ofrece consola. Puro; lo reexporta `filasArbolBd.ts`.
// Decisiones: docs/decisiones/bd/ui-arbol-filas-y-carga.md
// =============================================================================

import { descriptor, etiquetaMotor, extensionConsola } from '../../../../shared/motores/index.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'

/**
 * Título del área vacía de un perfil que solo tiene ajenas, y motivo de los botones que el
 * lateral apaga entonces: SÍ hay conexiones (se ven); ninguna que esta versión pueda abrir.
 */
export const TITULO_SOLO_AJENAS = 'Ninguna conexión que esta versión pueda abrir'

/** La pista de esa área vacía: no afirma ninguna causa (puede haber de varias); remite a cada fila. */
export const PISTA_SOLO_AJENAS =
  'Esta versión no sabe abrir las del árbol, y cada una dice por qué; se conservan tal cual. ' +
  'Actualiza Tessera si vienen de una más nueva, o crea una aquí.'

/**
 * El vacío del popover de montaje del agente: nada que ofrecer y nada montado. Con ajenas no
 * dice que el perfil no tiene conexiones (el árbol las enseña): remite al árbol.
 */
export function textoVacioMontaje(hayAjenas: boolean): string {
  return hayAjenas
    ? `${TITULO_SOLO_AJENAS}: la vista Bases de datos enseña las de este perfil atenuadas, ` +
        'cada una con su porqué. Crea allí una para montarla.'
    : 'Este perfil no tiene conexiones. Añádelas en la vista Bases de datos.'
}

// --- El registro entero con un FORMATO que esta versión no reconoce (`formatoAjeno`) -----
// El main no interpreta NINGUNA entrada y las listas llegan vacías aunque el archivo esté
// lleno; la misma marca llega con un archivo que no se puede leer. El qué pasa y el qué hacer
// los dice el aviso del main (`aviso`); aquí va lo de la UI, sin nombrar la causa.

/** Título del aviso, el mismo en el árbol, el área vacía y el popover de montaje. */
export const TITULO_FORMATO_AJENO = 'No se puede usar el registro de conexiones'

/** Lo que pasa mientras tanto, detrás del aviso del main: sobre todo, que no se pierde nada. */
export const NOTA_FORMATO_AJENO =
  'Mientras tanto no se ve ninguna conexión ni se pueden crear, pero no se pierde nada: ' +
  'el archivo no se modifica y las bases montadas en los proyectos se conservan.'

/** El porqué de los botones que se apagan (Nueva conexión, Nueva consola, Refrescar…), sin causa. */
export const MOTIVO_FORMATO_AJENO = 'No disponible: no se puede usar el registro de conexiones'

/** La nota del popover de montaje: allí importa que el MONTAJE se conserva aunque no se pueda enseñar. */
export const NOTA_MONTAJE_FORMATO_AJENO =
  'Las bases montadas aquí se conservan tal cual: vuelven a estar disponibles en cuanto ' +
  'Tessera pueda leer el registro.'

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
  const sinPerfil = e.perfilId === null ? 'Abre un perfil para usar las bases de datos' : null
  const formato = e.avisoFormato !== null ? MOTIVO_FORMATO_AJENO : null
  return {
    nuevaConexion: sinPerfil ?? formato,
    nuevaConsola: sinPerfil ?? formato,
    sinConexiones:
      sinPerfil ?? formato ?? (e.conexiones > 0 ? null : e.ajenas > 0 ? TITULO_SOLO_AJENAS : 'Todavía no hay conexiones')
  }
}

/**
 * Por qué no se ofrece una consola en esta conexión, o null si se ofrece. Hoy todas las
 * familias tienen consola; es el sitio único que decide si una futura llega sin ella, por la
 * familia del descriptor y no comparando el motor.
 */
export function motivoSinConsola(c: Pick<DbConnection, 'motor'> | null | undefined): string | null {
  if (!c || extensionConsola(descriptor(c.motor)) !== null) return null
  return `La consola de ${etiquetaMotor(c.motor)} todavía no está disponible en esta versión.`
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
  if (e.avisoFormato !== null) {
    return { titulo: TITULO_FORMATO_AJENO, pista: e.avisoFormato, nota: NOTA_FORMATO_AJENO, ofrecerAlta: false }
  }
  if (e.hayAjenas) return { titulo: TITULO_SOLO_AJENAS, pista: PISTA_SOLO_AJENAS, nota: null, ofrecerAlta: true }
  return { titulo: 'Sin conexiones', pista: 'Crea la primera para explorar sus datos.', nota: null, ofrecerAlta: true }
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
