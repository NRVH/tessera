// =============================================================================
// Piezas comunes de los visores de archivos: acciones de sistema y
// object-URL. Solo IPC; el renderer no toca disco ni ve rutas del host.
// Lo usan `useVisorBinario` y `useCargaImagen`.
// =============================================================================

import type { MutableRefObject } from 'react'
import type { ResultadoAbrirRuta, RutaEnProyecto } from '../../../../shared/archivos-ipc'
import { txVisorComun } from './textosVisores.ts'

function detalleDelFallo(resultado: Extract<ResultadoAbrirRuta, { ok: false }>): string {
  const t = txVisorComun()
  if (resultado.motivo === 'no-existe') return t.archivoNoExiste
  if (resultado.motivo === 'sin-asociacion') return t.sinAsociacion
  return resultado.detalle
}

/** Abre el archivo con la app del sistema; devuelve el aviso a mostrar si falla. */
export async function abrirExterno(ruta: RutaEnProyecto): Promise<string | null> {
  try {
    const resultado = await window.tessera.files.abrirRuta(ruta)
    return resultado.ok ? null : txVisorComun().noSePudoAbrirConApp(detalleDelFallo(resultado))
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** Revela el archivo en el gestor de archivos del sistema; devuelve el aviso si falla. */
export async function revelarEnCarpeta(ruta: RutaEnProyecto): Promise<string | null> {
  try {
    await window.tessera.files.revelar(ruta)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** Revoca el object-URL guardado en la ref, si lo hay, y la deja vacía. */
export function revocarUrl(ref: MutableRefObject<string | null>): void {
  if (ref.current) {
    URL.revokeObjectURL(ref.current)
    ref.current = null
  }
}
