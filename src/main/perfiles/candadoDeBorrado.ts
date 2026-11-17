// =============================================================================
// El candado del borrado de un perfil: el guardado de perfiles lo mantiene de principio a fin mientras
// borra lo de un perfil, y lo que da vida a un perfil con ese id (su carpeta del agente de la terminal,
// su espacio de datos, abrir sus sesiones) espera a que se suelte. Sin él, recrear el perfil mientras se
// borra dejaría que el borrado tocase lo del perfil nuevo. Un `MutexPorClave` por la clave del id
// (`claveDePerfil` de `util/carpetaDePerfil.ts`, el mismo criterio que el resto del borrado); sin Electron.
// Decisiones: docs/decisiones/workspace/borrar-perfil-con-orden.md
// =============================================================================
import { claveDePerfil as clave } from '../util/carpetaDePerfil.ts'
import { MutexPorClave } from '../util/mutex.ts'

/** Un candado por id de perfil entre su borrado y lo que lo recrea; ids distintos no se esperan. */
export class CandadoDeBorrado {
  private readonly candados = new MutexPorClave()

  /** Corre `fn`, el borrado del perfil, con su candado tomado de principio a fin. */
  mientrasSeBorra<T>(perfilId: string, fn: () => Promise<T>): Promise<T> {
    return this.candados.ejecutarExclusivo(clave(perfilId), fn)
  }

  /**
   * Corre `fn` cuando no se está borrando ese perfil, con el candado tomado para que ningún borrado
   * empiece a mitad. Para lo corto y síncrono: preparar la carpeta de un perfil.
   */
  trasElBorrado<T>(perfilId: string, fn: () => T): Promise<T> {
    return this.candados.ejecutarExclusivo(clave(perfilId), async () => fn())
  }

  /**
   * Espera a que termine el borrado en curso (o ya encolado) de ese perfil, sin quedarse el candado:
   * para lo largo, como abrir una sesión, que no tiene por qué esperar a otras del mismo perfil. Un id
   * que no es un texto no espera: la petición la rechaza quien la atiende.
   */
  async esperar(perfilId: unknown): Promise<void> {
    if (typeof perfilId !== 'string') return
    await this.candados.ejecutarExclusivo(clave(perfilId), async () => {})
  }
}
