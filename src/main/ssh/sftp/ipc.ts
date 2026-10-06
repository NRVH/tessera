// =============================================================================
// Registro de los canales `SFTP_CHANNELS`: comprueba la FORMA de cada petición (textos donde el contrato
// pide textos) y delega en `SesionesSftp`, que decide lo que vale cada ruta. Solo lo importa
// `src/main/ssh/componer.ts`.
// Decisiones: docs/decisiones/ssh/explorador-sftp.md
// =============================================================================
import type { IpcMain } from 'electron'
import { SFTP_CHANNELS } from '../../../shared/sftp-ipc.ts'
import { esObjeto } from '../../util/valores.ts'
import type { SesionesSftp } from './SesionesSftp.ts'

const MAL_FORMADA = 'Petición del explorador SFTP mal formada'

function objeto(v: unknown): Record<string, unknown> {
  if (!esObjeto(v)) throw new Error(`${MAL_FORMADA}.`)
  return v
}

function texto(o: Record<string, unknown>, campo: string): string {
  const v = o[campo]
  if (typeof v !== 'string') throw new Error(`${MAL_FORMADA}: «${campo}» tiene que ser un texto.`)
  return v
}

export function registrarIpcSftp(ipc: IpcMain, sftp: SesionesSftp): void {
  ipc.handle(SFTP_CHANNELS.ABRIR, (_e, req: unknown) => {
    const o = objeto(req)
    return sftp.abrir(texto(o, 'sesionId'), texto(o, 'profileId'), texto(o, 'conexionId'))
  })
  ipc.handle(SFTP_CHANNELS.LISTAR, (_e, req: unknown) => {
    const o = objeto(req)
    return sftp.listar(texto(o, 'sesionId'), texto(o, 'ruta'))
  })
  ipc.handle(SFTP_CHANNELS.CREAR_CARPETA, (_e, req: unknown) => {
    const o = objeto(req)
    return sftp.crearCarpeta(texto(o, 'sesionId'), texto(o, 'ruta'))
  })
  ipc.handle(SFTP_CHANNELS.RENOMBRAR, (_e, req: unknown) => {
    const o = objeto(req)
    return sftp.renombrar(texto(o, 'sesionId'), texto(o, 'desde'), texto(o, 'a'))
  })
  ipc.handle(SFTP_CHANNELS.BORRAR, (_e, req: unknown) => {
    const o = objeto(req)
    return sftp.borrar(texto(o, 'sesionId'), o.rutas)
  })
  ipc.handle(SFTP_CHANNELS.DESCARGAR, (_e, req: unknown) => {
    const o = objeto(req)
    return sftp.descargar(texto(o, 'sesionId'), o.rutas)
  })
  ipc.handle(SFTP_CHANNELS.SUBIR, (_e, req: unknown) => {
    const o = objeto(req)
    return sftp.subirElegidos(texto(o, 'sesionId'), texto(o, 'destino'), o.carpeta === true)
  })
  ipc.handle(SFTP_CHANNELS.SUBIR_SOLTADOS, (_e, req: unknown) => {
    const o = objeto(req)
    return sftp.subirSoltados(texto(o, 'sesionId'), texto(o, 'destino'), o.rutasLocales)
  })
  ipc.handle(SFTP_CHANNELS.CONFIRMAR_PLAN, (_e, req: unknown) => {
    const o = objeto(req)
    return sftp.confirmarPlan(texto(o, 'planId'), o.reemplazar === true)
  })
  ipc.handle(SFTP_CHANNELS.CANCELAR, (_e, req: unknown) => sftp.cancelar(texto(objeto(req), 'opId')))
  ipc.handle(SFTP_CHANNELS.MOSTRAR_DESCARGA, (_e, req: unknown) => sftp.mostrarDescarga(texto(objeto(req), 'opId')))
  ipc.handle(SFTP_CHANNELS.CERRAR, (_e, req: unknown) => sftp.cerrar(texto(objeto(req), 'sesionId')))
}
