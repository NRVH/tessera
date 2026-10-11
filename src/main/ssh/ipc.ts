// =============================================================================
// Registro de los canales `SSH_CHANNELS`: único sitio del dominio con `ipcMain`. Comprueba la FORMA
// de cada petición (que cada campo sea del tipo del contrato) y delega en `ControladorSsh`; lo que
// vale cada campo lo decide el registro. Solo lo importa `src/main/ssh/componer.ts`.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================
import type { IpcMain } from 'electron'
import { SSH_CHANNELS, SSH_LOTE_MAX, type SshActividadPerfil, type SshConexionInput, type SshExportarOpenSsh, type SshMetodo, type SshTipoTunel, type SshTunel } from '../../shared/ssh-ipc.ts'
import { esObjeto } from '../util/valores.ts'
import type { ControladorSsh } from './ControladorSsh.ts'
import type { DialogoAskpass } from './controlador/dialogoAskpass.ts'

const MAL_FORMADA = 'Petición de conexiones SSH mal formada'

function objeto(v: unknown, que: string): Record<string, unknown> {
  if (!esObjeto(v)) throw new Error(`${MAL_FORMADA}: falta ${que}.`)
  return v
}

function texto(o: Record<string, unknown>, campo: string): string {
  const v = o[campo]
  if (typeof v !== 'string') throw new Error(`${MAL_FORMADA}: «${campo}» tiene que ser un texto.`)
  return v
}

/** El archivo de clave recién elegido: `{tipo: 'elegida', token}`, o nada. */
function claveDe(v: unknown): SshConexionInput['clave'] {
  if (v === undefined || v === null) return undefined
  const o = objeto(v, 'la clave')
  if (o.tipo !== 'elegida') throw new Error(`${MAL_FORMADA}: la clave tiene que ser una recién elegida.`)
  return { tipo: 'elegida', token: texto(o, 'token') }
}

/**
 * La entrada del formulario con la forma del contrato. Un `disponibleAgentes` ausente lo decide el
 * registro (en un alta, `true`); un `secreto` ausente conserva el guardado.
 */
export function entradaSshDe(v: unknown): SshConexionInput {
  const o = objeto(v, 'la conexión')
  if (typeof o.puerto !== 'number') throw new Error(`${MAL_FORMADA}: «puerto» tiene que ser un número.`)
  if (o.disponibleAgentes !== undefined && typeof o.disponibleAgentes !== 'boolean') {
    throw new Error(`${MAL_FORMADA}: «disponibleAgentes» tiene que ser verdadero o falso.`)
  }
  if (o.secreto !== undefined && typeof o.secreto !== 'string') throw new Error(`${MAL_FORMADA}: «secreto» tiene que ser un texto.`)
  const entrada: SshConexionInput = {
    profileId: texto(o, 'profileId'),
    alias: texto(o, 'alias'),
    grupoId: o.grupoId === null || o.grupoId === undefined ? null : texto(o, 'grupoId'),
    host: texto(o, 'host'),
    puerto: o.puerto,
    usuario: texto(o, 'usuario'),
    metodo: texto(o, 'metodo') as SshMetodo,
    disponibleAgentes: o.disponibleAgentes as boolean
  }
  const clave = claveDe(o.clave)
  if (clave !== undefined) entrada.clave = clave
  if (typeof o.secreto === 'string') entrada.secreto = o.secreto
  if (o.saltoId !== undefined) entrada.saltoId = o.saltoId === null ? null : texto(o, 'saltoId')
  if (o.tuneles !== undefined) entrada.tuneles = tunelesDe(o.tuneles)
  return entrada
}

/** Los túneles con la forma del contrato: una lista de objetos; lo que vale cada campo lo decide el registro. */
function tunelesDe(v: unknown): SshTunel[] {
  if (!Array.isArray(v)) throw new Error(`${MAL_FORMADA}: «tuneles» tiene que ser una lista.`)
  return v.map((t) => {
    const o = objeto(t, 'un túnel')
    const tunel: SshTunel = { tipo: texto(o, 'tipo') as SshTipoTunel, puerto: o.puerto as number }
    if (o.destinoHost !== undefined) tunel.destinoHost = texto(o, 'destinoHost')
    if (o.destinoPuerto !== undefined) tunel.destinoPuerto = o.destinoPuerto as number
    return tunel
  })
}

/** La carpeta del agente de la terminal, tal como la usan sus dos canales (`controlador/espacioTerminal.ts`). */
export interface EspacioTerminalIpc {
  asegurar: (profileId: string) => Promise<{ projectHostPath: string; name: string }>
  rutas: (profileIds: readonly string[]) => Record<string, string>
}

/** Lo que `registrarIpcSsh` necesita: el `ipcMain`, el controlador al que delegar y la carpeta del agente de la terminal. */
export interface DependenciasIpcSsh {
  ipc: Pick<IpcMain, 'handle'>
  ssh: ControladorSsh
  /** Sin ella no se registran los dos canales de la carpeta del agente de la terminal. */
  espacio?: EspacioTerminalIpc
  /** Las preguntas de ssh que contesta el usuario; sin él no se registra `ASKPASS_RESPONDER`. */
  dialogo?: Pick<DialogoAskpass, 'responder'>
  /** La actividad de los agentes con `tssh` de un perfil; sin ella no se registra `ACTIVIDAD`. */
  actividad?: (profileId: string) => Promise<SshActividadPerfil>
}

/** Los ids de `ESPACIO_RUTAS`: una lista, de la que se descarta lo que no sea un texto. */
function idsDe(v: unknown): string[] {
  if (!Array.isArray(v)) throw new Error(`${MAL_FORMADA}: «profileIds» tiene que ser una lista.`)
  return v.filter((id): id is string => typeof id === 'string')
}

/** Las ids de un lote (`BORRAR_VARIAS`, `MOVER`): una lista de textos, con tope. */
function loteDe(v: unknown): string[] {
  if (!Array.isArray(v) || !v.every((id) => typeof id === 'string')) throw new Error(`${MAL_FORMADA}: «ids» tiene que ser una lista de textos.`)
  if (v.length > SSH_LOTE_MAX) throw new Error(`${MAL_FORMADA}: «ids» trae más de ${SSH_LOTE_MAX}.`)
  return v
}

/** La petición de `EXPORTAR_OPENSSH`: el perfil y, si vienen, las ids. */
function peticionExportar(req: unknown): SshExportarOpenSsh {
  const o = objeto(req, 'la petición')
  return { profileId: texto(o, 'profileId'), ...(o.ids === undefined ? {} : { ids: loteDe(o.ids) }) }
}

/** Los dos canales de la carpeta del agente de la terminal. */
function registrarIpcEspacio(ipc: Pick<IpcMain, 'handle'>, espacio: EspacioTerminalIpc): void {
  ipc.handle(SSH_CHANNELS.ESPACIO_ASEGURAR, (_e, req: unknown) => espacio.asegurar(texto(objeto(req, 'la petición'), 'profileId')))
  ipc.handle(SSH_CHANNELS.ESPACIO_RUTAS, (_e, req: unknown) => espacio.rutas(idsDe(objeto(req, 'la petición').profileIds)))
}

/**
 * Registra los dieciséis canales invocables del controlador y, si llegan sus dependencias, los dos de la carpeta
 * del agente de la terminal (`espacio`), la respuesta del diálogo de contraseñas (`dialogo`) y la actividad
 * de los agentes (`actividad`). `CAMBIO`, `AVISO` y las preguntas del diálogo los emite el main.
 */
export function registrarIpcSsh({ ipc, ssh, espacio, dialogo, actividad }: DependenciasIpcSsh): void {
  if (actividad) ipc.handle(SSH_CHANNELS.ACTIVIDAD, (_e, req: unknown) => actividad(texto(objeto(req, 'la petición'), 'profileId')))
  ipc.handle(SSH_CHANNELS.LISTAR, () => ssh.listar())
  ipc.handle(SSH_CHANNELS.CREAR, (_e, input: unknown) => ssh.crear(entradaSshDe(input)))
  ipc.handle(SSH_CHANNELS.EDITAR, (_e, req: unknown) => {
    const o = objeto(req, 'la petición')
    return ssh.editar({ id: texto(o, 'id'), input: entradaSshDe(o.input) })
  })
  ipc.handle(SSH_CHANNELS.DUPLICAR, (_e, req: unknown) => {
    const o = objeto(req, 'la petición')
    return ssh.duplicar({ id: texto(o, 'id'), profileId: texto(o, 'profileId') })
  })
  ipc.handle(SSH_CHANNELS.BORRAR, (_e, req: unknown) => {
    const o = objeto(req, 'la petición')
    return ssh.borrar({ id: texto(o, 'id'), profileId: texto(o, 'profileId') })
  })
  ipc.handle(SSH_CHANNELS.BORRAR_VARIAS, (_e, req: unknown) => {
    const o = objeto(req, 'la petición')
    return ssh.borrarVarias({ ids: loteDe(o.ids), profileId: texto(o, 'profileId') })
  })
  ipc.handle(SSH_CHANNELS.MOVER, (_e, req: unknown) => {
    const o = objeto(req, 'la petición')
    return ssh.mover({ ids: loteDe(o.ids), profileId: texto(o, 'profileId'), grupoId: o.grupoId === null ? null : texto(o, 'grupoId') })
  })
  ipc.handle(SSH_CHANNELS.GRUPO_CREAR, (_e, req: unknown) => {
    const o = objeto(req, 'la petición')
    return ssh.crearGrupo({ profileId: texto(o, 'profileId'), nombre: texto(o, 'nombre') })
  })
  ipc.handle(SSH_CHANNELS.GRUPO_RENOMBRAR, (_e, req: unknown) => {
    const o = objeto(req, 'la petición')
    return ssh.renombrarGrupo({ id: texto(o, 'id'), profileId: texto(o, 'profileId'), nombre: texto(o, 'nombre') })
  })
  ipc.handle(SSH_CHANNELS.GRUPO_BORRAR, (_e, req: unknown) => {
    const o = objeto(req, 'la petición')
    return ssh.borrarGrupo({ id: texto(o, 'id'), profileId: texto(o, 'profileId') })
  })
  ipc.handle(SSH_CHANNELS.ENTORNO, () => ssh.entorno())
  ipc.handle(SSH_CHANNELS.CLAVE_ELEGIR, (_e, req: unknown) => {
    const o = objeto(req, 'la petición')
    return ssh.elegirClave({ profileId: texto(o, 'profileId') })
  })
  ipc.handle(SSH_CHANNELS.CLAVE_SOLTADA, (_e, req: unknown) => {
    const o = objeto(req, 'la petición')
    return ssh.claveSoltada({ profileId: texto(o, 'profileId'), ruta: texto(o, 'ruta') })
  })
  ipc.handle(SSH_CHANNELS.IMPORTAR_OPENSSH, (_e, req: unknown) => ssh.leerOpenSsh({ profileId: texto(objeto(req, 'la petición'), 'profileId') }))
  ipc.handle(SSH_CHANNELS.EXPORTAR_OPENSSH, (_e, req: unknown) => ssh.exportarOpenSsh(peticionExportar(req)))
  ipc.handle(SSH_CHANNELS.PROBAR, (_e, req: unknown) => ssh.probar({ id: texto(objeto(req, 'la petición'), 'id') }))
  ipc.handle(SSH_CHANNELS.HUELLA_OLVIDAR, (_e, req: unknown) => ssh.olvidarHuella({ id: texto(objeto(req, 'la petición'), 'id') }))
  if (espacio) registrarIpcEspacio(ipc, espacio)
  if (dialogo) {
    ipc.handle(SSH_CHANNELS.ASKPASS_RESPONDER, (_e, req: unknown) => {
      const o = objeto(req, 'la petición')
      const r = o.respuesta
      if (r !== null && typeof r !== 'string') throw new Error(`${MAL_FORMADA}: «respuesta» tiene que ser un texto o null.`)
      dialogo.responder(texto(o, 'id'), r)
    })
  }
}
