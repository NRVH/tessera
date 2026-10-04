// =============================================================================
// Qué contenedores son DE TESSERA, los únicos que el barrido, el cierre y la hibernación
// pueden parar o borrar: nombre que EMPIEZA por `tessera-` Y nacido de la imagen del sandbox
// (su etiqueta, o su `Config.Image` para los anteriores a la etiqueta). `pruebas-*` y los
// del usuario no se tocan. Puro, sin Docker: se prueba con `node`.
// Decisiones: docs/decisiones/sandbox/contenedores-propios.md
// =============================================================================

/** Prefijo del nombre de todo contenedor que crea Tessera. */
export const PREFIJO_CONTENEDOR = 'tessera-'

/** Etiqueta que la imagen del sandbox pone a cada contenedor que nace de ella. */
export const ETIQUETA_IMAGEN_SANDBOX = 'tessera.sandbox.version'

/** Filtro de `docker ps` para los CANDIDATOS: anclado al principio del nombre. */
export const FILTRO_NOMBRE_PROPIO = `name=^${PREFIJO_CONTENEDOR}`

/** Lo que hace falta del `docker inspect` de un contenedor para decidir. */
export interface FichaContenedor {
  /** `Name` de Docker: lleva una barra delante (`/tessera-qa`). */
  Name?: string
  Config?: { Image?: string; Labels?: Record<string, string> | null } | null
}

/** Nombre sin la barra con la que lo devuelve `docker inspect`. */
export function nombreDeFicha(f: FichaContenedor): string {
  const n = f.Name ?? ''
  return n.startsWith('/') ? n.slice(1) : n
}

/**
 * ¿Lo creó Tessera? Nombre con el prefijo Y nacido de la imagen del sandbox (por su
 * etiqueta o, si es anterior a ella, por la referencia de imagen). Ver la cabecera.
 */
export function esContenedorDeTessera(f: FichaContenedor, imagenSandbox: string): boolean {
  if (!nombreDeFicha(f).startsWith(PREFIJO_CONTENEDOR)) return false
  const etiqueta = f.Config?.Labels?.[ETIQUETA_IMAGEN_SANDBOX]
  if (typeof etiqueta === 'string' && etiqueta !== '') return true
  const imagen = f.Config?.Image ?? ''
  return imagen === imagenSandbox || imagen.startsWith(`${imagenSandbox}:`) || imagen.startsWith(`${imagenSandbox}@`)
}

/**
 * Lee la salida de `docker inspect <n1> <n2>…` (un array JSON). Si alguno desapareció
 * entre el `ps` y el `inspect`, Docker sale con error pero imprime el resto: se lee lo
 * que haya. Salida ilegible = ninguno, que para borrar es el lado seguro.
 */
export function leerFichas(stdout: string): FichaContenedor[] {
  const t = stdout.trim()
  if (t === '') return []
  try {
    const v = JSON.parse(t) as unknown
    return Array.isArray(v) ? (v.filter((x) => x !== null && typeof x === 'object') as FichaContenedor[]) : []
  } catch {
    return []
  }
}

/** Nombres de los contenedores de Tessera de una salida de `docker inspect`. */
export function contenedoresDeTessera(stdoutInspect: string, imagenSandbox: string): string[] {
  return leerFichas(stdoutInspect)
    .filter((f) => esContenedorDeTessera(f, imagenSandbox))
    .map(nombreDeFicha)
}

/** Lo mínimo de `runDocker` que hace falta aquí (se inyecta: el test pone el suyo). */
export type EjecutarDocker = (args: string[]) => Promise<{ status: number | null; stdout: string; stderr: string }>

/**
 * Los contenedores de Tessera que hay ahora: los candidatos por nombre ANCLADO y, de
 * esos, los que salen de la imagen del sandbox. `null` = no se pudo listar (Docker
 * caído, timeout): el llamador no borra nada, que es distinto de «no hay ninguno».
 */
export async function listarContenedoresDeTessera(
  docker: EjecutarDocker,
  imagenSandbox: string
): Promise<string[] | null> {
  const ps = await docker(['ps', '-a', '--filter', FILTRO_NOMBRE_PROPIO, '--format', '{{.Names}}'])
  if (ps.status !== 0) return null
  const candidatos = ps.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (candidatos.length === 0) return []
  // Un `status` de error NO invalida lo impreso: si uno desapareció entre el `ps` y
  // aquí, Docker sale con error pero imprime los demás (y si desaparecieron todos,
  // imprime `[]`). Lo que sí es «no se sabe» es un fallo SIN salida (timeout, daemon
  // que no contesta): ahí null, o el cierre daría por hecho que no queda ninguno y
  // desmontaría las raíces con los contenedores vivos.
  const ins = await docker(['inspect', ...candidatos])
  if (ins.status !== 0 && ins.stdout.trim() === '') return null
  return contenedoresDeTessera(ins.stdout, imagenSandbox)
}

/**
 * El texto del error cuando el nombre del contenedor de un perfil ya lo usa un
 * contenedor que no es de Tessera: no se toca, y el usuario sabe por qué y qué hacer.
 */
export function mensajeContenedorAjeno(nombre: string): string {
  return (
    `Ya existe un contenedor «${nombre}» que no creó Tessera, y Tessera no borra ni para ` +
    'contenedores ajenos. Cámbiale el nombre (docker rename) para poder usar el ' +
    'aislamiento de este perfil.'
  )
}
