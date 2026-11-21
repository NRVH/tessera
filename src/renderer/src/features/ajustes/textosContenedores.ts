// =============================================================================
// Textos de la categoría «Contenedores Docker» de Configuración, en español e inglés: el
// deslizador del límite con su semáforo y la política para hacer sitio al llegar a él. Se leen al
// usarse. Depende de `shared/i18n`.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'
import type { ColorSemaforo, PrimeroEnPararse } from '../../../../shared/semaforoContenedores.ts'

export const txContenedores = crearTextos(
  {
    grupoLimite: 'Contenedores simultáneos',
    grupoLimiteAyuda:
      'Incluye todo lo que se abre en modo Docker: los agentes de los proyectos y el agente de la vista de bases de datos. Un agente trabajando ocupa entre 0,3 y 1,5 GB.',
    limite: 'Límite de contenedores',
    sinLimite: 'Sin límite',
    recomendado: (n: number) => `Recomendado: ${n}`,
    sinLimiteHastaDocker: 'Sin límite hasta que Docker responda',
    contenedores: (n: number) => `${n} ${n === 1 ? 'contenedor' : 'contenedores'}`,
    color: { verde: 'Holgado', amarillo: 'Justo', rojo: 'Excesivo' } as Record<ColorSemaforo, string>,
    aviso: {
      verde: 'Su equipo puede mantenerlos todos trabajando al mismo tiempo con holgura.',
      amarillo:
        'Muy justo: si todos trabajan al mismo tiempo, puede haber lentitud, agentes detenidos y cierres inesperados de Tessera.',
      rojo: 'Excesivo: si todos trabajan al mismo tiempo, alguno de sus agentes fallará a mitad de una tarea. Puede perderse trabajo y Tessera puede cerrarse.'
    } as Record<ColorSemaforo, string>,
    avisoSinLimite:
      'Sin límite no hay protección: si todos trabajan al mismo tiempo, alguno de sus agentes fallará a mitad de una tarea. Puede perderse trabajo y Tessera puede cerrarse.',
    maquina: (gb: string, nucleos: number | null, recomendado: number) =>
      nucleos === null
        ? `Docker tiene ${gb} GB en este equipo: se recomiendan hasta ${recomendado}.`
        : `Docker tiene ${gb} GB y ${nucleos} ${nucleos === 1 ? 'núcleo' : 'núcleos'} en este equipo: se recomiendan hasta ${recomendado}.`,
    ahora: (vivos: number) => (vivos === 1 ? 'Ahora hay 1 en ejecución.' : `Ahora hay ${vivos} en ejecución.`),
    noResponde: 'Docker no responde: el semáforo se calculará en cuanto Docker vuelva a responder.',
    usarRecomendado: 'Usar el valor recomendado',
    grupoPolitica: 'Al llegar al límite',
    politicaAyuda:
      'Para abrir otro agente cuando ya no hay espacio disponible, Tessera detiene un contenedor. Comienza por uno sin agentes; si no hay ninguno, aplica la opción elegida aquí. Los agentes del contenedor detenido se hibernan: la conversación se conserva, pero se interrumpe lo que estuvieran haciendo.',
    primero: {
      ultimos: {
        etiqueta: 'El último contenedor abierto',
        pista: 'Recomendado: suele tener menos trabajo en curso que los contenedores abiertos antes.'
      },
      primeros: { etiqueta: 'El primer contenedor abierto', pista: 'Es el que lleva más tiempo abierto; puede tener una tarea larga en curso.' },
      inactivos: { etiqueta: 'El contenedor con más tiempo sin actividad', pista: 'Es aquel cuyos agentes llevan más tiempo sin recibir ni mostrar nada.' }
    } as Record<PrimeroEnPararse, { etiqueta: string; pista: string }>,
    proteger: 'No detener contenedores con agentes trabajando',
    protegerAyuda: 'Si todos tienen agentes trabajando, el agente nuevo no se abre y Tessera explica el motivo.',
    grupoSaturacion: 'Si Docker se satura',
    saturacionAyuda:
      'Tessera mide la memoria de todos los contenedores de Docker. Si supera el umbral durante el tiempo indicado, hiberna un agente según "Al llegar al límite" (qué contenedor detener primero y si se protegen los que están trabajando). Nunca detiene el agente visible en pantalla ni un agente propio. Si todos los restantes están trabajando, detiene uno que esté trabajando: con Docker sin memoria, uno fallaría de todos modos y sin que usted pudiera elegir cuál. La conversación se reanuda cuando usted vuelve al agente.',
    umbral: 'Se considera saturado con la memoria de Docker por encima del',
    umbralValor: (pct: number) => `${pct} %`,
    duracion: 'durante',
    duracionValor: (s: number) => (s < 60 ? `${s} s` : `${s / 60} min`),
    avisar: (s: number) => `Avisar ${s} s antes de detener, con la opción de elegir otro`,
    avisarAyuda: 'Si se desmarca, el contenedor se detiene sin aviso.',
    grupoParadas: 'Últimos contenedores detenidos',
    actualizar: 'Refrescar',
    sinParadas: 'Tessera no ha detenido ningún contenedor.',
    motivoLimite: (n: number | null) =>
      n === null ? 'Límite de contenedores' : `Límite de ${n} ${n === 1 ? 'contenedor' : 'contenedores'}`,
    motivoSaturacion: (pct: number | null, umbral: number | null) =>
      pct === null || umbral === null ? 'Docker saturado' : `Docker al ${pct} % (umbral ${umbral} %)`,
    sinAgentes: 'un contenedor sin agentes',
    reglaProtege: 'protegiendo a los que trabajan',
    reglaNoProtege: 'sin proteger a los que trabajan'
  },
  {
    grupoLimite: 'Simultaneous containers',
    grupoLimiteAyuda:
      'It counts everything you open in Docker mode: the project agents and the database view agent. A working agent takes between 0.3 and 1.5 GB.',
    limite: 'Container limit',
    sinLimite: 'No limit',
    recomendado: (n: number) => `Recommended: ${n}`,
    sinLimiteHastaDocker: 'No limit until Docker responds',
    contenedores: (n: number) => `${n} ${n === 1 ? 'container' : 'containers'}`,
    color: { verde: 'Comfortable', amarillo: 'Tight', rojo: 'Excessive' } as Record<ColorSemaforo, string>,
    aviso: {
      verde: 'Your computer can run them all at once with room to spare.',
      amarillo: 'Very tight: with all of them working, expect slowdowns, stopped agents and unexpected Tessera crashes.',
      rojo: 'Excessive: with all of them working, some of your agents will fail mid-task. You may lose work, and Tessera may close.'
    } as Record<ColorSemaforo, string>,
    avisoSinLimite:
      'With no limit, nothing protects you: with all of them working, some of your agents will fail mid-task. You may lose work, and Tessera may close.',
    maquina: (gb: string, nucleos: number | null, recomendado: number) =>
      nucleos === null
        ? `Docker has ${gb} GB on this computer: up to ${recomendado} are recommended.`
        : `Docker has ${gb} GB and ${nucleos} ${nucleos === 1 ? 'core' : 'cores'} on this computer: up to ${recomendado} are recommended.`,
    ahora: (vivos: number) => `${vivos} running now.`,
    noResponde: 'Docker is not responding: the indicator updates as soon as it responds.',
    usarRecomendado: 'Use recommended value',
    grupoPolitica: 'When the limit is reached',
    politicaAyuda:
      'To open another agent when there is no room left, Tessera stops a container. It starts with one that has no agents; if there is none, it uses the option you choose here. Its agents are hibernated: the conversation is kept, but whatever they were doing is interrupted.',
    primero: {
      ultimos: {
        etiqueta: 'The last container you opened',
        pista: 'Recommended: it usually has less work in progress than the ones you opened earlier.'
      },
      primeros: { etiqueta: 'The first container you opened', pista: 'It has been open the longest and may have a long task in progress.' },
      inactivos: { etiqueta: 'The container idle the longest', pista: 'Its agents have gone the longest without receiving or showing anything.' }
    } as Record<PrimeroEnPararse, { etiqueta: string; pista: string }>,
    proteger: 'Do not stop containers with working agents',
    protegerAyuda: 'If all of them have working agents, the new agent does not open and Tessera tells you why.',
    grupoSaturacion: 'If Docker gets saturated',
    saturacionAyuda:
      'Tessera measures the memory used by all Docker containers. When it stays above the threshold for that long, it hibernates an agent following "When the limit is reached" (what to stop first and whether working agents are protected). It never stops the agent on screen or a custom agent. If all the remaining ones are working, it stops a working one: with Docker out of memory, one would fail anyway, with no choice of which. The conversation resumes when you return.',
    umbral: 'Considered saturated when Docker memory is above',
    umbralValor: (pct: number) => `${pct}%`,
    duracion: 'for',
    duracionValor: (s: number) => (s < 60 ? `${s} s` : `${s / 60} min`),
    avisar: (s: number) => `Warn ${s} s before stopping, so you can choose another`,
    avisarAyuda: 'If you clear it, Tessera stops the agent without warning.',
    grupoParadas: 'Recently stopped containers',
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
