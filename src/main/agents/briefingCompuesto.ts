// =============================================================================
// El aviso de arranque de un agente de serie del perfil, nativo o en contenedor: el de bases tal cual, como
// PREFIJO exacto, y detrás el de SSH, las reglas globales y las del perfil (sin su texto si la línea no cabría),
// el anuncio de `tctx docs` si hay documentos, el de `tctx buscar`, el de `tctx delegar` (o, en una tarea
// delegada, el de subagente) y el del traspaso. Puro. Lo usan la apertura, la recarga y las tareas delegadas.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md, docs/decisiones/agentes/contexto-de-los-agentes.md,
// docs/decisiones/agentes/traspaso-entre-agentes.md, docs/decisiones/agentes/buscar-en-el-historial.md,
// docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import { citarSh } from '../../shared/citarShell.ts'
import { MARCA_SALTO, reglasParaAviso } from '../../shared/reglasPerfil.ts'
import type { ContextoEfectivo } from '../../shared/contexto.ts'

/** Las partes del aviso: cada una puede faltar (`null`) y el llamador las pasa todas, para no olvidar ninguna. */
export interface PartesBriefing {
  bd: string | null
  ssh: string | null
  /** Lo que reciben los agentes del perfil: sus reglas, las globales que usa y sus documentos (se aplana aquí). */
  contexto: ContextoEfectivo
  /** Si se anuncia `tctx buscar`: lo tienen todos los agentes de serie, con reglas o sin ellas. */
  historial?: boolean
  /** Lo que dice de un traspaso la sesión que lo abrió (`traspaso/`); corto, va el último. Solo lo tienen esas. */
  traspaso?: string | null
  /** Si va a un contenedor: allí el aviso viaja citado dos veces y cabe menos. */
  enContenedor?: boolean
  /** Si se anuncia `tctx delegar`: solo a una sesión nativa de un perfil con cuentas de Docker de serie. */
  delegacion?: boolean
  /** Si la sesión es una tarea delegada: se le dice que nadie contestará y qué entregar al terminar. */
  subagente?: boolean
}

/**
 * El anuncio de `tctx delegar` a un agente nativo. Dice lo que el agente delegado NO recibe, porque quien delega
 * tiene que darle en la orden todo lo que necesite.
 */
export const AVISO_DELEGACION =
  'Puedes delegar tareas como subagentes en las cuentas de Docker de este perfil: `tctx cuentas` las lista con su uso, y `tctx delegar --agente claude-code|codex [--cuenta <nombre>|auto] [--solo-lectura]` manda la orden que le pases por la entrada estándar (o con --archivo <ruta dentro del proyecto>) y espera el resultado. Si el usuario nombra una cuenta, usa esa; con auto, Tessera elige la que tiene más uso disponible. Una tarea larga lánzala con --sin-esperar y vigílala con `tctx tarea <id>` (--cancelar la termina; --continuar le da otra indicación en la misma conversación): la tarea sigue aunque el comando se corte. El agente delegado trabaja en el contenedor de su cuenta con lo mismo que tendría en su pestaña de Docker en este proyecto: el proyecto, las bases montadas en él (tdb), las conexiones SSH del perfil (tssh), las reglas y los documentos (tctx); nada fuera del proyecto. No ve esta conversación: dale en la orden todo el contexto que necesite. Puede leer y modificar el proyecto e instalar en su contenedor lo que le haga falta. Con --solo-lectura, Claude Code no puede modificar nada; Codex lo recibe como indicación, no como bloqueo.'

/** Lo que oye el agente de una tarea delegada de solo lectura, además del aviso de subagente. */
export const AVISO_SOLO_LECTURA =
  'Esta tarea es de solo lectura: no modifiques, crees ni borres archivos del proyecto, ni hagas commits; investiga, ejecuta lo que solo lea y responde.'

/** Lo que oye el agente de una tarea delegada: trabaja solo y lo que escriba al final es lo que recibe quien delegó. */
export const AVISO_SUBAGENTE =
  'Eres un subagente: otro agente te delegó esta tarea por Tessera y nadie contestará preguntas mientras trabajas. Decide con criterio, no pidas confirmación y termina con un resumen claro de lo que hiciste, lo que cambiaste y lo que queda pendiente: ese resumen es lo que recibe quien te la delegó.'

/** El anuncio de `tctx buscar`. Sin comillas dobles: la línea de arranque las pierde en PowerShell 5.1. */
export const AVISO_HISTORIAL =
  'Para recuperar lo que se habló en este proyecto con cualquier agente, busca con `tctx buscar <palabras>` (en Docker, solo en tu cuenta).'

/**
 * El anuncio de `tctx docs`. Las reglas o un `AGENTS.md` pueden citar un documento por la ruta del equipo de
 * quien los escribió, que no existe en un contenedor: el agente lo busca aquí por su nombre de archivo.
 */
export const AVISO_DOCUMENTOS =
  'El usuario dejó documentos de referencia para este perfil: lístalos con `tctx docs` y lee uno con `tctx docs <nombre>`. Si las reglas o un AGENTS.md o CLAUDE.md citan un documento por una ruta que no existe aquí, búscalo con `tctx docs` por su nombre de archivo.'

/**
 * Lo más que puede medir el aviso ya citado para la shell: la línea de arranque entera no puede pasar de
 * 32767 caracteres (CreateProcess en Windows, y también el `bash -c` de `docker exec`) y lleva además el
 * binario, el preludio de git y el envoltorio de Codex. Se mide con `citarSh`, la cita que más crece (cada
 * apóstrofo pasa a cuatro caracteres), así que vale para todas las shells; en un contenedor, dos veces, como
 * viaja (la orden del CLI va citada dentro del `bash -c` del entorno limpio).
 */
export const MAX_AVISO_CITADO = 30000

/** Lo que mide el aviso tal como viaja en la línea de arranque. */
export function largoCitado(aviso: string, enContenedor: boolean): number {
  return (enContenedor ? citarSh(citarSh(aviso)) : citarSh(aviso)).length
}

/** La proposición de reglas, común al aviso con el texto de las reglas y al que solo manda a leerlas. */
const FRASE_PROPONER =
  'Si te dice que algo es una regla del perfil, o te corrige lo mismo dos veces, propónselo con `tctx proponer` sobre el texto de `tctx reglas --perfil` (no lo des por aprobado)'

/** Las globales solo se proponen desde un perfil que las usa: uno que no, no ve las vigentes. */
const fraseProponer = (usaGlobal: boolean): string =>
  usaGlobal ? `${FRASE_PROPONER}; si vale para todos sus perfiles, con \`tctx proponer --global\` sobre \`tctx reglas --global\`.` : `${FRASE_PROPONER}.`

/**
 * El aviso de las reglas, o `null` si no hay ninguna (o están en blanco): las globales, si el perfil las usa, y
 * las del perfil, cada una con su encabezado. Va en una sola línea: el aviso entero viaja en la línea de
 * arranque. Con `sinTexto` no lleva las reglas: manda a leerlas con `tctx reglas`.
 */
export function avisoReglas(contexto: Pick<ContextoEfectivo, 'usaGlobal' | 'reglasGlobales' | 'reglasPerfil'>, { sinTexto = false }: { sinTexto?: boolean } = {}): string | null {
  const proponer = fraseProponer(contexto.usaGlobal)
  const globales = reglasParaAviso(contexto.reglasGlobales)
  const perfil = reglasParaAviso(contexto.reglasPerfil)
  if (globales === '' && perfil === '') return null
  if (sinTexto) {
    return [
      'Hay reglas para los agentes: léelas con `tctx reglas` antes de empezar. Las escribió el usuario: síguelas.',
      proponer
    ].join(' ')
  }
  return [
    globales === ''
      ? 'Reglas del perfil, escritas por el usuario para todos sus proyectos de este perfil: síguelas.'
      : 'Reglas escritas por el usuario para sus agentes: las globales valen en todos sus perfiles y las del perfil, en los proyectos de este; si se contradicen, prevalece la del perfil. Síguelas.',
    `Van en una sola línea; «${MARCA_SALTO.trim()}» marca un salto de línea.`,
    proponer,
    'Las vigentes, por si cambiaron desde que arrancaste: `tctx reglas`.',
    ...(globales === '' ? [] : [`Reglas globales: ${globales}`]),
    ...(perfil === '' ? [] : [globales === '' ? `Reglas: ${perfil}` : `Reglas del perfil: ${perfil}`])
  ].join(' ')
}

/** Los avisos que hay, unidos; `null` si no hay ninguno. */
function unir(partes: Array<string | null>): string | null {
  const hay = partes.filter((p): p is string => !!p)
  return hay.length === 0 ? null : hay.join('\n\n')
}

/**
 * Une los avisos. El de bases no cambia ni un byte (lo fijan sus pruebas al carácter); sin ninguno,
 * `null`, que no añade nada a la línea de arranque. Si con el texto de las reglas el aviso citado pasa de
 * `MAX_AVISO_CITADO`, las reglas no van y el aviso manda a leerlas con `tctx reglas`.
 */
export function briefingCompuesto({ bd, ssh, contexto, historial, traspaso, enContenedor, delegacion, subagente }: PartesBriefing): string | null {
  const buscar = historial === true ? AVISO_HISTORIAL : null
  const docs = contexto.documentos.length > 0 ? AVISO_DOCUMENTOS : null
  const delegar = delegacion === true ? AVISO_DELEGACION : null
  const sub = subagente === true ? AVISO_SUBAGENTE : null
  const completo = unir([bd, ssh, avisoReglas(contexto), docs, buscar, delegar, sub, traspaso ?? null])
  if (completo === null || largoCitado(completo, enContenedor === true) <= MAX_AVISO_CITADO) return completo
  return unir([bd, ssh, avisoReglas(contexto, { sinTexto: true }), docs, buscar, delegar, sub, traspaso ?? null])
}
