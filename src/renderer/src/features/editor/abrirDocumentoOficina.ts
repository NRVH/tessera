// =============================================================================
// Apertura de documentos de oficina sin pestaña, con el aviso de la ventana.
// El main recibe la ruta relativa y la identidad del proyecto por el IPC de archivos.
// Las aperturas en curso se comparten entre los gestos del editor.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import type { ResultadoAbrirRuta } from '../../../../shared/archivos-ipc'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { descartar, notify } from '../../comun/notificaciones'
import { txAperturaOficina } from './textosVisores'
import type { ArchivoAbierto } from './paneCentral'

const aperturasEnCurso = new Set<string>()

function textoDelFallo(
  nombre: string,
  extension: string,
  resultado: Extract<ResultadoAbrirRuta, { ok: false }>
): string {
  const t = txAperturaOficina()
  if (resultado.motivo === 'no-existe') return t.noExiste(nombre)
  if (resultado.motivo === 'sin-asociacion') {
    return t.sinAsociacion(nombre, extension, nombresSistema(window.tessera.plataforma).gestorArchivos)
  }
  return t.fallo(nombre, resultado.detalle)
}

/** Lanza el documento con la aplicación del sistema una sola vez mientras el IPC esté en curso. */
export async function abrirDocumentoOficina(raiz: string, archivo: ArchivoAbierto, extension: string): Promise<void> {
  const clave = JSON.stringify([raiz, archivo.ruta])
  if (aperturasEnCurso.has(clave)) return
  aperturasEnCurso.add(clave)
  const aviso = notify('info', txAperturaOficina().abriendo(archivo.nombre))
  try {
    const resultado = await window.tessera.files.abrirRuta({ raiz, ruta: archivo.ruta })
    if (!resultado.ok) {
      descartar(aviso)
      notify('error', textoDelFallo(archivo.nombre, extension, resultado))
    }
  } catch (error) {
    descartar(aviso)
    notify('error', txAperturaOficina().fallo(archivo.nombre, error instanceof Error ? error.message : String(error)))
  } finally {
    aperturasEnCurso.delete(clave)
  }
}
