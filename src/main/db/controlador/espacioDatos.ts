// =============================================================================
// Espacio de datos de un perfil: la carpeta `<userData>/conexiones/<perfil>` que se abre como un
// proyecto más, donde se siembra el `CLAUDE.md`/`AGENTS.md` del agente de datos y que va a la
// papelera con el perfil. Depende de `agentMemory.ts` (el contexto que se escribe), del registro de conexiones y
// de `util/carpetaDePerfil.ts` (la ruta y el borrado, con la papelera que le inyectan).
// =============================================================================
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { hijaDirectaALaPapelera, rutaHijaDirecta, rutasHijas, type APapelera, type ResultadoBorrado } from '../../util/carpetaDePerfil.ts'
import { escribirContextoEspacio } from '../agentMemory.ts'
import type { ConnectionStore } from '../ConnectionStore.ts'
import { mismaRuta } from '../hostEnv.ts'

/** Gestiona la carpeta de datos de cada perfil y su contexto de agente. */
export class EspacioDatos {
  /** `<userData>/conexiones`, donde cuelga la carpeta de cada perfil. */
  private readonly base: string
  private readonly connections: Pick<ConnectionStore, 'listaCompleta'>
  /** La papelera del sistema (`shell.trashItem`), adonde va el espacio de un perfil borrado; nunca en firme. */
  private readonly papelera: APapelera
  private readonly log: (msg: string) => void

  constructor(
    userDataDir: string,
    connections: Pick<ConnectionStore, 'listaCompleta'>,
    papelera: APapelera,
    log: (msg: string) => void
  ) {
    this.base = path.resolve(userDataDir, 'conexiones')
    this.connections = connections
    this.papelera = papelera
    this.log = log
  }

  /**
   * Ruta `<userData>/conexiones/<perfilId>`, sin crearla, validando que sea hija directa de
   * `conexiones/` (`util/carpetaDePerfil.ts`): el id llega del renderer. Lanza sin la ruta en el mensaje.
   */
  ruta(profileId: string): string {
    return rutaHijaDirecta(this.base, profileId)
  }

  /**
   * El usuario BORRÓ el perfil: su espacio, con el contexto del agente, sus consolas y lo que haya
   * dejado en él, va a la papelera del sistema. Solo lo llama el guardado de perfiles; `idsVivos` da
   * los que existen en cada momento.
   */
  borrar(profileId: string, idsVivos: () => readonly string[]): Promise<ResultadoBorrado> {
    return hijaDirectaALaPapelera(this.base, profileId, idsVivos, this.papelera)
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
    return rutasHijas(this.base, profileIds)
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
