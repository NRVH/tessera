// =============================================================================
// Ciclo de vida del contenedor de cada perfil: crearlo o reusarlo (coalescido y bajo el
// `candadoPerfil`), ejecutar dentro, escribirle archivos, pararlo y llevar la cuenta
// INFORMATIVA de sesiones. Depende del resto de operaciones de `gestor/`.
// Decisiones: docs/decisiones/sandbox/gestor-concurrencia.md
// =============================================================================
import type { Perfil } from '../../perfiles/types.ts'
import { esContenedorDeTessera, mensajeContenedorAjeno } from '../contenedoresPropios.ts'
import { escribirPorStdinDocker, ejecutarDocker, type ResultadoComandoDocker } from '../adaptadores/docker.ts'
import {
  RAIZ_CONFIG_AGENTE,
  KEEPALIVE_CMD,
  USUARIO_NEUTRO,
  IMAGEN_SANDBOX,
  RAIZ_WORKSPACE,
  raizConfigAgentePara,
  argsEtiquetaInstancia,
  nombreContenedorPara,
  hostnameDe,
  idBase,
  raizGestionadaPara
} from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { DiagnosticoSandbox } from './diagnostico.ts'
import type { ImagenSandbox } from './imagen.ts'
import type { MontajesSandbox } from './montajes.ts'
import type { RedSandbox } from './red.ts'
import type { BarridoSandbox } from './barrido.ts'
import type { CapaPerfilSandbox } from './capaPerfil.ts'
import type { DescriptorContenedor, OpcionesExec, ResultadoExec } from './tipos.ts'
import { txSandbox } from '../textos.ts'

/** Crear, reusar, usar y parar el contenedor de un perfil. */
export class ContenedoresSandbox {
  private readonly n: NucleoSandbox
  private readonly diag: DiagnosticoSandbox
  private readonly imagen: ImagenSandbox
  private readonly montajes: MontajesSandbox
  private readonly red: RedSandbox
  private readonly barrido: BarridoSandbox
  private readonly capa: CapaPerfilSandbox

  constructor(
    n: NucleoSandbox,
    ops: {
      diag: DiagnosticoSandbox
      imagen: ImagenSandbox
      montajes: MontajesSandbox
      red: RedSandbox
      barrido: BarridoSandbox
      capa: CapaPerfilSandbox
    }
  ) {
    this.n = n
    this.diag = ops.diag
    this.imagen = ops.imagen
    this.montajes = ops.montajes
    this.red = ops.red
    this.barrido = ops.barrido
    this.capa = ops.capa
  }

  /**
   * Crea (o reutiliza/reinicia) el contenedor del perfil con SU raíz como `/workspace`
   * (`rshared`); los proyectos entran después en caliente. Coalesce las llamadas en vuelo
   * del mismo perfil y serializa contra paradas y montajes con el `candadoPerfil`.
   */
  async asegurarContenedor(perfil: Perfil): Promise<DescriptorContenedor> {
    const enCurso = this.n.creacionesEnCurso.get(perfil.id)
    if (enCurso) return enCurso
    const resultadoEjecucion = this.n.candadoPerfil
      .ejecutarExclusivo(perfil.id, () => this.crearOReutilizarContenedor(perfil))
      .finally(() => {
        this.n.creacionesEnCurso.delete(perfil.id)
      })
    this.n.creacionesEnCurso.set(perfil.id, resultadoEjecucion)
    return resultadoEjecucion
  }

  /** Cuerpo de `ensureContainer`, ya bajo el candado del perfil. */
  private async crearOReutilizarContenedor(perfil: Perfil): Promise<DescriptorContenedor> {
    // Nunca sobre binds residuales de un cierre sucio: se espera el barrido de arranque.
    if (this.n.barridoArranque) await this.n.barridoArranque

    const nombreContenedor = nombreContenedorPara(perfil)
    const existente = await this.diag.inspeccionarContenedor(nombreContenedor)
    const conocido = this.n.descriptores.get(perfil.id)

    // Camino rápido: el MISMO contenedor vivo (mismo Id); sus montajes siguen valiendo.
    if (existente && existente.State.Running && conocido && conocido.contenedorId === existente.Id) {
      return conocido
    }

    // PIZARRA LIMPIA: el contenedor no es el vivo que conocíamos, así que sus binds se
    // perdieron aunque los mapas los den por montados. Solo se borra si es nuestro.
    if (existente) {
      if (!esContenedorDeTessera(existente, IMAGEN_SANDBOX)) throw new Error(mensajeContenedorAjeno(nombreContenedor))
      await this.conParadaEsperada(nombreContenedor, () => ejecutarDocker(['rm', '-f', nombreContenedor])) // mata el contenedor parado/zombie
    }
    await this.barrido.restablecerMontajesPerfil(perfil) // desmonta binds residuales + limpia mapas
    this.n.descriptores.delete(perfil.id)

    // Las raíces rshared van ANTES del `docker run` para que los montajes en caliente se propaguen.
    await this.montajes.asegurarRaizGestionada(perfil)
    await this.montajes.asegurarRaizConfigAgente(perfil)
    await this.imagen.asegurarImagen()
    // La capa de los agentes manuales del perfil, al día (también si cambió la base); sin capa, la base.
    // La capa es del perfil: el contenedor de una cuenta usa la de su perfil.
    const imagen = await this.capa.imagenPara(idBase(perfil.id), (linea) => this.n.onRegistrarConstruccionImagen?.(linea))

    const redHost = perfil.sandbox?.redHost === true
    const resultadoEjecucion = await this.crearContenedor(perfil, nombreContenedor, redHost, imagen)

    // `docker run -d` imprime el Id: distingue en el próximo `ensureContainer` si sigue siendo ESTE.
    const contenedorId = resultadoEjecucion.stdout.trim()
    const descriptor: DescriptorContenedor = {
      perfilId: perfil.id,
      nombreContenedor,
      contenedorId,
      rutaWorkspace: RAIZ_WORKSPACE,
      redHostAplicado: redHost
    }
    this.n.descriptores.set(perfil.id, descriptor)
    // Vivo de nuevo: la muerte anterior ya no explica nada, y desde ahora lo vigila el supervisor.
    this.n.muertes.delete(perfil.id)
    this.n.oomRecientes.delete(perfil.id)
    this.n.iniciarSupervision?.()
    if (redHost) void this.red.avisarSiLaRedNoLlega(perfil)
    // El puente de BD se monta aquí, el embudo de apertura, recarga y despertar.
    await this.montajes.montarPuenteDb(perfil)
    return descriptor
  }

  /**
   * `docker run` del contenedor; un fallo se propaga. Ninguno publica puertos: la vuelta del
   * login de Codex la trae el puente de Tessera (`agentes/loginCodex.ts`) por `docker exec`.
   */
  private async crearContenedor(perfil: Perfil, nombreContenedor: string, redHost: boolean, imagen: string): Promise<ResultadoComandoDocker> {
    const resultadoEjecucion = await ejecutarDocker(this.argsEjecutarDocker(perfil, nombreContenedor, redHost, imagen))
    if (resultadoEjecucion.status !== 0) {
      throw new Error(txSandbox().contenedores.noSeCreo(nombreContenedor, resultadoEjecucion.stderr.trim()))
    }
    return resultadoEjecucion
  }

  /** Argumentos del `docker run` del contenedor del perfil (red y montajes). */
  private argsEjecutarDocker(perfil: Perfil, nombreContenedor: string, redHost: boolean, imagen: string): string[] {
    return [
      'run',
      '-d',
      '--name',
      nombreContenedor,
      // `--network host` no admite `--hostname` ni `-p`; en bridge, hostname neutro.
      ...(redHost ? ['--network', 'host'] : ['--hostname', hostnameDe(perfil)]),
      '--user',
      USUARIO_NEUTRO,
      // PID 1 que cosecha huérfanos (un navegador colgado no deja zombis).
      '--init',
      // Los 64 MiB de /dev/shm por defecto tumban un navegador que graba vídeo.
      ...(this.n.extras.depsNavegador ? ['--shm-size', '1g'] : []),
      '--mount',
      `type=bind,source=${raizGestionadaPara(perfil)},target=${RAIZ_WORKSPACE},bind-propagation=rshared`,
      '--mount',
      `type=bind,source=${raizConfigAgentePara(perfil)},target=${RAIZ_CONFIG_AGENTE},bind-propagation=rshared`,
      ...argsEtiquetaInstancia(),
      '-w',
      RAIZ_WORKSPACE,
      imagen,
      ...KEEPALIVE_CMD
    ]
  }

  /** Registra una sesión viva del contenedor `perfilId`; `claveSesion` va con su origen (`agent:`). */
  retenerSesion(perfilId: string, claveSesion: string): void {
    let set = this.n.sesionesVivas.get(perfilId)
    if (!set) {
      set = new Set<string>()
      this.n.sesionesVivas.set(perfilId, set)
    }
    set.add(claveSesion)
  }

  /** Da de baja una sesión; `true` si era la última. NUNCA detiene el contenedor. */
  liberarSesion(perfil: Perfil, claveSesion: string): boolean {
    const set = this.n.sesionesVivas.get(perfil.id)
    if (!set || !set.has(claveSesion)) return false
    set.delete(claveSesion)
    const eraUltima = set.size === 0
    if (eraUltima) this.n.sesionesVivas.delete(perfil.id)
    return eraUltima
  }

  /** Nº de sesiones vivas registradas para un contenedor (0 si ninguna). */
  contarSesionesVivas(perfilId: string): number {
    return this.n.sesionesVivas.get(perfilId)?.size ?? 0
  }

  /** Ejecuta en el contenedor; cwd: `opts.cwd`, o el del proyecto, o `/workspace`. */
  async exec(perfil: Perfil, comando: string, opts?: OpcionesExec): Promise<ResultadoExec> {
    const descriptor = this.n.descriptores.get(perfil.id)
    if (!descriptor) {
      throw new Error(
        `No hay contenedor activo para el perfil "${perfil.id}". Llama a ensureContainer() primero.`
      )
    }

    let cwd = opts?.cwd
    if (!cwd && opts?.proyecto) {
      const pm = this.montajes.buscarMontaje(perfil.id, opts.proyecto)
      if (!pm) {
        throw new Error(
          `El proyecto "${opts.proyecto}" no está montado en el perfil "${perfil.id}". ` +
            'Llama a addProject() primero.'
        )
      }
      cwd = pm.rutaWorkspace
    }
    cwd ??= RAIZ_WORKSPACE

    const args = ['exec', '-w', cwd, descriptor.nombreContenedor, 'bash', '-lc', comando]
    const r = await ejecutarDocker(args)
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.status ?? -1
    }
  }

  /**
   * Vuelca los bytes de un archivo en `/tmp` del contenedor, por stdin y como el usuario
   * neutro, y devuelve su ruta EN EL CONTENEDOR (el CLI no puede leer rutas del host).
   */
  async escribirArchivoEnContenedor(
    perfil: Perfil,
    bytes: Buffer,
    nombreArchivo: string,
    marcaTiempo: number
  ): Promise<string> {
    const descriptor = this.n.descriptores.get(perfil.id)
    if (!descriptor) {
      throw new Error(
        `No hay contenedor activo para el perfil "${perfil.id}". Llama a ensureContainer() primero.`
      )
    }
    // Nombre saneado: sin separadores ni caracteres que rompan el `sh -c` o escapen de /tmp.
    const nombreSeguro = nombreArchivo.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(-120) || 'archivo'
    const rutaContenedor = `/tmp/tessera-${marcaTiempo}-${nombreSeguro}`
    // Poda best-effort de clips de más de 12 h en un contenedor de vida larga.
    void ejecutarDocker([
      'exec',
      '-d',
      descriptor.nombreContenedor,
      'sh',
      '-c',
      "find /tmp -maxdepth 1 -name 'tessera-*' -mmin +720 -delete 2>/dev/null || true"
    ])
    await escribirPorStdinDocker(
      ['exec', '-i', '-u', USUARIO_NEUTRO, descriptor.nombreContenedor, 'sh', '-c', `cat > "${rutaContenedor}"`],
      bytes
    )
    return rutaContenedor
  }

  /**
   * Corre una orden que para o borra el contenedor sabiendo que es Tessera quien lo hace: el
   * supervisor no lo cuenta como una muerte. La marca dura lo que la orden y unos segundos más,
   * porque el evento de Docker puede llegar después de que la orden vuelva.
   */
  private async conParadaEsperada<T>(nombreContenedor: string, orden: () => Promise<T>): Promise<T> {
    const marcas = this.n.paradasEsperadas
    marcas.set(nombreContenedor, (marcas.get(nombreContenedor) ?? 0) + 1)
    try {
      return await orden()
    } finally {
      // Cuenta, no conjunto: el plazo de una parada no borra la marca de otra que sigue en curso.
      setTimeout(() => {
        const quedan = (marcas.get(nombreContenedor) ?? 1) - 1
        if (quedan > 0) marcas.set(nombreContenedor, quedan)
        else marcas.delete(nombreContenedor)
      }, 10_000).unref?.()
    }
  }

  /**
   * Detiene y elimina el contenedor del perfil y limpia SUS raíces; nunca la raíz común ni
   * las de otros perfiles. Un contenedor con ese nombre que no es nuestro no se toca.
   */
  async detenerContenedor(perfil: Perfil): Promise<void> {
    return this.n.candadoPerfil.ejecutarExclusivo(perfil.id, async () => {
      const nombreContenedor = nombreContenedorPara(perfil)

      const actual = await this.diag.inspeccionarContenedor(nombreContenedor)
      if (actual && !esContenedorDeTessera(actual, IMAGEN_SANDBOX)) {
        throw new Error(mensajeContenedorAjeno(nombreContenedor))
      }

      const parada = await this.conParadaEsperada(nombreContenedor, () => ejecutarDocker(['stop', nombreContenedor]))
      if (parada.status !== 0 && !/no such container/i.test(parada.stderr)) {
        // Sin olvidar el buzón: si el `stop` falló, el contenedor puede seguir vivo.
        throw new Error(txSandbox().contenedores.noSeDetuvo(nombreContenedor, parada.stderr.trim()))
      }

      // Parado: se olvida el buzón AQUÍ, antes de lo que puede lanzar, o el puente lo
      // sondearía para siempre. Idempotente; `montarPuenteDb` lo da de alta al despertar.
      this.n.olvidarBuzonDb?.(perfil.id)

      const rm = await this.conParadaEsperada(nombreContenedor, () => ejecutarDocker(['rm', nombreContenedor]))
      if (rm.status !== 0 && !/no such container/i.test(rm.stderr)) {
        throw new Error(txSandbox().contenedores.noSeElimino(nombreContenedor, rm.stderr.trim()))
      }

      await this.barrido.limpiarRaicesPerfil(perfil)

      this.n.descriptores.delete(perfil.id)
      this.n.montajesProyecto.delete(perfil.id)
      this.n.montajesConfigAgente.delete(perfil.id)
      this.n.sesionesVivas.delete(perfil.id)
    })
  }
}
