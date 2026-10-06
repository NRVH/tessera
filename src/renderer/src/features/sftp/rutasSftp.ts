// =============================================================================
// Rutas REMOTAS (POSIX, del servidor) del explorador SFTP, en lógica pura: normalizar, unir, padre,
// nombre, migas de la ruta actual y validar el nombre de una carpeta nueva o renombrada. Nunca se
// mira el sistema del equipo: estas rutas no tienen nada que ver con él. Sin React ni DOM; se fija
// bajo `node` (`test-sftp.mts`). Sin dependencias.
// =============================================================================

/** Una miga: lo que se ve y la ruta absoluta a la que lleva. */
export interface Miga {
  nombre: string
  ruta: string
}

/** Ruta absoluta sin `//` ni barra final; vacía o solo barras es la raíz. */
export function normalizarRuta(ruta: string): string {
  const trozos = ruta.split('/').filter((t) => t !== '')
  return '/' + trozos.join('/')
}

/** `nombre` dentro de la carpeta `base`. */
export function unirRuta(base: string, nombre: string): string {
  const b = normalizarRuta(base)
  return b === '/' ? `/${nombre}` : `${b}/${nombre}`
}

/**
 * Adónde va lo soltado: dentro de la carpeta de la lista sobre la que se soltó (como en el gestor de archivos
 * del sistema) o, fuera de las filas o sobre un archivo, a la carpeta que se ve.
 */
export function destinoDeSoltar(ruta: string, carpeta: string | null): string {
  return carpeta === null ? normalizarRuta(ruta) : unirRuta(ruta, carpeta)
}

/** La carpeta que contiene `ruta`; la raíz es su propio padre. */
export function padreDe(ruta: string): string {
  const r = normalizarRuta(ruta)
  const i = r.lastIndexOf('/')
  return i <= 0 ? '/' : r.slice(0, i)
}

/** Lo último de la ruta; vacío en la raíz. */
export function nombreDe(ruta: string): string {
  const r = normalizarRuta(ruta)
  return r.slice(r.lastIndexOf('/') + 1)
}

/** Las migas de una ruta, de la raíz a la carpeta actual (la raíz se llama «/»). */
export function migasDe(ruta: string): Miga[] {
  const migas: Miga[] = [{ nombre: '/', ruta: '/' }]
  let acumulada = '/'
  for (const trozo of normalizarRuta(ruta).split('/').filter((t) => t !== '')) {
    acumulada = unirRuta(acumulada, trozo)
    migas.push({ nombre: trozo, ruta: acumulada })
  }
  return migas
}

/** Por qué un nombre no sirve para una carpeta o un renombrado; `null` si sirve. */
export function validarNombre(nombre: string): string | null {
  const n = nombre.trim()
  if (n === '') return 'Escribe un nombre.'
  if (n === '.' || n === '..') return 'Ese nombre no es válido.'
  if (n.includes('/')) return 'El nombre no puede llevar «/».'
  if (n.includes('\0')) return 'El nombre tiene un carácter no válido.'
  return null
}
