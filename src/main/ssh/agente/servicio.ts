// =============================================================================
// Autoriza cada petición con el token vigente y firma exclusivamente con claves del catálogo del perfil.
// Coordina permisos, frases y límites para impedir firmas tras una revocación incluso durante un diálogo.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { createHash } from 'node:crypto'
import { homedir, userInfo } from 'node:os'
import path from 'node:path'
import type { Perfil } from '../../perfiles/types.ts'
import type { ProgramaBuzon, RespuestaPrograma } from '../../db/puenteDocker.ts'
import type { SesionDelPuente } from '../../db/puenteBd.ts'
import type { PreguntadorAskpass } from '../controlador/askpassSsh.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import { ColaConcurrencia } from '../../../shared/colaConcurrencia.ts'
import { CacheCatalogo, carpetaSshGlobal, leerLimitado, publicaSinFrase } from './catalogo.ts'
import type { ClaveAgente } from '../../../shared/ssh-agente-ipc.ts'
import { configPublico, nombrePublica, primeroLasEstandar, type EntornoConfig } from './configuracion.ts'
import { decodificar, identidades, respuestaFirma, TOPE_MENSAJE, Lector } from './protocolo.ts'
import { firmar, FraseNecesaria, leerClave, type ClaveLeida } from './lectorClaves.ts'
import { txAgenteSsh } from './textos.ts'

/** Lo que dura el silencio tras cancelar la frase: cubre los reintentos de una misma conexión. */
export const SILENCIO_TRAS_CANCELAR_MS = 60_000

export interface DependenciasAgente {
  perfiles: () => Perfil[]
  sesion: (token: string) => SesionDelPuente | null
  dialogo: PreguntadorAskpass
  fraseGuardada: (ruta: string) => string | null
  guardarFrase: (ruta: string, frase: string) => void
  auditar: (linea: string) => void
  dirTssh: string
  entorno?: EntornoConfig
}

export class AgenteSshHost {
  private readonly entorno: EntornoConfig
  private readonly cola = new ColaConcurrencia(2)
  private readonly catalogos = new CacheCatalogo()
  private readonly canceladas = new Map<string, { huella: string; hasta: number }>()
  private readonly dependencias: DependenciasAgente
  constructor(dependencias: DependenciasAgente) {
    this.dependencias = dependencias
    this.entorno = dependencias.entorno ?? { home: homedir(), usuario: userInfo().username, plataforma: plataformaActual() }
  }

  async listar(id: string): Promise<ClaveAgente[]> {
    const perfil = this.dependencias.perfiles().find((p) => p.id === id)
    if (!perfil) throw new Error(txAgenteSsh().perfil)
    try { return (await this.catalogos.leer(perfil, this.entorno)).claves } catch { throw new Error(txAgenteSsh().lectura) }
  }

  programa(): ProgramaBuzon {
    return { nombre: 'ssh-agente', archivos: { 'ssh-agente.cjs': path.join(this.dependencias.dirTssh, 'ssh-agente.cjs') }, cliente: 'ssh-agente.cjs', maxRespuesta: 2 * 1024 * 1024, atender: (peticion) => this.cola.correr(() => this.atender(peticion)) }
  }

  private perfil(token: string): Perfil {
    const sesion = this.dependencias.sesion(token)
    const perfil = sesion && this.dependencias.perfiles().find((p) => p.id === sesion.profileId)
    if (!perfil) throw new Error('Token sin perfil vigente')
    return perfil
  }

  private async clave(texto: string, ruta: string, perfil: Perfil): Promise<ClaveLeida> {
    try { return leerClave(texto) } catch (error) { if (!(error instanceof FraseNecesaria)) throw error }
    const identificador = `${perfil.id}:${ruta}`
    const huella = createHash('sha256').update(texto).digest('hex')
    const guardada = this.dependencias.fraseGuardada(ruta)
    if (guardada !== null) {
      try { return leerClave(texto, guardada) } catch (error) { if (!(error instanceof FraseNecesaria)) throw error }
    }
    // Una cancelación calla las firmas seguidas de la misma conexión, no la clave para siempre.
    const cancelada = this.canceladas.get(identificador)
    if (cancelada?.huella === huella && cancelada.hasta > Date.now()) throw new Error('Frase cancelada')
    const frase = await this.dependencias.dialogo.preguntar({ alias: perfil.nombre, texto: txAgenteSsh().frase(path.basename(ruta)), delServidor: false, rechazada: guardada !== null })
    if (frase === null) {
      if (this.canceladas.size >= 1024) this.canceladas.delete(this.canceladas.keys().next().value!)
      this.canceladas.delete(identificador)
      this.canceladas.set(identificador, { huella, hasta: Date.now() + SILENCIO_TRAS_CANCELAR_MS })
      throw new Error('Frase cancelada')
    }
    const clave = leerClave(texto, frase)
    this.dependencias.guardarFrase(ruta, frase)
    return clave
  }

  async atender(peticion: Readonly<Record<string, unknown>>): Promise<RespuestaPrograma> {
    const fallo = { exitCode: 1, stderr: txAgenteSsh().fallo, respuesta: Buffer.from([5]).toString('base64') }
    let perfilRegistro = '(sin autorización)'
    let operacion = 'rechazo'
    let resultado = 'rechazada'
    try {
      if (typeof peticion.token !== 'string') return fallo
      const token = peticion.token
      const perfil = this.perfil(token)
      perfilRegistro = perfil.id
      operacion = peticion.operacion === 'material' ? 'material-publico' : 'mensaje-agente'
      const mensaje = peticion.operacion === 'material' ? null : typeof peticion.mensaje === 'string' && peticion.mensaje.length <= TOPE_MENSAJE * 4 / 3 + 4 ? decodificar(Buffer.from(peticion.mensaje, 'base64')) : null
      if (peticion.operacion !== 'material' && (!mensaje || mensaje.tipo === 'fallo')) return fallo
      if (mensaje) operacion = mensaje.tipo
      const { claves, config } = await this.catalogos.leer(perfil, this.entorno)
      const permitidas = claves.filter((c) => c.permitida)
      const material: { ruta: string; nombre: string; publica: Buffer }[] = []
      for (const clave of permitidas) {
        try {
          const texto = await leerLimitado(clave.ruta)
          const publica = await publicaSinFrase(texto, clave.ruta)
          material.push({ ruta: clave.ruta, nombre: clave.nombre, publica })
        } catch (error) {
          const motivo = (error as NodeJS.ErrnoException).code ?? (error instanceof Error && error.message.includes('no admitid') ? 'formato-no-admitido' : 'publica-no-disponible')
          this.dependencias.auditar(`perfil=${JSON.stringify(perfil.id)} sub=ssh-agente omision=${JSON.stringify(motivo)} clave=${createHash('sha256').update(clave.ruta).digest('hex')}`)
        }
      }
      // También se revalida tras cualquier diálogo: los permisos pudieron cambiar mientras estaba abierto.
      const vigentes = new Set((await this.listar(this.perfil(token).id)).filter((c) => c.permitida).map((c) => c.ruta))
      const autorizadas = primeroLasEstandar(material.filter((c) => vigentes.has(c.ruta)))
      if (peticion.operacion === 'material') {
        let conocidos = ''
        for (const carpeta of [carpetaSshGlobal(this.entorno), ...(perfil.sshDir ? [perfil.sshDir] : [])]) {
          try {
            const texto = await leerLimitado(path.join(carpeta, 'known_hosts'))
            if (!texto.includes('PRIVATE KEY')) conocidos += texto + '\n'
          } catch { /* Sin huellas previas, ssh guarda las que acepte dentro del contenedor. */ }
        }
        resultado = 'autorizada'
        return { exitCode: 0, stderr: '', config: configPublico(config, this.entorno, autorizadas.map((c) => c.ruta)), conocidas: conocidos, publicas: autorizadas.map((c) => ({ nombre: nombrePublica(c.ruta), texto: `${new Lector(c.publica).texto()} ${c.publica.toString('base64')}\n` })) }
      }
      if (mensaje?.tipo === 'listar') {
        resultado = 'autorizada'
        return { exitCode: 0, stderr: '', respuesta: identidades(autorizadas).toString('base64') }
      }
      if (mensaje?.tipo !== 'firmar') return fallo
      const elegida = autorizadas.find((c) => c.publica.equals(mensaje.publica))
      if (!elegida) return fallo
      const clave = await this.clave(await leerLimitado(elegida.ruta), elegida.ruta, perfil)
      if (!clave.publica.equals(mensaje.publica) || !(await this.listar(this.perfil(token).id)).some((c) => c.ruta === elegida.ruta && c.permitida)) return fallo
      const firma = firmar(clave, mensaje.datos, mensaje.banderas)
      const huella = createHash('sha256').update(clave.publica).digest('base64').replace(/=+$/, '')
      this.dependencias.auditar(`perfil=${JSON.stringify(perfil.id)} sub=firma clave=SHA256:${huella} cuando=${new Date().toISOString()}`)
      resultado = 'autorizada'
      return { exitCode: 0, stderr: '', respuesta: respuestaFirma(firma).toString('base64') }
    } catch { return fallo }
    finally { this.dependencias.auditar(`perfil=${JSON.stringify(perfilRegistro)} sub=ssh-agente operacion=${operacion} resultado=${resultado} cuando=${new Date().toISOString()}`) }
  }
}
