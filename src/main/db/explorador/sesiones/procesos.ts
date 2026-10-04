// =============================================================================
// Procesos de sesión (`src/tdb/sesion.cjs`): lanzarlos bajo demanda, expulsar el ocioso más
// viejo al llegar al tope, retirarlos, matar el colgado y atender su salida y sus eventos.
// Decisiones: docs/decisiones/bd/sesiones-procesos-y-autoridad.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc.ts'
import { type MotivoCierre, tieneTxPendiente } from '../maquinaSesion.ts'
import { CIERRE_TRABAJADORES_MS, MAX_PROCESOS, MAX_PROCESOS_CONSOLA } from '../limites.ts'
import type { EventoTrabajador } from '../protocoloTrabajador.ts'
import { ErrorGestor, mensajeDe } from './errores.ts'
import type { NucleoSesiones } from './NucleoSesiones.ts'
import { abierta, claveProceso, exigirSql } from './reglas.ts'
import type { Proceso, Sesion } from './tipos.ts'

/** Ciclo de vida de los procesos de sesión. */
export class Procesos {
  private readonly n: NucleoSesiones

  constructor(n: NucleoSesiones) {
    this.n = n
  }

  private procesoOcioso(p: Proceso): boolean {
    if (!p.listo || p.salido || p.retirado || p.trabajador.pendientes > 0) return false
    return this.n.sesionesDe(p).every(
      (s) =>
        s.estado.fase !== 'ocupada' &&
        s.estado.fase !== 'abriendo' &&
        s.cola.vacia() &&
        s.operacionUsuario === null &&
        !tieneTxPendiente(s.estado)
    )
  }

  /** Al llegar a `MAX_PROCESOS`: expulsa el ocioso usado hace más tiempo o falla con `limite`. */
  private hacerSitioProceso(deConsola = false): void {
    // Los procesos PROPIOS de una consola (`procesoPorSesion`, SQLite) cuentan aparte, contra
    // `MAX_PROCESOS_CONSOLA`: el de las conexiones sigue midiendo conexiones abiertas, y una
    // SQLite con tres consolas no se come el sitio de tres conexiones (ver `limites.ts`).
    const tope = deConsola ? MAX_PROCESOS_CONSOLA : MAX_PROCESOS
    const vivos = [...this.n.procesos()].filter((p) => !p.retirado && !p.salido && p.deConsola === deConsola)
    if (vivos.length < tope) return
    const victima = vivos.filter((p) => this.procesoOcioso(p)).sort((a, b) => a.ultimoUso - b.ultimoUso)[0]
    if (!victima) {
      throw new ErrorGestor(
        'limite',
        deConsola
          ? `Hay ${tope} consolas con proceso propio abiertas a la vez y ninguna se puede cerrar sin perder trabajo. Cierra alguna para abrir otra.`
          : `Hay ${tope} conexiones abiertas a la vez y ninguna se puede cerrar sin perder trabajo. Desconecta alguna para abrir otra.`
      )
    }
    this.n.log(`se retira el proceso de ${victima.conexionId} (límite de ${tope} procesos)`)
    void this.retirar(victima, 'expulsada')
  }

  async procesoPara(con: DbConnection, s?: Pick<Sesion, 'rol' | 'clave'>): Promise<Proceso> {
    const clave = s ? claveProceso(con, s) : con.id
    const deConsola = clave !== con.id
    const actual = this.n.procesoVigente(clave)
    if (actual && !actual.retirado && !actual.salido) {
      await actual.arranque
      if (!actual.salido && !actual.retirado) return actual
    }
    if (this.n.estaCerrando()) throw new ErrorGestor('interno', 'Tessera se está cerrando.')
    // El ÚNICO sitio que lanza el trabajador SQL: aunque un camino se
    // saltara `conexionOError`, un MongoDB o un Redis no llega a arrancar un proceso de `tdb`.
    exigirSql(con)
    this.hacerSitioProceso(deConsola)
    const trabajador = this.n.deps.lanzar(con)
    const p: Proceso = {
      id: this.n.siguienteIdProceso(),
      conexionId: con.id,
      clave,
      deConsola,
      trabajador,
      arranque: Promise.resolve(),
      listo: false,
      salido: false,
      retirado: false,
      colgado: false,
      salida: null,
      ultimoUso: this.n.ahora(),
      sinSesionesDesde: null,
      driverId: null,
      bajas: []
    }
    this.n.registrarProceso(p)
    p.bajas.push(trabajador.onEvento((e) => this.alEvento(p, e)))
    p.bajas.push(trabajador.onSalida((s) => this.alSalirProceso(p, s)))
    this.n.log(`lanzar proceso #${p.id} de ${con.id}${deConsola ? ' (consola)' : ''}`)
    p.arranque = trabajador.arrancar().then(
      () => {
        p.listo = true
      },
      (err: unknown) => {
        this.n.log(`el proceso #${p.id} de ${con.id} no arrancó: ${mensajeDe(err)}`)
        try {
          trabajador.matar()
        } catch {
          // ya no está
        }
        this.olvidarProceso(p)
        throw new ErrorGestor('interno', 'No se pudo lanzar el proceso de la conexión.')
      }
    )
    await p.arranque
    return p
  }

  private olvidarProceso(p: Proceso): void {
    p.salido = true
    this.n.olvidarProceso(p)
    for (const baja of p.bajas.splice(0)) {
      try {
        baja()
      } catch {
        // nada que hacer
      }
    }
  }

  /**
   * Retira un proceso: no admite sesiones nuevas, cierra (máquina) las ociosas y
   * sale. Las que estén trabajando mueren con él (`salir` interrumpe y revierte).
   */
  retirar(p: Proceso, motivo: MotivoCierre): Promise<void> {
    if (p.retirado && p.salida) return p.salida
    this.n.retirarProceso(p)
    for (const s of this.n.sesionesDe(p)) {
      if (s.estado.fase === 'lista' && s.cola.vacia() && s.operacionUsuario === null) {
        const ef = this.n.aplicar(s, { tipo: 'cierre', ahora: this.n.ahora(), motivo, resolver: 'rollback' })
        // El `salir` del trabajador cierra TODAS sus sesiones: sin un `cerrar` por cada una.
        this.n.efectosSincronos(
          s,
          ef.filter((e) => e.tipo !== 'cerrarSesion')
        )
        s.proceso = null
      }
    }
    this.n.log(`retirar proceso #${p.id} de ${p.conexionId} (${motivo})`)
    p.salida = p.trabajador.salir(CIERRE_TRABAJADORES_MS).catch((e: unknown) => {
      this.n.log(`salir del proceso #${p.id} falló: ${mensajeDe(e)}`)
    })
    return p.salida
  }

  /** Un vigilante venció: el proceso no contesta. Se mata; sus sesiones, caídas. */
  matarColgado(p: Proceso | null): void {
    if (!p || p.salido) return
    this.n.log(`proceso #${p.id} de ${p.conexionId} colgado: se mata`)
    p.colgado = true
    this.n.retirarProceso(p)
    try {
      p.trabajador.matar()
    } catch {
      // ya no está
    }
  }

  private alSalirProceso(p: Proceso, salida: { codigo: number | null; senal: string | null }): void {
    if (p.salido) return
    const caida = !p.retirado || p.colgado
    this.olvidarProceso(p)
    this.n.log(
      `salió el proceso #${p.id} de ${p.conexionId} (${salida.senal ? `señal ${salida.senal}` : `código ${String(salida.codigo)}`})`
    )
    for (const s of [...this.n.sesiones()]) {
      if (s.proceso !== p) continue
      s.proceso = null
      if (abierta(s)) {
        // Lo mató un Stop (`detenerMatando`): no es una pérdida, lo pidió el usuario.
        if (p.detenido) {
          this.n.efectosSincronos(s, this.n.aplicar(s, { tipo: 'detenida', ahora: this.n.ahora() }))
          continue
        }
        // Esto llega ANTES que el rechazo de la operación en vuelo: si llevaba una
        // confirmación en camino, es aquí donde el aviso tiene que decirlo.
        const ef = this.n.aplicar(s, {
          tipo: 'perdida',
          ahora: this.n.ahora(),
          caida,
          commitEnCamino: s.commitEnCamino !== undefined,
          porDentro: s.commitEnCamino === 'porDentro'
        })
        this.n.efectosSincronos(s, ef)
      }
    }
  }

  private alEvento(p: Proceso, e: EventoTrabajador): void {
    if (e.ev === 'fatal') {
      this.n.log(`el proceso #${p.id} de ${p.conexionId} avisó de un fallo fatal`)
      return
    }
    const s = [...this.n.sesiones()].find((x) => x.proceso === p && x.idTrabajador === e.sesion)
    if (!s) return
    // Con una operación en curso, su respuesta ya lo dirá.
    if (s.estado.fase === 'ocupada') return
    this.n.log(`sesión ${s.rol} de ${s.conexionId} perdida estando ociosa`)
    this.n.perder(s)
  }
}
