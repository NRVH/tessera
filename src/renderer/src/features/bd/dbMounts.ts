// =============================================================================
// dbMounts: modelo PURO de los montajes de bases de datos por proyecto, el mapa de
// `${profileId}|${projectHostPath}` a ids de conexión (persistido en los ajustes).
// Aquí vive la poda (partir la clave sin romper rutas de Windows, distinguir la basura
// de lo que solo lo parece) y los ids VIVOS con que podan `useBdApp` los montajes y
// las pestañas; con un registro de formato ajeno no se poda nada. Sin React ni IPC.
// Decisiones: docs/decisiones/bd/ui-area-estado-de-la-vista.md
// =============================================================================

export type DbMounts = Record<string, string[]>

/**
 * Perfil al que pertenece una clave de montaje. Se corta por el PRIMER `|` porque
 * la parte derecha es una ruta de Windows, que puede contener casi cualquier cosa;
 * el id de perfil no lleva `|`.
 */
export function perfilDeClave(clave: string): string {
  const i = clave.indexOf('|')
  return i < 0 ? clave : clave.slice(0, i)
}

/**
 * Quita un id de conexión de todos los proyectos de UN perfil. Se usa al ELIMINAR la
 * conexión. Solo los de ese perfil: la misma copia pegada en dos perfiles comparte id, y
 * borrar la de p2 no puede desmontar la original de p1 en sus proyectos. En el caso normal da lo mismo que quitarla en todos, porque una conexión es de
 * un solo perfil. Devuelve el MISMO objeto si no había nada que quitar, para no disparar
 * renders ni escrituras del archivo de ajustes sin motivo.
 */
export function quitarConexion(mounts: DbMounts, connectionId: string, profileId: string): DbMounts {
  let cambio = false
  const next: DbMounts = {}
  for (const [clave, ids] of Object.entries(mounts)) {
    if (perfilDeClave(clave) !== profileId) {
      next[clave] = ids
      continue
    }
    const limpios = ids.filter((id) => id !== connectionId)
    if (limpios.length !== ids.length) cambio = true
    // Un proyecto sin bases montadas se descarta en vez de guardar un array vacío.
    if (limpios.length > 0) next[clave] = limpios
  }
  return cambio ? next : mounts
}

/**
 * Los ids VIVOS de un perfil para la poda: las conexiones que esta versión conoce Y las
 * AJENAS (las que no sabe abrir; llegan con las conocidas en `db.listCompleta`). Una
 * ajena sigue en el registro —se conserva tal cual para la versión que la creó—, así
 * que su montaje no es basura: si la poda solo contara las conocidas, abrir Tessera en
 * una versión anterior le quitaría la base montada al proyecto, y al volver a la nueva
 * habría que montarla otra vez sin saber por qué desapareció. Sin repetidos (un id en
 * las dos listas sería un fallo del main, pero no debe duplicar nada aquí).
 */
export function idsVivosDePerfil(
  conocidas: readonly { id: string }[],
  ajenas: readonly { id: string }[]
): string[] {
  return [...new Set([...conocidas.map((c) => c.id), ...ajenas.map((a) => a.id)])]
}

/** Lo que la poda necesita de la respuesta de `db.listCompleta` de UN perfil. */
export interface ListaParaPoda {
  conexiones: readonly { id: string }[]
  ajenas: readonly { id: string }[]
  /** El registro entero tiene un formato que esta versión no reconoce (ver el ADR). */
  formatoAjeno: boolean
}

/**
 * Los ids vivos de cada perfil para `podarMontajes`, a partir de las respuestas de
 * `db.listCompleta`; o `null` si NO SE DEBE PODAR. Basta con que UNA traiga
 * `formatoAjeno`: el registro es uno solo para todos los perfiles, así que ninguna de sus
 * listas dice qué existe (ver el ADR). Con `null`, la poda de arranque no toca nada,
 * igual que cuando la lectura falla.
 */
export function vivosParaPodar(listas: readonly (readonly [string, ListaParaPoda])[]): Map<string, string[]> | null {
  if (listas.some(([, l]) => l.formatoAjeno)) return null
  return new Map(listas.map(([perfil, l]) => [perfil, idsVivosDePerfil(l.conexiones, l.ajenas)]))
}

/**
 * Las conexiones vivas de cada perfil para la poda de PESTAÑAS y SELECCIÓN de la vista
 * Bases de datos (`podarConexiones` de `dbVistaEstado`), a partir de lo que tiene leído
 * `useConexionesBd`: conocidas + ajenas (`idsVivosDePerfil`), y SIN los perfiles cuyo
 * registro vino con formato ajeno (`conFormatoAjeno`). `podarConexiones` deja intacto un
 * perfil que no esté en el mapa, así que quitarlo de aquí es no podarlo: sus listas vacías
 * no dicen que sus conexiones se borraran. Hoy el registro solo se lee al arrancar, y con
 * formato ajeno no llega a haber pestañas de conexión que cerrar; se salta igual, porque
 * esta poda no sabe de dónde viene la lista y la regla tiene que valer sin ese supuesto.
 */
export function vivasParaPodarPestanas(
  conexiones: ReadonlyMap<string, readonly { id: string }[]>,
  ajenas: ReadonlyMap<string, readonly { id: string }[]>,
  conFormatoAjeno: { has: (perfil: string) => boolean }
): Map<string, string[]> {
  const vivas = new Map<string, string[]>()
  for (const [perfil, lista] of conexiones) {
    if (conFormatoAjeno.has(perfil)) continue
    vivas.set(perfil, idsVivosDePerfil(lista, ajenas.get(perfil) ?? []))
  }
  return vivas
}

/**
 * Poda de arranque: descarta montajes que apunten a perfiles o conexiones que ya no
 * existen. `validosPorPerfil` mapea perfil -> ids de conexión vivos (los de
 * `vivosParaPodar`: las ajenas cuentan como vivas, y con un registro de formato ajeno ni
 * se llega a llamar).
 *
 * Lo que NO se poda, a propósito: las entradas de proyectos CERRADOS. Cerrar una
 * pestaña y reabrir el proyecto meses después debe recordar sus bases; eso es la
 * función, no basura. Solo se limpia lo que ya no puede existir.
 *
 * Un perfil AUSENTE del mapa se trata como desconocido y su entrada se descarta;
 * quien llame debe pasar TODOS los perfiles vivos (aunque sea con lista vacía), o
 * se perderían montajes buenos.
 */
export function podarMontajes(mounts: DbMounts, validosPorPerfil: Map<string, string[]>): DbMounts {
  let cambio = false
  const next: DbMounts = {}
  for (const [clave, montados] of Object.entries(mounts)) {
    const validos = validosPorPerfil.get(perfilDeClave(clave))
    if (!validos) {
      cambio = true // perfil borrado: fuera la entrada entera
      continue
    }
    const limpios = montados.filter((id) => validos.includes(id))
    if (limpios.length !== montados.length) cambio = true
    if (limpios.length > 0) next[clave] = limpios
  }
  return cambio ? next : mounts
}
