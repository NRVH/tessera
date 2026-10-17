// =============================================================================
// El diálogo de «Borrar claves por patrón» del árbol de Redis: escribe el patrón, ENSEÑA lo que va a borrar
// (cuántas y las primeras) y solo entonces borra EXACTAMENTE esas con `UNLINK`, por la consola de Redis del
// main, que aplica la solo lectura impuesta y la marca de producción. En producción lleva la franja y el
// botón «Borrar en producción»: el botón es la confirmación. Lo pinta `DialogosArbol`.
// La lógica (recoger, partir en lotes, enviar) es de `borradoClaves.ts`.
// Decisiones: docs/decisiones/bd/ui-claves-borrar-por-patron.md
// =============================================================================

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { DbConnection } from '../../../../../shared/db-ipc'
import { PREFIJO_CONSOLA_VISOR, type DbKvPaginaClaves, type DbKvResultado, type DbKvTipo } from '../../../../../shared/db-claves-ipc'
import type { DbRespuesta } from '../../../../../shared/db-explorador-ipc'
import { esProduccion } from '../consola/produccionConsola'
import { useDialogo } from '../../../comun/useDialogo'
import { patronDeFiltro } from '../arbolClaves'
import { errorDeInvoke, textoError } from '../panesBd'
import { pintarBytes } from './bytesClaves'
import { etiquetaTipo } from './visorClaves'
import { txEdicionClaves } from './textosEdicionClaves'
import {
  CUENTA_BORRADO,
  MUESTRA_VISTA_PREVIA,
  casaConTodas,
  ejecutarBorrado,
  lotesDeBorrado,
  recogerClaves,
  resumenVistaPrevia,
  textoClaves,
  type Recogida
} from './borradoClaves'
import { Cuadro, MarcoDialogo } from './DialogoEdicionClave'

export interface PropsDialogoBorrarClaves {
  conexion: DbConnection
  base: number
  /** El patrón con el que se abre (el filtro de la base o el prefijo de la carpeta); se puede cambiar. */
  patronInicial: string
  /** El filtro de tipo de la base: con él se borra solo lo de ese tipo, lo que el árbol enseñaba. */
  tipo?: DbKvTipo
  /** `huboBorrado`: se borró algo (el árbol se vuelve a pedir). */
  onCerrar: (huboBorrado: boolean) => void
}

type Fase =
  | { f: 'editando' }
  | { f: 'buscando'; n: number }
  | { f: 'previa'; r: Recogida; patron: string }
  | { f: 'borrando'; enviados: number; lotes: number }
  | { f: 'fin'; borradas: number; error: string | null; detenido: boolean }

/** Lo que enseña la vista previa: el resumen, las primeras claves y, si se ha pasado el tope, el aviso. */
function VistaPrevia({ r, patron, base }: { r: Recogida; patron: string; base: number }): React.JSX.Element {
  const muestra = r.claves.slice(0, MUESTRA_VISTA_PREVIA)
  const resto = r.claves.length - muestra.length
  const t = txEdicionClaves()
  return (
    <>
      <div className="modal-message">{resumenVistaPrevia(r)}</div>
      {casaConTodas(patron) && r.claves.length > 0 && <div className="modal-hint">{t.patronCasaConTodas(base)}</div>}
      {muestra.length > 0 && (
        <pre className="db-envio-sql" tabIndex={0} aria-label={t.primerasClaves}>
          {muestra.map((k) => (
            <div key={k.base64} className="db-envio-linea">
              {pintarBytes(k)}
            </div>
          ))}
          {resto > 0 && <div className="db-envio-linea">{t.yMas(textoClaves(resto))}</div>}
        </pre>
      )}
    </>
  )
}

interface IpcBorrado {
  escanear: (patron: string) => (cursor: string) => Promise<DbRespuesta<DbKvPaginaClaves>>
  enviar: (texto: string) => Promise<DbRespuesta<DbKvResultado>>
  cerrarSesion: () => void
}

/** Escanea y envía por IPC; ambas respuestas son `DbRespuesta` (un fallo del propio IPC se convierte en uno). */
function useBorradoIpc(conexion: DbConnection, base: number, tipo: DbKvTipo | undefined): IpcBorrado {
  const [consolaId] = useState(() => `${PREFIJO_CONSOLA_VISOR}borrar-${crypto.randomUUID()}`)
  const produccion = esProduccion(conexion.entorno)
  const escanear = useCallback(
    (patron: string) => async (cursor: string) => {
      try {
        return await window.tessera.dbClaves.escanear({ conexionId: conexion.id, base, patron, cursor, cuenta: CUENTA_BORRADO, ...(tipo !== undefined ? { tipo } : {}) })
      } catch (err) {
        return { ok: false as const, error: errorDeInvoke(err) }
      }
    },
    [conexion.id, base, tipo]
  )
  const enviar = useCallback(
    async (texto: string) => {
      try {
        // El botón del diálogo ya dice «Borrar en producción»: es la confirmación que el main pide.
        return await window.tessera.dbClaves.ejecutarConsola({
          perfilId: conexion.profileId,
          consolaId,
          conexionId: conexion.id,
          base,
          texto,
          desplazamiento: 0,
          ...(produccion ? { confirmado: true } : {})
        })
      } catch (err) {
        return { ok: false as const, error: errorDeInvoke(err) }
      }
    },
    [conexion.id, conexion.profileId, consolaId, base, produccion]
  )
  const cerrarSesion = useCallback((): void => {
    void window.tessera.dbExplorador.cerrarSesionConsola(conexion.profileId, consolaId).catch(() => undefined)
  }, [conexion.profileId, consolaId])
  return { escanear, enviar, cerrarSesion }
}

interface BorradoPorPatron {
  fase: Fase
  escrito: string
  setEscrito: (v: string) => void
  hayPatron: boolean
  buscar: () => void
  borrar: (r: Recogida) => void
  detener: () => void
  volver: () => void
  cerrar: () => void
  cerrable: boolean
}

/** La máquina del diálogo: editar el patrón, buscar, enseñar, borrar y el resultado. */
function useBorradoPorPatron(p: PropsDialogoBorrarClaves): BorradoPorPatron {
  const [escrito, setEscrito] = useState(p.patronInicial)
  const [fase, setFase] = useState<Fase>({ f: 'editando' })
  const detenerRef = useRef(false)
  const huboBorrado = useRef(false)
  const montado = useRef(true)
  const { escanear, enviar, cerrarSesion } = useBorradoIpc(p.conexion, p.base, p.tipo)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
      detenerRef.current = true
      cerrarSesion()
    }
  }, [cerrarSesion])

  const patron = patronDeFiltro(escrito)
  const buscar = (): void => {
    if (patron === '') return
    detenerRef.current = false
    setFase({ f: 'buscando', n: 0 })
    void recogerClaves(escanear(patron), {
      cancelada: () => detenerRef.current,
      alProgreso: (n) => montado.current && setFase({ f: 'buscando', n })
    }).then((r) => {
      if (!montado.current) return
      if (!r.ok) setFase({ f: 'fin', borradas: 0, error: textoError(r.error), detenido: false })
      else setFase({ f: 'previa', r: r.valor, patron })
    })
  }
  const borrar = (r: Recogida): void => {
    const lotes = lotesDeBorrado(r.claves)
    detenerRef.current = false
    setFase({ f: 'borrando', enviados: 0, lotes: lotes.length })
    void ejecutarBorrado(lotes, enviar, () => detenerRef.current, (enviados) => montado.current && setFase({ f: 'borrando', enviados, lotes: lotes.length })).then((res) => {
      if (res.borradas > 0) huboBorrado.current = true
      if (!montado.current) return
      const error = res.paro?.tipo === 'error' ? textoError(res.paro.error) : null
      setFase({ f: 'fin', borradas: res.borradas, error, detenido: res.paro?.tipo === 'detenido' })
    })
  }
  const cerrar = (): void => {
    // Mientras borra solo se sale con «Detener»: cerrar a medias dejaría el borrado sin dueño.
    if (fase.f === 'borrando') return
    detenerRef.current = true
    p.onCerrar(huboBorrado.current)
  }
  return {
    fase,
    escrito,
    setEscrito,
    hayPatron: patron !== '',
    buscar,
    borrar,
    detener: () => {
      detenerRef.current = true
    },
    volver: () => setFase({ f: 'editando' }),
    cerrar,
    cerrable: fase.f !== 'borrando'
  }
}

export function DialogoBorrarClaves(p: PropsDialogoBorrarClaves): React.JSX.Element {
  const idBase = useId()
  const b = useBorradoPorPatron(p)
  const dlg = useDialogo({ onClose: b.cerrar, cerrable: b.cerrable })
  const produccion = esProduccion(p.conexion.entorno)
  return (
    <MarcoDialogo dlg={dlg} conexion={p.conexion} titulo={txEdicionClaves().tituloBorrarPatron} base={p.base} onCerrar={b.cerrar}>
      <CuerpoFase fase={b.fase} idBase={idBase} escrito={b.escrito} base={p.base} tipo={p.tipo} onEscrito={b.setEscrito} onBuscar={b.buscar} />
      <BotonesFase
        fase={b.fase}
        produccion={produccion}
        hayPatron={b.hayPatron}
        onCerrar={b.cerrar}
        onBuscar={b.buscar}
        onBorrar={b.borrar}
        onDetener={b.detener}
        onVolver={b.volver}
      />
    </MarcoDialogo>
  )
}

function CuerpoFase(p: {
  fase: Fase
  idBase: string
  escrito: string
  base: number
  tipo: DbKvTipo | undefined
  onEscrito: (v: string) => void
  onBuscar: () => void
}): React.JSX.Element {
  const { fase } = p
  const t = txEdicionClaves()
  const soloTipo = p.tipo !== undefined ? t.soloTipo(etiquetaTipo(p.tipo)) : ''
  switch (fase.f) {
    case 'editando':
      return (
        <>
          <Cuadro id={`${p.idBase}-patron`} etiqueta={t.patronOTexto} valor={p.escrito} multilinea={false} foco onCambio={p.onEscrito} onEnter={p.onBuscar} />
          <div className="modal-hint">
            {t.ayudaPatron}
            {soloTipo}
          </div>
        </>
      )
    case 'buscando':
      return (
        <div className="db-envio-estado" role="status">
          {t.buscando(textoClaves(fase.n))}
        </div>
      )
    case 'previa':
      return (
        <>
          <div className="modal-hint">
            {t.patron(fase.patron)}
            {soloTipo}
          </div>
          <VistaPrevia r={fase.r} patron={fase.patron} base={p.base} />
        </>
      )
    case 'borrando':
      return (
        <div className="db-envio-estado" role="status">
          {t.borrando(fase.enviados, fase.lotes)}
        </div>
      )
    case 'fin':
      return (
        <>
          {fase.error !== null && (
            <div className="db-envio-error" role="alert">
              <div className="db-envio-error-titulo">{t.noSePudo}</div>
              <div className="db-envio-error-texto">{fase.error}</div>
            </div>
          )}
          <div className="modal-message">
            {fase.detenido ? t.detenido : ''}
            {fase.borradas > 0 ? t.seBorraron(textoClaves(fase.borradas)) : t.ningunaBorrada}
          </div>
        </>
      )
  }
}

function BotonesFase(p: {
  fase: Fase
  produccion: boolean
  hayPatron: boolean
  onCerrar: () => void
  onBuscar: () => void
  onBorrar: (r: Recogida) => void
  onDetener: () => void
  onVolver: () => void
}): React.JSX.Element {
  const { fase } = p
  const t = txEdicionClaves()
  const cancelar = (
    <button type="button" className="btn btn-ghost" onClick={p.onCerrar}>
      {fase.f === 'fin' ? t.cerrar : t.cancelar}
    </button>
  )
  switch (fase.f) {
    case 'editando':
      return (
        <div className="modal-actions">
          {cancelar}
          <button type="button" className="btn primary" disabled={!p.hayPatron} onClick={p.onBuscar}>
            {t.buscar}
          </button>
        </div>
      )
    case 'buscando':
      return (
        <div className="modal-actions">
          {cancelar}
          <button type="button" className="btn" onClick={p.onDetener}>
            {t.detener}
          </button>
        </div>
      )
    case 'previa':
      return (
        <div className="modal-actions">
          {cancelar}
          <button type="button" className="btn" onClick={p.onVolver}>
            {t.cambiarPatron}
          </button>
          <button type="button" className={`btn ${p.produccion ? 'db-envio-btn-prod' : 'danger'}`} disabled={fase.r.claves.length === 0} onClick={() => p.onBorrar(fase.r)}>
            {p.produccion ? t.borrarEnProduccion : t.borrarN(textoClaves(fase.r.claves.length))}
          </button>
        </div>
      )
    case 'borrando':
      return (
        <div className="modal-actions">
          <button type="button" className="btn" onClick={p.onDetener}>
            {t.detener}
          </button>
        </div>
      )
    case 'fin':
      return <div className="modal-actions">{cancelar}</div>
  }
}
