// =============================================================================
// Las acciones del lateral de BD sobre conexiones y consolas: copiar, refrescar, probar,
// desconectar, eliminar y renombrar. Cada una recibe el contexto del render que la lanzó
// (`CtxArbol`), el mismo que tenían sus clausuras. Una transacción pendiente se pregunta
// (Confirmar / Revertir / Cancelar) antes de reintentar con esa resolución.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import { olvidarEnPerfilTrasBorrar, type DbConexionAjena, type DbConnection } from '../../../../shared/db-ipc'
import type { DbConsolaInfo, DbResolverTx, DbRespuesta } from '../../../../shared/db-explorador-ipc'
import { notify } from '../../comun/notifications'
import { idDbPane, paneKeyDb } from './dbTabsModel'
import { aliasParaConfirmar, avisoRevertidas, mensajeDeError, nombresDeRefs, opcionesTxArbol } from './filasArbolBd'
import { solicitarCierreConsola } from './registroConsolas'
import type { CtxArbol } from './DbArbolTipos'

/**
 * La respuesta de un invoke que lanzó, con la forma de un fallo del canal. `never`
 * en el valor: encaja con la respuesta de cualquier canal (`void` o no).
 */
function respuestaDeError(err: unknown): DbRespuesta<never> {
  return { ok: false, error: { motivo: 'interno', mensaje: mensajeDeError(err) } }
}

export function avisoError(a: CtxArbol, texto: string): void {
  a.e.setAviso({ tono: 'error', texto })
}

export function copiar(a: CtxArbol, texto: string | null): void {
  if (!texto) return
  void window.tessera.clipboard.write(texto).catch((err: unknown) => avisoError(a, `No se pudo copiar: ${mensajeDeError(err)}`))
}

export function refrescar(a: CtxArbol, conexionId: string, esquema?: string, base?: string): void {
  // La base solo viaja si la hay: sin ella, la llamada de siempre.
  void (base === undefined ? a.dbx.refrescar(conexionId, esquema) : a.dbx.refrescar(conexionId, esquema, base))
    .catch((err: unknown) => avisoError(a, `No se pudo refrescar: ${mensajeDeError(err)}`))
}

export function refrescarCabecera(a: CtxArbol): void {
  const ids = a.d.conexionSel ? [a.d.conexionSel] : a.p.conexiones.map((c) => c.id)
  for (const id of ids) refrescar(a, id)
  // Las consolas son archivos que el agente también puede tocar: se vuelven a listar.
  a.p.onConsolasCambiaron()
}

export async function probar(a: CtxArbol, c: DbConnection): Promise<void> {
  const { setProbando, setAviso, setDialogo } = a.e
  if (a.e.probando) return
  setProbando(c.id)
  setAviso({ tono: 'info', texto: `Probando ${c.alias}…` })
  try {
    const r = await window.tessera.db.test(c.id)
    const detalle = [r.servidor, r.ms !== undefined ? `${r.ms} ms` : null].filter(Boolean).join(' · ')
    const requiere = r.requiereDriver
    setAviso({
      tono: r.ok ? 'ok' : 'error',
      texto: `${r.ok ? '✓' : '✗'} ${c.alias}: ${r.mensaje}`,
      detalle: detalle || undefined,
      accion: requiere
        ? {
            etiqueta: 'Instalar cliente…',
            hacer: () => setDialogo({ conexionId: c.id, abrirClientes: true, requiereDriver: requiere })
          }
        : undefined
    })
  } catch (err) {
    avisoError(a, `✗ ${c.alias}: ${mensajeDeError(err)}`)
  } finally {
    setProbando(null)
  }
}

export async function desconectar(a: CtxArbol, c: DbConnection, resolver?: DbResolverTx): Promise<void> {
  const { consolas, sesiones } = a.p
  const r = await a.dbx.desconectar(c.id, resolver).catch(respuestaDeError)
  if (r.ok) {
    // En bloque, «Confirmar» revierte las fallidas: se dice cuáles, para que nadie
    // las dé por confirmadas. Con `rollback` el main no lista nada (era lo pedido).
    // El `?.` es a propósito: un main anterior respondía `void`.
    const aviso = avisoRevertidas(c.alias, r.valor?.revertidasFallidas ?? [], consolas)
    if (aviso) notify('info', 'Transacciones fallidas revertidas', aviso)
    return
  }
  if (r.error.motivo === 'txPendiente' && resolver === undefined) {
    const refs = r.error.txPendientes ?? []
    const nombres = nombresDeRefs(refs, consolas)
    const opciones = opcionesTxArbol(refs, sesiones, true)
    a.e.setPeticionTx({
      titulo: 'Transacciones sin confirmar',
      mensaje:
        // En producción el alias lo dice: aquí «Confirmar» es un COMMIT.
        `${aliasParaConfirmar(c)} tiene cambios sin confirmar` +
        (nombres.length > 0 ? ` en ${nombres.join(', ')}` : '') +
        (opciones.confirmar === null
          ? '. Para desconectar hay que revertirlos.'
          : '. Para desconectar hay que confirmarlos o revertirlos.'),
      opciones,
      onResolver: (res) => void desconectar(a, c, res)
    })
    return
  }
  avisoError(a, `No se pudo desconectar ${c.alias}: ${r.error.mensaje}`)
}

/**
 * Borra una conexión, conocida o AJENA, por el mismo DELETE (el main quita la entrada TAL
 * CUAL y avisa con `db:changed`). `ajena` dice CUÁL de las dos, porque pueden compartir id, y
 * va el PERFIL de la fila: el olvido de montajes y pestañas se ciñe a él y solo si no queda
 * una conocida con ese id (`olvidarEnPerfilTrasBorrar`).
 */
export async function eliminarPorId(
  a: CtxArbol,
  c: Pick<DbConnection | DbConexionAjena, 'id' | 'alias' | 'profileId'>,
  ajena: boolean
): Promise<void> {
  try {
    // De una ajena va también su alias: dos ajenas pueden compartir id.
    const r = await window.tessera.db.remove(c.id, ajena, ajena ? c.alias : undefined, c.profileId)
    if (olvidarEnPerfilTrasBorrar(r)) a.p.onConexionEliminada(c.id, c.profileId)
    a.p.onConsolasCambiaron()
  } catch (err) {
    avisoError(a, `No se pudo eliminar ${c.alias}: ${mensajeDeError(err)}`)
  }
}

export async function eliminarConsola(a: CtxArbol, k: DbConsolaInfo, resolver?: DbResolverTx): Promise<void> {
  const { perfilId } = a.p
  if (!perfilId) return
  // Si está abierta, se pregunta como al cerrar su pestaña (¿detener lo que corre?,
  // ¿qué hacer con su transacción?). Con `resolver` ya se preguntó.
  if (resolver === undefined) {
    const paneKey = paneKeyDb(perfilId, idDbPane({ kind: 'consola', conexionId: k.conexionId, consolaId: k.id }))
    if (!(await solicitarCierreConsola(paneKey))) return
  }
  const r = await a.dbx.borrarConsola(perfilId, k.id, resolver).catch(respuestaDeError)
  if (r.ok) {
    a.p.onConsolasCambiaron()
    return
  }
  if (r.error.motivo === 'txPendiente' && resolver === undefined) {
    // Una sola consola NO es un bloque: el main no revierte su fallida al confirmar
    // (la rechaza), así que aquí solo caben dos mitades, con o sin Confirmar.
    const refs = r.error.txPendientes ?? [{ rol: 'consola' as const, perfilId, consolaId: k.id }]
    a.e.setPeticionTx({
      titulo: 'Transacción sin confirmar',
      mensaje: `«${k.nombre}» tiene cambios sin confirmar. Elige qué hacer con ellos antes de eliminarla.`,
      opciones: opcionesTxArbol(refs, a.p.sesiones, false),
      onResolver: (res) => void eliminarConsola(a, k, res)
    })
    return
  }
  avisoError(a, `No se pudo eliminar «${k.nombre}»: ${r.error.mensaje}`)
}

export async function renombrarConsola(a: CtxArbol, k: DbConsolaInfo, nombre: string): Promise<void> {
  const { perfilId } = a.p
  const { setRenombrando } = a.e
  if (!perfilId) return
  if (nombre === k.nombre) {
    setRenombrando(null)
    return
  }
  const r = await a.dbx.renombrarConsola(perfilId, k.id, nombre).catch((err: unknown) => ({
    ok: false as const,
    error: { motivo: 'interno' as const, mensaje: mensajeDeError(err) }
  }))
  if (r.ok) {
    setRenombrando(null)
    a.p.onConsolasCambiaron()
  } else {
    setRenombrando({ consola: k, error: r.error.mensaje })
  }
}
