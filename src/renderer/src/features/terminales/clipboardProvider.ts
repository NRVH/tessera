// =============================================================================
// Provider del addon OSC 52 de xterm (`@xterm/addon-clipboard`): enruta la copia de
// las TUIs por el IPC de Tessera hacia el portapapeles del sistema. Recibe y entrega
// texto plano (el addon hace el base64) y solo atiende la selección `c`.
// Decisiones: docs/decisiones/terminales/raton-y-portapapeles-de-la-terminal.md
// =============================================================================

import type { IClipboardProvider, ClipboardSelectionType } from '@xterm/addon-clipboard'

const SYSTEM_SELECTION = 'c'

class TesseraClipboardProvider implements IClipboardProvider {
  async readText(selection: ClipboardSelectionType): Promise<string> {
    if ((selection as string) !== SYSTEM_SELECTION) return ''
    return window.tessera.clipboard.read()
  }
  async writeText(selection: ClipboardSelectionType, text: string): Promise<void> {
    if ((selection as string) !== SYSTEM_SELECTION) return
    await window.tessera.clipboard.write(text)
  }
}

/** Instancia compartida (sin estado): un solo provider sirve a todas las terminales. */
export const tesseraClipboardProvider = new TesseraClipboardProvider()
