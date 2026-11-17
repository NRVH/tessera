// =============================================================================
// La ventana del relevo como objeto: la crea con la página que le dan, pinta los estados en
// orden y guarda el registro que enseña, que es el mismo que va a disco. Los botones de la
// página llegan como marcas por consola y se entregan a quien escuche.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================

import { BrowserWindow } from 'electron'
import type { EstadoPintable } from '../../../shared/relevo'

export class VentanaRelevo {
  /** El registro en pantalla: las mismas líneas que el archivo, en el mismo orden. */
  readonly lineas: string[] = []
  private cola: Promise<unknown> = Promise.resolve()
  private titulo: string
  private detalle: string

  private constructor(
    private readonly ventana: BrowserWindow,
    inicial: { titulo: string; detalle: string }
  ) {
    this.titulo = inicial.titulo
    this.detalle = inicial.detalle
  }

  /** `html` es la página entera; `inicial`, el paso con el que se repinta hasta el primero. */
  static async abrir(html: string, tituloVentana: string, inicial: { titulo: string; detalle: string }): Promise<VentanaRelevo> {
    const ventana = new BrowserWindow({
      // Ancho para las cuatro salidas de un fallo en una fila.
      width: 640,
      // Alto pensado para el caso PEOR (fallo: título + explicación de tres líneas +
      // registro desplegado + botones), que es cuando la ventana de verdad tiene que
      // servir: el registro tiene que verse con varios renglones.
      height: 440,
      resizable: false,
      minimizable: false,
      maximizable: false,
      // Sin menú y sin barra propia: es un diálogo, no una ventana de trabajo.
      autoHideMenuBar: true,
      backgroundColor: '#1b1d23',
      show: false,
      title: tituloVentana,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    ventana.setMenu(null)
    ventana.once('ready-to-show', () => ventana.show())
    await ventana.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    return new VentanaRelevo(ventana, inicial)
  }

  /**
   * Los pintados van ENCOLADOS. Cada uno es un `executeJavaScript` asíncrono, y sueltos
   * competirían: uno anterior podría ganar la carrera al último y la ventana enseñaría menos
   * registro que el archivo. Aquí se promete que digan LO MISMO.
   */
  pintar(e: EstadoPintable): void {
    if (this.ventana.isDestroyed()) return
    const carga = JSON.stringify({ ...e, log: this.lineas })
    this.cola = this.cola.then(() =>
      this.ventana.isDestroyed()
        ? undefined
        : this.ventana.webContents.executeJavaScript(`window.relevo.estado(${carga})`).catch(() => undefined)
    )
  }

  /** Un paso en marcha: se recuerda para repintarlo con cada línea nueva del registro. */
  paso(titulo: string, detalle: string): void {
    this.titulo = titulo
    this.detalle = detalle
    this.pintar({ fase: 'instalando', titulo, detalle })
  }

  /** Una línea a disco y a pantalla. */
  registrar(log: (m: string) => void, m: string): void {
    log(m)
    this.lineas.push(m)
    this.pintar({ fase: 'instalando', titulo: this.titulo, detalle: this.detalle })
  }

  /**
   * Los botones avisan por consola (`location.hash` no funciona en una URL `data:`). El mensaje
   * se lee del OBJETO del evento: los argumentos posicionales están deprecados desde Electron 35,
   * y el día que los retiren los botones dejarían de hacer nada sin dar ningún error.
   */
  alPulsar(atender: (marca: string) => void): void {
    this.ventana.webContents.on('console-message', (e) => atender(e.message))
  }
}
