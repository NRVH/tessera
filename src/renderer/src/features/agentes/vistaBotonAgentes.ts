// =============================================================================
// Qué pinta el botón de los agentes de la barra de título (punto, anillo,
// etiqueta, título) y el rótulo de la acción del popover. Lógica pura con su test
// bajo `node`; el componente `BotonAgentesNativos.tsx` sólo dibuja.
// El sistema se nombra con `nombres.tuEquipo`, que llega de `window.tessera.plataforma`.
// Decisiones: docs/decisiones/agentes/boton-agentes-nativos.md
// =============================================================================

import type { EstadoAgentesNativos, EstadoCli } from '../../../../shared/agentes-nativos-ipc.ts'
import type { NombresSistema } from '../../../../shared/nombresSistema.ts'
import { ETIQUETA_AGENTE } from './actualizacionNativa.ts'
import type { EntradaBotonDocker } from './modeloActualizacionDocker.ts'
import { txActualizacion } from './textosActualizacion.ts'
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
  /** Lo que aporta la sección de Docker; sin ello, solo cuentan los agentes del equipo. */
  docker?: EntradaBotonDocker
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

/** «1 sesión» / «5 sesiones». Exportada: el resumen del popover cuenta igual. */
export function sesiones(n: number): string {
  return txActualizacion().boton.sesiones(n)
}

/** «A», «A y B», «A, B y C». */
function listaY(partes: string[]): string {
  return txActualizacion().boton.lista(partes)
}

/**
 * Lo que dice la acción principal del popover: nombra lo que hará —«Actualizar Codex
 * y reiniciar 5 sesiones»—, no «Actualizar» a secas, porque reinicia sesiones que no
 * se están viendo. Los CLIs van en el orden de `plan.instalar`. El plan FORZADO
 * («Reiniciar igualmente») lo rotula el componente aparte.
 */
export function textoAccion(plan: PlanActualizacion): string {
  const t = txActualizacion().boton
  const etiquetas = (reparar: boolean): string[] =>
    plan.instalar.filter((i) => i.reparar === reparar).map((i) => ETIQUETA_AGENTE[i.agente])
  const actualizar = etiquetas(false)
  const reparar = etiquetas(true)
  const n = plan.reiniciar.length
  const partes: string[] = []
  if (actualizar.length > 0) partes.push(t.actualizar(listaY(actualizar)))
  if (reparar.length > 0) partes.push(t.reparar(listaY(reparar)))
  if (n > 0) partes.push(t.reiniciar(sesiones(n)))
  if (partes.length === 0) return t.accionPorDefecto
  const frase = listaY(partes)
  return frase.charAt(0).toUpperCase() + frase.slice(1)
}

function clis(estado: EstadoAgentesNativos): EstadoCli[] {
  return [estado.claude, estado.codex]
}

/** «Codex 0.156.0 → 0.156.1» (o sólo la nueva si la instalada no se conoce, o la reparación). */
function salto(cli: EstadoCli): string {
  const etq = ETIQUETA_AGENTE[cli.agente]
  if (cli.reparar) return txActualizacion().boton.saltoRepara(etq, cli.ultima)
  return cli.instalada ? `${etq} ${cli.instalada} → ${cli.ultima}` : `${etq} ${cli.ultima}`
}

/** ¿Hay algo que este botón pueda atender? Es la regla del punto 'aviso'. */
export function hayNovedades(estado: EstadoAgentesNativos | null): boolean {
  if (estado === null) return false
  return clis(estado).some((c) => c.hayNueva && c.instalable) || estado.sesiones.some((s) => s.atrasada)
}

/** Vista con el punto de un resultado o de un aviso: siempre visible, sin anillo. */
function conPunto(punto: PuntoBotonAgentes, titulo: string): VistaBotonAgentes {
  return { visible: true, punto, anillo: false, etiqueta: txActualizacion().boton.etiqueta, titulo }
}

function vistaError(r: ResumenActualizacion): VistaBotonAgentes {
  const t = txActualizacion().boton
  const partes: string[] = []
  const instFallidas = r.instalaciones.filter((i) => !i.ok)
  if (instFallidas.length > 0) {
    partes.push(t.noSePudo(instFallidas.map((i) => ETIQUETA_AGENTE[i.agente]).join(t.ni)))
  }
  const sesFallidas = r.sesiones.filter((s) => s.resultado === 'fallo').length
  if (sesFallidas > 0) {
    partes.push(t.noVolvio(sesiones(sesFallidas), sesFallidas))
  }
  const detalle = partes.length > 0 ? `: ${partes.join('; ')}` : ''
  return conPunto('error', t.errorTitulo(detalle))
}

function vistaOk(r: ResumenActualizacion): VistaBotonAgentes {
  const relanzadas = r.sesiones.filter((s) => s.resultado === 'relanzada').length
  const cambios = r.instalaciones
    .filter((i) => i.ok && i.despues !== null && i.despues !== i.antes)
    .map((i) => (i.antes ? `${ETIQUETA_AGENTE[i.agente]} ${i.antes} → ${i.despues}` : `${ETIQUETA_AGENTE[i.agente]} ${i.despues}`))
  const partes = [...cambios]
  if (relanzadas > 0) partes.push(txActualizacion().boton.reiniciadas(sesiones(relanzadas), relanzadas))
  const detalle = partes.length > 0 ? `: ${partes.join(' · ')}` : ''
  return conPunto('ok', txActualizacion().boton.okTitulo(detalle))
}

function vistaAviso(estado: EstadoAgentesNativos, plan: PlanActualizacion | null, nombres: NombresSistema): VistaBotonAgentes {
  const partes = clis(estado)
    .filter((c) => c.hayNueva && c.instalable && c.ultima !== null)
    .map(salto)
  const atrasadas = estado.sesiones.filter((s) => s.atrasada).length
  if (atrasadas > 0) {
    partes.push(txActualizacion().boton.corre(sesiones(atrasadas), atrasadas))
  }
  const espera = plan !== null && plan.bloqueantes.length > 0 && plan.motivoNoEjecutar ? ` ${plan.motivoNoEjecutar}.` : ''
  return conPunto('aviso', txActualizacion().boton.avisoTitulo(nombres.tuEquipo, partes.join(' · '), espera))
}

/** Reposo: un CLI nuevo que sólo se instala a mano se menciona, sin punto. */
function vistaReposo(estado: EstadoAgentesNativos | null, hayProyectoNativo: boolean, nombres: NombresSistema): VistaBotonAgentes {
  const manuales = estado === null ? [] : clis(estado).filter((c) => c.hayNueva && !c.instalable && c.ultima !== null)
  const t = txActualizacion().boton
  let titulo: string
  if (estado === null) {
    titulo = t.reposoSinEstado(nombres.tuEquipo)
  } else if (manuales.length > 0) {
    titulo = t.reposoManual(manuales.map(salto).join(' · '))
  } else {
    titulo = t.reposoAlDia(nombres.tuEquipo)
  }
  // Aquí un resumen, si queda, es un «ok» ya visto: ya no sostiene el botón.
  return { ...conPunto(null, titulo), visible: hayProyectoNativo }
}

/** Docker se suma con la misma precedencia: en curso > error > ok sin ver > aviso. */
function conDocker(v: VistaBotonAgentes, d: EntradaBotonDocker | undefined): VistaBotonAgentes {
  const t = txActualizacion().docker
  if (!d || v.anillo) return v
  if (d.corriendo) return { visible: true, punto: null, anillo: true, etiqueta: txActualizacion().boton.actualizando, titulo: t.tituloCorriendo }
  if (v.punto === 'error') return v
  if (d.error) return conPunto('error', t.tituloError)
  if (v.punto === 'ok') return v
  if (d.okSinVer) return conPunto('ok', t.tituloOk)
  return d.novedades && v.punto === null ? conPunto('aviso', t.tituloNovedades) : v
}

/** Qué pinta el botón de los agentes: punto, anillo, etiqueta y título. */
export function decidirVistaBotonAgentes(e: EntradaVistaBotonAgentes): VistaBotonAgentes {
  return conDocker(vistaDelEquipo(e), e.docker)
}

function vistaDelEquipo(e: EntradaVistaBotonAgentes): VistaBotonAgentes {
  const { estado, plan, enCurso, resumen, resumenVisto, hayProyectoNativo, nombres } = e
  if (enCurso !== null && enCurso !== 'terminado') {
    return {
      visible: true,
      punto: null,
      anillo: true,
      etiqueta: txActualizacion().boton.actualizando,
      titulo: txActualizacion().boton.tituloEnCurso(nombres.tuEquipo, txActualizacion().boton.fases[enCurso])
    }
  }
  // Un resumen abortado no es pendiente: la compuerta paró antes de tocar nada.
  const resumenReal = resumen !== null && resumen.abortado === null ? resumen : null
  if (resumenReal && !resumenReal.ok) return vistaError(resumenReal)
  if (resumenReal && !resumenVisto) return vistaOk(resumenReal)
  if (hayProyectoNativo && estado !== null && hayNovedades(estado)) return vistaAviso(estado, plan, nombres)
  return vistaReposo(estado, hayProyectoNativo, nombres)
}
