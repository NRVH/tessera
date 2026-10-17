// =============================================================================
// Modal de EXPORTAR la configuración: qué perfiles y qué apartados (todo marcado de serie), la
// frase escrita dos veces (o, marcándolo y con su aviso, sin frase) y, al guardar, el resumen (y las
// conexiones que viajan sin su secreto porque este equipo ya no lo puede descifrar). La operación
// vive en `operacionesCopia.ts`.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================
import '../../../comun/formularioModal.css'
import './copia.css'
import { useId, useState } from 'react'
import { alClicEnVelo, useDialogo } from '../../../comun/useDialogo'
import { useStorePestanas } from '../../pestanas'
import { MIN_FRASE, errorDeFrase, type ApartadosCopia } from '../../../../../shared/copiaConfiguracion'
import type { ResumenExportacion } from '../../../../../shared/copia-configuracion-ipc'
import { exportarCopia } from './operacionesCopia'
import { CampoFrase, Casilla } from './camposCopia'
import { txCopia } from './textosCopia.ts'

const CLAVES_APARTADOS: ReadonlyArray<keyof ApartadosCopia> = ['ssh', 'bd', 'agentes', 'ajustes']

function Resumen({ nombre, r, sinFrase }: { nombre: string; r: ResumenExportacion; sinFrase: boolean }): React.JSX.Element {
  const t = txCopia()
  return (
    <div className="copia-resumen" role="status">
      <p className="copia-ok">{t.exportar.guardado(nombre)}</p>
      <p className={sinFrase ? 'dbc-error' : 'dbc-ayuda'}>{t.exportar.resumen(r.perfiles, r.ssh, r.bd, r.agentes, sinFrase)}</p>
      {r.sinSecreto.length > 0 && (
        <div className="dbc-error">{t.exportar.sinSecreto(t.comun.lista(r.sinSecreto))}</div>
      )}
      {r.sinClave.length > 0 && (
        <div className="dbc-error">{t.exportar.sinClave(t.comun.lista(r.sinClave))}</div>
      )}
    </div>
  )
}

function useExportar(onCerrar: () => void) {
  const perfiles = useStorePestanas((s) => s.tabs.profiles)
  const [elegidos, setElegidos] = useState<string[]>(() => perfiles.map((p) => p.id))
  const [apartados, setApartados] = useState<ApartadosCopia>({ ssh: true, bd: true, agentes: true, ajustes: true })
  const [frase, setFrase] = useState('')
  const [repetida, setRepetida] = useState('')
  const [sinFrase, setSinFrase] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [estado, setEstado] = useState<{ tipo: 'editando' } | { tipo: 'guardando' } | { tipo: 'hecho'; nombre: string; resumen: ResumenExportacion }>({ tipo: 'editando' })
  const alternar = (id: string): void => setElegidos((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  const exportar = async (): Promise<void> => {
    const e = elegidos.length === 0 ? txCopia().exportar.elegirPerfil : sinFrase ? null : errorDeFrase(frase, repetida)
    if (e) return setError(e)
    setError(null)
    setEstado({ tipo: 'guardando' })
    try {
      const r = await exportarCopia(elegidos, apartados, frase, sinFrase)
      if (r.estado === 'cancelado') return setEstado({ tipo: 'editando' })
      setEstado({ tipo: 'hecho', nombre: r.nombre, resumen: r.resumen })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setEstado({ tipo: 'editando' })
    }
  }
  // El error que hubiera era de la frase: con o sin ella, deja de valer.
  const alternarSinFrase = (): void => {
    setSinFrase((x) => !x)
    setError(null)
  }
  return { perfiles, elegidos, alternar, apartados, setApartados, frase, setFrase, repetida, setRepetida, sinFrase, alternarSinFrase, error, estado, exportar, onCerrar }
}

function Campos({ v }: { v: ReturnType<typeof useExportar> }): React.JSX.Element {
  const t = txCopia()
  return (
    <>
      <fieldset className="copia-lista">
        <legend className="dbc-etiqueta">{t.exportar.perfiles}</legend>
        {v.perfiles.map((p) => (
          <Casilla key={p.id} etiqueta={p.nombre} marcada={v.elegidos.includes(p.id)} onCambio={() => v.alternar(p.id)} />
        ))}
      </fieldset>
      <fieldset className="copia-lista">
        <legend className="dbc-etiqueta">{t.exportar.queLlevar}</legend>
        {CLAVES_APARTADOS.map((k) => (
          <Casilla key={k} etiqueta={t.exportar.apartados[k]} marcada={v.apartados[k]} onCambio={() => v.setApartados((a) => ({ ...a, [k]: !a[k] }))} />
        ))}
      </fieldset>
      {!v.sinFrase && (
        <>
          <CampoFrase etiqueta={t.comun.frase} valor={v.frase} onCambio={v.setFrase} autoFocus ayuda={t.exportar.fraseAyuda(MIN_FRASE)} />
          <CampoFrase etiqueta={t.exportar.repiteFrase} valor={v.repetida} onCambio={v.setRepetida} />
        </>
      )}
      <Casilla etiqueta={t.exportar.sinFrase} marcada={v.sinFrase} onCambio={v.alternarSinFrase} />
      {/* Sin frase el archivo lleva contraseñas y claves en claro: se dice en rojo y sin rodeos. */}
      {v.sinFrase && (
        <div className="dbc-error" role="note">
          {t.exportar.sinFraseAviso}
        </div>
      )}
    </>
  )
}

export function ModalExportar({ onCerrar }: { onCerrar: () => void }): React.JSX.Element {
  const v = useExportar(onCerrar)
  const ocupado = v.estado.tipo === 'guardando'
  const dialogo = useDialogo({ onClose: onCerrar, cerrable: !ocupado })
  const idTitulo = useId()
  const t = txCopia()
  return (
    <div className="modal-overlay" role="presentation" onMouseDown={ocupado ? undefined : alClicEnVelo(onCerrar)}>
      <div ref={dialogo.ref} className="modal-card db-conexion-modal copia-modal" role="dialog" aria-modal="true" aria-labelledby={idTitulo} onMouseDown={(e) => e.stopPropagation()} onKeyDown={dialogo.alPulsarTecla}>
        <form className="dbc-form" noValidate onSubmit={(e) => { e.preventDefault(); void v.exportar() }}>
          <div className="dbc-cabecera">
            <div id={idTitulo} className="modal-title">{t.exportar.titulo}</div>
            <div className="dbc-ayuda">{t.exportar.subtitulo}</div>
          </div>
          <div className="dbc-cuerpo">
            {v.estado.tipo === 'hecho' ? <Resumen nombre={v.estado.nombre} r={v.estado.resumen} sinFrase={v.sinFrase} /> : <Campos v={v} />}
            {v.error && <div className="dbc-error" role="alert">{v.error}</div>}
          </div>
          <div className="modal-actions dbc-acciones">
            <span className="dbc-hueco" />
            {v.estado.tipo === 'hecho' ? (
              <button type="button" className="btn primary" onClick={onCerrar}>{t.comun.cerrar}</button>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={onCerrar}>{t.comun.cancelar}</button>
                <button type="submit" className="btn primary" disabled={ocupado}>{ocupado ? t.exportar.exportando : t.exportar.exportar}</button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
