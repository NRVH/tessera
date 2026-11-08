// =============================================================================
// Modal de EXPORTAR la configuración: qué perfiles y qué apartados (todo marcado de serie salvo el
// historial de conversaciones, `HistorialExportar.tsx`), la frase escrita dos veces (o, marcándolo y con
// su aviso, sin frase) y, al guardar, el resumen (y las conexiones que viajan sin su secreto porque este
// equipo ya no lo puede descifrar). La operación vive en `operacionesCopia.ts`.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================
import '../../../comun/formularioModal.css'
import './copia.css'
import { useId, useState } from 'react'
import { AvisoConPresencia, AvisoModal, Modal, PieModal } from '../../../comun/Modal'
import { useStorePestanas } from '../../pestanas'
import { MIN_FRASE, errorDeFrase, type ApartadosCopia } from '../../../../../shared/copiaConfiguracion'
import type { ResumenExportacion } from '../../../../../shared/copia-configuracion-ipc'
import { exportarCopia } from './operacionesCopia'
import { CampoFrase, Casilla } from './camposCopia'
import { HistorialExportar } from './HistorialExportar'
import { formatoBytes } from '../../../util/formatoBytes'
import { txCopia } from './textosCopia.ts'

const CLAVES_APARTADOS: ReadonlyArray<keyof ApartadosCopia> = ['ssh', 'bd', 'agentes', 'configDocker', 'archivosCuentas', 'reglasNativas', 'ajustes']

function Resumen({ nombre, r, sinFrase }: { nombre: string; r: ResumenExportacion; sinFrase: boolean }): React.JSX.Element {
  const t = txCopia()
  return (
    <div className="copia-resumen" role="status">
      <AvisoModal tono="exito">{t.exportar.guardado(nombre)}</AvisoModal>
      <AvisoModal tono={sinFrase ? 'aviso' : 'info'}>{t.exportar.resumen(r.perfiles, r.ssh, r.bd, r.agentes, sinFrase)}</AvisoModal>
      {r.historial && <p className="dbc-ayuda">{t.exportar.resumenHistorial(r.historial.conversaciones, formatoBytes(r.historial.bytes))}</p>}
      {r.historial && r.historial.saltadas > 0 && <p className="dbc-ayuda">{t.exportar.historialSaltadas(r.historial.saltadas)}</p>}
      {r.archivosAgentes && (r.archivosAgentes.cuentas > 0 || r.archivosAgentes.nativos > 0) && <p className="dbc-ayuda">{t.exportar.resumenArchivos(r.archivosAgentes.cuentas, r.archivosAgentes.nativos)}</p>}
      <AvisoConPresencia>{r.archivosAgentes && r.archivosAgentes.bloqueados.length > 0 && (
        <AvisoModal tono="aviso">{t.exportar.archivosBloqueados(t.comun.lista(r.archivosAgentes.bloqueados))}</AvisoModal>
      )}</AvisoConPresencia>
      <AvisoConPresencia>{r.sinSecreto.length > 0 && (
        <AvisoModal tono="aviso">{t.exportar.sinSecreto(t.comun.lista(r.sinSecreto))}</AvisoModal>
      )}</AvisoConPresencia>
      <AvisoConPresencia>{r.sinClave.length > 0 && (
        <AvisoModal tono="aviso">{t.exportar.sinClave(t.comun.lista(r.sinClave))}</AvisoModal>
      )}</AvisoConPresencia>
    </div>
  )
}

function useExportar(onCerrar: () => void) {
  const perfiles = useStorePestanas((s) => s.tabs.profiles)
  const [elegidos, setElegidos] = useState<string[]>(() => perfiles.map((p) => p.id))
  const [apartados, setApartados] = useState<ApartadosCopia>({ ssh: true, bd: true, agentes: true, configDocker: true, archivosCuentas: true, reglasNativas: true, ajustes: true })
  const [frase, setFrase] = useState('')
  const [repetida, setRepetida] = useState('')
  const [sinFrase, setSinFrase] = useState(false)
  // Desmarcado de serie: puede ser grande y es tan sensible como lo hablado.
  const [historial, setHistorial] = useState({ activo: false, nativo: false })
  const [error, setError] = useState<string | null>(null)
  const [estado, setEstado] = useState<{ tipo: 'editando' } | { tipo: 'guardando' } | { tipo: 'hecho'; nombre: string; resumen: ResumenExportacion }>({ tipo: 'editando' })
  const alternar = (id: string): void => setElegidos((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  const exportar = async (): Promise<void> => {
    const e = elegidos.length === 0 ? txCopia().exportar.elegirPerfil : sinFrase ? null : errorDeFrase(frase, repetida)
    if (e) return setError(e)
    setError(null)
    setEstado({ tipo: 'guardando' })
    try {
      const r = await exportarCopia(elegidos, apartados, frase, sinFrase, historial.activo ? { nativo: historial.nativo } : null)
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
  return { perfiles, elegidos, alternar, apartados, setApartados, historial, setHistorial, frase, setFrase, repetida, setRepetida, sinFrase, alternarSinFrase, error, estado, exportar, onCerrar }
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
      <HistorialExportar
        perfiles={v.perfiles}
        elegidos={v.elegidos}
        activo={v.historial.activo}
        nativo={v.historial.nativo}
        sinFrase={v.sinFrase}
        onActivo={() => v.setHistorial((h) => ({ ...h, activo: !h.activo }))}
        onNativo={() => v.setHistorial((h) => ({ ...h, nativo: !h.nativo }))}
      />
      {!v.sinFrase && (
        <>
          <CampoFrase etiqueta={t.comun.frase} valor={v.frase} onCambio={v.setFrase} autoFocus ayuda={t.exportar.fraseAyuda(MIN_FRASE)} />
          <CampoFrase etiqueta={t.exportar.repiteFrase} valor={v.repetida} onCambio={v.setRepetida} />
        </>
      )}
      <Casilla etiqueta={t.exportar.sinFrase} marcada={v.sinFrase} onCambio={v.alternarSinFrase} />
      {/* Sin frase el archivo lleva contraseñas y claves en claro. */}
      <AvisoConPresencia>{v.sinFrase && (
        <AvisoModal tono="aviso">
          {t.exportar.sinFraseAviso}
        </AvisoModal>
      )}</AvisoConPresencia>
    </>
  )
}

export function ModalExportar({ onCerrar }: { onCerrar: () => void }): React.JSX.Element {
  const formulario = useId()
  const v = useExportar(onCerrar)
  const ocupado = v.estado.tipo === 'guardando'
  const t = txCopia()
  return (
    <Modal titulo={t.exportar.titulo} subtitulo={t.exportar.subtitulo} tamano="m" className="db-conexion-modal copia-modal"
      onCerrar={onCerrar} cerrable={!ocupado} cierraConVelo={v.estado.tipo === 'hecho'} ocupado={ocupado}
      pie={v.estado.tipo !== 'hecho' ? <PieModal>
        <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={onCerrar}>{t.comun.cancelar}</button>
        <button type="submit" form={formulario} className="btn primary" disabled={ocupado}>{ocupado ? t.exportar.exportando : t.exportar.exportar}</button>
      </PieModal> : undefined}>
      <form id={formulario} className="copia-formulario" noValidate onSubmit={(e) => { e.preventDefault(); if (!ocupado && v.estado.tipo !== 'hecho') void v.exportar() }}>
      {v.estado.tipo === 'hecho' ? <Resumen nombre={v.estado.nombre} r={v.estado.resumen} sinFrase={v.sinFrase} /> : <Campos v={v} />}
      <AvisoConPresencia>{v.error && <AvisoModal tono="error">{v.error}</AvisoModal>}</AvisoConPresencia>
      </form>
    </Modal>
  )
}
