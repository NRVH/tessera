// =============================================================================
// Provider del addon OSC 52 de xterm (`@xterm/addon-clipboard`): enruta la copia de
// las TUIs por el IPC de Tessera hacia el portapapeles del sistema. Recibe y entrega
// texto plano (el addon hace el base64) y solo atiende la selección `c`.
// Decisiones: docs/decisiones/terminales/raton-y-portapapeles-de-la-terminal.md
// =============================================================================

import type { IClipboardProvider, ClipboardSelectionType } from '@xterm/addon-clipboard'

const SELECCION_SISTEMA = 'c'

class ProveedorPortapapelesTessera implements IClipboardProvider {
  async readText(seleccion: ClipboardSelectionType): Promise<string> {
    if ((seleccion as string) !== SELECCION_SISTEMA) return ''
    return window.tessera.portapapeles.leerTexto()
  }
  async writeText(seleccion: ClipboardSelectionType, texto: string): Promise<void> {
    if ((seleccion as string) !== SELECCION_SISTEMA) return
    await window.tessera.portapapeles.escribirTexto(texto)
  }
}

/** Instancia compartida (sin estado): un solo provider sirve a todas las terminales. */
export const proveedorPortapapelesTessera = new ProveedorPortapapelesTessera()
