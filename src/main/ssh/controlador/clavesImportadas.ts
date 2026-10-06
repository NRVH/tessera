// =============================================================================
// Las claves importadas: elegir (diálogo nativo) o soltar el archivo, leerlo en el acto, validarlo
// por su contenido (`formatoClave.ts`), dejar una copia provisional protegida y comprobarla con el
// `ssh-keygen` del sistema; al guardar la conexión, la copia pasa a `ssh/claves/<id>`. Al cerrar se
// borran las provisionales de la sesión. El original no se toca y al renderer solo llegan una ficha y
// el nombre. Sin electron: el diálogo, los permisos y las órdenes llegan por parámetro.
// Decisiones: docs/decisiones/ssh/claves-importadas.md
// =============================================================================

import { randomUUID } from 'node:crypto'
import { existsSync, renameSync, rmSync } from 'node:fs'
import { open, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { Plataforma } from '../../../shared/plataforma.ts'
import type { SshClaveElegida } from '../../../shared/ssh-ipc.ts'
import { Fichas, VIDA_FICHA_POR_DEFECTO_MS } from '../../util/fichas.ts'
import { SUFIJO_CLAVE_ANTERIOR } from '../ConexionesSsh.ts'
import type { ClaveSshPersistida } from '../conservarAlEditarSsh.ts'
import {
  TOPE_CLAVE_BYTES,
  decidirImportacion,
  mensajeDeLectura,
  nombreDeClave,
  reconocerClave,
  veredictoKeygen,
  veredictoSinKeygen,
  type ClaveReconocida,
  type SalidaCorta,
  type VeredictoKeygen
} from '../formatoClave.ts'
import { codigoDeError, rutaCopiaClave } from '../registroSsh.ts'

/** Las copias provisionales: `ssh/claves/.import-<aleatorio>`. Al arrancar solo se barren estas. */
export const PREFIJO_PROVISIONAL = '.import-'
const TOPE_KEYGEN_MS = 5000
/** Un shell de Git exporta su propio programa de frases: `ssh-keygen` no debe preguntar nada. */
const QUITAR_ENV_KEYGEN = ['SSH_ASKPASS', 'SSH_ASKPASS_REQUIRE', 'DISPLAY']

export const MENSAJE_FICHA_CLAVE =
  'Ese archivo de clave ya no está elegido (pasó demasiado tiempo o se reinició Tessera). Vuelve a elegirlo.'
const MENSAJE_OTRO_PERFIL = 'Ese archivo de clave se eligió para otro perfil: vuelve a elegirlo.'
const MENSAJE_SIN_PROTEGER = 'No se pudo guardar una copia protegida de la clave: inténtalo otra vez.'
const MENSAJE_SIN_INSTALAR = 'No se pudo guardar la copia de la clave: inténtalo otra vez.'

/** Un error con el mensaje ya escrito para el usuario y sin rutas. */
export class ErrorClave extends Error {}

/** Una copia provisional lista para guardarse con una conexión. */
interface Provisional {
  ruta: string
  nombre: string
  tipo: string | null
  cifrada: boolean
  /** El perfil para el que se eligió o se soltó: solo vale para una conexión de ese perfil. */
  profileId: string
}

/** Lo que el diálogo nativo necesita y devuelve (las formas de Electron, sin importarlo). */
export interface DialogoClave {
  (
    opciones: { title: string; properties: Array<'openFile' | 'showHiddenFiles'>; buttonLabel: string },
    candidatas: { despues: string[] }
  ): Promise<{ canceled: boolean; filePaths: string[] }>
}

/** Lo que recibe: dónde, cómo abrir el diálogo, los permisos y cómo correr `ssh-keygen`. */
export interface DependenciasClaves {
  /** La carpeta `ssh/claves`. */
  dir: string
  plataforma: Plataforma
  elegirArchivo: DialogoClave
  /** El `ssh-keygen` del sistema, o `null`; se pregunta en cada uso. */
  sshKeygen: () => string | null
  permisos: {
    asegurarCarpeta: (dir: string) => Promise<void>
    escribirProtegida: (ruta: string, texto: string) => Promise<void>
  }
  ejecutar: (exe: string, args: readonly string[], opciones: { topeMs: number; quitarEnv?: readonly string[] }) => Promise<SalidaCorta>
  home?: string
  ahora?: () => number
  log?: (mensaje: string) => void
}

/** Una copia ya en su sitio: lo que guarda el registro, y cómo confirmarla o deshacerla. */
export interface InstalacionClave {
  clave: ClaveSshPersistida
  /** El registro la aceptó: la ficha se gasta y la clave anterior se borra. */
  confirmar: () => void
  /** El registro falló: la anterior vuelve a su sitio y la ficha sigue valiendo. */
  deshacer: () => void
}

/** Las claves importadas de todos los perfiles. Una instancia por proceso. */
export class ClavesImportadas {
  private readonly d: DependenciasClaves
  private readonly fichas: Fichas<Provisional>
  private readonly log: (mensaje: string) => void

  constructor(d: DependenciasClaves) {
    this.d = d
    this.log = d.log ?? ((m) => console.log(`[ssh] ${m}`))
    this.fichas = new Fichas<Provisional>({ ahora: d.ahora, alCaducar: (p) => this.borrarSinRuido(p.ruta) })
  }

  /** Diálogo nativo para elegir la clave (abre en lo último elegido o en `~/.ssh`); `null` si se cancela. */
  async elegir(profileId: string): Promise<SshClaveElegida | null> {
    const r = await this.d.elegirArchivo(
      { title: 'Elige el archivo de la clave privada', properties: ['openFile', 'showHiddenFiles'], buttonLabel: 'Elegir' },
      { despues: [path.join(this.d.home ?? homedir(), '.ssh')] }
    )
    if (r.canceled || r.filePaths.length === 0) return null
    return this.importar(r.filePaths[0], profileId)
  }

  /** Un archivo soltado sobre el campo (la ruta la sacó el preload), tratado como uno elegido para `profileId`. */
  async soltada(ruta: string, profileId: string): Promise<SshClaveElegida> {
    if (typeof ruta !== 'string' || ruta === '') throw new ErrorClave('Ese elemento no es un archivo del equipo.')
    return this.importar(ruta, profileId)
  }

  /** La copia de la clave de una conexión. */
  rutaDe(id: string): string {
    const ruta = rutaCopiaClave(this.d.dir, id)
    if (ruta === null) throw new ErrorClave('El id de la conexión no es válido.')
    return ruta
  }

  /**
   * Pasa la copia provisional de `token` a `ssh/claves/<id>`; la que hubiera queda en `<id>.anterior`
   * hasta `confirmar`. Lanza, sin tocar nada, si la ficha no vale para ese perfil.
   */
  instalar(token: unknown, id: string, profileId: string): InstalacionClave {
    const p = this.fichas.ver(token)
    if (p === undefined) throw new ErrorClave(MENSAJE_FICHA_CLAVE)
    if (p.profileId !== profileId) throw new ErrorClave(MENSAJE_OTRO_PERFIL)
    const destino = this.rutaDe(id)
    const anterior = `${destino}${SUFIJO_CLAVE_ANTERIOR}`
    const apartada = existsSync(destino)
    try {
      // Una `.anterior` que quedó de una edición cortada ya no la cita nadie: la que se aparta es la vigente.
      rmSync(anterior, { force: true })
      if (apartada) renameSync(destino, anterior)
      renameSync(p.ruta, destino)
    } catch (e) {
      if (apartada && !existsSync(destino)) this.renombrarSinRuido(anterior, destino)
      this.log(`no se pudo poner en su sitio la clave de ${id}: ${codigoDeError(e)}`)
      throw new ErrorClave(MENSAJE_SIN_INSTALAR, { cause: e })
    }
    return {
      clave: { nombre: p.nombre, tipo: p.tipo ?? '', cifrada: p.cifrada },
      confirmar: () => {
        this.fichas.olvidar(token as string)
        if (apartada) this.borrarSinRuido(anterior)
      },
      deshacer: () => {
        if (!this.renombrarSinRuido(destino, p.ruta)) {
          this.borrarSinRuido(destino)
          this.fichas.olvidar(token as string)
        }
        if (apartada) this.renombrarSinRuido(anterior, destino)
      }
    }
  }

  /**
   * Borra las copias provisionales sin ficha viva y más viejas que una ficha: de otra sesión, o
   * caducadas que no se pudieron borrar. Nunca lanza. La copia se escribe ANTES de emitir su ficha
   * (tras `ssh-keygen`, hasta 5 s), así que por la fecha sola caería la de una ficha aún viva.
   */
  async barrerCaducadas(): Promise<void> {
    // `valores` poda antes: la copia de cada ficha caducada la borra su aviso.
    const conFicha = new Set(this.fichas.valores().map((p) => p.ruta))
    let nombres: string[]
    try {
      nombres = await readdir(this.d.dir)
    } catch {
      return // sin carpeta no hay nada que barrer
    }
    const limite = (this.d.ahora ?? Date.now)() - VIDA_FICHA_POR_DEFECTO_MS
    for (const nombre of nombres.filter((n) => n.startsWith(PREFIJO_PROVISIONAL))) {
      const ruta = path.join(this.d.dir, nombre)
      if (conFicha.has(ruta)) continue // la borra la poda al caducar, o pasa a claves/<id> al guardar
      try {
        if ((await stat(ruta)).mtimeMs < limite) await rm(ruta, { force: true })
      } catch (e) {
        this.log(`no se pudo barrer una copia provisional de clave: ${codigoDeError(e)}`)
      }
    }
  }

  /**
   * Al cerrar la app: las copias provisionales de esta sesión que no llegaron a guardarse se borran ya (sus
   * fichas mueren con el proceso). Son copias: el original nunca se toca. Síncrono, porque corre en la salida
   * del proceso; nunca lanza. La que no se pueda borrar la recoge el barrido del siguiente arranque.
   */
  alSalir(): void {
    for (const p of this.fichas.valores()) this.borrarSinRuido(p.ruta)
  }

  private async importar(ruta: string, profileId: string): Promise<SshClaveElegida> {
    const nombre = nombreDeClave(path.basename(ruta))
    try {
      const reconocida = reconocerClave(await this.leer(ruta, nombre), nombre)
      if (!reconocida.ok) throw new ErrorClave(reconocida.error)
      await this.barrerCaducadas()
      const provisional = await this.copiaProtegida(reconocida.clave.texto)
      const decision = decidirImportacion(reconocida.clave, await this.comprobar(provisional, reconocida.clave), nombre)
      if (!decision.ok) {
        this.borrarSinRuido(provisional)
        throw new ErrorClave(decision.error)
      }
      const token = this.fichas.emitir({ ruta: provisional, nombre, tipo: decision.tipo, cifrada: decision.cifrada, profileId })
      return { token, nombre, tipo: decision.tipo, cifrada: decision.cifrada }
    } catch (e) {
      if (e instanceof ErrorClave) throw e
      this.log(`no se pudo importar una clave: ${String(e)}`)
      throw new ErrorClave(`No se pudo importar «${nombre}» (${codigoDeError(e, 'error inesperado')}).`, { cause: e })
    }
  }

  /** Lee el archivo EN EL ACTO (en macOS el permiso del diálogo no dura) y nunca más que el tope y uno. */
  private async leer(ruta: string, nombre: string): Promise<Buffer> {
    let archivo: Awaited<ReturnType<typeof open>> | null = null
    try {
      archivo = await open(ruta, 'r')
      const bytes = Buffer.alloc(TOPE_CLAVE_BYTES + 1)
      let leidos = 0
      for (;;) {
        const { bytesRead } = await archivo.read(bytes, leidos, bytes.length - leidos, leidos)
        leidos += bytesRead
        if (bytesRead === 0 || leidos === bytes.length) break
      }
      return bytes.subarray(0, leidos)
    } catch (e) {
      throw new ErrorClave(mensajeDeLectura(codigoDeError(e), nombre, this.d.plataforma), { cause: e })
    } finally {
      await archivo?.close().catch(() => undefined)
    }
  }

  /** La copia provisional, en la carpeta protegida y protegida ella misma. */
  private async copiaProtegida(texto: string): Promise<string> {
    const ruta = path.join(this.d.dir, `${PREFIJO_PROVISIONAL}${randomUUID()}`)
    try {
      await this.d.permisos.asegurarCarpeta(this.d.dir)
      await this.d.permisos.escribirProtegida(ruta, texto)
    } catch (e) {
      this.log(`no se pudo proteger la copia de una clave: ${String(e)}`)
      throw new ErrorClave(MENSAJE_SIN_PROTEGER, { cause: e })
    }
    return ruta
  }

  /** `ssh-keygen -y -P ""` sobre la copia ya protegida: ssh rechaza leer una clave con permisos abiertos. */
  private async comprobar(ruta: string, c: ClaveReconocida): Promise<VeredictoKeygen> {
    const keygen = this.d.sshKeygen()
    if (keygen === null) {
      this.log('sin ssh-keygen en el equipo: la clave importada se acepta por su contenido')
      return veredictoSinKeygen(c)
    }
    const r = await this.d.ejecutar(keygen, ['-y', '-P', '', '-f', ruta], { topeMs: TOPE_KEYGEN_MS, quitarEnv: QUITAR_ENV_KEYGEN })
    const v = veredictoKeygen(r)
    if (v.tipo === 'ilegible') this.log(`ssh-keygen no lee una clave importada: ${v.motivo} (salida ${r.codigo ?? 'sin código'})`)
    return v
  }

  private borrarSinRuido(ruta: string): void {
    try {
      rmSync(ruta, { force: true })
    } catch (e) {
      this.log(`no se pudo borrar una copia de clave: ${codigoDeError(e)}`)
    }
  }

  private renombrarSinRuido(desde: string, hacia: string): boolean {
    try {
      renameSync(desde, hacia)
      return true
    } catch (e) {
      this.log(`no se pudo devolver una copia de clave a su sitio: ${codigoDeError(e)}`)
      return false
    }
  }
}
