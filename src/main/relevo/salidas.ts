// =============================================================================
// Lo que el relevo hace con el desenlace: pintarlo (comprobando si la app sigue en su sitio) y
// las salidas que ofrece la ventana: abrir Tessera, reintentar, volver a la versión anterior y
// abrir el instalador con su asistente. Una a la vez: mientras una trabaja no hay botones.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { situacionTrasFallo, type EncargoRelevo, type VeredictoInstalador } from '../../shared/relevo'
import { instalar, restaurarAnterior } from './supervisor'
import { txRelevoUi } from './textos.ts'
import type { EstadoPintable } from '../../shared/relevo'

/** Lo que las salidas necesitan de la ventana (la implementa `adaptadores/ventana.ts`). */
export interface PantallaRelevo {
  readonly lineas: string[]
  pintar(e: EstadoPintable): void
  paso(titulo: string, detalle: string): void
  registrar(log: (m: string) => void, m: string): void
}

export interface SalidasRelevo {
  pintarVeredicto(veredicto: VeredictoInstalador): void
  abrirTessera(): void
  /** Corre una acción larga si no hay otra en marcha; si la hay, el clic sobra. */
  enExclusiva(accion: () => Promise<void>): void
  reintentar(): Promise<void>
  volverALaAnterior(): Promise<void>
  abrirInstalador(): Promise<void>
}

/** Lanza un ejecutable que sobreviva a este proceso, con `cwd` fuera de la carpeta de instalación. */
function lanzarDesprendido(exe: string, log: (m: string) => void): number {
  // El fallo de `spawn` llega por un evento asíncrono: lo que se puede saber antes, se mira antes.
  if (!existsSync(exe)) throw new Error(`no existe ${exe}`)
  const hijo = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) })
  hijo.on('error', (err) => log(`${exe} no arrancó: ${String(err)}`))
  if (hijo.pid === undefined) throw new Error('el sistema no le dio pid')
  hijo.unref()
  return hijo.pid
}

/** `salir` termina este proceso: lo pone la raíz de composición. */
export function crearSalidas(
  encargo: EncargoRelevo,
  ventana: PantallaRelevo,
  log: (m: string) => void,
  salir: () => void
): SalidasRelevo {
  const registrar = (m: string): void => ventana.registrar(log, m)
  const paso = (t: string, d: string): void => ventana.paso(t, d)
  // La copia del relevo ES la versión anterior: este mismo programa.
  const copia = path.dirname(process.execPath)
  let ocupado = false

  const s: SalidasRelevo = {
    /**
     * El desenlace en pantalla. Tras un fallo se COMPRUEBA si el ejecutable sigue en su sitio en
     * vez de suponerlo: el instalador quita la versión vieja antes de poner la nueva.
     */
    pintarVeredicto(veredicto) {
      const resumen = `veredicto: ${veredicto.ok ? 'OK' : 'FALLO'} — ${veredicto.titulo}`
      log(resumen)
      ventana.lineas.push(resumen)
      if (veredicto.ok) {
        ventana.pintar({ fase: 'ok', titulo: veredicto.titulo, detalle: veredicto.detalle || txRelevoUi().yaPuedes })
        return
      }
      const enSuSitio = existsSync(encargo.exeApp)
      const linea = `tras el fallo, ${encargo.exeApp} ${enSuSitio ? 'sigue en su sitio' : 'NO está'}`
      log(linea)
      ventana.lineas.push(linea)
      ventana.pintar({
        fase: 'error',
        titulo: veredicto.titulo,
        detalle: [veredicto.detalle, situacionTrasFallo(enSuSitio)].filter((t) => t.length > 0).join('\n\n')
      })
    },

    /**
     * Abre Tessera y se muere, en ese orden: `shell.openPath` es asíncrono, y salir en la línea
     * siguiente mataría el proceso antes de que el lanzamiento llegue a ocurrir.
     */
    abrirTessera() {
      log('el usuario pulsó Abrir Tessera')
      try {
        log(`Tessera lanzada (pid ${lanzarDesprendido(encargo.exeApp, log)})`)
      } catch (err) {
        // No se sale: si no arrancó, cerrar la ventana dejaría al usuario sin nada. Y se queda en
        // la fase del final bueno: la instalación salió bien, y las salidas de un fallo (volver a
        // la anterior, reinstalar) desharían algo que funciona.
        log(`no se pudo lanzar Tessera: ${String(err)}`)
        ventana.lineas.push(`no se pudo abrir Tessera automáticamente: ${String(err)}`)
        ventana.pintar({ fase: 'ok', titulo: txRelevoUi().noAbrioTitulo, detalle: txRelevoUi().noAbrioDetalle })
        return
      }
      salir()
    },

    enExclusiva(accion) {
      if (ocupado) return
      ocupado = true
      void accion().finally(() => {
        ocupado = false
      })
    },

    async reintentar() {
      log('el usuario pulsó Reintentar')
      s.pintarVeredicto(await instalar(encargo, paso, registrar))
    },

    async volverALaAnterior() {
      log('el usuario pulsó Volver a la versión anterior')
      paso(txRelevoUi().restaurandoTitulo, txRelevoUi().restaurandoDetalle)
      if (await restaurarAnterior(encargo, copia, registrar)) {
        s.abrirTessera()
        return
      }
      ventana.pintar({
        fase: 'error',
        titulo: txRelevoUi().noRestauroTitulo,
        detalle: txRelevoUi().noRestauroDetalle(copia, encargo.raizInstalacion)
      })
    },

    /** El instalador con su asistente, sin `/S`: la salida manual, viendo cada paso. */
    async abrirInstalador() {
      log('el usuario pulsó Abrir el instalador')
      try {
        log(`instalador abierto (pid ${lanzarDesprendido(encargo.instalador, log)})`)
      } catch (err) {
        log(`no se pudo abrir el instalador: ${String(err)}`)
        ventana.pintar({
          fase: 'error',
          titulo: txRelevoUi().noAbrioInstaladorTitulo,
          detalle: txRelevoUi().noAbrioInstaladorDetalle(encargo.instalador)
        })
        return
      }
      salir()
    }
  }
  return s
}
