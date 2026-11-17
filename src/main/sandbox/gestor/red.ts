// =============================================================================
// Red del contenedor: toma las MEDIDAS del modo anfitrión (motor, ajustes de Docker, modo de
// WSL y una sonda real) y delega criterio y textos en `redAnfitrion.ts`. También el aviso
// cuando la red del anfitrión no llega.
// Decisiones: docs/decisiones/sandbox/red-del-anfitrion.md
// =============================================================================
import { spawn } from 'node:child_process'
import os from 'node:os'
import fsp from 'node:fs/promises'
import net from 'node:net'
import type { Perfil } from '../../perfiles/types.ts'
import { esWindows, plataformaActual } from '../../../shared/plataforma.ts'
import { nombresSistema } from '../../../shared/nombresSistema.ts'
import type { ResultadoRedPrevuelo } from '../../../shared/sandbox-red-ipc.ts'
import {
  evaluarPrevuelo,
  leerAjustesDocker,
  modoRedWsl,
  notaSalidaVpn,
  rutasAjustesDocker
} from '../redAnfitrion.ts'
import { ejecutarDocker } from '../adaptadores/docker.ts'
import { argsEtiquetaInstancia } from './nombres.ts'
import { txSandbox } from '../textos.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'

/** Un puerto alto LIBRE pedido al sistema (bind al 0, leer, cerrar); nunca el 1455. */
function puertoLibre(): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const srv = net.createServer()
    srv.on('error', rechazar)
    srv.listen(0, '127.0.0.1', () => {
      const dir = srv.address()
      if (dir === null || typeof dir === 'string') {
        srv.close(() => rechazar(new Error('sin puerto')))
        return
      }
      const puerto = dir.port
      srv.close(() => resolver(puerto))
    })
  })
}

/**
 * Lo que conteste `127.0.0.1:puerto` desde el anfitrión, o `null`. Que acepte la conexión
 * no basta: el puerto se suelta antes del `docker run` y otro proceso podría tomarlo, así
 * que la sonda contesta un token y se exige ese token.
 */
function leePuerto(puerto: number, topeMs = 1000): Promise<string | null> {
  return new Promise((resolver) => {
    const sock = net.connect({ port: puerto, host: '127.0.0.1' })
    let datos = ''
    const cerrar = (v: string | null): void => {
      sock.destroy()
      resolver(v)
    }
    sock.setTimeout(topeMs, () => cerrar(null))
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
  redPendienteDeReiniciar(perfil: Perfil): boolean {
    const descriptor = this.n.descriptores.get(perfil.id)
    if (!descriptor) return false
    return descriptor.redHostAplicado !== (perfil.sandbox?.redHost === true)
  }

  /** Perfiles con un contenedor VIVO corriendo en modo anfitrión ahora mismo. */
  perfilesEnModoAnfitrion(exceptoId?: string): string[] {
    return [...this.n.descriptores.values()]
      .filter((h) => h.redHostAplicado && h.perfilId !== exceptoId)
      .map((h) => h.perfilId)
  }

  /**
   * El PREVUELO: toma las medidas y delega TODO el criterio y el texto en
   * `evaluarPrevuelo`. No decide nada: el usuario manda incluso con el prevuelo en rojo.
   */
  async prevueloRedHost(
    perfil: Perfil,
    perfiles: readonly Perfil[] = [],
    medirTrafico = true
  ): Promise<ResultadoRedPrevuelo> {
    const perfilId = perfil.id
    const plataforma = plataformaActual()
    const { tuEquipo } = nombresSistema(plataforma)

    // Timeout corto en las dos sondas calientes, como `checkDocker`.
    const [info, version, ajustes, wsl, trafico] = await Promise.all([
      ejecutarDocker(['info', '--format', '{{.OSType}}'], { topeMs: 30_000 }),
      ejecutarDocker(['version', '--format', '{{.Server.Platform.Name}}'], { topeMs: 30_000 }),
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
        redHostHabilitada: ajustes.redHostHabilitada,
        aislamientoReforzado: ajustes.aislamientoReforzado,
        traficoLlega: trafico
      },
      plataforma,
      tuEquipo
    )

    // El contrato promete el NOMBRE del otro perfil; el handle solo guarda el id.
    const otroId = this.perfilesEnModoAnfitrion(perfilId)[0] ?? null
    const otroNombre =
      otroId === null ? null : (perfiles.find((p) => p.id === otroId)?.nombre ?? otroId)
    return {
      filas: resultado.filas,
      hayFallas: resultado.hayFallas,
      notaSalidaVpn: notaSalidaVpn(plataforma, wsl),
      otroPerfilEnAnfitrion: otroNombre,
      pendiente: this.redPendienteDeReiniciar(perfil)
    }
  }

  /** Las dos claves de los ajustes de Docker Desktop: una PISTA; un fallo de lectura es `null`. */
  private async leerAjustesDockerDesktop(
    plataforma: ReturnType<typeof plataformaActual>
  ): Promise<{ redHostHabilitada: boolean | null; aislamientoReforzado: boolean | null }> {
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
    const salida = await new Promise<string | null>((resolver) => {
      const procesoHijo = spawn('wsl.exe', ['-d', 'docker-desktop', '--exec', 'wslinfo', '--networking-mode'])
      let salidaWsl = ''
      const fin = setTimeout(() => {
        procesoHijo.kill('SIGKILL')
        resolver(null)
      }, 5000)
      procesoHijo.stdout.on('data', (d: Buffer) => (salidaWsl += d.toString('utf8')))
      procesoHijo.on('error', () => {
        clearTimeout(fin)
        resolver(null)
      })
      procesoHijo.on('close', (codigo) => {
        clearTimeout(fin)
        resolver(codigo === 0 ? salidaWsl : null)
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
      const resultadoEjecucion = await ejecutarDocker(
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
          ...argsEtiquetaInstancia(),
          this.n.imagen,
          'node',
          '-e',
          guion
        ],
        { topeMs: 20_000 }
      )
      if (resultadoEjecucion.status !== 0) return null
      // Reintentos cortos: el listener tarda unas décimas en estar arriba.
      for (let intento = 0; intento < 8; intento++) {
        if ((await leePuerto(puerto)) === token) return true
        await new Promise((r) => setTimeout(r, 250))
      }
      return false
    } finally {
      // En el `finally` del bloque entero: un timeout del CLI no mata el contenedor.
      await ejecutarDocker(['rm', '-f', nombre], { topeMs: 15_000 })
    }
  }

  /** Sonda tras crear el contenedor: solo habla si mide que no llega, y una vez por perfil. */
  async avisarSiLaRedNoLlega(perfil: Perfil): Promise<void> {
    try {
      const { tuEquipo } = nombresSistema(plataformaActual())
      if (this.n.redAvisados.has(perfil.id)) return
      // Una medida por proceso: es una propiedad de la MÁQUINA, no del perfil.
      if (this.n.redAnfitrionMedida === null) this.n.redAnfitrionMedida = await this.sondaRedAnfitrion()
      if (this.n.redAnfitrionMedida !== false) return
      this.n.redAvisados.add(perfil.id)
      this.n.avisoRed?.({
        perfilId: perfil.id,
        motivo: 'sonda-fallida',
        titulo: txSandbox().red.sondaTitulo(tuEquipo),
        detalle: txSandbox().red.sondaDetalle(perfil.nombre, tuEquipo)
      })
    } catch {
      // Best-effort: un diagnóstico que falla no tumba la apertura de una sesión.
    }
  }
}
