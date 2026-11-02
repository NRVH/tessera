// =============================================================================
// El aviso de arranque de un agente de serie del perfil, nativo o en contenedor: el de bases tal cual, como
// PREFIJO exacto, y detrás el de SSH, las reglas del perfil (sin su texto si la línea no cabría), el anuncio de
// `tctx buscar` y el del traspaso. Puro. Lo usan la apertura y la recarga (`terminalAgente/apertura.ts` y `recarga.ts`).
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md, docs/decisiones/agentes/reglas-del-perfil.md,
// docs/decisiones/agentes/traspaso-entre-agentes.md, docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================
import { citarSh } from '../../shared/citarShell.ts'
import { MARCA_SALTO, reglasParaAviso } from '../../shared/reglasPerfil.ts'

/** Las partes del aviso: cada una puede faltar (`null`) y el llamador las pasa todas, para no olvidar ninguna. */
export interface PartesBriefing {
  bd: string | null
  ssh: string | null
  /** El texto de `Profile.reglas`, tal cual (se aplana aquí). */
  reglas: string | undefined
  /** Si se anuncia `tctx buscar`: lo tienen todos los agentes de serie, con reglas o sin ellas. */
  historial?: boolean
  /** Lo que dice de un traspaso la sesión que lo abrió (`traspaso/`); corto, va el último. Solo lo tienen esas. */
  traspaso?: string | null
}

/** El anuncio de `tctx buscar`. Sin comillas dobles: la línea de arranque las pierde en PowerShell 5.1. */
export const AVISO_HISTORIAL =
  'Para recuperar lo que se habló en este proyecto con cualquier agente, busca con `tctx buscar <palabras>` (en Docker, solo en tu cuenta).'

/**
 * Lo más que puede medir el aviso ya citado para la shell: la línea de arranque entera no puede pasar de
 * 32767 caracteres (CreateProcess en Windows, y también el `bash -c` de `docker exec`) y lleva además el
 * binario, el preludio de git y el envoltorio de Codex. Se mide con `citarSh`, la cita que más crece (cada
 * apóstrofo pasa a cuatro caracteres), así que vale para todas las shells.
 */
export const MAX_AVISO_CITADO = 30000

/** La proposición de reglas, común al aviso con el texto de las reglas y al que solo manda a leerlas. */
const FRASE_PROPONER = 'Si te dice que algo es una regla del perfil, o te corrige lo mismo dos veces, propónselo con `tctx proponer` (no lo des por aprobado).'

/**
 * El aviso de las reglas del perfil, o `null` si no hay (o están en blanco). Va en una sola línea: el
 * aviso entero viaja en la línea de arranque. Con `sinTexto` no lleva las reglas: manda a leerlas con `tctx reglas`.
 */
export function avisoReglasPerfil(reglas: string | undefined, { sinTexto = false }: { sinTexto?: boolean } = {}): string | null {
  const plano = reglas === undefined ? '' : reglasParaAviso(reglas)
  if (plano === '') return null
  if (sinTexto) {
    return [
      'Hay reglas del perfil: léelas con `tctx reglas` antes de empezar. Las escribió el usuario para todos sus proyectos de este perfil: síguelas.',
      FRASE_PROPONER
    ].join(' ')
  }
  return [
    'Reglas del perfil, escritas por el usuario para todos sus proyectos de este perfil: síguelas.',
    `Van en una sola línea; «${MARCA_SALTO.trim()}» marca un salto de línea.`,
    FRASE_PROPONER,
    'Las vigentes, por si cambiaron desde que arrancaste: `tctx reglas`.',
    `Reglas: ${plano}`
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
export function briefingCompuesto({ bd, ssh, reglas, historial, traspaso }: PartesBriefing): string | null {
  const buscar = historial === true ? AVISO_HISTORIAL : null
  const completo = unir([bd, ssh, avisoReglasPerfil(reglas), buscar, traspaso ?? null])
  if (completo === null || citarSh(completo).length <= MAX_AVISO_CITADO) return completo
  return unir([bd, ssh, avisoReglasPerfil(reglas, { sinTexto: true }), buscar, traspaso ?? null])
}
