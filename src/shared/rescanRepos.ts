// =============================================================================
// ¿Puede esta ráfaga del watcher haber cambiado la lista de repos de la contenedora?
// `scanRepos` solo mira el `.git` de la raíz y el de sus subcarpetas DIRECTAS: cuentan una
// entrada de primer nivel, `.git/...` y `repo/.git/...`; lo demás es ruido, por hondo que sea.
// No es una optimización opcional: el antirrebote del renderer (400 ms) es menor que el
// hueco entre eventos del main (600 ms), y sin el filtro cada evento de un build relanzaba
// un escaneo de ~1000 `stat` con la carpeta padre de todos los proyectos abierta.
// Con `parcial: true` no se puede decidir y se re-escanea. Puro, para probarlo con `node`.
// =============================================================================
export interface RafagaWatcher {
  /** Rutas POSIX relativas a la raíz activa. Puede venir truncada: ver `parcial`. */
  paths: readonly string[]
  /** `true` si hubo más cambios de los que cabían en `paths`. */
  parcial: boolean
}

/** ¿Una ruta relativa concreta puede alterar la lista de repos de primer nivel? */
export function rutaAfectaRepos(rutaPosix: string): boolean {
  // Normalización defensiva: el contrato dice POSIX relativo, pero una barra
  // inicial o final colada convertiría el primer segmento en "" y nos haría
  // tratar la raíz como una entrada de primer nivel.
  const limpia = rutaPosix.replace(/^\/+/, '').replace(/\/+$/, '')
  if (limpia.length === 0) return false

  const partes = limpia.split('/')
  // Entrada de primer nivel: una carpeta que aparece o desaparece SÍ cambia la
  // lista (un `git clone` recién terminado, un `rm -rf` de un repo). Esta es la
  // rama por la que pasa el tráfico real de `files:changed`.
  if (partes.length === 1) return true
  // `.git` de la raíz, o `.git` de una subcarpeta directa: es LITERALMENTE lo que
  // decide si algo es un repo.
  // DEFENSIVAS: hoy ninguna ruta con `.git` llega por `files:changed` (el clasificador
  // de `FileService` la desvía antes, y la cubre `files:gitChanged`, que va sin filtrar).
  // Se dejan porque la respuesta no depende del canal: si mañana el clasificador deja
  // pasar un `.git`, el filtro tiene que seguir siendo correcto.
  if (partes[0] === '.git') return true
  if (partes[1] === '.git') return true
  return false
}

/** ¿Hay que re-escanear los repos por esta ráfaga? */
export function necesitaReescaneo(rafaga: RafagaWatcher): boolean {
  // Lista truncada: no se puede descartar nada con fundamento.
  if (rafaga.parcial) return true
  return rafaga.paths.some(rutaAfectaRepos)
}
