// =============================================================================
// Espacio de datos de un perfil: la carpeta `<userData>/conexiones/<perfil>` que se abre como un
// proyecto más y donde se siembra el `CLAUDE.md`/`AGENTS.md` del agente de datos.
// Depende de `agentMemory.ts` (el contexto que se escribe) y del registro de conexiones.
// =============================================================================
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { escribirContextoEspacio } from '../agentMemory.ts'
import type { ConnectionStore } from '../ConnectionStore.ts'
import { mismaRuta } from '../hostEnv.ts'

/** Gestiona la carpeta de datos de cada perfil y su contexto de agente. */
export class EspacioDatos {
  private readonly userDataDir: string
  private readonly connections: Pick<ConnectionStore, 'listaCompleta'>
  private readonly log: (msg: string) => void

  constructor(userDataDir: string, connections: Pick<ConnectionStore, 'listaCompleta'>, log: (msg: string) => void) {
    this.userDataDir = userDataDir
    this.connections = connections
    this.log = log
  }

  /**
   * Ruta `<userData>/conexiones/<perfilId>`, sin crearla, validando que sea hija directa de
   * `conexiones/`: el id llega del renderer y un `..` o una barra sacarían la escritura de la
   * carpeta. Lanza sin la ruta dentro del mensaje.
   */
  ruta(profileId: string): string {
    const base = path.resolve(this.userDataDir, 'conexiones')
    const valido =
      typeof profileId === 'string' &&
      profileId !== '' &&
      profileId !== '.' &&
      profileId !== '..' &&
      !profileId.includes('\u0000') &&
      path.basename(profileId) === profileId
    if (valido) {
      const destino = path.resolve(base, profileId)
      if (path.dirname(destino) === base) return destino
    }
    throw new Error('Identificador de perfil no válido.')
  }

  /** `ruta` sin lanzar: un id inválido no tiene espacio y da cadena vacía, que no casa con ninguna ruta. */
  rutaOVacia(profileId: string): string {
    try {
      return this.ruta(profileId)
    } catch {
      return ''
    }
  }

  /**
   * ¿Es `projectHostPath` el espacio de datos del perfil? Solo decide redacción de textos, nunca
   * qué bases se ven.
   */
  esEspacioDeDatos(profileId: string, projectHostPath: string): boolean {
    return mismaRuta(projectHostPath, this.rutaOVacia(profileId))
  }

  /** Rutas del espacio de datos de cada perfil, sin crearlas; un id inválido se omite. */
  rutas(profileIds: string[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const id of profileIds) {
      try {
        out[id] = this.ruta(id)
      } catch {
        // Un id basura no tiene espacio de datos; los demás sí.
      }
    }
    return out
  }

  /** Crea el espacio si hace falta, siembra el contexto del agente y devuelve la ruta que abrirá el renderer. */
  asegurar(profileId: string, nombrePerfil: string): { projectHostPath: string; name: string } {
    const dir = this.ruta(profileId)
    mkdirSync(dir, { recursive: true })
    this.escribirContexto(dir, profileId, nombrePerfil)
    // `name` es lo que se pinta en la pestaña; el basename de la carpeta es el id del perfil.
    return { projectHostPath: dir, name: 'Conexiones' }
  }

  /** Regenera el contexto del agente de un perfil, si su espacio ya existe. */
  refrescarContexto(profileId: string, nombrePerfil: string): void {
    const dir = this.ruta(profileId)
    if (!existsSync(dir)) return // aún no lo ha abierto: se sembrará al crearlo
    this.escribirContexto(dir, profileId, nombrePerfil)
  }

  /** El catálogo y la marca del formato ajeno salen de la misma lectura (`listaCompleta`). */
  private escribirContexto(dir: string, profileId: string, nombrePerfil: string): void {
    const lista = this.connections.listaCompleta(profileId)
    escribirContextoEspacio(dir, nombrePerfil, lista.conexiones, lista.formatoAjeno ? lista.aviso : null, this.log)
  }
}
