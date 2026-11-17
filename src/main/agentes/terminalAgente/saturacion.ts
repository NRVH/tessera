// =============================================================================
// El vigía de la saturación de Docker: mide la memoria de sus contenedores mientras corre alguno de
// cuenta y, con lo que decide `shared/saturacionDocker.ts`, avisa y para el contenedor que diga la
// política del usuario (nunca uno a la vista, uno manual ni uno abriéndose). Si protege los que
// trabajan y no queda otro, para uno trabajando: con Docker sin memoria caería uno igual, sin elegir.
// Sin la configuración del renderer no actúa. Las pruebas inyectan la medida y los tiempos.
// Decisiones: docs/decisiones/sandbox/saturacion-de-docker.md
// =============================================================================

import {
  AGENT_TERMINAL_CHANNELS,
  type AvisoSaturacion,
  type VigiaSaturacionConfig
} from '../../../shared/agent-terminal-ipc'
import { elegirAParar } from '../../../shared/semaforoContenedores'
import {
  AVISO_PREVIO_MS,
  ENFRIAMIENTO_MS,
  VIGIA_INICIAL,
  pasoVigia,
  type EstadoVigia,
  type MuestraMemoria,
  type TiemposVigia
} from '../../../shared/saturacionDocker'
import { candidatos, pararPor, proyectosEn } from './cupo'
import type { NucleoAgente } from './tipos'

/** Cada cuánto se mide: con 30 s de umbral, varias medidas antes de actuar sin cargar a Docker. */
const INTERVALO_MS = 5_000

export interface OpcionesVigia {
  intervaloMs?: number
  tiempos?: TiemposVigia
  /** La medida; por defecto, la de Docker. */
  medir?: () => Promise<MuestraMemoria | null>
  ahora?: () => number
}

export class VigiaSaturacion {
  private readonly n: NucleoAgente
  private readonly intervaloMs: number
  private readonly tiempos: TiemposVigia
  private readonly medir: () => Promise<MuestraMemoria | null>
  private readonly ahora: () => number
  private estado: EstadoVigia = VIGIA_INICIAL
  /** El contenedor anunciado en el aviso en curso. */
  private victima: string | null = null
  /** Los que el usuario descartó con «Parar otro» en el aviso en curso. */
  private readonly descartados = new Set<string>()
  /** El último porcentaje medido, para los avisos que no llegan con una medida. */
  private porcentaje = 0
  /** Ya se dijo en esta racha que no hay nada que parar. */
  private avisadoSinCandidatos = false
  private temporizador: ReturnType<typeof setTimeout> | null = null
  private enRonda = false
  private detenido = false

  constructor(n: NucleoAgente, o: OpcionesVigia = {}) {
    this.n = n
    this.intervaloMs = o.intervaloMs ?? INTERVALO_MS
    this.tiempos = o.tiempos ?? { avisoMs: AVISO_PREVIO_MS, enfriamientoMs: ENFRIAMIENTO_MS }
    this.medir = o.medir ?? (() => n.sandbox.medirMemoria())
    this.ahora = o.ahora ?? (() => Date.now())
  }

  /** Lo que manda el renderer: ajustes, política y lo que se ve. La primera vez arranca la vigilancia. */
  configurar(config: VigiaSaturacionConfig): void {
    this.n.vigia.config = config
    if (this.temporizador === null && !this.enRonda) this.programar()
  }

  detener(): void {
    this.detenido = true
    if (this.temporizador !== null) clearTimeout(this.temporizador)
    this.temporizador = null
  }

  private programar(): void {
    if (this.detenido) return
    this.temporizador = setTimeout(() => {
      this.temporizador = null
      this.enRonda = true
      void this.ronda()
        .catch((err: unknown) => this.n.log(`saturación: la ronda falló: ${err instanceof Error ? err.message : String(err)}`))
        .finally(() => {
          this.enRonda = false
          this.programar()
        })
    }, this.intervaloMs)
    this.temporizador.unref?.()
  }

  /** Una medida y lo que toque. Sin configuración o sin contenedores de cuenta, ni se mide. */
  async ronda(): Promise<void> {
    const config = this.n.vigia.config
    const hayCuentas = this.n.sandbox.contenedoresVivos().some((id) => this.n.sandbox.esDeCuenta(id))
    if (config === null || !hayCuentas) {
      // Sin contenedores de cuenta no queda nada que parar: el aviso en curso ya no vale.
      if (this.estado.fase === 'avisando') this.emitir({ tipo: 'cancelado', porcentaje: this.porcentaje })
      this.reiniciar()
      return
    }
    const muestra = await this.medir()
    const paso = pasoVigia(this.estado, muestra, config.ajustes, this.ahora(), this.tiempos)
    this.estado = paso.estado
    if (paso.porcentaje !== null) this.porcentaje = paso.porcentaje
    if (paso.accion === 'avisar') this.avisar()
    else if (paso.accion === 'parar') await this.parar(config)
    else if (paso.accion === 'cancelar') this.emitir({ tipo: 'cancelado', porcentaje: this.porcentaje })
    if (this.estado.fase === 'normal') this.reiniciar()
  }

  /** Fin de la racha: se olvida lo anunciado y lo descartado. */
  private reiniciar(): void {
    this.estado = VIGIA_INICIAL
    this.victima = null
    this.descartados.clear()
    this.avisadoSinCandidatos = false
  }

  /** El contenedor a parar ahora con la política del usuario, o null si no hay ninguno. */
  private elegir(): string | null {
    const politica = this.n.vigia.config?.politica
    if (!politica) return null
    const lista = candidatos(this.n).filter((c) => !this.descartados.has(c.id))
    const elegido = elegirAParar(lista, politica, '')
    if (elegido !== null || !politica.protegerTrabajando) return elegido
    return elegirAParar(lista, { ...politica, protegerTrabajando: false }, '')
  }

  /** El aviso del contenedor `id` con lo que queda de plazo. */
  private anunciar(id: string): void {
    this.victima = id
    this.emitir({
      tipo: 'aviso',
      porcentaje: this.porcentaje,
      plazoMs: Math.max(0, (this.estado.hasta ?? 0) - this.ahora()),
      proyectos: proyectosEn(this.n, id)
    })
  }

  private avisar(): void {
    const id = this.elegir()
    if (id === null) this.sinCandidatos()
    else this.anunciar(id)
  }

  /** Nada que parar: se dice una vez por racha y se espera al respiro para volver a mirar. */
  private sinCandidatos(): void {
    this.victima = null
    this.estado = { fase: 'enfriando', desde: null, hasta: this.ahora() + this.tiempos.enfriamientoMs }
    if (this.avisadoSinCandidatos) return
    this.avisadoSinCandidatos = true
    this.emitir({ tipo: 'sin-candidatos', porcentaje: this.porcentaje })
  }

  private async parar(config: VigiaSaturacionConfig): Promise<void> {
    const porcentaje = this.porcentaje
    // El anunciado, si aún se puede: pudo morir o abrirse a la vista.
    const anunciado = this.victima
    const sigue = anunciado !== null && candidatos(this.n).some((c) => c.id === anunciado && !c.protegido)
    const id = sigue ? anunciado : this.elegir()
    this.victima = null
    // «Parar otro» vale para el aviso que se respondió; el siguiente vuelve a mirar a todos.
    this.descartados.clear()
    if (anunciado !== null && !sigue && id !== null) {
      // El anunciado ya no se puede (se abrió a la vista o murió): el otro se anuncia antes de pararlo.
      this.estado = { fase: 'avisando', desde: null, hasta: this.ahora() + this.tiempos.avisoMs }
      this.anunciar(id)
      return
    }
    if (id === null) {
      this.sinCandidatos()
      return
    }
    this.n.log(`saturación: paro "${id}" (Docker al ${porcentaje} %, umbral ${config.ajustes.umbralPct} %, ${config.politica.primero})`)
    try {
      await pararPor(this.n, id, { motivo: 'saturacion', politica: config.politica, porcentaje, umbralPct: config.ajustes.umbralPct })
    } catch (err) {
      this.n.log(`saturación: no se pudo parar "${id}": ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** «Parar otro» durante el aviso: descarta el anunciado y anuncia el siguiente. false si no hay otro. */
  pararOtro(): boolean {
    if (this.estado.fase !== 'avisando' || this.victima === null) return false
    const anterior = this.victima
    this.descartados.add(anterior)
    const otro = this.elegir()
    if (otro === null) {
      this.descartados.delete(anterior)
      return false
    }
    this.anunciar(otro)
    return true
  }

  private emitir(aviso: AvisoSaturacion): void {
    this.n.eventos.emitir(AGENT_TERMINAL_CHANNELS.SATURACION_AVISO, aviso)
  }
}
