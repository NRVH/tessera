// =============================================================================
// Selector de esquema de la consola SQL: qué esquema se enseña (sesión > elegido >
// conexión), qué dice su botón y qué opciones ofrece su popover («Esquema de la conexión
// (X)» primero, PUBLIC nunca, los del sistema al final y atenuados). Donde se elige la
// base y no el esquema, las mismas reglas valen para las bases. Puro: el popover pinta.
// Decisiones: docs/decisiones/bd/ui-consola-estado.md
// =============================================================================

import type { DbEsquema, DbEstadoSesion } from '../../../../../shared/db-explorador-ipc'

export interface OpcionEsquemaConsola {
  /** `null` = «Esquema de la conexión» (se manda `null` a `esquemaConsola`). */
  esquema: string | null
  /** Lo que se lee en la fila. */
  texto: string
  /** Esquema del sistema: al final y atenuado. */
  sistema: boolean
  /** Es el que la consola usa ahora. */
  actual: boolean
}

/** Etiqueta de la opción que vuelve al esquema de la conexión. */
export function textoEsquemaConexion(porDefecto: string | null): string {
  return porDefecto ? `Esquema de la conexión (${porDefecto})` : 'Esquema de la conexión'
}

/**
 * El esquema que la consola usa (o usará al abrir su sesión): el de la sesión, el
 * elegido o el de la conexión, por ese orden: la sesión manda porque el main la relee tras
 * un cambio a mano (`ALTER SESSION`, `SET search_path`). null si no se sabe.
 */
export function esquemaEfectivo(
  sesion: Pick<DbEstadoSesion, 'esquema' | 'fase'> | null,
  elegido: string | null,
  porDefecto: string | null
): string | null {
  if (sesion && sesion.fase !== 'cerrada' && sesion.esquema) return sesion.esquema
  return elegido ?? porDefecto ?? null
}

/** `title` del botón de la barra. */
export function tituloBotonEsquema(actual: string | null, ejecutando: boolean): string {
  if (ejecutando) return 'Espera a que termine la ejecución para cambiar el esquema'
  return actual ? `Esquema: ${actual}. Pulsa para cambiar` : 'Esquema de la consola. Pulsa para cambiar'
}

/**
 * Las opciones del popover, ya filtradas (subcadena sin mayúsculas): primero
 * «Esquema de la conexión (X)», luego los esquemas normales en su orden y los del
 * sistema al final. PUBLIC (pseudo) nunca.
 * `actual` marca la opción VIGENTE: la de la conexión si no se eligió nada y la
 * consola está en el de la conexión; si no, la fila del esquema en que está
 * (`efectivo`), que puede no ser el elegido si el usuario hizo un ALTER SESSION a
 * mano: el popover enseña dónde se está, no lo que se pidió.
 */
export function opcionesEsquemaConsola(
  esquemas: readonly DbEsquema[] | null,
  porDefecto: string | null,
  elegido: string | null,
  efectivo: string | null,
  filtro: string,
  /**
   * El texto de la primera opción. Con nivel «Bases» (SQL Server) la
   * lista es de BASES y dice «Base de la conexión (X)» (`textosSelectorConsola` de
   * `nivelBasesBd.ts`); por defecto, el de siempre.
   */
  textoDeLaConexion: (porDefecto: string | null) => string = textoEsquemaConexion
): OpcionEsquemaConsola[] {
  const f = filtro.trim().toLowerCase()
  const coincide = (t: string): boolean => f === '' || t.toLowerCase().indexOf(f) !== -1
  const enLaDeConexion = elegido === null && (efectivo === null || efectivo === porDefecto)
  const out: OpcionEsquemaConsola[] = []
  if (f === '' || (porDefecto !== null && coincide(porDefecto))) {
    out.push({ esquema: null, texto: textoDeLaConexion(porDefecto), sistema: false, actual: enLaDeConexion })
  }
  const lista = (esquemas ?? []).filter((x) => x.pseudo !== true && coincide(x.nombre))
  const normales = lista.filter((x) => !x.sistema)
  const sistema = lista.filter((x) => x.sistema)
  for (const x of normales.concat(sistema)) {
    out.push({
      esquema: x.nombre,
      texto: x.nombre,
      sistema: x.sistema,
      actual: !enLaDeConexion && x.nombre === efectivo
    })
  }
  return out
}

/** Dónde abre el cursor del popover: en la opción vigente, o en la primera. */
export function indiceInicialEsquema(opciones: readonly OpcionEsquemaConsola[]): number {
  const i = opciones.findIndex((o) => o.actual)
  return i >= 0 ? i : 0
}
