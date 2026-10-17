// =============================================================================
// Pruebas de `agentesDelProyecto.ts`: qué pestañas tiene un proyecto según su modo (nativos de
// todo el equipo, Docker del perfil), ocultar cualquiera por perfil, el orden del perfil, las de la
// terminal (solo los manuales marcados), la identidad estable, el agente a mostrar y el chip del mosaico.
// Uso: node src/renderer/src/features/agentes/test-agentes-del-proyecto.mts
// =============================================================================

import {
  agenteAMostrar,
  agentesDelPerfil,
  agentesDelProyecto,
  casillasDeOcultar,
  idsManualesOcupados,
  todasDelProyecto,
  definicionDe,
  pestanasDeLaTerminal,
  pestanasEstables,
  sePuedeOcultar,
  siguienteAgente,
  type FuenteAgentes
} from './agentesDelProyecto.ts'
import type { DefinicionAgente } from '../../../../shared/agentesManuales.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

const nativo: DefinicionAgente = { id: 'm-nutria', nombre: 'Nutria', comando: 'nutria' }
const nativoTerminal: DefinicionAgente = { id: 'm-ops', nombre: 'Ops', comando: 'ops', enTerminal: true }
const docker: DefinicionAgente = { id: 'm-orca', nombre: 'Orca', comando: 'orca', instalacion: 'pip install orca-chat' }
const f: FuenteAgentes = {
  nativos: [nativo, nativoTerminal],
  dockerPorPerfil: { trabajo: [docker] },
  ocultosPorPerfil: { trabajo: ['codex'] },
  ordenPorPerfil: {}
}

hr('(1) Pestañas por modo y perfil')
const j = (x: unknown): string => JSON.stringify(x)
check('nativo: de serie y los nativos de todo el equipo', j(agentesDelProyecto(f, 'personal', true)) === j(['claude-code', 'codex', 'm-nutria', 'm-ops']), j(agentesDelProyecto(f, 'personal', true)))
check('Docker de otro perfil: solo los de serie', j(agentesDelProyecto(f, 'personal', false)) === j(['claude-code', 'codex']), j(agentesDelProyecto(f, 'personal', false)))
check('Docker de su perfil, con Codex oculto ahí', j(agentesDelProyecto(f, 'trabajo', false)) === j(['claude-code', 'm-orca']), j(agentesDelProyecto(f, 'trabajo', false)))
check('NEGATIVO: el Docker de un perfil no sale en nativo', !agentesDelProyecto(f, 'trabajo', true).includes('m-orca'), '')
check('la definición de un manual, la de su modo', definicionDe(f, 'trabajo', false, 'm-orca')?.comando === 'orca' && definicionDe(f, 'trabajo', true, 'm-orca') === null, '')
check('uno de serie no tiene definición', definicionDe(f, 'trabajo', true, 'claude-code') === null, '')

hr('(2) La terminal y la identidad')
const terminal = pestanasDeLaTerminal(f, 'personal').map((x) => x.id)
check('terminal: de serie y solo los manuales marcados', j(terminal) === j(['claude-code', 'codex', 'm-ops']), j(terminal))
check('misma fuente, mismo sitio: la MISMA lista', pestanasEstables(f, 'personal', 'proyecto-nativo') === pestanasEstables(f, 'personal', 'proyecto-nativo'), '')
check('otro sitio: otra lista', pestanasEstables(f, 'personal', 'proyecto-nativo') !== pestanasEstables(f, 'personal', 'terminal'), '')
const datos = pestanasEstables(f, 'trabajo', 'datos').map((x) => x.id)
check('espacio de datos: los dos de serie siempre', j(datos) === j(['claude-code', 'codex']), j(datos))
const nombres = pestanasEstables(f, 'trabajo', 'proyecto-docker').map((x) => `${x.nombre}/${x.corta}`)
check('nombres: el de serie con su abreviatura, el manual con el suyo', j(nombres) === j(['Claude Code/CC', 'Orca/Orca']), j(nombres))

hr('(3) Agente a mostrar, ocultar y el chip')
const disp = agentesDelProyecto(f, 'trabajo', false)
check('el elegido si está', agenteAMostrar(disp, 'm-orca') === 'm-orca', '')
check('el elegido oculto o de otro modo: el primero', agenteAMostrar(disp, 'codex') === 'claude-code' && agenteAMostrar(disp, 'm-nutria') === 'claude-code', '')
check('sin pestañas: null', agenteAMostrar([], 'codex') === null, '')
check('se puede ocultar si queda otro de serie', sePuedeOcultar(['claude-code', 'codex', 'm-orca'], 'claude-code'), '')
check('se puede ocultar el último de serie si queda un manual', sePuedeOcultar(['claude-code', 'm-orca'], 'claude-code'), '')
check('se puede ocultar un manual', sePuedeOcultar(['claude-code', 'm-orca'], 'm-orca'), '')
check('NEGATIVO: no la última pestaña, sea de serie o manual', !sePuedeOcultar(['claude-code'], 'claude-code') && !sePuedeOcultar(['m-orca'], 'm-orca'), '')
check('NEGATIVO: no uno que no está a la vista', !sePuedeOcultar(['claude-code', 'codex'], 'm-orca'), '')
check('el chip recorre también los manuales', siguienteAgente(disp, 'claude-code') === 'm-orca' && siguienteAgente(disp, 'm-orca') === 'claude-code', '')
check('con uno solo, no hay chip', siguienteAgente(['claude-code'], 'claude-code') === null, '')

hr('(4) Ocultar cualquiera, por perfil')
const sinSerie: FuenteAgentes = { ...f, ocultosPorPerfil: { trabajo: ['claude-code', 'codex'] } }
check('ocultos los dos de serie, queda el manual de su modo', j(agentesDelProyecto(sinSerie, 'trabajo', false)) === j(['m-orca']), j(agentesDelProyecto(sinSerie, 'trabajo', false)))
check('ocultos los dos de serie, en nativo quedan los manuales nativos', j(agentesDelProyecto(sinSerie, 'trabajo', true)) === j(['m-nutria', 'm-ops']), j(agentesDelProyecto(sinSerie, 'trabajo', true)))
check('lo oculto es del perfil: otro perfil sigue viéndolos', j(agentesDelProyecto(sinSerie, 'personal', false)) === j(['claude-code', 'codex']), j(agentesDelProyecto(sinSerie, 'personal', false)))
const todoOculto: FuenteAgentes = { ...f, ocultosPorPerfil: { trabajo: ['claude-code', 'codex', 'm-orca'] } }
check('si en un modo no queda ninguno, vuelven los de serie (un proyecto nunca se queda sin agente)',
  j(agentesDelProyecto(todoOculto, 'trabajo', false)) === j(['claude-code', 'codex']), j(agentesDelProyecto(todoOculto, 'trabajo', false)))
const manualOculto: FuenteAgentes = { ...f, ocultosPorPerfil: { personal: ['m-nutria'] } }
check('un manual nativo oculto en un perfil', j(agentesDelProyecto(manualOculto, 'personal', true)) === j(['claude-code', 'codex', 'm-ops']), j(agentesDelProyecto(manualOculto, 'personal', true)))
check('todas las del proyecto incluyen la oculta', todasDelProyecto(manualOculto, 'personal', true).some((x) => x.id === 'm-nutria'), '')
check('la terminal también respeta lo oculto', j(pestanasDeLaTerminal({ ...f, ocultosPorPerfil: { personal: ['m-ops'] } }, 'personal').map((x) => x.id)) === j(['claude-code', 'codex']), '')

hr('(5) Orden por perfil')
const ordenada: FuenteAgentes = { ...f, ocultosPorPerfil: {}, ordenPorPerfil: { trabajo: ['m-orca', 'codex', 'm-nutria'] } }
check('Docker: el orden del perfil, y lo que falta detrás en su orden de siempre',
  j(agentesDelProyecto(ordenada, 'trabajo', false)) === j(['m-orca', 'codex', 'claude-code']), j(agentesDelProyecto(ordenada, 'trabajo', false)))
check('nativo: el mismo orden aplicado a sus agentes; un id de otro modo no estorba',
  j(agentesDelProyecto(ordenada, 'trabajo', true)) === j(['codex', 'm-nutria', 'claude-code', 'm-ops']), j(agentesDelProyecto(ordenada, 'trabajo', true)))
check('el orden es del perfil: otro perfil, el de siempre', j(agentesDelProyecto(ordenada, 'personal', true)) === j(['claude-code', 'codex', 'm-nutria', 'm-ops']), '')
const perfil = agentesDelPerfil({ ...ordenada, ocultosPorPerfil: { trabajo: ['codex'] } }, 'trabajo')
check('la lista del perfil: todos, en su orden, con su modo y si están ocultos',
  j(perfil.map((x) => `${x.pestana.id}/${x.modo}/${x.oculto ? 'oculto' : 'visible'}`)) ===
    j(['m-orca/docker/visible', 'codex/serie/oculto', 'm-nutria/nativo/visible', 'claude-code/serie/visible', 'm-ops/nativo/visible']),
  j(perfil.map((x) => `${x.pestana.id}/${x.modo}/${x.oculto}`)))
const choque: FuenteAgentes = { ...f, dockerPorPerfil: { trabajo: [{ ...docker, id: 'm-nutria' }] } }
check('un id repetido entre nativos y Docker sale una vez en la lista del perfil',
  agentesDelPerfil(choque, 'trabajo').filter((x) => x.pestana.id === 'm-nutria').length === 1, '')

hr('(6) Casillas de mostrar u ocultar: el estado guardado, no el respaldo')
const casillas = (fu: FuenteAgentes, hostMode: boolean): string[] =>
  casillasDeOcultar(todasDelProyecto(fu, 'trabajo', hostMode), fu.ocultosPorPerfil.trabajo ?? []).map((c) => `${c.x.id}:${c.mostrado ? 'si' : 'no'}${c.bloqueada ? ':bloq' : ''}`)
check('todo oculto en Docker: salen los de serie por el respaldo, pero sus casillas van SIN marcar',
  j(casillas(todoOculto, false)) === j(['claude-code:no', 'codex:no', 'm-orca:no']), j(casillas(todoOculto, false)))
check('con uno sin ocultar, ese es el último y no se puede desmarcar', j(casillas(sinSerie, false)) === j(['claude-code:no', 'codex:no', 'm-orca:si:bloq']), j(casillas(sinSerie, false)))
check('lo normal: marcadas las no ocultas', j(casillas(f, false)) === j(['claude-code:si', 'codex:no', 'm-orca:si']), j(casillas(f, false)))

hr('(7) Ids de manuales: únicos entre nativos y Docker de todos los perfiles')
const ocupados = idsManualesOcupados({ nativos: [nativo], dockerPorPerfil: { trabajo: [docker], otro: [{ ...docker, id: 'm-pez' }] } })
check('cuenta nativos y Docker de todos los perfiles', j(ocupados.sort()) === j(['m-nutria', 'm-orca', 'm-pez']), j(ocupados))
check('sin el que se edita', !idsManualesOcupados({ nativos: [nativo], dockerPorPerfil: { trabajo: [docker] } }, 'm-orca').includes('m-orca'), '')

const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
