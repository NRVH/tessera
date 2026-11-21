// =============================================================================
// Clasificación y saneado de errores de `ServicioArchivos.abrirRuta`.
// Módulo puro (sin Electron ni disco) para probarlo en todas las plataformas con `node`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import * as path from 'node:path'
import type { ResultadoAbrirRuta } from '../../shared/archivos-ipc.ts'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

const SIN_ASOCIACION =
  /\b(?:no (?:default )?(?:application|app)(?: is)? (?:found|associated|registered|available)|no (?:file )?association|no application to open|no method available for opening)\b/i

const NO_EXISTE_EN_TEXTO = /\bENOENT\b|no such file or directory/i

function reemplazarLiteralRuta(texto: string, objetivo: string, reemplazo: string, insensible: boolean): string {
  if (!objetivo) return texto
  const patron = new RegExp(objetivo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), insensible ? 'gi' : 'g')
  return texto.replace(patron, () => reemplazo)
}

/** Sustituye las rutas absolutas del equipo por el nombre visible del archivo o de la raíz. */
export function reemplazarRutaPorNombre(
  texto: string,
  rutaAbs: string,
  nombre: string,
  raiz?: string | null,
  plataforma: Plataforma = plataformaActual()
): string {
  const insensible = plataforma === 'windows' || plataforma === 'mac'
  let limpio = reemplazarLiteralRuta(texto, rutaAbs, nombre, insensible)
  if (plataforma === 'windows') {
    limpio = reemplazarLiteralRuta(limpio, rutaAbs.split('\\').join('/'), nombre, true)
    limpio = reemplazarLiteralRuta(limpio, rutaAbs.split('/').join('\\'), nombre, true)
  }
  if (raiz) {
    const nombreRaiz = (plataforma === 'windows' ? path.win32.basename(raiz) : path.posix.basename(raiz)) || nombre
    limpio = reemplazarLiteralRuta(limpio, raiz, nombreRaiz, insensible)
    if (plataforma === 'windows') {
      limpio = reemplazarLiteralRuta(limpio, raiz.split('\\').join('/'), nombreRaiz, true)
      limpio = reemplazarLiteralRuta(limpio, raiz.split('/').join('\\'), nombreRaiz, true)
    }
  }
  return limpio
}

/** Clasifica un error de `fs.stat` al comprobar un documento antes de abrirlo. */
export function clasificarErrorStat(
  error: unknown,
  rutaAbs: string,
  nombre: string,
  raiz?: string | null,
  plataforma: Plataforma = plataformaActual()
): Exclude<ResultadoAbrirRuta, { ok: true }> {
  const codigo = (error as NodeJS.ErrnoException | null)?.code
  if (codigo === 'ENOENT' || codigo === 'ENOTDIR') return { ok: false, motivo: 'no-existe' }
  const mensaje = error instanceof Error ? error.message : String(error)
  return { ok: false, motivo: 'otro', detalle: reemplazarRutaPorNombre(mensaje, rutaAbs, nombre, raiz, plataforma) }
}

/** Clasifica el resultado de texto que devuelve el adaptador de escritorio (`shell.openPath`). */
export function clasificarErrorEscritorio(
  error: string,
  rutaAbs: string,
  nombre: string,
  raiz?: string | null,
  plataforma: Plataforma = plataformaActual()
): ResultadoAbrirRuta {
  if (!error) return { ok: true }
  if (SIN_ASOCIACION.test(error)) return { ok: false, motivo: 'sin-asociacion' }
  if (NO_EXISTE_EN_TEXTO.test(error)) return { ok: false, motivo: 'no-existe' }
  return { ok: false, motivo: 'otro', detalle: reemplazarRutaPorNombre(error, rutaAbs, nombre, raiz, plataforma) }
}
