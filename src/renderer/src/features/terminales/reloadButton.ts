// =============================================================================
// Qué ofrece el botón de reinicio (Reiniciar / Reabrir / Reintentar) en cada estado
// del pane, en lógica pura sin React ni DOM: corre bajo `node` y se prueba. La acción
// que devuelve es la que ejecuta el pane, así lo pintado y lo hecho no discrepan.
// Decisiones: docs/decisiones/terminales/boton-de-reinicio-una-sola-verdad.md
// =============================================================================

import { sesionAtrasada } from '../../../../shared/versionesCli.ts'

/** Estado de la sesión, tal y como lo llevan los panes (agente y shell). */
export type EstadoSesion = 'booting' | 'live' | 'exited' | 'error'

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
  if (reintento) return 'Reintentando…'
  return e.status === 'exited' ? 'Reabriendo…' : e.etiquetaProgreso
}

/** Etiqueta y `soloIcono`, decididos en las mismas ramas (no comparando con `etiquetaNormal`). */
function etiquetaDe(
  e: EntradaBotonReinicio,
  accion: Accion
): Pick<SalidaBotonReinicio, 'etiqueta' | 'soloIcono'> {
  const reintento = esReintento(e, accion)
  if (e.faseRecuperacion === 'recovering') {
    const etiqueta = `Recuperando… (${e.intentoRecuperacion ?? 0}/${e.maxIntentos ?? 2})`
    return { etiqueta, soloIcono: false }
  }
  if (e.reloading) return { etiqueta: etiquetaEnVuelo(e, reintento), soloIcono: false }
  if (reintento) return { etiqueta: 'Reintentar', soloIcono: false }
  if (e.status === 'exited') return { etiqueta: 'Reabrir', soloIcono: false }
  return { etiqueta: e.etiquetaNormal, soloIcono: true }
}

/** Aviso de sesión atrasada (corre un binario más viejo que el instalado), o null. */
function avisoAtrasada(v: EntradaBotonReinicio['versiones']): string | null {
  if (!v || !sesionAtrasada(v.lanzada, v.instalada)) return null
  return `corre ${v.lanzada} · instalada ${v.instalada}: reinicia para usarla`
}

/** Tooltip; el aviso de versión solo con el botón pulsable (en vuelo pediría lo que ya pasa). */
function tituloDe(e: EntradaBotonReinicio, accion: Accion, habilitado: boolean): string {
  if (accion === 'open' || reintentandoEnFrio(e)) {
    return 'Reintentar el arranque: vuelve a comprobar Docker y a levantar el contenedor'
  }
  if (e.faseRecuperacion === 'docker-down') {
    return 'Reintentar: comprueba Docker y vuelve a levantar el contenedor + credenciales'
  }
  if (e.faseRecuperacion === 'failed') return 'Reintentar la recuperación del contenedor a mano'
  if (e.status === 'exited') return 'Reabrir: vuelve a lanzar en el mismo panel (mismo id de sesión)'
  const aviso = habilitado && accion === 'reload' ? avisoAtrasada(e.versiones) : null
  return aviso ?? `${e.etiquetaNormal} robusto: relanza conservando la sesión`
}

/** Decide etiqueta, tooltip, estado y acción del botón de reinicio a partir del estado del pane. */
export function botonReinicio(e: EntradaBotonReinicio): SalidaBotonReinicio {
  const accion = accionBase(e)
  const habilitado = accion !== 'nada' && !estaBloqueado(e, accion)
  const { etiqueta, soloIcono } = etiquetaDe(e, accion)
  const titulo = tituloDe(e, accion, habilitado)
  return { habilitado, etiqueta, titulo, accion: habilitado ? accion : 'nada', soloIcono }
}
