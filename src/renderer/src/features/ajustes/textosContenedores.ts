// =============================================================================
// Textos de la categoría «Contenedores Docker» de Configuración, en español e inglés: el
// deslizador del límite con su semáforo y la política para hacer sitio al llegar a él. Se leen al
// usarse. Depende de `shared/i18n`.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'
import type { ColorSemaforo, PrimeroEnPararse } from '../../../../shared/semaforoContenedores.ts'

export const txContenedores = crearTextos(
  {
    grupoLimite: 'Contenedores a la vez',
    grupoLimiteAyuda:
      'Cuenta todo lo que abres en modo Docker: los agentes de los proyectos, el de la vista de bases de datos, el de la terminal y las terminales Docker. Un agente trabajando ocupa entre 0,3 y 1,5 GB.',
    limite: 'Límite de contenedores',
    sinLimite: 'Sin límite',
    sinLimiteHastaDocker: 'Sin límite hasta que Docker responda',
    contenedores: (n: number) => `${n} ${n === 1 ? 'contenedor' : 'contenedores'}`,
    color: { verde: 'Holgado', amarillo: 'Justo', rojo: 'Excesivo' } as Record<ColorSemaforo, string>,
    aviso: {
      verde: 'Tu equipo los mantiene trabajando a la vez con holgura.',
      amarillo:
        'Muy justo: con todos trabajando puede haber lentitud, agentes detenidos y cierres inesperados de Tessera.',
      rojo: 'Excesivo: con todos trabajando, alguno de sus agentes fallará a medio proceso. Te arriesgas a perder trabajo y a que Tessera se cierre.'
    } as Record<ColorSemaforo, string>,
    avisoSinLimite:
      'Sin límite no hay red: con todos trabajando, alguno de sus agentes fallará a medio proceso. Te arriesgas a perder trabajo y a que Tessera se cierre.',
    maquina: (gb: string, nucleos: number | null, recomendado: number) =>
      nucleos === null
        ? `Docker tiene ${gb} GB en este equipo: se recomiendan hasta ${recomendado}.`
        : `Docker tiene ${gb} GB y ${nucleos} ${nucleos === 1 ? 'núcleo' : 'núcleos'} en este equipo: se recomiendan hasta ${recomendado}.`,
    ahora: (vivos: number) => (vivos === 1 ? 'Ahora corre 1.' : `Ahora corren ${vivos}.`),
    noResponde: 'Docker no responde: el semáforo se calcula en cuanto vuelva.',
    usarRecomendado: 'Usar el recomendado',
    grupoPolitica: 'Al llegar al límite',
    politicaAyuda:
      'Antes de parar nada, Tessera para un contenedor que ya no tenga agentes. Lo que se para se hiberna: la conversación se retoma al volver, pero lo que estuviera haciendo se interrumpe. Si todos están protegidos, el agente nuevo no se abre y se explica por qué.',
    primero: {
      ultimos: {
        label: 'Los últimos que abriste',
        hint: 'Recomendado: protege los que llevan más tiempo con tareas largas.'
      },
      primeros: { label: 'Los primeros que abriste', hint: 'Se paran los más antiguos.' },
      inactivos: { label: 'Los que llevan más tiempo sin uso', hint: 'Se para el que lleva más sin entrada ni salida.' }
    } as Record<PrimeroEnPararse, { label: string; hint: string }>,
    proteger: 'No parar los que están trabajando mientras haya otro',
    protegerAyuda: 'Un agente que está produciendo salida no se interrumpe si hay otro que parar.',
    grupoSaturacion: 'Si Docker se satura',
    saturacionAyuda:
      'Tessera mide la memoria de todos los contenedores de Docker. Cuando pasa del umbral durante ese tiempo, hiberna un agente según «Al llegar al límite» (qué parar primero y si se protegen los que trabajan). Nunca para el que estás mirando ni uno manual. Si todos los que quedan están trabajando, para uno trabajando: con Docker sin memoria caería uno igual, sin elegir. La conversación se retoma al volver.',
    umbral: 'Se considera saturado con la memoria de Docker por encima del',
    umbralValor: (pct: number) => `${pct} %`,
    duracion: 'durante',
    duracionValor: (s: number) => (s < 60 ? `${s} s` : `${s / 60} min`),
    avisar: (s: number) => `Avisar ${s} s antes de parar, con la opción de elegir otro`,
    avisarAyuda: 'Si lo desmarcas, se para sin aviso.',
    grupoParadas: 'Últimas paradas',
    actualizar: 'Actualizar',
    sinParadas: 'Tessera no ha parado ningún contenedor.',
    motivoLimite: (n: number | null) =>
      n === null ? 'Límite de contenedores' : `Límite de ${n} ${n === 1 ? 'contenedor' : 'contenedores'}`,
    motivoSaturacion: (pct: number | null, umbral: number | null) =>
      pct === null || umbral === null ? 'Docker saturado' : `Docker al ${pct} % (umbral ${umbral} %)`,
    sinAgentes: 'un contenedor sin agentes',
    reglaProtege: 'protegiendo a los que trabajan',
    reglaNoProtege: 'sin proteger a los que trabajan'
  },
  {
    grupoLimite: 'Containers at once',
    grupoLimiteAyuda:
      'It counts everything you open in Docker mode: the project agents, the database view agent, the terminal agent and the Docker terminals. A working agent takes between 0.3 and 1.5 GB.',
    limite: 'Container limit',
    sinLimite: 'No limit',
    sinLimiteHastaDocker: 'No limit until Docker responds',
    contenedores: (n: number) => `${n} ${n === 1 ? 'container' : 'containers'}`,
    color: { verde: 'Comfortable', amarillo: 'Tight', rojo: 'Excessive' } as Record<ColorSemaforo, string>,
    aviso: {
      verde: 'Your computer keeps them all working at once with room to spare.',
      amarillo: 'Very tight: with all of them working there may be slowness, stopped agents and unexpected Tessera crashes.',
      rojo: 'Excessive: with all of them working, some of your agents will fail mid-task. You risk losing work and Tessera closing.'
    } as Record<ColorSemaforo, string>,
    avisoSinLimite:
      'With no limit there is no safety net: with all of them working, some of your agents will fail mid-task. You risk losing work and Tessera closing.',
    maquina: (gb: string, nucleos: number | null, recomendado: number) =>
      nucleos === null
        ? `Docker has ${gb} GB on this computer: up to ${recomendado} are recommended.`
        : `Docker has ${gb} GB and ${nucleos} ${nucleos === 1 ? 'core' : 'cores'} on this computer: up to ${recomendado} are recommended.`,
    ahora: (vivos: number) => `${vivos} running now.`,
    noResponde: 'Docker is not responding: the traffic light is calculated as soon as it is back.',
    usarRecomendado: 'Use the recommended',
    grupoPolitica: 'When the limit is reached',
    politicaAyuda:
      'Before stopping anything, Tessera stops a container that no longer has agents. What gets stopped is hibernated: the conversation resumes when you return, but whatever it was doing is interrupted. If all of them are protected, the new agent does not open and you are told why.',
    primero: {
      ultimos: {
        label: 'The most recent ones you opened',
        hint: 'Recommended: it protects the ones that have been on long tasks the longest.'
      },
      primeros: { label: 'The first ones you opened', hint: 'The oldest ones are stopped.' },
      inactivos: { label: 'The ones idle the longest', hint: 'The one with the longest time without input or output is stopped.' }
    } as Record<PrimeroEnPararse, { label: string; hint: string }>,
    proteger: 'Do not stop the ones that are working while there is another',
    protegerAyuda: 'An agent that is producing output is not interrupted if there is another one to stop.',
    grupoSaturacion: 'If Docker gets saturated',
    saturacionAyuda:
      'Tessera measures the memory used by all Docker containers. When it stays above the threshold for that long, it hibernates an agent following «When the limit is reached» (what to stop first and whether working agents are protected). It never stops the one you are looking at or a manual one. If all the remaining ones are working, it stops a working one: with Docker out of memory one would fall anyway, without a choice. The conversation resumes when you return.',
    umbral: 'Considered saturated when Docker memory is above',
    umbralValor: (pct: number) => `${pct}%`,
    duracion: 'for',
    duracionValor: (s: number) => (s < 60 ? `${s} s` : `${s / 60} min`),
    avisar: (s: number) => `Warn ${s} s before stopping, with the option to pick another`,
    avisarAyuda: 'If you clear it, the stop happens without a warning.',
    grupoParadas: 'Latest stops',
    actualizar: 'Refresh',
    sinParadas: 'Tessera has not stopped any container.',
    motivoLimite: (n: number | null) =>
      n === null ? 'Container limit' : `Limit of ${n} ${n === 1 ? 'container' : 'containers'}`,
    motivoSaturacion: (pct: number | null, umbral: number | null) =>
      pct === null || umbral === null ? 'Docker saturated' : `Docker at ${pct}% (threshold ${umbral}%)`,
    sinAgentes: 'a container with no agents',
    reglaProtege: 'protecting the ones that are working',
    reglaNoProtege: 'not protecting the ones that are working'
  }
)
