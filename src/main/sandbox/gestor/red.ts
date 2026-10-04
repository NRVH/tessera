// =============================================================================
// Red del contenedor: toma las MEDIDAS del modo anfitrión (motor, ajustes de Docker, modo de
// WSL y una sonda real) y delega criterio y textos en `redAnfitrion.ts`. También el puente
// del callback de Codex (1455) y el aviso cuando la red del anfitrión no llega.
// Decisiones: docs/decisiones/sandbox/red-del-anfitrion.md
// =============================================================================
import { spawn } from 'node:child_process'
import os from 'node:os'
import fsp from 'node:fs/promises'
import net from 'node:net'
import type { Profile } from '../../profiles/types.ts'
import { esWindows, plataformaActual } from '../../../shared/plataforma.ts'
import { nombresSistema } from '../../../shared/nombresSistema.ts'
import type { ResultadoRedPrevuelo } from '../../../shared/sandbox-red-ipc.ts'
import {
  evaluarPrevuelo,
  leerAjustesDocker,
  modoRedWsl,
  notaEgress,
  rutasAjustesDocker
} from '../redAnfitrion.ts'
import { runDocker } from '../adaptadores/docker.ts'
import { SANDBOX_IMAGE } from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'

/**
 * Puente TCP DENTRO del contenedor para el callback de login de Codex: Codex escucha solo
 * en el loopback del contenedor y el port-forward de Docker entra por eth0. Escucha en la
 * IP de eth0 (no 0.0.0.0, para no chocar con Codex) y reenvía a 127.0.0.1:1455;
 * idempotente (un segundo intento falla al bindear y sale).
 */
export const CODEX_CALLBACK_FORWARDER_SCRIPT =
  "const net=require('net'),os=require('os');" +
  "const nic=Object.values(os.networkInterfaces()).flat().find(i=>i&&i.family==='IPv4'&&!i.internal);" +
  'if(!nic)process.exit(0);' +
  "net.createServer(c=>{const u=net.connect(1455,'127.0.0.1');u.on('error',()=>c.destroy());c.on('error',()=>u.destroy());c.pipe(u);u.pipe(c)})" +
  ".on('error',()=>process.exit(0)).listen(1455,nic.address);"

/** ¿El fallo de `docker run` es por un PUERTO ya en uso? Solo entonces se reintenta sin publicarlo. */
export function isPortConflictError(stderr: string): boolean {
  return /port is already allocated|address already in use|ports are not available|bind for [^\n]*failed|being used by/i.test(
    stderr
  )
}

/** Un puerto alto LIBRE pedido al sistema (bind al 0, leer, cerrar); nunca el 1455. */
function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const dir = srv.address()
      if (dir === null || typeof dir === 'string') {
        srv.close(() => reject(new Error('sin puerto')))
        return
      }
      const puerto = dir.port
      srv.close(() => resolve(puerto))
    })
  })
}

/**
 * Lo que conteste `127.0.0.1:puerto` desde el anfitrión, o `null`. Que acepte la conexión
 * no basta: el puerto se suelta antes del `docker run` y otro proceso podría tomarlo, así
 * que la sonda contesta un token y se exige ese token.
 */
function leePuerto(puerto: number, timeoutMs = 1000): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = net.connect({ port: puerto, host: '127.0.0.1' })
    let datos = ''
    const cerrar = (v: string | null): void => {
      sock.destroy()
      resolve(v)
    }
    sock.setTimeout(timeoutMs, () => cerrar(null))
    sock.on('data', (d: Buffer) => (datos += d.toString('utf8')))
    sock.on('end', () => cerrar(datos.trim() || null))
    sock.on('close', () => cerrar(datos.trim() || null))
    sock.on('error', () => cerrar(null))
  })
}

// Contador de sondas del PROCESO (no de la instancia): da nombre y token únicos a cada una.
let sondaSeq = 0

/** Medidas y avisos de la red del contenedor. */
export class RedSandbox {
  private readonly n: NucleoSandbox

  constructor(n: NucleoSandbox) {
    this.n = n
  }

  /** ¿Lo que el perfil PIDE difiere de lo que su contenedor vivo TIENE? Sin contenedor, no. */
  redPendienteDeReiniciar(profile: Profile): boolean {
    const handle = this.n.handles.get(profile.id)
    if (!handle) return false
    return handle.redHostAplicado !== (profile.sandbox?.redHost === true)
  }

  /** Perfiles con un contenedor VIVO corriendo en modo anfitrión ahora mismo. */
  perfilesEnModoAnfitrion(exceptoId?: string): string[] {
    return [...this.n.handles.values()]
      .filter((h) => h.redHostAplicado && h.profileId !== exceptoId)
      .map((h) => h.profileId)
  }

  /**
   * El PREVUELO: toma las medidas y delega TODO el criterio y el texto en
   * `evaluarPrevuelo`. No decide nada: el usuario manda incluso con el prevuelo en rojo.
   */
  async prevueloRedHost(
    profile: Profile,
    perfiles: readonly Profile[] = [],
    medirTrafico = true
  ): Promise<ResultadoRedPrevuelo> {
    const profileId = profile.id
    const plataforma = plataformaActual()
    const { tuEquipo } = nombresSistema(plataforma)

    // Timeout corto en las dos sondas calientes, como `checkDocker`.
    const [info, version, ajustes, wsl, trafico] = await Promise.all([
      runDocker(['info', '--format', '{{.OSType}}'], { timeoutMs: 30_000 }),
      runDocker(['version', '--format', '{{.Server.Platform.Name}}'], { timeoutMs: 30_000 }),
      this.leerAjustesDockerDesktop(plataforma),
      this.modoRedDeWsl(plataforma),
      // Se mide sin caché: abrir el diálogo es cuando el usuario puede haber tocado Docker.
      medirTrafico
        ? this.sondaRedAnfitrion().then((r) => {
            this.n.redAnfitrionMedida = r
            // Una medida nueva reabre la boca: si vuelve a fallar más tarde, que lo diga.
            if (r !== false) this.n.redAvisados.clear()
            return r
          })
        : Promise.resolve<boolean | null>(null)
    ])

    const motorVivo = info.status === 0
    const tipo = info.stdout.trim().toLowerCase()
    const resultado = evaluarPrevuelo(
      {
        motorVivo,
        tipoContenedores: tipo === 'linux' || tipo === 'windows' ? tipo : null,
        nombrePlataformaDocker: version.status === 0 ? version.stdout.trim() || null : null,
        hostNetworking: ajustes.hostNetworking,
        aislamientoReforzado: ajustes.aislamientoReforzado,
        traficoLlega: trafico
      },
      plataforma,
      tuEquipo
    )

    // El contrato promete el NOMBRE del otro perfil; el handle solo guarda el id.
    const otroId = this.perfilesEnModoAnfitrion(profileId)[0] ?? null
    const otroNombre =
      otroId === null ? null : (perfiles.find((p) => p.id === otroId)?.nombre ?? otroId)
    return {
      filas: resultado.filas,
      hayFallas: resultado.hayFallas,
      notaEgress: notaEgress(plataforma, wsl),
      otroPerfilEnAnfitrion: otroNombre,
      pendiente: this.redPendienteDeReiniciar(profile)
    }
  }

  /** Las dos claves de los ajustes de Docker Desktop: una PISTA; un fallo de lectura es `null`. */
  private async leerAjustesDockerDesktop(
    plataforma: ReturnType<typeof plataformaActual>
  ): Promise<{ hostNetworking: boolean | null; aislamientoReforzado: boolean | null }> {
    const rutas = rutasAjustesDocker(plataforma, os.homedir(), process.env.APPDATA ?? '')
    for (const ruta of rutas) {
      try {
        return leerAjustesDocker(await fsp.readFile(ruta, 'utf8'))
      } catch {
        // Siguiente candidata: el fichero cambió de nombre en Docker Desktop 4.35.
      }
    }
    return leerAjustesDocker(null)
  }

  /** Modo de red EFECTIVO de WSL (solo Windows), preguntado al sistema y no al `.wslconfig`. */
  private async modoRedDeWsl(
    plataforma: ReturnType<typeof plataformaActual>
  ): Promise<'nat' | 'mirrored' | null> {
    if (plataforma !== 'windows' || !esWindows()) return null
    const salida = await new Promise<string | null>((resolve) => {
      const child = spawn('wsl.exe', ['-d', 'docker-desktop', '--exec', 'wslinfo', '--networking-mode'])
      let out = ''
      const fin = setTimeout(() => {
        child.kill('SIGKILL')
        resolve(null)
      }, 5000)
      child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
      child.on('error', () => {
        clearTimeout(fin)
        resolve(null)
      })
      child.on('close', (code) => {
        clearTimeout(fin)
        resolve(code === 0 ? out : null)
      })
    })
    // `wslinfo` responde en UTF-16 en algunas versiones: los NUL sobrantes se caen aquí.
    return modoRedWsl(salida === null ? null : salida.replace(/\0/g, ''))
  }

  /**
   * LA COMPROBACIÓN QUE DECIDE: un contenedor efímero `--network host` escucha en
   * `127.0.0.1:<puerto libre>` y el main se conecta. `null` = no se pudo comprobar, que no
   * es lo mismo que «no llega».
   */
  private async sondaRedAnfitrion(): Promise<boolean | null> {
    // Nombre y token ÚNICOS por sonda: varias pueden correr a la vez.
    const nombre = `tessera-sonda-red-${process.pid}-${++sondaSeq}`
    const token = `t${process.pid}-${sondaSeq}`
    let puerto: number
    try {
      puerto = await puertoLibre()
    } catch {
      return null
    }
    const guion = `require('net').createServer(s=>s.end('${token}')).listen(${puerto},'127.0.0.1')`
    try {
      const run = await runDocker(
        [
          'run',
          '--rm',
          '-d',
          '--name',
          nombre,
          '--network',
          'host',
          // NUNCA al registro: la imagen es local y un diagnóstico no dispara un build.
          '--pull=never',
          SANDBOX_IMAGE,
          'node',
          '-e',
          guion
        ],
        { timeoutMs: 20_000 }
      )
      if (run.status !== 0) return null
      // Reintentos cortos: el listener tarda unas décimas en estar arriba.
      for (let intento = 0; intento < 8; intento++) {
        if ((await leePuerto(puerto)) === token) return true
        await new Promise((r) => setTimeout(r, 250))
      }
      return false
    } finally {
      // En el `finally` del bloque entero: un timeout del CLI no mata el contenedor.
      await runDocker(['rm', '-f', nombre], { timeoutMs: 15_000 })
    }
  }

  /** Sonda tras crear el contenedor: solo habla si mide que no llega, y una vez por perfil. */
  async avisarSiLaRedNoLlega(profile: Profile): Promise<void> {
    try {
      const { tuEquipo } = nombresSistema(plataformaActual())
      if (this.n.redAvisados.has(profile.id)) return
      // Una medida por proceso: es una propiedad de la MÁQUINA, no del perfil.
      if (this.n.redAnfitrionMedida === null) this.n.redAnfitrionMedida = await this.sondaRedAnfitrion()
      if (this.n.redAnfitrionMedida !== false) return
      this.n.redAvisados.add(profile.id)
      this.n.avisoRed?.({
        profileId: profile.id,
        motivo: 'sonda-fallida',
        titulo: `La red del anfitrión no está llegando a ${tuEquipo}`,
        detalle:
          `El contenedor de “${profile.nombre}” se creó pidiendo la red del anfitrión, pero una prueba real no llegó a ` +
          `${tuEquipo}. Suele ser que «Enable host networking» está desactivado en Docker Desktop (Settings › Resources › ` +
          'Network). Abre «Red del contenedor…» en el menú del perfil para ver el diagnóstico completo.'
      })
    } catch {
      // Best-effort: un diagnóstico que falla no tumba la apertura de una sesión.
    }
  }

  /** Lanza (detached) el puente del callback de Codex; fire-and-forget. */
  startCodexCallbackForwarder(containerName: string): void {
    void runDocker(['exec', '-d', containerName, 'node', '-e', CODEX_CALLBACK_FORWARDER_SCRIPT]).then(
      (r) => {
        if (r.status !== 0) {
          console.log(
            `[sandbox] puente de callback de Codex no iniciado en ${containerName}: ${r.stderr.trim()}`
          )
        }
      },
      () => {}
    )
  }
}
