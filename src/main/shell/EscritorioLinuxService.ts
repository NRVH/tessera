// =============================================================================
// Mantiene el `tessera.desktop` de Linux: dice si se puede aquí, lo instala o lo borra en
// caliente y al arrancar lo reescribe si apunta a otro ejecutable (el AppImage se movió o cambió
// de nombre) o es de una versión anterior. Con él va el tipo de los `.tessera`. Instalarlo no le
// quita las carpetas a su aplicación (`carpetasPorDefecto.ts`). La
// verdad es el disco; toda escritura pasa por una cola. La parte pura está en `escritorioLinux.ts`;
// Electron entra por `SistemaShell` y por las rutas que pasa `index.ts`.
// Decisiones: docs/decisiones/sistema/abrir-con-en-linux.md
// =============================================================================

import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { logUpdate } from '../update/logUpdate'
import { txShell } from './textos.ts'
import type { SistemaShell } from './adaptadores/sistemaElectron'
import {
  ARCHIVO_DESKTOP,
  carpetaDatos,
  contenidoDesktop,
  desinstalarDesktop,
  disponibilidadEscritorioLinux,
  ejecutableDelDesktop,
  esDesktopPropio,
  fijadaDelDesktop,
  instalarDesktop,
  leerDesktopInstalado,
  mimeAlDia,
  refrescarBaseEscritorio,
  rutaIcono,
  rutaIconoDocumento,
  type FalloEscritorio
} from './escritorioLinux'
import {
  MIME_CARPETA,
  aplicacionAFijar,
  conDefecto,
  consultarCarpetas,
  defectoDeclarado,
  escribirMimeapps,
  leerMimeapps,
  rutaMimeapps,
  sinDefecto
} from './carpetasPorDefecto'
import type {
  DisponibilidadEscritorioLinux,
  EstadoEscritorioLinux,
  ResultadoEscritorioLinux
} from '../../shared/escritorio-linux-ipc'

export class EscritorioLinuxService {
  /** `$XDG_DATA_HOME` o `~/.local/share`; parámetro para poder probarlo en una carpeta temporal. */
  private readonly datos: string

  private readonly sistema: Pick<SistemaShell, 'empaquetada'>

  /** Lo que se lanza: el AppImage o el ejecutable (`rutaEjecutableLinux`). */
  private readonly ejecutable: () => string

  /** El PNG de la marca dentro de los recursos de la app. */
  private readonly iconoOrigen: string

  /** El instalado apunta a otra copia de Tessera y no se pudo arreglar. */
  private desactualizado = false

  private cola: Promise<void> = Promise.resolve()

  /** `mimeapps.list` del usuario, donde se fija la aplicación de las carpetas. */
  private readonly mimeapps: string

  /** Qué abre hoy las carpetas; parámetro para que el test no dependa del escritorio. */
  private readonly consultarCarpetas: () => Promise<{ defecto: string | null; registradas: string[] }>

  constructor(opts: {
    sistema: Pick<SistemaShell, 'empaquetada'>
    ejecutable: () => string
    iconoOrigen: string
    home?: string
    xdgDataHome?: string
    xdgConfigHome?: string
    consultarCarpetas?: () => Promise<{ defecto: string | null; registradas: string[] }>
  }) {
    this.datos = carpetaDatos({ home: opts.home ?? homedir(), xdgDataHome: opts.xdgDataHome })
    this.mimeapps = rutaMimeapps({ home: opts.home ?? homedir(), xdgConfigHome: opts.xdgConfigHome })
    this.consultarCarpetas = opts.consultarCarpetas ?? consultarCarpetas
    this.sistema = opts.sistema
    this.ejecutable = opts.ejecutable
    this.iconoOrigen = opts.iconoOrigen
  }

  disponibilidad(): DisponibilidadEscritorioLinux {
    return disponibilidadEscritorioLinux({ empaquetada: this.sistema.empaquetada() })
  }

  async estado(): Promise<EstadoEscritorioLinux> {
    const desktop = await leerDesktopInstalado(this.datos)
    const propio = desktop !== null && esDesktopPropio(desktop)
    return {
      disponibilidad: this.disponibilidad(),
      instalado: propio,
      ajeno: desktop !== null && !propio,
      desactualizado: this.desactualizado
    }
  }

  /** Instala o borra, de una en una: dos clics seguidos escriben y borran el mismo archivo. */
  async aplicar(activo: boolean): Promise<ResultadoEscritorioLinux> {
    return this.enCola(() => this.aplicarAhora(activo))
  }

  private enCola<T>(trabajo: () => Promise<T>): Promise<T> {
    const turno = this.cola.then(trabajo, trabajo)
    this.cola = turno.then(
      () => undefined,
      () => undefined
    )
    return turno
  }

  /**
   * Instala la entrada. ANTES fija en `mimeapps.list` la aplicación que abre las carpetas, para
   * que la nuestra no pase a abrirlas (`carpetasPorDefecto.ts`); si la entrada no se escribe, se
   * deshace. Una reescritura conserva lo que fijó la primera instalación.
   */
  private async escribir(): Promise<FalloEscritorio[]> {
    const previo = await leerDesktopInstalado(this.datos)
    let fijada = previo !== null && esDesktopPropio(previo) ? fijadaDelDesktop(previo) : null
    let fijadaAhora = false
    if (fijada === null) {
      try {
        const mimeapps = await leerMimeapps(this.mimeapps)
        const aFijar =
          defectoDeclarado(mimeapps, MIME_CARPETA) === null
            ? aplicacionAFijar(await this.consultarCarpetas(), ARCHIVO_DESKTOP)
            : null
        if (aFijar !== null) {
          await escribirMimeapps(this.mimeapps, conDefecto(mimeapps, MIME_CARPETA, aFijar))
          fijada = aFijar
          fijadaAhora = true
        }
      } catch (e) {
        return [{ operacion: txShell().linux.conservarAplicacion, detalle: e instanceof Error ? e.message : String(e) }]
      }
    }
    const { fallos, iconoCopiado, mimeEscrito } = await instalarDesktop(this.datos, this.ejecutable(), this.iconoOrigen, fijada)
    if (!iconoCopiado) logUpdate(`no se pudo copiar el icono desde ${this.iconoOrigen}.`)
    if (!mimeEscrito) logUpdate('no se pudo escribir el tipo de los archivos .tessera; se abrirán desde Configuración.')
    if (fallos.length > 0 && fijadaAhora && fijada !== null) await this.soltarCarpetas(fijada)
    return fallos
  }

  /** Borra la entrada y, si al instalarla se fijó la aplicación de las carpetas, lo deshace. */
  private async retirar(): Promise<FalloEscritorio[]> {
    const previo = await leerDesktopInstalado(this.datos)
    const fijada = previo !== null && esDesktopPropio(previo) ? fijadaDelDesktop(previo) : null
    const fallos = await desinstalarDesktop(this.datos)
    if (fallos.length === 0 && fijada !== null) await this.soltarCarpetas(fijada)
    return fallos
  }

  /** Quita la línea que se puso, si sigue tal cual. Que no se pueda no estorba: es la que ya las abría. */
  private async soltarCarpetas(fijada: string): Promise<void> {
    try {
      const actual = await leerMimeapps(this.mimeapps)
      const nuevo = sinDefecto(actual, MIME_CARPETA, fijada)
      if (nuevo !== actual) await escribirMimeapps(this.mimeapps, nuevo)
    } catch (e) {
      logUpdate(`no se pudo deshacer la aplicación fijada para las carpetas: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private async aplicarAhora(activo: boolean): Promise<ResultadoEscritorioLinux> {
    if (this.disponibilidad() !== 'ok') {
      return { ok: false, fallos: [txShell().linux.noDisponible] }
    }
    const fallos = activo ? await this.escribir() : await this.retirar()
    await refrescarBaseEscritorio(this.datos)
    if (fallos.length > 0) {
      logUpdate(`entrada de escritorio: ${fallos.length} operación(es) fallaron.`)
      return { ok: false, fallos: fallos.map((f) => `${f.operacion}: ${f.detalle}`) }
    }
    this.desactualizado = false
    logUpdate(`entrada de escritorio ${activo ? 'instalada' : 'retirada'}.`)
    return { ok: true, fallos: [] }
  }

  /**
   * Al arrancar: si NUESTRO `.desktop` apunta a otro ejecutable o no es el que escribe esta
   * versión (le falta el tipo `.tessera`, o su definición), se reescribe. Nunca lo crea, y uno
   * sin la clave propia no se toca. La lectura previa va en la cola con la escritura.
   */
  async reconciliar(): Promise<void> {
    return this.enCola(async () => {
      if (this.disponibilidad() !== 'ok') return
      const desktop = await leerDesktopInstalado(this.datos)
      if (desktop === null || !esDesktopPropio(desktop)) return
      const actual = this.ejecutable()
      const apuntaba = ejecutableDelDesktop(desktop)
      const esperado = contenidoDesktop(actual, rutaIcono(this.datos), fijadaDelDesktop(desktop))
      // El icono de los `.tessera` también: si su primera copia falló, se repone.
      const iconoDocumento = await access(rutaIconoDocumento(this.datos)).then(
        () => true,
        () => false
      )
      if (apuntaba === actual && desktop === esperado && iconoDocumento && (await mimeAlDia(this.datos))) return
      logUpdate(`entrada de escritorio desactualizada (apuntaba a ${apuntaba ?? 'nada'}); se reescribe.`)
      const fallos = await this.escribir()
      await refrescarBaseEscritorio(this.datos)
      this.desactualizado = fallos.length > 0
      if (this.desactualizado) logUpdate('no se pudo reescribir la entrada de escritorio.')
    })
  }
}
