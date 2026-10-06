// =============================================================================
// Hibernación coherente de los targets de agente que NO son pestaña (el agente de datos y el de la
// terminal). Hibernar un perfil cierra en el main TODAS sus sesiones de agente, pero el modelo de
// pestañas solo marca sus proyectos: estos se marcan aquí al empezar la hibernación, para que su pane
// suelte la sesión muerta, y se desmarcan al volver a verse o con el botón «Despertar» de su pie. Lógica pura: solo hay `import type` de otras features
// y corre bajo `node` (`test-hibernacion-fuera-de-pestanas.mts`).
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import type { OpenAgentTarget } from '../pestanas'
import type { LugarAgente } from './textosMontajeBases'

/**
 * Al empezar a hibernarse un perfil (está en `ahora` y no estaba en `antes`), marca sus targets que no
 * son pestaña. Repetir con el mismo `ahora` no marca nada: así se puede llamar en cada cambio de los
 * targets sin volver a hibernar uno que el usuario ya despertó. Mismo conjunto si no hay nada que marcar.
 */
export function marcarAlHibernar(
  marcados: ReadonlySet<string>,
  antes: ReadonlySet<string>,
  ahora: ReadonlySet<string>,
  fueraDePestanas: readonly OpenAgentTarget[]
): ReadonlySet<string> {
  const empiezan = [...ahora].filter((perfil) => !antes.has(perfil))
  if (empiezan.length === 0) return marcados
  const nuevos = fueraDePestanas.filter((t) => empiezan.includes(t.profileId) && !marcados.has(t.key))
  if (nuevos.length === 0) return marcados
  const out = new Set(marcados)
  for (const t of nuevos) out.add(t.key)
  return out
}

/**
 * El target que se empieza a mirar deja de estar marcado y su pane abre una sesión nueva: se despierta
 * perezoso, solo al verse. Mismo conjunto si no estaba marcado.
 */
export function despertarAlVerse(marcados: ReadonlySet<string>, claveVista: string | null): ReadonlySet<string> {
  if (claveVista === null || !marcados.has(claveVista)) return marcados
  const out = new Set(marcados)
  out.delete(claveVista)
  return out
}

/**
 * ¿Se puede despertar a mano un target marcado? Solo uno que no es pestaña (a la pestaña la despierta
 * su clic) y cuando su perfil ya terminó de hibernarse: antes, el main aún está cerrando lo suyo.
 */
export function puedeDespertarseAMano(lugar: LugarAgente, hibernado: boolean, perfilHibernando: boolean): boolean {
  return hibernado && lugar !== 'proyecto' && !perfilHibernando
}

/** Olvida las marcas de los targets que ya no están abiertos (se cerró su agente). Mismo conjunto si no sobra ninguna. */
export function podarMarcas(marcados: ReadonlySet<string>, abiertos: readonly OpenAgentTarget[]): ReadonlySet<string> {
  if (marcados.size === 0) return marcados
  const vivos = new Set(abiertos.map((t) => t.key))
  if ([...marcados].every((k) => vivos.has(k))) return marcados
  return new Set([...marcados].filter((k) => vivos.has(k)))
}

/** Los hibernados que ve la columna: los de las pestañas más los marcados aquí. El MISMO conjunto sin marcas. */
export function unirHibernados(dePestanas: Set<string>, marcados: ReadonlySet<string>): Set<string> {
  if (marcados.size === 0) return dePestanas
  return new Set([...dePestanas, ...marcados])
}
