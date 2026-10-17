// =============================================================================
// Modal de IMPORTAR la configuración de un archivo ya elegido: la frase (o el aviso si va sin cifrar), lo que trae frente a lo que
// hay aquí como lista de casillas para elegir qué entra (`ListaImportar.tsx`) y, al importar solo lo
// marcado, el resumen: lo añadido, lo que se saltó y por qué, y lo que conviene revisar porque depende del
// equipo. Cerrar sin importar suelta el archivo en el main. La operación vive en `operacionesCopia.ts`.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================
import '../../../comun/formularioModal.css'
import './copia.css'
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react'
import { alClicEnVelo, useDialogo } from '../../../comun/useDialogo'
import type { AbrirResult } from '../../../../../shared/copia-configuracion-ipc'
import { nombresSistema } from '../../../../../shared/nombresSistema'
import { importarCopia, vistaPrevia, type Descifrado, type ResumenImportacion } from './operacionesCopia'
import {
  alternar,
  haySeleccion,
  seleccionInicial,
  seleccionParaImportar,
  type ArbolImportar,
  type AvisoSeleccion,
  type SeleccionImportar
} from '../../../../../shared/seleccionCopia'
import { CampoFrase } from './camposCopia'
import { ListaImportar } from './ListaImportar'
import { txCopia } from './textosCopia.ts'

type Abierto = Extract<AbrirResult, { estado: 'abierto' }>
type Fase =
  | { tipo: 'frase'; ocupado: boolean }
  | { tipo: 'previa'; d: Descifrado; arbol: ArbolImportar; seleccion: ReadonlySet<string>; avisos: AvisoSeleccion[] }
  | { tipo: 'importando' }
  | { tipo: 'hecho'; r: ResumenImportacion }
  /** Falló a medias: el archivo ya se soltó en el main, así que no se ofrece reintentar aquí. */
  | { tipo: 'fallo' }


/** El nombre del sistema en que se exportó; uno que esta versión no conoce, tal cual. */
function sistemaDe(p: string): string {
  return p === 'windows' || p === 'mac' || p === 'linux' ? nombresSistema(p).sistema : p
}

function Previa({ p, v, cifrado }: { p: Extract<Fase, { tipo: 'previa' }>; v: ReturnType<typeof useImportar>; cifrado: boolean }): React.JSX.Element {
  const t = txCopia()
  return (
    <div className="copia-resumen">
      {/* El aviso sigue a la vista mientras se elige: es lo que explica por qué no viene nada marcado. */}
      {!cifrado && <div className="dbc-error" role="note">{t.importar.sinCifrarPrevia}</div>}
      <ListaImportar arbol={p.arbol} seleccion={p.seleccion} avisos={p.avisos} onAlternar={v.alternarCasilla} onMarcarTodo={v.marcarTodo} />
      {p.d.perfilesInvalidos > 0 && <div className="dbc-error">{t.importar.perfilesInvalidos(p.d.perfilesInvalidos)}</div>}
    </div>
  )
}

function Saltadas({ titulo, lista }: { titulo: string; lista: Array<{ alias: string; motivo: string }> }): React.JSX.Element | null {
  if (lista.length === 0) return null
  return (
    <>
      <p className="dbc-ayuda">{titulo}</p>
      <ul className="copia-detalle">
        {lista.map((s, i) => (
          <li key={i}>{txCopia().importar.saltada(s.alias, s.motivo)}</li>
        ))}
      </ul>
    </>
  )
}

function Hecho({ r }: { r: ResumenImportacion }): React.JSX.Element {
  const { ssh, bd, revisar } = r.conexiones
  const fallidas = r.capas.filter((c) => !c.resultado.ok || c.resultado.faltan.length > 0)
  const t = txCopia().importar
  return (
    <div className="copia-resumen" role="status">
      <p className="copia-ok">{t.importado}</p>
      <p className="dbc-ayuda">{t.hecho(r.perfilesNuevos.length, ssh.anadidas, bd.anadidas, r.agentes, r.ajustes)}</p>
      <Saltadas titulo={t.saltadasSsh} lista={ssh.saltadas} />
      <Saltadas titulo={t.saltadasBd} lista={bd.saltadas} />
      {revisar.length > 0 && (
        <ul className="copia-detalle">
          {revisar.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
      {fallidas.map((c) => (
        <div key={c.perfil} className="dbc-error">
          {t.capaFallida(c.perfil, c.resultado.error ?? null)}
        </div>
      ))}
    </div>
  )
}

function useImportar(a: Abierto) {
  const [frase, setFrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fase, setFase] = useState<Fase>({ tipo: 'frase', ocupado: false })
  const descifrar = async (): Promise<void> => {
    setError(null)
    setFase({ tipo: 'frase', ocupado: true })
    const d = await window.tessera.copiaConfiguracion.descifrar(a.token, frase)
    if (!d.ok) {
      setError(d.error)
      return setFase({ tipo: 'frase', ocupado: false })
    }
    const arbol = vistaPrevia(d)
    // Sin cifrar, cualquiera pudo cambiarlo (añadir un agente con sus órdenes, unos ajustes): nada
    // entra marcado de serie y lo que se importa lo elige el usuario de una en una.
    setFase({ tipo: 'previa', d, arbol, seleccion: a.cifrado ? seleccionInicial(arbol) : new Set<string>(), avisos: [] })
  }
  const alternarCasilla = (clave: string): void =>
    setFase((f) => {
      if (f.tipo !== 'previa') return f
      const { seleccion, avisos } = alternar(f.arbol, f.seleccion, clave)
      return { ...f, seleccion, avisos }
    })
  const marcarTodo = (todo: boolean): void =>
    setFase((f) => (f.tipo === 'previa' ? { ...f, seleccion: todo ? seleccionInicial(f.arbol) : new Set<string>(), avisos: [] } : f))
  const importar = async (d: Descifrado, sel: SeleccionImportar): Promise<void> => {
    setFase({ tipo: 'importando' })
    try {
      setFase({ tipo: 'hecho', r: await importarCopia(a.token, d, sel) })
    } catch (err) {
      // Importar otra vez el mismo archivo completa lo que falte: lo que ya entró no se duplica.
      setError(txCopia().importar.errorFinal(err instanceof Error ? err.message : String(err)))
      setFase({ tipo: 'fallo' })
    }
  }
  return { frase, setFrase, error, fase, descifrar, alternarCasilla, marcarTodo, importar }
}

/** «Importar» manda solo lo marcado; sin nada marcado no hay nada que importar. */
function BotonImportar({ fase, importar }: { fase: Extract<Fase, { tipo: 'previa' }>; importar: (d: Descifrado, sel: SeleccionImportar) => Promise<void> }): React.JSX.Element {
  const t = txCopia().importar
  const sel = seleccionParaImportar(fase.arbol, fase.seleccion)
  const vacia = !haySeleccion(sel)
  return (
    <button type="button" className="btn primary" disabled={vacia} title={vacia ? t.nadaMarcado : undefined} onClick={() => void importar(fase.d, sel)}>
      {t.importar}
    </button>
  )
}

/** `cifrado`: sin frase, el primer paso no abre con una frase sino que continúa tras el aviso. */
function Acciones({ v, onCerrar, cifrado }: { v: ReturnType<typeof useImportar>; onCerrar: () => void; cifrado: boolean }): React.JSX.Element {
  const { fase } = v
  const t = txCopia()
  if (fase.tipo === 'hecho' || fase.tipo === 'fallo') return <button type="button" className="btn primary" onClick={onCerrar}>{t.comun.cerrar}</button>
  const ocupado = fase.tipo === 'importando' || (fase.tipo === 'frase' && fase.ocupado)
  return (
    <>
      <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={onCerrar}>{t.comun.cancelar}</button>
      {fase.tipo === 'previa' ? (
        <BotonImportar fase={fase} importar={v.importar} />
      ) : (
        <button type="submit" className="btn primary" disabled={ocupado}>
          {fase.tipo === 'importando' ? t.importar.importando : ocupado ? t.importar.abriendo : cifrado ? t.importar.abrir : t.importar.continuar}
        </button>
      )}
    </>
  )
}

/** Cuántos importar hay montados: abrir otra copia en el main suelta la que se está importando. */
let montados = 0
const oyentes = new Set<() => void>()
function suscribir(fn: () => void): () => void {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}
function cambiarMontados(delta: number): void {
  montados += delta
  for (const fn of oyentes) fn()
}

/** ¿Hay un importar abierto (desde Configuración o desde el sistema)? */
export function useHayImportarAbierto(): boolean {
  return useSyncExternalStore(suscribir, () => montados > 0)
}

export function ModalImportar({ abierto, onCerrar }: { abierto: Abierto; onCerrar: () => void }): React.JSX.Element {
  useEffect(() => {
    cambiarMontados(1)
    return () => cambiarMontados(-1)
  }, [])
  const v = useImportar(abierto)
  const importado = v.fase.tipo === 'importando' || v.fase.tipo === 'hecho' || v.fase.tipo === 'fallo'
  // Cerrar sin importar suelta el archivo descifrado que guarda el main.
  const cerrar = useCallback(() => {
    if (!importado) void window.tessera.copiaConfiguracion.olvidar(abierto.token)
    onCerrar()
  }, [importado, abierto.token, onCerrar])
  const ocupado = v.fase.tipo === 'importando'
  const dialogo = useDialogo({ onClose: cerrar, cerrable: !ocupado })
  const idTitulo = useId()
  const creado = new Date(abierto.creado)
  const t = txCopia()
  return (
    <div className="modal-overlay" role="presentation" onMouseDown={ocupado ? undefined : alClicEnVelo(cerrar)}>
      <div ref={dialogo.ref} className="modal-card db-conexion-modal copia-modal" role="dialog" aria-modal="true" aria-labelledby={idTitulo} onMouseDown={(e) => e.stopPropagation()} onKeyDown={dialogo.alPulsarTecla}>
        <form className="dbc-form" noValidate onSubmit={(e) => { e.preventDefault(); void v.descifrar() }}>
          <div className="dbc-cabecera">
            <div id={idTitulo} className="modal-title">{t.importar.titulo}</div>
            <div className="dbc-ayuda">
              {t.importar.cabecera(abierto.nombre, sistemaDe(abierto.plataforma), Number.isNaN(creado.getTime()) ? abierto.creado : creado.toLocaleString(), abierto.app)}
            </div>
          </div>
          <div className="dbc-cuerpo">
            {v.fase.tipo === 'frase' &&
              (abierto.cifrado ? (
                <CampoFrase etiqueta={t.comun.frase} valor={v.frase} onCambio={v.setFrase} autoFocus ayuda={t.importar.fraseAyuda} />
              ) : (
                // Sin frase no hay nada que pedir, pero sí que avisar antes de enseñar lo que trae.
                <div className="dbc-error" role="note">
                  {t.importar.sinCifrar}
                </div>
              ))}
            {v.fase.tipo === 'previa' && <Previa p={v.fase} v={v} cifrado={abierto.cifrado} />}
            {v.fase.tipo === 'importando' && <p className="dbc-ayuda">{t.importar.progreso}</p>}
            {v.fase.tipo === 'hecho' && <Hecho r={v.fase.r} />}
            {v.error && <div className="dbc-error" role="alert">{v.error}</div>}
          </div>
          <div className="modal-actions dbc-acciones">
            <span className="dbc-hueco" />
            <Acciones v={v} onCerrar={cerrar} cifrado={abierto.cifrado} />
          </div>
        </form>
      </div>
    </div>
  )
}
