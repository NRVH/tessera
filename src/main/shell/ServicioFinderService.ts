// =============================================================================
// Mantiene la acción rápida del Finder en `~/Library/Services`: dice si se puede aquí, instala
// o borra el `.workflow` en caliente y al arrancar lo reescribe si apunta a otro `.app`. No
// guarda estado: la verdad es el disco (el usuario puede borrar la carpeta a mano) y leerlo
// cuesta un `stat`. Toda escritura pasa por una cola. La parte pura está en `servicioFinder.ts`;
// Electron entra por `SistemaShell`; los canales los traduce `shell/ipc.ts`.
// Decisiones: docs/decisiones/sistema/accion-rapida-del-finder.md
// =============================================================================

import { homedir } from 'node:os'
import { logUpdate } from '../update/logUpdate'
import type { SistemaShell } from './adaptadores/sistemaElectron'
import {
  appDelWflow,
  desinstalarServicioFinder,
  disponibilidadFinder,
  instalarServicioFinder,
  leerWflowInstalado,
  refrescarRegistroServicios,
  rutaAppDesdeEjecutable
} from './servicioFinder'
import type {
  DisponibilidadFinder,
  EstadoServicioFinder,
  ResultadoServicioFinder
} from '../../shared/servicio-finder-ipc'

export class ServicioFinderService {
  /** El HOME donde vive `Library/Services`. Parámetro para poder probar el servicio. */
  private readonly home: string

  private readonly sistema: Pick<SistemaShell, 'empaquetada'>

  /** El `.workflow` apunta a otra copia de Tessera y no se pudo arreglar. */
  private desactualizado = false

  /** Cadena que serializa las escrituras, por el mismo motivo que en Windows. */
  private cola: Promise<void> = Promise.resolve()

  constructor(opts: { home?: string; sistema: Pick<SistemaShell, 'empaquetada'> }) {
    this.home = opts.home ?? homedir()
    this.sistema = opts.sistema
  }

  /** La ruta del `.app` de ESTA copia, que es la que se hornea en el `.workflow`. */
  private get rutaApp(): string | null {
    return rutaAppDesdeEjecutable(process.execPath)
  }

  disponibilidad(): DisponibilidadFinder {
    return disponibilidadFinder({
      empaquetada: this.sistema.empaquetada(),
      execPath: process.execPath
    })
  }

  async estado(): Promise<EstadoServicioFinder> {
    const wflow = await leerWflowInstalado(this.home)
    return {
      disponibilidad: this.disponibilidad(),
      instalado: wflow !== null,
      desactualizado: this.desactualizado
    }
  }

  /**
   * Instala o borra la acción rápida, DE UNA EN UNA: dos clics seguidos escriben y borran la
   * MISMA carpeta a la vez, y el `rm -rf` del segundo puede intercalarse entre el `mkdir` y el
   * `writeFile` del primero y dejar un `.workflow` a medias, que se registra y al pulsarlo no
   * hace nada.
   */
  async aplicar(activo: boolean): Promise<ResultadoServicioFinder> {
    return this.enCola(() => this.aplicarAhora(activo))
  }

  /**
   * Encola un trabajo detrás de los anteriores, pasen o fallen. TODO lo que escriba en
   * `~/Library/Services` entra por aquí, también la reconciliación del arranque: escribe la
   * misma carpeta, y el `pbs -flush` de cada operación tarda hasta 10 s, así que solaparse con un
   * clic en el interruptor no es teórico.
   */
  private enCola<T>(trabajo: () => Promise<T>): Promise<T> {
    const turno = this.cola.then(trabajo, trabajo)
    this.cola = turno.then(
      () => undefined,
      () => undefined
    )
    return turno
  }

  private async aplicarAhora(activo: boolean): Promise<ResultadoServicioFinder> {
    if (this.disponibilidad() !== 'ok') {
      return { ok: false, fallos: ['La acción rápida del Finder no está disponible aquí.'] }
    }
    const rutaApp = this.rutaApp
    if (rutaApp === null) {
      return { ok: false, fallos: ['No se pudo localizar el paquete de Tessera.'] }
    }

    const fallos = activo
      ? await instalarServicioFinder(this.home, rutaApp)
      : await desinstalarServicioFinder(this.home)

    // El flush va SIEMPRE, incluso si algo falló: puede haber quedado escrito a medias y
    // lo que el sistema tenga que ver, mejor que lo vea ya.
    await refrescarRegistroServicios()

    if (fallos.length > 0) {
      // La bandera de «apunta a otra copia» solo se limpia cuando de verdad se escribió lo
      // correcto: un `aplicar` que no consiguió escribir nada no puede apagar el aviso que
      // `reconciliar` encendió con razón.
      logUpdate(`acción rápida del Finder: ${fallos.length} operación(es) fallaron.`)
      return { ok: false, fallos: fallos.map((f) => `${f.operacion}: ${f.detalle}`) }
    }
    this.desactualizado = false
    logUpdate(`acción rápida del Finder ${activo ? 'instalada' : 'retirada'}.`)
    return { ok: true, fallos: [] }
  }

  /**
   * Comprueba al arrancar que el `.workflow` instalado apunte a ESTE `.app` y, si no, lo
   * reescribe. No hace nada si no hay ninguno instalado: nunca se crea el servicio por esta vía.
   * Va por la cola entera, también la lectura previa: entre decidir «hay que reescribir» y
   * hacerlo cabría un `desinstalar` completo.
   */
  async reconciliar(): Promise<void> {
    return this.enCola(async () => {
      if (this.disponibilidad() !== 'ok') return
      const rutaApp = this.rutaApp
      if (rutaApp === null) return
      const wflow = await leerWflowInstalado(this.home)
      if (wflow === null) return
      if (appDelWflow(wflow) === rutaApp) return

      logUpdate(
        `acción rápida del Finder desactualizada (apuntaba a ${appDelWflow(wflow) ?? 'nada'}); ` +
          'se reescribe.'
      )
      const fallos = await instalarServicioFinder(this.home, rutaApp)
      await refrescarRegistroServicios()
      this.desactualizado = fallos.length > 0
      if (this.desactualizado) logUpdate('no se pudo reescribir la acción rápida del Finder.')
    })
  }
}
