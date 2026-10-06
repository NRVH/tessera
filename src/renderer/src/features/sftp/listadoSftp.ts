// =============================================================================
// Lo que se enseña de una carpeta remota, en lógica pura: el orden (carpetas primero, luego por
// nombre sin distinguir mayúsculas ni acentos), qué entradas se pueden abrir o descargar, y el
// texto del tamaño y de la fecha. Los nombres vienen del servidor: aquí son datos, nunca HTML.
// Sin React ni DOM; se fija bajo `node` (`test-sftp.mts`). Su único import es de tipo.
// =============================================================================

import type { SftpEntrada } from '../../../../shared/sftp-ipc.ts'

const COLACION = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

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
  return [...entradas].sort((a, b) => {
    const carpetaA = esNavegable(a)
    if (carpetaA !== esNavegable(b)) return carpetaA ? -1 : 1
    const c = COLACION.compare(a.nombre, b.nombre)
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
  const texto = valor < 10 ? valor.toFixed(1).replace('.', ',') : String(Math.round(valor))
  return `${texto} ${UNIDADES[i]}`
}

/** Fecha local corta («6 oct 2026, 14:05»); `null` es «—». */
export function formatoFecha(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** El tipo, dicho para quien lee con un lector de pantalla. */
export function descripcionTipo(e: SftpEntrada): string {
  if (e.tipo === 'carpeta') return 'carpeta'
  if (e.tipo === 'archivo') return 'archivo'
  if (e.tipo === 'enlace') {
    if (e.destinoEnlace === 'carpeta') return 'enlace a una carpeta'
    return e.destinoEnlace === 'roto' ? 'enlace roto' : 'enlace'
  }
  return 'archivo especial'
}
