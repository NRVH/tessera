// =============================================================================
// Espacio de datos de un perfil: la carpeta `<userData>/conexiones/<perfil>` que se abre como un
// proyecto más, donde se siembra el `CLAUDE.md`/`AGENTS.md` del agente de datos y que va a la
// papelera con el perfil. Depende de `memoriaAgente.ts` (el contexto que se escribe), del registro de conexiones y
// de `util/carpetaDePerfil.ts` (la ruta y el borrado, con la papelera que le inyectan).
// =============================================================================
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { hijaDirectaALaPapelera, rutaHijaDirecta, rutasHijas, type APapelera, type ResultadoBorrado } from '../../util/carpetaDePerfil.ts'
import { escribirContextoEspacio } from '../memoriaAgente.ts'
import type { AlmacenConexiones } from '../AlmacenConexiones.ts'
import { mismaRuta } from '../entornoHost.ts'

/** Gestiona la carpeta de datos de cada perfil y su contexto de agente. */
export class EspacioDatos {
  /** `<userData>/conexiones`, donde cuelga la carpeta de cada perfil. */
  private readonly base: string
  private readonly conexiones: Pick<AlmacenConexiones, 'listaCompleta'>
  /** La papelera del sistema (`shell.trashItem`), adonde va el espacio de un perfil borrado; nunca en firme. */
  private readonly papelera: APapelera
  private readonly log: (msg: string) => void

  constructor(
    dirDatosUsuario: string,
    conexiones: Pick<AlmacenConexiones, 'listaCompleta'>,
    papelera: APapelera,
    log: (msg: string) => void
  ) {
    this.base = path.resolve(dirDatosUsuario, 'conexiones')
    this.conexiones = conexiones
    this.papelera = papelera
    this.log = log
  }

  /**
   * Ruta `<userData>/conexiones/<perfilId>`, sin crearla, validando que sea hija directa de
   * `conexiones/` (`util/carpetaDePerfil.ts`): el id llega del renderer. Lanza sin la ruta en el mensaje.
   */
  ruta(perfilId: string): string {
    return rutaHijaDirecta(this.base, perfilId)
  }

  /**
   * El usuario BORRÓ el perfil: su espacio, con el contexto del agente, sus consolas y lo que haya
   * dejado en él, va a la papelera del sistema. Solo lo llama el guardado de perfiles; `idsVivos` da
   * los que existen en cada momento.
   */
  borrar(perfilId: string, idsVivos: () => readonly string[]): Promise<ResultadoBorrado> {
    return hijaDirectaALaPapelera(this.base, perfilId, idsVivos, this.papelera)
  }

  /** `ruta` sin lanzar: un id inválido no tiene espacio y da cadena vacía, que no casa con ninguna ruta. */
  rutaOVacia(perfilId: string): string {
    try {
      return this.ruta(perfilId)
    } catch {
      return ''
    }
  }

  /**
   * ¿Es `projectHostPath` el espacio de datos del perfil? Solo decide redacción de textos, nunca
   * qué bases se ven.
   */
  esEspacioDeDatos(perfilId: string, rutaHostProyecto: string): boolean {
    return mismaRuta(rutaHostProyecto, this.rutaOVacia(perfilId))
  }

  /** Rutas del espacio de datos de cada perfil, sin crearlas; un id inválido se omite. */
  rutas(perfilIds: string[]): Record<string, string> {
    return rutasHijas(this.base, perfilIds)
  }

  /** Crea el espacio si hace falta, siembra el contexto del agente y devuelve la ruta que abrirá el renderer. */
  asegurar(perfilId: string, nombrePerfil: string): { projectHostPath: string; name: string } {
    const dir = this.ruta(perfilId)
    mkdirSync(dir, { recursive: true })
    this.escribirContexto(dir, perfilId, nombrePerfil)
    // `name` es lo que se pinta en la pestaña; el basename de la carpeta es el id del perfil.
    return { projectHostPath: dir, name: 'Conexiones' }
  }

  /** Regenera el contexto del agente de un perfil, si su espacio ya existe. */
  refrescarContexto(perfilId: string, nombrePerfil: string): void {
    const dir = this.ruta(perfilId)
    if (!existsSync(dir)) return // aún no lo ha abierto: se sembrará al crearlo
    this.escribirContexto(dir, perfilId, nombrePerfil)
  }

  /** El catálogo y la marca del formato ajeno salen de la misma lectura (`listaCompleta`). */
  private escribirContexto(dir: string, perfilId: string, nombrePerfil: string): void {
    const lista = this.conexiones.listaCompleta(perfilId)
    escribirContextoEspacio(dir, nombrePerfil, lista.conexiones, lista.formatoAjeno ? lista.aviso : null, this.log)
  }
}
