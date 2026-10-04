// =============================================================================
// Lo que se puede poner en una casilla del mosaico: UNA fila por proyecto abierto
// (hibernados incluidos), con el agente que se ofrece y su estado. La misma lista
// alimenta el selector «N de M» de la barra y el menú de destinos de cada casilla.
// =============================================================================
import type { Agente } from '../../../../main/profiles/types'
import { ordenarCandidatos, type CandidatoMosaico, type OpcionMosaico } from './mosaicoTeselas'

/** Entrada del cálculo de opciones. */
export interface EntradaOpciones {
  candidatos: CandidatoMosaico[]
  teselas: readonly string[]
  vivas: ReadonlySet<string>
  perfiles: ReadonlyMap<string, { nombre: string }>
  nombresProyecto: Record<string, string>
  tintasPorPerfil: Record<string, string>
  hibernados: ReadonlySet<string>
  trabajando: ReadonlySet<string>
  sinVer: ReadonlySet<string>
  /** Qué agente se ofrece de un proyecto (el mismo orden que «abrir otro proyecto»). */
  agenteDelProyecto: (profileId: string, projectHostPath: string) => Agente
  claveProyecto: (profileId: string, projectHostPath: string) => string
}

/** Agrupa los candidatos por proyecto, en orden canónico. */
function porProyecto(e: EntradaOpciones): Map<string, CandidatoMosaico[]> {
  const mapa = new Map<string, CandidatoMosaico[]>()
  for (const c of ordenarCandidatos(e.candidatos)) {
    const pk = e.claveProyecto(c.profileId, c.projectHostPath)
    const lista = mapa.get(pk)
    if (lista) lista.push(c)
    else mapa.set(pk, [c])
  }
  return mapa
}

/** Una opción por proyecto abierto, con el agente que ya es casilla, trabaja, está sin ver o vivo. */
export function opcionesDelMosaico(e: EntradaOpciones): OpcionMosaico[] {
  const enRejilla = new Set(e.teselas)
  const opciones: OpcionMosaico[] = []
  for (const [proyectoKey, agentes] of porProyecto(e)) {
    const cual = e.agenteDelProyecto(agentes[0].profileId, agentes[0].projectHostPath)
    const elegido = agentes.find((c) => c.agente === cual) ?? agentes[0]
    opciones.push({
      key: elegido.key,
      profileId: elegido.profileId,
      projectHostPath: elegido.projectHostPath,
      proyectoKey,
      agenteId: elegido.agente,
      perfil: e.perfiles.get(elegido.profileId)?.nombre ?? elegido.profileId,
      proyecto: e.nombresProyecto[proyectoKey] ?? elegido.projectHostPath,
      agente: elegido.agente === 'claude-code' ? 'Claude Code' : 'Codex',
      agenteCorto: elegido.agente === 'claude-code' ? 'CC' : 'Cdx',
      color: e.tintasPorPerfil[elegido.profileId] ?? null,
      esCasilla: agentes.some((c) => enRejilla.has(c.key)),
      enMarcha: agentes.some((c) => e.vivas.has(c.key)),
      // Dormido se dice aparte: elegirlo levanta además su contenedor, que tarda.
      dormido: agentes.every((c) => e.hibernados.has(c.key)),
      trabajando: agentes.some((c) => e.trabajando.has(c.key)),
      sinVer: agentes.some((c) => e.sinVer.has(c.key))
    })
  }
  return opciones
}
