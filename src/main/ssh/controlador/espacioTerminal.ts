// =============================================================================
// La carpeta del agente de la terminal de un perfil, `<userData>/terminal/<perfil>`: se valida como
// hija directa, se crea al prepararla, va a la papelera con el perfil y su `CLAUDE.md`/`AGENTS.md` lleva el
// bloque `tessera:ssh` con las conexiones del perfil, que se regenera cuando cambian. Calca
// `db/controlador/espacioDatos.ts`. Depende del registro SSH (`listar`), del catálogo y el texto de
// `catalogoAgentes.ts` y `bloqueAgenteTerminal.ts`, del escritor de `db/agentMemory.ts` y de
// `util/carpetaDePerfil.ts` (la ruta y el borrado, con la papelera que le inyectan).
// Decisiones: docs/decisiones/agentes/agente-de-la-terminal.md
// =============================================================================
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { SSH_CHANNELS, type SshListaConexiones } from '../../../shared/ssh-ipc.ts'
import { escribirBloqueContexto } from '../../db/agentMemory.ts'
import { hijaDirectaALaPapelera, rutaHijaDirecta, rutasHijas, type APapelera, type ResultadoBorrado } from '../../util/carpetaDePerfil.ts'
import type { EmisorEventos } from '../../util/emisorEventos.ts'
import type { CandadoDeBorrado } from '../../profiles/candadoDeBorrado.ts'
import type { LlegadaDePerfiles } from '../../profiles/llegadaDePerfiles.ts'
import { FIN_SSH, INICIO_SSH, bloqueAgenteTerminal } from '../bloqueAgenteTerminal.ts'
import { catalogoAgentes } from '../catalogoAgentes.ts'

/** Cómo se llama la carpeta en la pestaña de la sesión: su basename es el id del perfil. */
const NOMBRE_VISIBLE = 'Terminal'

/** Lo que recibe la carpeta del agente de la terminal. */
export interface OpcionesEspacioTerminal {
  userDataDir: string
  /** El registro de un perfil (`ConexionesSsh.listar(profileId)`); su catálogo se saca en cada escritura. */
  listar: (profileId: string) => SshListaConexiones
  /** La papelera del sistema (`shell.trashItem`), adonde va la carpeta de un perfil borrado; nunca en firme. */
  papelera: APapelera
  log?: (mensaje: string) => void
}

/** Un perfil, tal como lo necesita la regeneración: su id y el nombre que se escribe. */
export interface PerfilEspacio {
  id: string
  nombre: string
}

/**
 * El emisor del controlador SSH, que además regenera el contexto del agente de la terminal cada vez que
 * avisa de un cambio del registro (`ssh:cambio`): lo que lee el agente sigue a la lista sin que el
 * controlador lo sepa. Un fallo al regenerar se registra y no corta el aviso al renderer.
 */
export function emisorQueRegenera(emisor: EmisorEventos, regenerar: () => void, log: (mensaje: string) => void): EmisorEventos {
  return {
    emitir(canal, payload) {
      emisor.emitir(canal, payload)
      if (canal !== SSH_CHANNELS.CAMBIO) return
      try {
        regenerar()
      } catch (err) {
        log(`no se pudo regenerar el contexto del agente de la terminal: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    hayDestino: () => emisor.hayDestino()
  }
}

/**
 * Lo que ven los canales de la carpeta (`ESPACIO_ASEGURAR` y `ESPACIO_RUTAS`). Solo se prepara la de
 * un perfil que el main conoce: si no, un perfil recién borrado (o un id inventado) volvería a tener
 * carpeta. Y solo cuando no se está borrando un perfil con ese id (`borrados`): el borrado mandaría a
 * la papelera la carpeta recién sembrada del perfil recreado. El nombre que se escribe es el del main,
 * no el que manda el renderer. Un perfil recién creado puede pedir su carpeta antes de que llegue el
 * guardado que lo trae: antes de la guarda se espera, con tope, a que llegue (`llegada`).
 */
export function espacioParaIpc(
  espacio: Pick<EspacioTerminal, 'asegurar' | 'rutas'>,
  perfiles: () => readonly PerfilEspacio[],
  borrados: Pick<CandadoDeBorrado, 'trasElBorrado'>,
  llegada?: Pick<LlegadaDePerfiles, 'esperar'>
): {
  asegurar: (profileId: string) => Promise<{ projectHostPath: string; name: string }>
  rutas: (profileIds: readonly string[]) => Record<string, string>
} {
  return {
    asegurar: async (profileId) => {
      // Fuera del candado: esperar la llegada no debe retrasar el borrado de otro perfil con ese id.
      await llegada?.esperar(profileId)
      return borrados.trasElBorrado(profileId, () => {
        // Tras el borrado, con la lista de ese momento: un perfil recreado mientras tanto ya está.
        const perfil = perfiles().find((p) => p.id === profileId)
        if (!perfil) throw new Error('Ese perfil no existe: no se prepara la carpeta de su agente de la terminal.')
        return espacio.asegurar(perfil.id, perfil.nombre)
      })
    },
    rutas: (profileIds) => espacio.rutas(profileIds)
  }
}

/** Gestiona la carpeta del agente de la terminal de cada perfil y su contexto. */
export class EspacioTerminal {
  private readonly base: string
  private readonly listar: (profileId: string) => SshListaConexiones
  private readonly papelera: APapelera
  private readonly log: (mensaje: string) => void

  constructor(opts: OpcionesEspacioTerminal) {
    this.base = path.resolve(opts.userDataDir, 'terminal')
    this.listar = opts.listar
    this.papelera = opts.papelera
    this.log = opts.log ?? ((m) => console.log(`[ssh] ${m}`))
  }

  /** Ruta `<userData>/terminal/<perfilId>`, sin crearla; lanza con un id que no sea hija directa. */
  ruta(profileId: string): string {
    return rutaHijaDirecta(this.base, profileId)
  }

  /** Rutas de la carpeta de cada perfil, sin crearlas; un id inválido se omite. */
  rutas(profileIds: readonly string[]): Record<string, string> {
    return rutasHijas(this.base, profileIds)
  }

  /**
   * El usuario BORRÓ el perfil: su carpeta, con su `CLAUDE.md`/`AGENTS.md` y lo que haya dejado en
   * ella, va a la papelera del sistema. Solo lo llama el guardado de perfiles; `idsVivos` da los que
   * existen en cada momento (ver `hijaDirectaALaPapelera`).
   */
  borrar(profileId: string, idsVivos: () => readonly string[]): Promise<ResultadoBorrado> {
    return hijaDirectaALaPapelera(this.base, profileId, idsVivos, this.papelera)
  }

  /** Crea la carpeta si hace falta, siembra el contexto y devuelve la ruta que abrirá el renderer. */
  asegurar(profileId: string, nombrePerfil: string): { projectHostPath: string; name: string } {
    const dir = this.ruta(profileId)
    mkdirSync(dir, { recursive: true })
    this.escribirContexto(dir, profileId, nombrePerfil)
    return { projectHostPath: dir, name: NOMBRE_VISIBLE }
  }

  /**
   * Regenera el contexto de los perfiles cuya carpeta ya existe (las demás se siembran al crearlas).
   * Cada uno lee solo sus conexiones; un perfil que falla no impide los demás.
   */
  refrescar(perfiles: readonly PerfilEspacio[]): void {
    for (const p of perfiles) {
      let dir: string
      try {
        dir = this.ruta(p.id)
      } catch {
        continue
      }
      if (!existsSync(dir)) continue
      this.escribirContexto(dir, p.id, p.nombre)
    }
  }

  /** Escribe el bloque `tessera:ssh` en los dos archivos (`escribirBloqueContexto`). */
  private escribirContexto(dir: string, profileId: string, nombrePerfil: string): void {
    const bloque = bloqueAgenteTerminal(nombrePerfil, catalogoAgentes(this.listar(profileId), profileId))
    escribirBloqueContexto(dir, bloque, { inicio: INICIO_SSH, fin: FIN_SSH }, (nombre, err) =>
      // El nombre del archivo y no su ruta: el registro no necesita la carpeta del usuario.
      this.log(`no se pudo escribir ${nombre} del agente de la terminal del perfil ${profileId}: ${String(err)}`)
    )
  }
}
