// =============================================================================
// Qué pinta el botón de los agentes nativos de la barra de título (punto, anillo,
// etiqueta, título) y el rótulo de la acción del popover. Lógica pura con su test
// bajo `node`; el componente `BotonAgentesNativos.tsx` sólo dibuja.
// El sistema se nombra con `nombres.tuEquipo`, que llega de `window.tessera.plataforma`.
// Decisiones: docs/decisiones/agentes/boton-agentes-nativos.md
// =============================================================================

import type { EstadoAgentesNativos, EstadoCli } from '../../../../shared/agentes-nativos-ipc.ts'
import type { NombresSistema } from '../../../../shared/nombresSistema.ts'
import { ETIQUETA_AGENTE } from './actualizacionNativa.ts'
import type { FaseActualizacion, PlanActualizacion, ResumenActualizacion } from './tipos.ts'

export interface EntradaVistaBotonAgentes {
  /** Última foto del main (push de estado); null antes de la primera. */
  estado: EstadoAgentesNativos | null
  /** Plan de la vista previa (sin forzar); null si aún no hay estado. */
  plan: PlanActualizacion | null
  /** Fase de la ejecución en curso; null si no corre nada. 'terminado' cuenta como parada. */
  enCurso: FaseActualizacion | null
  /** Resultado PEGAJOSO de la última ejecución (vive en el hook); null tras descartarlo. */
  resumen: ResumenActualizacion | null
  /** ¿Se abrió el popover después de terminar? Retira el punto verde, nunca el rojo. */
  resumenVisto: boolean
  /** ¿Hay algún proyecto abierto en modo nativo? */
  hayProyectoNativo: boolean
  /** `nombresSistema(window.tessera.plataforma)`. */
  nombres: NombresSistema
}

export type PuntoBotonAgentes = 'aviso' | 'ok' | 'error' | null

export interface VistaBotonAgentes {
  /** ¿Se monta el botón? */
  visible: boolean
  punto: PuntoBotonAgentes
  /** Anillo de progreso alrededor del glifo mientras corre la actualización. */
  anillo: boolean
  /** Lo que se despliega al pasar el ratón. Corto. */
  etiqueta: string
  /** Frase larga para el tooltip nativo y el lector de pantalla. */
  titulo: string
}

/** Qué se está haciendo, para el título mientras corre. */
const TEXTO_FASE: Readonly<Record<FaseActualizacion, string>> = {
  comprobando: 'comprobando versiones',
  instalando: 'instalando la versión nueva',
  deteniendo: 'deteniendo las sesiones',
  relanzando: 'reiniciando las sesiones',
  terminado: 'terminando'
}

/** «1 sesión» / «5 sesiones». Exportada: el resumen del popover cuenta igual. */
export function sesiones(n: number): string {
  return n === 1 ? '1 sesión' : `${n} sesiones`
}

/** «A», «A y B», «A, B y C». */
function listaY(partes: string[]): string {
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/**
 * Lo que dice la acción principal del popover: nombra lo que hará —«Actualizar Codex
 * y reiniciar 5 sesiones»—, no «Actualizar» a secas, porque reinicia sesiones que no
 * se están viendo. Los CLIs van en el orden de `plan.instalar`. El plan FORZADO
 * («Reiniciar igualmente») lo rotula el componente aparte.
 */
export function textoAccion(plan: PlanActualizacion): string {
  const etiquetas = plan.instalar.map((i) => ETIQUETA_AGENTE[i.agente])
  const n = plan.reiniciar.length
  if (etiquetas.length > 0 && n > 0) return `Actualizar ${listaY(etiquetas)} y reiniciar ${sesiones(n)}`
  if (etiquetas.length > 0) return `Actualizar ${listaY(etiquetas)}`
  if (n > 0) return `Reiniciar ${sesiones(n)}`
  return 'Actualizar y reiniciar'
}

function clis(estado: EstadoAgentesNativos): EstadoCli[] {
  return [estado.claude, estado.codex]
}

/** «Codex 0.156.0 → 0.156.1» (o sólo la nueva si la instalada no se conoce). */
function salto(cli: EstadoCli): string {
  const etq = ETIQUETA_AGENTE[cli.agente]
  return cli.instalada ? `${etq} ${cli.instalada} → ${cli.ultima}` : `${etq} ${cli.ultima}`
}

/** ¿Hay algo que este botón pueda atender? Es la regla del punto 'aviso'. */
export function hayNovedades(estado: EstadoAgentesNativos | null): boolean {
  if (estado === null) return false
  return clis(estado).some((c) => c.hayNueva && c.instalable) || estado.sesiones.some((s) => s.atrasada)
}

/** Vista con el punto de un resultado o de un aviso: siempre visible, sin anillo. */
function conPunto(punto: PuntoBotonAgentes, nombres: NombresSistema, titulo: string): VistaBotonAgentes {
  return { visible: true, punto, anillo: false, etiqueta: `Actualizar los agentes de ${nombres.tuEquipo}`, titulo }
}

function vistaError(r: ResumenActualizacion, nombres: NombresSistema): VistaBotonAgentes {
  const partes: string[] = []
  const instFallidas = r.instalaciones.filter((i) => !i.ok)
  if (instFallidas.length > 0) {
    partes.push(`no se pudo actualizar ${instFallidas.map((i) => ETIQUETA_AGENTE[i.agente]).join(' ni ')}`)
  }
  const sesFallidas = r.sesiones.filter((s) => s.resultado === 'fallo').length
  if (sesFallidas > 0) {
    partes.push(`${sesiones(sesFallidas)} no ${sesFallidas === 1 ? 'volvió' : 'volvieron'} a arrancar`)
  }
  const detalle = partes.length > 0 ? `: ${partes.join('; ')}` : ''
  return conPunto('error', nombres, `La actualización de los agentes tuvo problemas${detalle}. Pulsa para ver qué pasó.`)
}

function vistaOk(r: ResumenActualizacion, nombres: NombresSistema): VistaBotonAgentes {
  const relanzadas = r.sesiones.filter((s) => s.resultado === 'relanzada').length
  const cambios = r.instalaciones
    .filter((i) => i.ok && i.despues !== null && i.despues !== i.antes)
    .map((i) => (i.antes ? `${ETIQUETA_AGENTE[i.agente]} ${i.antes} → ${i.despues}` : `${ETIQUETA_AGENTE[i.agente]} ${i.despues}`))
  const partes = [...cambios]
  if (relanzadas > 0) partes.push(`${sesiones(relanzadas)} ${relanzadas === 1 ? 'reiniciada' : 'reiniciadas'}`)
  const detalle = partes.length > 0 ? `: ${partes.join(' · ')}` : ''
  return conPunto('ok', nombres, `Agentes actualizados${detalle}. Pulsa para ver el resumen.`)
}

function vistaAviso(estado: EstadoAgentesNativos, plan: PlanActualizacion | null, nombres: NombresSistema): VistaBotonAgentes {
  const partes = clis(estado)
    .filter((c) => c.hayNueva && c.instalable && c.ultima !== null)
    .map(salto)
  const atrasadas = estado.sesiones.filter((s) => s.atrasada).length
  if (atrasadas > 0) {
    partes.push(`${sesiones(atrasadas)} ${atrasadas === 1 ? 'corre' : 'corren'} una versión anterior`)
  }
  const espera = plan !== null && plan.bloqueantes.length > 0 && plan.motivoNoEjecutar ? ` ${plan.motivoNoEjecutar}.` : ''
  return conPunto(
    'aviso',
    nombres,
    `Hay novedades en los agentes de ${nombres.tuEquipo}: ${partes.join(' · ')}.${espera} Pulsa para verlas.`
  )
}

/** Reposo: un CLI nuevo que sólo se instala a mano se menciona, sin punto. */
function vistaReposo(estado: EstadoAgentesNativos | null, hayProyectoNativo: boolean, nombres: NombresSistema): VistaBotonAgentes {
  const manuales = estado === null ? [] : clis(estado).filter((c) => c.hayNueva && !c.instalable && c.ultima !== null)
  let titulo: string
  if (estado === null) {
    titulo = `Comprobar las versiones de Claude Code y Codex en ${nombres.tuEquipo}.`
  } else if (manuales.length > 0) {
    titulo = `Hay una versión nueva que se instala a mano: ${manuales.map(salto).join(' · ')}. Pulsa para ver cómo.`
  } else {
    titulo = `Los agentes de ${nombres.tuEquipo} están al día. Pulsa para comprobarlo o reiniciarlos.`
  }
  // Aquí un resumen, si queda, es un «ok» ya visto: ya no sostiene el botón.
  return { ...conPunto(null, nombres, titulo), visible: hayProyectoNativo }
}

/** Qué pinta el botón de los agentes nativos: punto, anillo, etiqueta y título. */
export function decidirVistaBotonAgentes(e: EntradaVistaBotonAgentes): VistaBotonAgentes {
  const { estado, plan, enCurso, resumen, resumenVisto, hayProyectoNativo, nombres } = e
  if (enCurso !== null && enCurso !== 'terminado') {
    return {
      visible: true,
      punto: null,
      anillo: true,
      etiqueta: 'Actualizando…',
      titulo: `Actualizando los agentes de ${nombres.tuEquipo}: ${TEXTO_FASE[enCurso]}. Pulsa para ver el progreso.`
    }
  }
  // Un resumen abortado no es pendiente: la compuerta paró antes de tocar nada.
  const resumenReal = resumen !== null && resumen.abortado === null ? resumen : null
  if (resumenReal && !resumenReal.ok) return vistaError(resumenReal, nombres)
  if (resumenReal && !resumenVisto) return vistaOk(resumenReal, nombres)
  if (hayProyectoNativo && estado !== null && hayNovedades(estado)) return vistaAviso(estado, plan, nombres)
  return vistaReposo(estado, hayProyectoNativo, nombres)
}
