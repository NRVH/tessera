// =============================================================================
// Qué ofrece el botón de reinicio (Reiniciar / Reabrir / Reintentar; «Reconectar» en una sesión
// SSH) en cada estado del pane, en lógica pura sin React ni DOM: corre bajo `node` y se prueba. La
// acción que devuelve es la que ejecuta el pane, así lo pintado y lo hecho no discrepan. Los textos
// que cambian de una sesión a otra son un parámetro (`TextosBotonReinicio`) y sus valores por
// defecto son los de siempre.
// Decisiones: docs/decisiones/terminales/boton-de-reinicio-una-sola-verdad.md
// =============================================================================

import { sesionAtrasada } from '../../../../shared/versionesCli.ts'
import { txTerminales } from './textos.ts'

/** Estado de la sesión, tal y como lo llevan los panes (agente y shell). */
export type EstadoSesion = 'booting' | 'live' | 'exited' | 'error'

/** Los textos del botón que dependen de qué se reinicia: un shell o un agente, o una conexión SSH. */
export interface TextosBotonReinicio {
  /** Con la sesión muerta: la etiqueta y su gerundio. */
  reabrir: string
  reabriendo: string
  /** Tooltip del reintento de un arranque que falló. */
  tituloReintentarArranque: string
  /** Tooltip con la sesión muerta. */
  tituloReabrir: string
  /** Tooltip en reposo, a partir de la etiqueta normal. */
  tituloNormal: (etiquetaNormal: string) => string
}

/** Los textos de siempre, los del shell y los del agente. En español no cambian: hay pruebas y capturas que los leen. */
export function textosReinicio(): TextosBotonReinicio {
  const t = txTerminales()
  return {
    reabrir: t.reabrir,
    reabriendo: t.reabriendo,
    tituloReintentarArranque: t.tituloReintentarArranque,
    tituloReabrir: t.tituloReabrir,
    tituloNormal: t.tituloNormal
  }
}

/** Los de una sesión SSH: se reconecta, con los datos vigentes de la conexión, y no hay contenedor que comprobar. */
export function textosReconexionSsh(): TextosBotonReinicio {
  const t = txTerminales()
  return {
    reabrir: t.reconectar,
    reabriendo: t.reconectando,
    tituloReintentarArranque: t.sshReintentarArranque,
    tituloReabrir: t.sshReabrir,
    tituloNormal: () => t.sshNormal
  }
}

/** Fase de la recuperación ante una muerte anómala (sólo el pane del agente). */
export type FaseRecuperacion = 'recovering' | 'docker-down' | 'failed'

export interface EntradaBotonReinicio {
  status: EstadoSesion
  /** Id de la sesión viva; null = no hay ninguna (nunca abrió, o se hibernó). */
  sessionId: string | null
  /** Hay un reload/reintento en vuelo. */
  reloading: boolean
  /** Hay una auto-recuperación en vuelo (verdad SÍNCRONA del pane). */
  recuperando?: boolean
  faseRecuperacion?: FaseRecuperacion | null
  /** Nº de intento en curso, para la etiqueta "Recuperando… (1/2)". */
  intentoRecuperacion?: number
  maxIntentos?: number
  /** El perfil está hibernado: no se abre nada a sus espaldas. */
  hibernated?: boolean
  /** ¿Se dan las condiciones para ABRIR? (hay cuenta / las bases están listas). */
  puedeAbrir?: boolean
  /** "Reiniciar" en el pane del agente; "Recargar" en la terminal de abajo. */
  etiquetaNormal: string
  /**
   * Su gerundio: "Reiniciando…" / "Recargando…". El pane del agente pasa
   * "Actualizando…" mientras el orquestador de actualización lo tiene preparado.
   */
  etiquetaProgreso: string
  /**
   * Sólo sesiones de agente NATIVAS: con qué versión arrancó el CLI y cuál hay
   * instalada ahora. Si la sesión va atrasada, el tooltip lo dice. Ausente, o con
   * alguna desconocida, el botón se comporta como siempre.
   */
  versiones?: { lanzada: string | null; instalada: string | null } | null
  /** Los textos de esta sesión; ausente = los de siempre (`textosReinicio()`). */
  textos?: TextosBotonReinicio
  /**
   * Por qué el botón no se puede usar aunque haya sesión (una conexión SSH eliminada: no hay con
   * qué reconectar). Lo deshabilita y es su tooltip.
   */
  bloqueo?: string
}

export interface SalidaBotonReinicio {
  habilitado: boolean
  etiqueta: string
  titulo: string
  /** Qué debe hacer el onClick. 'nada' = el botón está inerte (y deshabilitado). */
  accion: 'reload' | 'open' | 'nada'
  /**
   * ¿El botón se pinta solo con su icono? Solo en el caso aburrido (reposo): el resto
   * de etiquetas ("Reintentar", "Reabrir", "Recuperando… (1/2)") son la única señal
   * de que pasa algo, así que el botón crece una etiqueta cuando tiene algo que decir.
   */
  soloIcono: boolean
}

type Accion = SalidaBotonReinicio['accion']

/** Con sesión viva se recarga; sin ella solo tiene sentido reintentar un arranque que falló. */
function accionBase(e: EntradaBotonReinicio): Accion {
  if (e.sessionId) return 'reload'
  return e.status === 'error' ? 'open' : 'nada'
}

/** Reintento en frío en vuelo: `reloading` sin sesión (un reload normal conserva la suya). */
function reintentandoEnFrio(e: EntradaBotonReinicio): boolean {
  return e.reloading && !e.sessionId
}

/** Las tres guardas (hibernado, sin condiciones para abrir, recuperación en vuelo) y el estado. */
function estaBloqueado(e: EntradaBotonReinicio, accion: Accion): boolean {
  return (
    e.reloading ||
    e.recuperando === true ||
    e.faseRecuperacion === 'recovering' ||
    e.status === 'booting' ||
    e.hibernated === true ||
    e.bloqueo !== undefined ||
    (accion === 'open' && e.puedeAbrir === false)
  )
}

/** «Reintentar» cubre el arranque en frío fallido, Docker caído en caliente y la recuperación agotada. */
function esReintento(e: EntradaBotonReinicio, accion: Accion): boolean {
  return (
    accion === 'open' ||
    reintentandoEnFrio(e) ||
    e.faseRecuperacion === 'docker-down' ||
    e.faseRecuperacion === 'failed'
  )
}

function etiquetaEnVuelo(e: EntradaBotonReinicio, reintento: boolean): string {
  if (reintento) return txTerminales().reintentando
  return e.status === 'exited' ? (e.textos ?? textosReinicio()).reabriendo : e.etiquetaProgreso
}

/** Etiqueta y `soloIcono`, decididos en las mismas ramas (no comparando con `etiquetaNormal`). */
function etiquetaDe(
  e: EntradaBotonReinicio,
  accion: Accion
): Pick<SalidaBotonReinicio, 'etiqueta' | 'soloIcono'> {
  const reintento = esReintento(e, accion)
  if (e.faseRecuperacion === 'recovering') {
    const etiqueta = txTerminales().recuperando(e.intentoRecuperacion ?? 0, e.maxIntentos ?? 2)
    return { etiqueta, soloIcono: false }
  }
  if (e.reloading) return { etiqueta: etiquetaEnVuelo(e, reintento), soloIcono: false }
  if (reintento) return { etiqueta: txTerminales().reintentar, soloIcono: false }
  if (e.status === 'exited') return { etiqueta: (e.textos ?? textosReinicio()).reabrir, soloIcono: false }
  return { etiqueta: e.etiquetaNormal, soloIcono: true }
}

/** Aviso de sesión atrasada (corre un binario más viejo que el instalado), o null. */
function avisoAtrasada(v: EntradaBotonReinicio['versiones']): string | null {
  if (!v || !sesionAtrasada(v.lanzada, v.instalada)) return null
  return txTerminales().sesionAtrasada(v.lanzada, v.instalada)
}

/** Tooltip; el aviso de versión solo con el botón pulsable (en vuelo pediría lo que ya pasa). */
function tituloDe(e: EntradaBotonReinicio, accion: Accion, habilitado: boolean): string {
  const textos = e.textos ?? textosReinicio()
  if (e.bloqueo !== undefined) return e.bloqueo
  if (accion === 'open' || reintentandoEnFrio(e)) return textos.tituloReintentarArranque
  if (e.faseRecuperacion === 'docker-down') return txTerminales().dockerCaido
  if (e.faseRecuperacion === 'failed') return txTerminales().recuperacionAgotada
  if (e.status === 'exited') return textos.tituloReabrir
  const aviso = habilitado && accion === 'reload' ? avisoAtrasada(e.versiones) : null
  return aviso ?? textos.tituloNormal(e.etiquetaNormal)
}

/** Decide etiqueta, tooltip, estado y acción del botón de reinicio a partir del estado del pane. */
export function botonReinicio(e: EntradaBotonReinicio): SalidaBotonReinicio {
  const accion = accionBase(e)
  const habilitado = accion !== 'nada' && !estaBloqueado(e, accion)
  const { etiqueta, soloIcono } = etiquetaDe(e, accion)
  const titulo = tituloDe(e, accion, habilitado)
  return { habilitado, etiqueta, titulo, accion: habilitado ? accion : 'nada', soloIcono }
}
