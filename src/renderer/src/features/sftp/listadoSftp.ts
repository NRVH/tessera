// =============================================================================
// Lo que se enseña de una carpeta remota, en lógica pura: el orden (carpetas primero, luego por
// nombre sin distinguir mayúsculas ni acentos), qué entradas se pueden abrir o descargar, y el
// texto del tamaño y de la fecha. Los nombres vienen del servidor: aquí son datos, nunca HTML.
// Sin React ni DOM; se fija bajo `node` (`test-sftp.mts`). Depende de los textos y del idioma.
// =============================================================================

import { idiomaActual, localeActual } from '../../../../shared/i18n.ts'
import type { SftpEntrada } from '../../../../shared/sftp-ipc.ts'
import { txSftp } from './textos.ts'

const colacion = (): Intl.Collator => new Intl.Collator(localeActual(), { sensitivity: 'base', numeric: true })

/** ¿Se entra en ella como en una carpeta? Una carpeta, o un enlace que apunta a una. */
export function esNavegable(e: SftpEntrada): boolean {
  return e.tipo === 'carpeta' || (e.tipo === 'enlace' && e.destinoEnlace === 'carpeta')
}

/** ¿Se puede bajar? Archivos y carpetas, y los enlaces que llevan a uno; no un socket ni un enlace roto. */
export function esDescargable(e: SftpEntrada): boolean {
  if (e.tipo === 'carpeta' || e.tipo === 'archivo') return true
  return e.tipo === 'enlace' && (e.destinoEnlace === 'carpeta' || e.destinoEnlace === 'archivo')
}

/** Carpetas (y enlaces a carpeta) primero; dentro de cada grupo, por nombre. No toca el original. */
export function ordenarEntradas(entradas: readonly SftpEntrada[]): SftpEntrada[] {
  const cmp = colacion()
  return [...entradas].sort((a, b) => {
    const carpetaA = esNavegable(a)
    if (carpetaA !== esNavegable(b)) return carpetaA ? -1 : 1
    const c = cmp.compare(a.nombre, b.nombre)
    if (c !== 0) return c
    return a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0
  })
}

const UNIDADES = ['B', 'KB', 'MB', 'GB', 'TB']

/** «512 B», «1,5 KB», «12 MB»: base 1024, un decimal por debajo de 10. `null` es «—». */
export function formatoTamano(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—'
  let valor = bytes
  let i = 0
  while (valor >= 1024 && i < UNIDADES.length - 1) {
    valor /= 1024
    i++
  }
  if (i === 0) return `${Math.round(valor)} B`
  // El separador decimal es el del idioma: coma en español, punto en inglés.
  const decimal = valor.toFixed(1)
  const texto = valor < 10 ? (idiomaActual() === 'en' ? decimal : decimal.replace('.', ',')) : String(Math.round(valor))
  return `${texto} ${UNIDADES[i]}`
}

/** Fecha local corta («6 oct 2026, 14:05»); `null` es «—». */
export function formatoFecha(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString(localeActual(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** El tipo, dicho para quien lee con un lector de pantalla. */
export function descripcionTipo(e: SftpEntrada): string {
  const t = txSftp()
  if (e.tipo === 'carpeta') return t.tipoCarpeta
  if (e.tipo === 'archivo') return t.tipoArchivo
  if (e.tipo === 'enlace') {
    if (e.destinoEnlace === 'carpeta') return t.tipoEnlaceCarpeta
    return e.destinoEnlace === 'roto' ? t.tipoEnlaceRoto : t.tipoEnlace
  }
  return t.tipoEspecial
}
