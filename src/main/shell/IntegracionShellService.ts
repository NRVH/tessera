// =============================================================================
// Mantiene «Abrir con Tessera» en el registro de Windows (HKCU): dice si se puede aquí, aplica
// en caliente lo que marca Configuración y al arrancar reescribe el `command` si apunta a otro
// ejecutable. El estado aplicado vive en memoria, sembrado con los ajustes persistidos, porque
// es lo que dice qué hay que BORRAR; las aplicaciones van en cola. Escribe con
// `RegistroWindows.ts`; Electron entra por `SistemaShell`; los canales los traduce `shell/ipc.ts`.
// Decisiones: docs/decisiones/sistema/menu-contextual-de-windows.md
// =============================================================================

import { logUpdate } from '../update/logUpdate'
import { aplicarPlan, leerPredeterminado } from './RegistroWindows'
import type { SistemaShell } from './adaptadores/sistemaElectron'
import {
  claveDeSondeo,
  escriturasDe,
  exeDeComando,
  INTEGRACION_APAGADA,
  integracionVacia,
  planDeCambio,
  type EstadoIntegracion
} from '../../shared/integracionShell'
import { normalizarExtensiones } from '../../shared/extensionesShell'
import { esWindows } from '../../shared/plataforma'
import type {
  DisponibilidadShell,
  EstadoIntegracionShell,
  ResultadoIntegracion
} from '../../shared/shell-windows-ipc'

/** Cómo se llama el ajuste en el panel de Windows moderno. */
const URI_APPS_PREDETERMINADAS = 'ms-settings:defaultapps'

export interface IntegracionShellOpts {
  /** Estado con el que arrancar, leído de los ajustes persistidos. */
  inicial: EstadoIntegracion
  sistema: SistemaShell
}

export class IntegracionShellService {
  private readonly sistema: SistemaShell

  /** Lo último que se aplicó al registro. Es la base de todos los borrados. */
  private aplicado: EstadoIntegracion

  /** ¿El registro apunta a otro ejecutable y no se pudo arreglar? */
  private desactualizado = false

  /** Cadena que serializa las escrituras. Ver `aplicar`. */
  private cola: Promise<void> = Promise.resolve()

  constructor(opts: IntegracionShellOpts) {
    this.sistema = opts.sistema
    this.aplicado = {
      carpetas: opts.inicial.carpetas === true,
      archivos: opts.inicial.archivos === true,
      extensiones: normalizarExtensiones(opts.inicial.extensiones)
    }
  }

  /**
   * El ejecutable que se registra. En producción es el propio `Tessera.exe`; en
   * desarrollo sería `electron.exe`, que es justo por lo que `disponibilidad` corta.
   */
  private get exe(): string {
    return process.execPath
  }

  /**
   * ¿Se puede registrar aquí? El caso `portable` se detecta por la variable que el propio
   * lanzador de electron-builder define: en ese target el .exe corre desde una carpeta de
   * `%TEMP%` que se borra al salir, y la clave nacería apuntando a algo condenado a desaparecer.
   */
  disponibilidad(): DisponibilidadShell {
    if (!esWindows()) return 'otro-sistema'
    if (!this.sistema.empaquetada()) return 'desarrollo'
    if (typeof process.env.PORTABLE_EXECUTABLE_DIR === 'string') return 'portable'
    return 'ok'
  }

  estado(): EstadoIntegracionShell {
    return {
      disponibilidad: this.disponibilidad(),
      aplicado: {
        carpetas: this.aplicado.carpetas,
        archivos: this.aplicado.archivos,
        extensiones: [...this.aplicado.extensiones]
      },
      desactualizado: this.desactualizado
    }
  }

  /**
   * Aplica lo que pide Configuración, DE UNA EN UNA. Dos llamadas en vuelo leerían el MISMO
   * `this.aplicado`: el plan de la segunda no tendría los borrados de lo que escribió la
   * primera, sus `reg.exe` se intercalarían y quedarían ProgIDs que el servicio ya no sabe que
   * existen y nunca podrá borrar. Dos clics seguidos en dos casillas bastan para llegar ahí.
   */
  async aplicar(pedido: EstadoIntegracion): Promise<ResultadoIntegracion> {
    const turno = this.cola.then(
      () => this.aplicarAhora(pedido),
      () => this.aplicarAhora(pedido)
    )
    // La cola nunca guarda un rechazo: `aplicarAhora` no lanza, pero si algún día lo
    // hiciera, un `catch` aquí impide que la cadena se quede envenenada para siempre.
    this.cola = turno.then(
      () => undefined,
      () => undefined
    )
    return turno
  }

  private async aplicarAhora(pedido: EstadoIntegracion): Promise<ResultadoIntegracion> {
    if (this.disponibilidad() !== 'ok') {
      return { ok: false, fallos: ['La integración con el Explorador no está disponible aquí.'] }
    }
    const nuevo: EstadoIntegracion = {
      carpetas: pedido.carpetas === true,
      archivos: pedido.archivos === true,
      extensiones: normalizarExtensiones(pedido.extensiones)
    }
    const plan = planDeCambio(this.aplicado, nuevo, this.exe)
    const fallos = await aplicarPlan(plan)
    // El estado se actualiza aunque algo falle: lo que SÍ se escribió está escrito, y
    // seguir creyendo el estado viejo haría que el siguiente cambio no lo borrara.
    this.aplicado = nuevo
    this.desactualizado = false
    if (fallos.length > 0) {
      logUpdate(`integración con el Explorador: ${fallos.length} operación(es) fallaron.`)
      return { ok: false, fallos: fallos.map((f) => `${f.operacion}: ${f.detalle}`) }
    }
    logUpdate(
      `integración con el Explorador aplicada (carpetas=${nuevo.carpetas}, ` +
        `archivos=${nuevo.archivos}, extensiones=${nuevo.extensiones.length}).`
    )
    return { ok: true, fallos: [] }
  }

  /**
   * Comprueba al arrancar que el registro apunte a ESTE ejecutable y, si no, lo reescribe: la
   * clave guarda una ruta absoluta y basta reinstalar en otra carpeta para que el menú lance un
   * .exe que ya no está. No hace nada sin integración activa: sondear cuesta un `reg query`.
   */
  async reconciliar(): Promise<void> {
    if (this.disponibilidad() !== 'ok' || integracionVacia(this.aplicado)) return
    const sondeo = claveDeSondeo(this.aplicado)
    if (sondeo === null) return
    const dato = await leerPredeterminado(sondeo.clave)
    const registrado = dato === null ? null : exeDeComando(dato)
    if (registrado !== null && registrado.toLowerCase() === this.exe.toLowerCase()) return

    logUpdate(
      `integración con el Explorador desactualizada (apuntaba a ${registrado ?? 'nada'}); ` +
        'se reescribe.'
    )
    // Solo escrituras: no hay nada que borrar, es la MISMA configuración con otra ruta.
    const fallos = await aplicarPlan({
      borrarClaves: [],
      borrarValores: [],
      escrituras: escriturasDe(this.aplicado, this.exe)
    })
    this.desactualizado = fallos.length > 0
    if (this.desactualizado) {
      logUpdate('no se pudo reescribir la integración con el Explorador.')
    }
  }

  /**
   * Retira TODO lo que Tessera haya escrito. Lo usa el interruptor maestro; el desinstalador
   * tiene su propia copia en `build/installer.nsh`, porque para cuando corre ya no hay app.
   */
  async retirarTodo(): Promise<ResultadoIntegracion> {
    return this.aplicar(INTEGRACION_APAGADA)
  }

  /** Abre el panel del sistema donde el usuario elige la aplicación predeterminada de una extensión. */
  async abrirAppsPredeterminadas(): Promise<void> {
    await this.sistema.abrirExterno(URI_APPS_PREDETERMINADAS)
  }
}
