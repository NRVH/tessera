// =============================================================================
// Construcción de las piezas que posee la fachada del explorador: caché de catálogo, archivos de consola, historial,
// gestor de sesiones y exportador. Cada una toma del contexto al CREARSE sus opciones fijas
// (plataforma, carpeta del historial, lanzador); lo que puede cambiar (emitir, log, perfiles vivos,
// espacio de datos) lo leen al usarse las clausuras que se le pasan.
// Decisiones: docs/decisiones/bd/explorador-controlador.md
// =============================================================================

import path from 'node:path'
import type { BrowserWindow } from 'electron'

import { DBX_CHANNELS } from '../../../../shared/db-explorador-ipc.ts'
import type { DbConnection } from '../../../../shared/db-ipc.ts'

import { CacheCatalogo } from '../CacheCatalogo.ts'
import { ConsolasStore } from '../ConsolasStore.ts'
import { Exportador, type OpcionesDialogoGuardar } from '../exportacion.ts'
import { GestorSesiones, type TrabajadorGestor } from '../GestorSesiones.ts'
import { HistorialStore } from '../HistorialStore.ts'
import { ProcesoTrabajador } from '../ProcesoTrabajador.ts'

import type { ContextoExplorador } from './tipos.ts'
import { mensajeDe } from './validacion.ts'

/** La caché del catálogo: emite `dbx:ev:catalogo` al invalidarse. */
export function crearCache(c: ContextoExplorador): CacheCatalogo {
  return new CacheCatalogo({ emitir: (e) => c.emitir(DBX_CHANNELS.EV_CATALOGO, e) })
}

/** Los archivos de consola, en el espacio de datos del perfil si sigue vivo. */
export function crearConsolas(c: ContextoExplorador): ConsolasStore {
  return new ConsolasStore({
    dirPerfil: (perfilId) => {
      if (!c.opciones.perfilVivo(perfilId)) return null
      try {
        return c.registro.espacioDeDatos(perfilId)
      } catch {
        return null
      }
    },
    papelera: (ruta) => c.opciones.papelera(ruta),
    plataforma: c.opciones.plataforma
  })
}

/** El historial de consultas; null si no se le dio carpeta. */
export function crearHistorial(c: ContextoExplorador): HistorialStore | null {
  const dir = c.opciones.dirHistorial
  return dir ? new HistorialStore({ dir, log: (l) => c.log(l) }) : null
}

function lanzadorDe(c: ContextoExplorador): (con: DbConnection) => TrabajadorGestor {
  return (
    c.opciones.lanzar ??
    ((con) =>
      new ProcesoTrabajador({
        rutaScript: path.join(c.registro.tdbScriptDir(), 'sesion.cjs'),
        log: (l) => c.log(`[${con.id.slice(0, 8)}] ${l}`)
      }))
  )
}

/** El gestor de sesiones, con lo que necesita del registro, las consolas, la caché y el historial. */
export function crearGestor(c: ContextoExplorador, historial: HistorialStore | null): GestorSesiones {
  const { opciones, conexiones, registro } = c
  return new GestorSesiones({
    lanzar: lanzadorDe(c),
    conexion: (id) => conexiones.get(id),
    secreto: (id) => conexiones.secretOf(id),
    rutaArchivo: (id) => (conexiones.rutaArchivoDe ? (conexiones.rutaArchivoDe(id) ?? null) : null),
    nombreConsola: async (perfilId, consolaId) => {
      try {
        return (await c.consolas.listar(perfilId)).find((k) => k.id === consolaId)?.nombre ?? null
      } catch {
        return null
      }
    },
    ctxDrivers: () => registro.ctxDrivers(),
    emitirSesion: (estado) => c.emitir(DBX_CHANNELS.EV_SESION, estado),
    alAbrir: (conexionId, driverId) => {
      if (conexiones.marcarVerificada(conexionId, driverId)) registro.notificarCambio()
    },
    alDdl: (conexionId, esquema, global) => {
      if (global || esquema === null) c.cache.invalidar(conexionId, { motivo: 'ddl' })
      else c.cache.invalidar(conexionId, { esquema, motivo: 'ddl' })
    },
    esquemaDeConsola: (perfilId, consolaId) => c.estado.esquemaDeConsola(perfilId, consolaId) ?? null,
    alPerderEsquema: (perfilId, consolaId, perdido) => {
      // Si mientras se reabría el usuario eligió otro esquema, ni el mapa ni el índice lo pierden.
      if (!c.estado.olvidarEsquemaPerdido(perfilId, consolaId, perdido)) return
      c.consolas
        .fijarEsquema(perfilId, consolaId, null)
        .catch((e: unknown) => c.log(`no se pudo olvidar el esquema de una consola: ${mensajeDe(e)}`))
    },
    // Sin esperar: el historial nunca retrasa ni rompe la respuesta de la sentencia.
    alSentencia: historial
      ? (e, d) => {
          if (opciones.perfilVivo(e.perfilId)) void historial.anotar(e, d)
        }
      : undefined,
    ahora: opciones.ahora,
    soloLecturaImpuesta: opciones.soloLecturaImpuesta,
    log: (l) => c.log(l)
  })
}

/** El exportador; el diálogo de guardar lo pone quien lo crea. */
export function crearExportador(
  c: ContextoExplorador,
  guardar: (op: OpcionesDialogoGuardar, ventana: BrowserWindow | null) => Promise<string | null>
): Exportador {
  return new Exportador({
    guardar: (op, ventana) => guardar(op, (ventana as BrowserWindow | null) ?? null),
    revelar: (ruta) => c.opciones.mostrarEnCarpeta?.(ruta),
    emitirProgreso: (p) => c.emitir(DBX_CHANNELS.EV_EXPORTACION, p),
    plataforma: c.opciones.plataforma,
    log: (l) => c.log(l)
  })
}
