// =============================================================================
// Las operaciones del puente que usa `tssh`, con el token de SESIÓN (su ámbito es el perfil entero):
// `ssh.listar`, `ssh.preparar` (la línea de ssh o scp en modo agente y, si el método pide secreto, una
// ficha del programa de contraseñas; si la conexión tiene bastión, el salto, pero nunca sus túneles),
// `ssh.terminar` (revoca la ficha y clasifica un 255) y
// `ssh.diagnostico`. `tssh` nunca recibe un secreto. En `logs/ssh.log` quedan alias, subcomando, código y
// duración, nunca la orden remota ni las rutas. Sin `electron`: todo llega por parámetro.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
import path from 'node:path'
import { nombresSistema } from '../../../shared/nombresSistema.ts'
import type { Plataforma } from '../../../shared/plataforma.ts'
import { pideSecretoSsh, type SshConexion, type SshListaConexiones } from '../../../shared/ssh-ipc.ts'
import type { TerminalExitReason } from '../../../shared/terminal-ipc.ts'
import type { PuertaPuente, RespuestaOperacion, SesionDelPuente } from '../../db/dbBridge.ts'
import { mensajeSinSsh, type BinariosSsh, type EjecutableSsh } from '../binariosSsh.ts'
import { buscarDisponible, catalogoAgentes, estadoSecreto, filaTssh, type CatalogoAgentes } from '../catalogoAgentes.ts'
import { clasificarSalidaSsh } from '../clasificacionSalida.ts'
import type { ConexionSshPersistida } from '../conservarAlEditarSsh.ts'
import { FICHA_AGENTE, type UsoFicha } from '../fichasAskpass.ts'
import { argumentosScp, argumentosSsh, hostParaScp } from '../lineaSsh.ts'
import { QUITAR_ENV_SSH } from '../programaAskpass.ts'
import { cadenaDeSaltos, type CitaProxy } from '../saltosSsh.ts'
import { errorHost, errorPuerto, errorUsuario } from '../validacionSsh.ts'
import type { EntornoSecreto } from './askpassSsh.ts'
import { citaDe, problemaDeSalto, proxyDeSaltos, type DepsLineaSaltos } from './lineaSaltos.ts'

/** Las operaciones del puente que usa `tssh`. */
export const OP_LISTAR = 'ssh.listar'
export const OP_PREPARAR = 'ssh.preparar'
export const OP_TERMINAR = 'ssh.terminar'
export const OP_DIAGNOSTICO = 'ssh.diagnostico'

/** Los códigos de salida propios de `tssh` (los mismos en `src/tssh/tsshSalida.cjs`, que lo fija `test-tssh`). */
export const CODIGOS_TSSH = { uso: 2, puente: 3, alias: 4, huella: 5, noUsable: 6, tope: 124 } as const

/**
 * Lo que el ssh lanzado por `tssh` no hereda: lo de `QUITAR_ENV_SSH` (el programa de contraseñas, el
 * puente `TESSERA_DB_PIPE` y la ficha heredados; los propios vuelven en `env`) y tampoco el token de la
 * sesión: no lo necesita, y así no lo ve nada que él lance. `tsshOrdenes.entornoDe` quita además el
 * puente aunque una respuesta no traiga esta lista: las dos mitades dicen lo mismo (lo fija `test:tssh`).
 */
export const QUITAR_ENV_TSSH: readonly string[] = [...QUITAR_ENV_SSH, 'TESSERA_DB_SESSION']

/** Para qué se prepara la línea: `tssh run`, `tssh cp` o la prueba de `tssh doctor <alias>`. */
type Uso = 'run' | 'cp' | 'doctor'

/** Lo que hace falta para componer la línea de un agente. */
interface LineaAgente {
  c: ConexionSshPersistida
  /** Sus bastiones, del más cercano al más lejano. */
  cadena: ConexionSshPersistida[]
  uso: Uso
  ssh: EjecutableSsh
  scp: string | null
  cita: CitaProxy
}

/** Un «no» con su código de salida y un mensaje para el agente. */
interface Rechazo {
  codigo: number
  error: string
}

/** Lo que `ssh.terminar` mira de la salida de errores: el puente corta las peticiones a 4 KiB. */
const MAX_COLA = 3000
/** El alias como se apunta: lo escribe el agente y podría ser cualquier cosa. */
const MAX_ALIAS_REGISTRO = 120

/** Lo que necesita. */
export interface DepsPuenteTssh {
  /** El puente; sin él no se registra nada y `tssh` dice que Tessera no contesta. */
  puerta: PuertaPuente | null
  /** El registro de un perfil, sin secretos ni rutas (`ConexionesSsh.listar(profileId)`). */
  listar: (profileId: string) => SshListaConexiones
  /** La conexión guardada (con su secreto cifrado: nunca sale de aquí). */
  conexion: (id: string) => ConexionSshPersistida | undefined
  rutaHuellas: (id: string) => string
  rutaClave: (id: string) => string
  /** El programa de contraseñas; sin él, una conexión que pide secreto no se puede usar desde un agente. */
  askpass: {
    entorno: (c: ConexionSshPersistida, uso: UsoFicha, pestana: boolean, saltos?: readonly ConexionSshPersistida[]) => EntornoSecreto
    soltar: (ficha: string | null) => boolean
  } | null
  binarios: () => BinariosSsh
  existe: (ruta: string) => boolean
  programaAskpass: string
  nombrePerfil: (profileId: string) => string | undefined
  /** Escribe una línea en `logs/ssh.log`. */
  auditar: (linea: string) => void
  /** Dónde se escribe la configuración de los saltos; sin ella, una conexión con bastión no se puede usar. */
  configSaltos?: DepsLineaSaltos['config']
  plataforma: Plataforma
  log?: (mensaje: string) => void
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function usoDe(v: unknown): Uso | null {
  return v === 'run' || v === 'cp' || v === 'doctor' ? v : null
}

function noUsable(error: string): Rechazo {
  return { codigo: CODIGOS_TSSH.noUsable, error }
}

/** El alias que nadie encuentra: el mismo mensaje para uno que no existe y para uno que el usuario no dejó disponible. */
function sinAlias(alias: string): Rechazo {
  return { codigo: CODIGOS_TSSH.alias, error: `No hay ninguna conexión disponible llamada «${alias.trim()}». \`tssh ls\` da las que puedes usar.` }
}

/** El ssh de la misma carpeta que scp: el que scp lanzará con `-S`. */
function sshHermano(scp: string, plataforma: Plataforma): string {
  const p = plataforma === 'windows' ? path.win32 : path.posix
  return p.join(p.dirname(scp), plataforma === 'windows' ? 'ssh.exe' : 'ssh')
}

/** Qué decirle al agente cuando ssh salió con 255 y dejó escrito por qué. */
function pistaDe(motivo: TerminalExitReason, sinContestar: boolean): string {
  if (motivo === 'ssh-huella-cambiada') {
    return (
      'La huella del servidor no es la que se confirmó: puede que lo reinstalaran o que no sea el equipo de siempre. ' +
      'No sigas: díselo al usuario, que tiene que comprobarla y, si es legítima, usar «Olvidar la huella guardada» en la conexión.'
    )
  }
  if (motivo === 'ssh-autenticacion') {
    return sinContestar
      ? 'El servidor pidió algo que Tessera no contesta (un código o un segundo factor): esa conexión solo la puede usar el usuario desde la terminal.'
      : 'El servidor rechazó las credenciales guardadas. No pidas la contraseña: díselo al usuario.'
  }
  if (motivo === 'ssh-algoritmos') return 'El equipo solo ofrece algoritmos antiguos que el cliente SSH ya no acepta: díselo al usuario.'
  return 'No se llega al equipo o se cortó la conexión: comprueba con el usuario la red o la VPN.'
}

/** La línea de auditoría: sin la orden remota ni rutas; el alias, citado en JSON para que quepa en una línea. */
export function lineaAuditoria(d: { perfil: string; sub: string; alias: string; resto: string }): string {
  return `perfil=${d.perfil} sub=${d.sub} alias=${JSON.stringify(d.alias.trim().slice(0, MAX_ALIAS_REGISTRO))} ${d.resto}`
}

/** Las operaciones de `tssh` sobre el puente. */
export class PuenteTssh {
  private readonly d: DepsPuenteTssh
  private readonly log: (mensaje: string) => void

  constructor(d: DepsPuenteTssh) {
    this.d = d
    this.log = d.log ?? (() => {})
    const puerta = d.puerta
    if (puerta === null) return
    puerta.registrarOperacion(OP_LISTAR, { token: 'sesion', manejar: (_p, s) => this.listar(s) })
    puerta.registrarOperacion(OP_PREPARAR, { token: 'sesion', manejar: (p, s) => this.preparar(p, s) })
    puerta.registrarOperacion(OP_TERMINAR, { token: 'sesion', manejar: (p, s) => this.terminar(p, s) })
    puerta.registrarOperacion(OP_DIAGNOSTICO, { token: 'sesion', manejar: (p, s) => this.diagnostico(p, s) })
    this.log('operaciones de tssh registradas en el puente')
  }

  private catalogo(s: SesionDelPuente): CatalogoAgentes {
    return catalogoAgentes(this.d.listar(s.profileId), s.profileId)
  }

  private auditar(s: SesionDelPuente, sub: string, alias: string, resto: string): void {
    this.d.auditar(lineaAuditoria({ perfil: s.profileId, sub, alias, resto }))
  }

  /** `ssh.listar`: las disponibles para los agentes y cuántas más hay, sin nombrarlas. */
  private listar(s: SesionDelPuente): RespuestaOperacion {
    const cat = this.catalogo(s)
    return {
      ok: true,
      conexiones: cat.disponibles.map((c) => filaTssh(c, cat.grupos)),
      excluidas: cat.excluidas,
      ...(cat.aviso !== null ? { aviso: cat.aviso } : {})
    }
  }

  /** La disponible con ese alias, o por qué no la hay. */
  private elegir(cat: CatalogoAgentes, alias: string): { dto: SshConexion } | Rechazo {
    if (cat.aviso !== null) return noUsable(`Tessera no puede leer ahora las conexiones SSH de este perfil: ${cat.aviso}`)
    const r = buscarDisponible(cat, alias)
    if (r === null) return sinAlias(alias)
    if ('ambigua' in r) {
      return { codigo: CODIGOS_TSSH.alias, error: `Varias conexiones disponibles se llaman «${alias.trim()}» (solo cambian las comillas o los espacios): pide al usuario que renombre una.` }
    }
    return { dto: r.conexion }
  }

  /** Lo que la conexión necesita y no tiene: su secreto, o el programa que lo da. */
  private problemaDeSecreto(dto: SshConexion): Rechazo | null {
    if (!pideSecretoSsh(dto)) return null
    const una = dto.metodo === 'clave' ? 'la frase de su clave' : 'una contraseña'
    const la = dto.metodo === 'clave' ? 'La frase de la clave' : 'La contraseña'
    const estado = estadoSecreto(dto)
    if (estado === 'falta') {
      return noUsable(`La conexión «${dto.alias}» necesita ${una} y no tiene ninguna guardada. No la pidas: el usuario puede guardarla editando la conexión, o conectarse él desde la terminal de Tessera.`)
    }
    if (estado === 'ilegible') {
      return noUsable(`${la} guardada de «${dto.alias}» no se puede leer en este equipo (${nombresSistema(this.d.plataforma).almacenSecretos}). No la pidas: díselo al usuario, que tiene que volver a guardarla editando la conexión.`)
    }
    if (this.d.askpass === null || !this.d.existe(this.d.programaAskpass)) {
      return noUsable(`Tessera no puede dar ahora ${una} de «${dto.alias}»: falta su programa de contraseñas. Díselo al usuario.`)
    }
    return null
  }

  /**
   * Los bastiones de la conexión, cada uno con lo que impediría usarlo: sus datos, la copia de su clave, su
   * huella confirmada por una persona y su secreto. No hace falta que estén disponibles para los agentes: el
   * usuario eligió el bastión de una conexión que sí lo está.
   */
  private saltos(c: ConexionSshPersistida, profileId: string): { cadena: ConexionSshPersistida[]; dtos: SshConexion[] } | Rechazo {
    let cadena: ConexionSshPersistida[]
    try {
      cadena = cadenaDeSaltos(c, (id) => this.d.conexion(id))
    } catch (e) {
      return noUsable(`${e instanceof Error ? e.message : String(e)} Díselo al usuario.`)
    }
    if (cadena.length === 0) return { cadena, dtos: [] }
    if (this.d.configSaltos === undefined) return noUsable(`«${c.alias}» salta por un bastión y Tessera no puede prepararlo ahora. Díselo al usuario.`)
    const delPerfil = this.d.listar(profileId).conexiones
    const dtos: SshConexion[] = []
    for (const s of cadena) {
      const dto = delPerfil.find((x) => x.id === s.id)
      if (dto === undefined) return noUsable(`El bastión de «${c.alias}» ya no existe en este perfil. Díselo al usuario.`)
      const dato = problemaDeSalto(s, { existe: this.d.existe, rutaClave: this.d.rutaClave })
      if (dato !== null) return noUsable(`Para llegar a «${c.alias}»: ${dato} Díselo al usuario.`)
      if (dto.huellaServidor.length === 0) {
        return {
          codigo: CODIGOS_TSSH.huella,
          error:
            `Se llega a «${c.alias}» por el bastión «${s.alias}», cuya huella no está confirmada. Pide al usuario que se conecte ` +
            'una vez a ese bastión desde la terminal de Tessera (o que pulse «Probar» en él): solo puedes usar equipos cuya huella ya aceptó una persona.'
        }
      }
      const secreto = this.problemaDeSecreto(dto)
      if (secreto !== null) return secreto
      dtos.push(dto)
    }
    return { cadena, dtos }
  }

  /** Lo primero que impide usar la conexión desde un agente, comprobado ahora; `null` si está lista. */
  private problema(dto: SshConexion, c: ConexionSshPersistida, uso: Uso, b: BinariosSsh): Rechazo | null {
    const dato = errorHost(c.host) ?? errorPuerto(c.puerto) ?? errorUsuario(c.usuario)
    if (dato !== null) return noUsable(`La conexión «${c.alias}» tiene un dato que no vale: ${dato} Pide al usuario que la edite.`)
    if (dto.huellaServidor.length === 0) {
      return {
        codigo: CODIGOS_TSSH.huella,
        error:
          `La huella del servidor de «${c.alias}» no está confirmada. Pide al usuario que se conecte una vez desde la terminal ` +
          'de Tessera (o que pulse «Probar» en la conexión): solo puedes usar equipos cuya huella ya aceptó una persona.'
      }
    }
    if (b.ssh === null) return noUsable(mensajeSinSsh(this.d.plataforma))
    if (uso === 'cp' && b.scp === null) return noUsable('No se encontró scp junto al cliente SSH del sistema, así que no se puede copiar.')
    if (c.metodo === 'clave' && (c.clave === undefined || !this.d.existe(this.d.rutaClave(c.id)))) {
      return noUsable(`La conexión «${c.alias}» usa un archivo de clave y falta la copia que guardó Tessera: pide al usuario que la edite y vuelva a elegir el archivo.`)
    }
    return this.problemaDeSecreto(dto)
  }

  /** `ssh.preparar`: la línea de ssh (o de scp) de la conexión del alias, en modo agente. */
  private preparar(p: Record<string, unknown>, s: SesionDelPuente): RespuestaOperacion {
    const uso = usoDe(p.uso)
    const alias = texto(p.alias)
    if (uso === null) return { ok: false, error: 'peticion invalida', codigo: CODIGOS_TSSH.uso }
    const elegida = this.elegir(this.catalogo(s), alias)
    if ('error' in elegida) return this.rechazar(s, uso, alias, elegida)
    const c = this.d.conexion(elegida.dto.id)
    if (!c) return this.rechazar(s, uso, alias, sinAlias(alias))
    const b = this.d.binarios()
    const problema = this.problema(elegida.dto, c, uso, b)
    if (problema !== null || b.ssh === null) return this.rechazar(s, uso, c.alias, problema ?? noUsable(mensajeSinSsh(this.d.plataforma)))
    const saltos = this.saltos(c, s.profileId)
    if ('error' in saltos) return this.rechazar(s, uso, c.alias, saltos)
    const secreto = this.secretoPara(elegida.dto, c, saltos)
    if (secreto !== null && 'error' in secreto) return this.rechazar(s, uso, c.alias, secreto)
    const linea = this.lineaConFicha({ c, cadena: saltos.cadena, uso, ssh: b.ssh, scp: b.scp, cita: citaDe(this.d.plataforma, b.origen) }, secreto, p)
    this.auditar(s, uso, c.alias, 'inicio')
    return {
      ok: true,
      ...linea,
      env: secreto?.env ?? {},
      quitarEnv: [...QUITAR_ENV_TSSH],
      ficha: secreto?.ficha ?? null,
      alias: c.alias,
      host: hostParaScp(c.host)
    }
  }

  /**
   * El secreto que dará el programa de contraseñas (el de la conexión y el de sus bastiones); `null` si ninguno
   * lo pide, o por qué no se puede.
   */
  private secretoPara(dto: SshConexion, c: ConexionSshPersistida, saltos: { cadena: ConexionSshPersistida[]; dtos: SshConexion[] }): EntornoSecreto | Rechazo | null {
    if (![dto, ...saltos.dtos].some(pideSecretoSsh) || this.d.askpass === null) return null
    const secreto = this.d.askpass.entorno(c, FICHA_AGENTE, false, saltos.cadena)
    if (secreto.conAskpass) return secreto
    // El motivo concreto (pensado para una persona) va al registro; al agente, qué hacer.
    this.log(`tssh conexion=${c.id}: ${secreto.aviso ?? 'sin programa de contraseñas'}`)
    return noUsable(`Tessera no puede dar ahora el secreto guardado de «${c.alias}» o de su bastión. No lo pidas: díselo al usuario.`)
  }

  /** La línea; si no se puede componer, la ficha (que no llegó a nadie) se revoca ya, sin esperar a que caduque. */
  private lineaConFicha(l: LineaAgente, secreto: EntornoSecreto | null, p: Record<string, unknown>): { exe: string; args: string[] } {
    try {
      return this.linea(l, secreto !== null, p)
    } catch (e) {
      if (secreto !== null) this.d.askpass?.soltar(secreto.ficha)
      throw e
    }
  }

  /** La línea de ssh (`run`, `doctor`) o de scp (`cp`) en modo agente, saltando por sus bastiones si los tiene. */
  private linea(l: LineaAgente, conAskpass: boolean, p: Record<string, unknown>): { exe: string; args: string[] } {
    const { c, uso, ssh, scp } = l
    // Con bastión y sin dónde preparar el salto se lanza: nunca directo a un equipo que se alcanza por él.
    if (l.cadena.length > 0 && this.d.configSaltos === undefined) throw new Error(`«${c.alias}» salta por un bastión y Tessera no puede prepararlo ahora.`)
    const proxyCommand =
      l.cadena.length === 0 || this.d.configSaltos === undefined
        ? undefined
        : proxyDeSaltos(l.cadena, { modo: 'agente', conAskpass, conDialogo: false, ssh, cita: l.cita }, {
            rutaHuellas: this.d.rutaHuellas,
            rutaClave: this.d.rutaClave,
            existe: this.d.existe,
            config: this.d.configSaltos,
            plataforma: this.d.plataforma
          })
    const opts = {
      modo: 'agente' as const,
      rutaHuellas: this.d.rutaHuellas(c.id),
      rutaClave: c.metodo === 'clave' ? this.d.rutaClave(c.id) : undefined,
      plataforma: this.d.plataforma,
      conAskpass,
      ...(proxyCommand === undefined ? {} : { proxyCommand })
    }
    if (uso === 'cp' && scp !== null) {
      return { exe: scp, args: argumentosScp(c, { ...opts, ssh: sshHermano(scp, this.d.plataforma), recursivo: p.recursivo === true }) }
    }
    return { exe: ssh.exe, args: [...ssh.args, ...argumentosSsh(c, { ...opts, orden: { conEntrada: uso === 'run' && p.entrada === true } })] }
  }

  private rechazar(s: SesionDelPuente, uso: Uso, alias: string, r: Rechazo): RespuestaOperacion {
    this.auditar(s, uso, alias, `codigo=${r.codigo} rechazada`)
    return { ok: false, error: r.error, codigo: r.codigo }
  }

  /** `ssh.terminar`: revoca la ficha, apunta cómo acabó y, si ssh falló con 255, por qué y qué decir. */
  private terminar(p: Record<string, unknown>, s: SesionDelPuente): RespuestaOperacion {
    const ficha = texto(p.ficha)
    const sinContestar = ficha !== '' && this.d.askpass !== null ? this.d.askpass.soltar(ficha) : false
    const codigo = typeof p.codigo === 'number' && Number.isInteger(p.codigo) ? p.codigo : null
    const ms = typeof p.ms === 'number' && Number.isFinite(p.ms) && p.ms >= 0 ? Math.round(p.ms) : null
    const motivo = clasificarSalidaSsh(codigo, texto(p.cola).slice(-MAX_COLA), this.d.plataforma)
    const tope = p.tope === true ? ' tope' : ''
    this.auditar(s, usoDe(p.uso) ?? 'run', texto(p.alias), `codigo=${codigo ?? '-'} ms=${ms ?? '-'}${tope}${motivo ? ` motivo=${motivo}` : ''}`)
    if (motivo === undefined) return { ok: true }
    return { ok: true, motivo, pista: pistaDe(motivo, sinContestar) }
  }

  /** `ssh.diagnostico`: lo que `tssh doctor` no puede ver desde fuera, y la conexión de un alias si lo trae. */
  private diagnostico(p: Record<string, unknown>, s: SesionDelPuente): RespuestaOperacion {
    const cat = this.catalogo(s)
    const b = this.d.binarios()
    const base = {
      ok: true,
      perfil: this.d.nombrePerfil(s.profileId) ?? s.profileId,
      cliente: { origen: b.origen, aviso: b.aviso, ssh: b.ssh?.exe ?? null, scp: b.scp },
      contrasenas: this.d.askpass !== null && this.d.existe(this.d.programaAskpass),
      disponibles: cat.disponibles.length,
      excluidas: cat.excluidas,
      ...(cat.aviso !== null ? { aviso: cat.aviso } : {})
    }
    const alias = texto(p.alias)
    if (alias.trim() === '') return base
    const elegida = this.elegir(cat, alias)
    if ('error' in elegida) return { ...base, conexion: null, problema: elegida }
    const c = this.d.conexion(elegida.dto.id)
    const saltos = c ? this.saltos(c, s.profileId) : null
    const problema = c ? (this.problema(elegida.dto, c, 'run', b) ?? (saltos !== null && 'error' in saltos ? saltos : null)) : sinAlias(alias)
    return { ...base, conexion: filaTssh(elegida.dto, cat.grupos), problema }
  }
}
