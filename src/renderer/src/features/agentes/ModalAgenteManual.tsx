// =============================================================================
// Modal para definir (o editar) un agente a mano: nombre, dónde corre (solo uno nuevo), comando,
// cómo reanudar, en Docker las órdenes de instalación, si se ofrece también en la terminal y de
// dónde sale su contexto. Dice lo que un agente manual no tiene. Al guardar en Docker con órdenes
// nuevas enseña el progreso de la capa.
// La lógica vive en `useModalAgenteManual.ts`.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================
import '../../comun/formularioModal.css'
import './agentesManuales.css'
import { useId } from 'react'
import { alClicEnVelo, useDialogo } from '../../comun/useDialogo'
import { MAX_COMANDO, MAX_INSTALACION, MAX_NOMBRE, MAX_REANUDAR } from '../../../../shared/agentesManuales'
import { MAX_CAMPO, MAX_VALOR_FUENTE } from '../../../../shared/contextoAgenteManual'
import { idiomaActual } from '../../../../shared/i18n.ts'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { txAgenteManual } from './textosAgenteManual.ts'
import { useModalAgenteManual, type BorradorAgente, type OpcionesModalAgente, type VistaModalAgente } from './useModalAgenteManual'

/** Un campo de una línea; la ayuda va fuera de la etiqueta (es su descripción, no parte de su nombre). */
function CampoTexto(p: { etiqueta: string; valor: string; max: number; placeholder?: string; mono?: boolean; autoFocus?: boolean; ayuda?: string; onCambio: (v: string) => void }): React.JSX.Element {
  const id = useId()
  return (
    <div className="dbc-campo">
      <label className="dbc-etiqueta" htmlFor={id}>
        {p.etiqueta}
      </label>
      <input
        id={id}
        type="text"
        value={p.valor}
        maxLength={p.max}
        placeholder={p.placeholder}
        autoFocus={p.autoFocus}
        spellCheck={false}
        className={p.mono ? 'agman-mono' : undefined}
        aria-describedby={p.ayuda ? `${id}-ayuda` : undefined}
        onChange={(e) => p.onCambio(e.target.value)}
      />
      {p.ayuda && (
        <span id={`${id}-ayuda`} className="dbc-ayuda">
          {p.ayuda}
        </span>
      )}
    </div>
  )
}

/** Las órdenes de instalación (solo Docker): varias líneas, con su ayuda como descripción. */
function CampoInstalacion({ v }: { v: VistaModalAgente }): React.JSX.Element {
  const id = useId()
  const t = txAgenteManual()
  return (
    <div className="dbc-campo">
      <label className="dbc-etiqueta" htmlFor={id}>
        {t.ordenesInstalacion}
      </label>
      <textarea
        id={id}
        className="agman-mono"
        rows={4}
        value={v.b.instalacion}
        maxLength={MAX_INSTALACION}
        spellCheck={false}
        placeholder="npm install -g mi-agente"
        aria-describedby={`${id}-ayuda`}
        onChange={(e) => v.editar({ instalacion: e.target.value })}
      />
      <span id={`${id}-ayuda`} className="dbc-ayuda">
        {t.ordenesAyuda}
      </span>
    </div>
  )
}

/** Dónde corre un agente nuevo: en el equipo o en Docker, con varias cuentas. Uno que se edita no lo cambia. */
function CampoDonde({ v }: { v: VistaModalAgente }): React.JSX.Element | null {
  const id = useId()
  const t = txAgenteManual()
  if (!v.eligeDonde) return null
  return (
    <div className="dbc-campo">
      <label className="dbc-etiqueta" htmlFor={id}>
        {t.dondeCorre}
      </label>
      <select id={id} value={v.nativo ? 'nativo' : 'docker'} aria-describedby={`${id}-ayuda`} onChange={(e) => v.elegirNativo(e.target.value === 'nativo')}>
        <option value="nativo">{t.dondeNativo(nombresSistema(window.tessera.plataforma).sistema)}</option>
        <option value="docker">{t.dondeDocker}</option>
      </select>
      <span id={`${id}-ayuda`} className="dbc-ayuda">
        {t.dondeAyuda}
      </span>
    </div>
  )
}

function CamposAgente({ v }: { v: VistaModalAgente }): React.JSX.Element {
  const { b, editar } = v
  const t = txAgenteManual()
  const hostMode = v.nativo
  return (
    <>
      <CampoTexto etiqueta={t.nombre} valor={b.nombre} max={MAX_NOMBRE} placeholder={t.nombrePlaceholder} autoFocus onCambio={(nombre) => editar({ nombre })} />
      <CampoDonde v={v} />
      <CampoTexto
        etiqueta={t.comando}
        valor={b.comando}
        max={MAX_COMANDO}
        placeholder="mi-agente"
        mono
        ayuda={hostMode ? t.comandoNativo : t.comandoDocker}
        onCambio={(comando) => editar({ comando })}
      />
      <CampoTexto
        etiqueta={t.reanudar}
        valor={b.reanudar}
        max={MAX_REANUDAR}
        placeholder="--continue"
        mono
        ayuda={t.reanudarAyuda}
        onCambio={(reanudar) => editar({ reanudar })}
      />
      {!hostMode && <CampoInstalacion v={v} />}
      <CasillaTerminal v={v} />
      <CamposContexto v={v} />
      <p className="dbc-ayuda agman-limites">{t.limites}</p>
    </>
  )
}

function CasillaTerminal({ v }: { v: VistaModalAgente }): React.JSX.Element {
  const id = useId()
  const t = txAgenteManual()
  return (
    <div className="agman-casilla">
      <input id={id} type="checkbox" checked={v.b.enTerminal} aria-describedby={`${id}-ayuda`} onChange={(e) => v.editar({ enTerminal: e.target.checked })} />
      <div>
        <label className="agman-casilla-titulo" htmlFor={id}>
          {t.activarTerminal}
        </label>
        <span id={`${id}-ayuda`} className="dbc-ayuda">
          {t.terminalAyudaA}
          <code>AGENTS.md</code>
          {t.terminalAyudaB}
        </span>
      </div>
    </div>
  )
}

/** De dónde sale el contexto del agente, para el anillo del pie; sin origen, el anillo no aparece. */
function CamposContexto({ v }: { v: VistaModalAgente }): React.JSX.Element {
  const { b, editar } = v
  const id = useId()
  const t = txAgenteManual()
  const comando = b.contextoOrigen === 'comando'
  return (
    <>
      <div className="dbc-campo">
        <label className="dbc-etiqueta" htmlFor={id}>
          {t.contexto}
        </label>
        <select id={id} value={b.contextoOrigen} aria-describedby={`${id}-ayuda`} onChange={(e) => editar({ contextoOrigen: e.target.value as BorradorAgente['contextoOrigen'] })}>
          <option value="">{t.contextoNo}</option>
          <option value="comando">{t.contextoComando}</option>
          <option value="archivo">{t.contextoArchivo}</option>
        </select>
        <span id={`${id}-ayuda`} className="dbc-ayuda">
          {t.contextoAyuda}
        </span>
      </div>
      {b.contextoOrigen && (
        <>
          <CampoTexto
            etiqueta={comando ? t.comandoQueLoDa : t.archivo}
            valor={b.contextoValor}
            max={MAX_VALOR_FUENTE}
            placeholder={comando ? 'mi-agente stats --json' : '~/.mi-agente/uso.jsonl'}
            mono
            ayuda={comando ? t.valorComandoAyuda : t.valorArchivoAyuda}
            onCambio={(contextoValor) => editar({ contextoValor })}
          />
          <CampoTexto etiqueta={t.campoUsado} valor={b.contextoUsado} max={MAX_CAMPO} placeholder="context.used" mono ayuda={t.campoUsadoAyuda} onCambio={(contextoUsado) => editar({ contextoUsado })} />
          <CampoTexto etiqueta={t.maximo} valor={b.contextoMaximo} max={MAX_CAMPO} placeholder="context.max" mono ayuda={t.maximoAyuda} onCambio={(contextoMaximo) => editar({ contextoMaximo })} />
        </>
      )}
    </>
  )
}

/** El progreso de la capa mientras se instala y, al acabar, lo que salió. */
function ProgresoInstalacion({ v }: { v: VistaModalAgente }): React.JSX.Element | null {
  const { fase } = v
  const t = txAgenteManual()
  if (fase.tipo !== 'instalando' && fase.tipo !== 'instalado') return null
  const r = fase.tipo === 'instalado' ? fase.resultado : null
  const comillas = idiomaActual() === 'en' ? (p: string): string => `“${p}”` : (p: string): string => `«${p}»`
  return (
    <div className="agman-progreso">
      <pre className="agman-log" aria-live="polite">
        {fase.lineas.join('\n') || t.preparando}
      </pre>
      {r && !r.ok && <div className="dbc-error" role="alert">{r.error ?? t.falloInstalacion}</div>}
      {r?.ok && r.faltan.length > 0 && (
        <div className="dbc-error" role="alert">
          {t.faltan(r.faltan.map(comillas).join(', '))}
        </div>
      )}
      {r?.ok && r.faltan.length === 0 && <div className="agman-ok" role="status">{t.listo}</div>}
    </div>
  )
}

function Pie({ v, onCerrar }: { v: VistaModalAgente; onCerrar: () => void }): React.JSX.Element {
  const { fase } = v
  const t = txAgenteManual()
  if (fase.tipo === 'instalado') {
    return (
      <div className="modal-actions dbc-acciones">
        <span className="dbc-hueco" />
        <button type="button" className="btn primary" onClick={onCerrar}>{t.cerrar}</button>
      </div>
    )
  }
  const instalando = fase.tipo === 'instalando'
  return (
    <div className="modal-actions dbc-acciones">
      <button type="button" className="btn" disabled={instalando} onClick={() => void v.pegar()} title={t.pegarTitulo}>
        {t.pegarDefinicion}
      </button>
      <span className="dbc-hueco" />
      <button type="button" className="btn btn-ghost" disabled={instalando} onClick={onCerrar}>{t.cancelar}</button>
      <button type="submit" className="btn primary" disabled={instalando}>
        {instalando ? t.instalando : fase.tipo === 'sin-programa' ? t.guardarIgualmente : t.guardar}
      </button>
    </div>
  )
}

export function ModalAgenteManual(o: OpcionesModalAgente): React.JSX.Element {
  const v = useModalAgenteManual(o)
  const ocupado = v.fase.tipo === 'instalando'
  const dialogo = useDialogo({ onClose: o.onCerrar, cerrable: !ocupado })
  const idTitulo = useId()
  const t = txAgenteManual()
  return (
    <div className="modal-overlay" role="presentation" onMouseDown={ocupado ? undefined : alClicEnVelo(o.onCerrar)}>
      <div
        ref={dialogo.ref}
        className="modal-card db-conexion-modal agman-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={dialogo.alPulsarTecla}
      >
        <form className="dbc-form" noValidate onSubmit={(e) => { e.preventDefault(); void v.guardar() }}>
          <div className="dbc-cabecera">
            <div id={idTitulo} className="modal-title">{o.inicial ? t.editar(o.inicial.nombre) : t.agenteNuevo}</div>
            <div className="dbc-ayuda">{v.nativo ? t.ambitoNativo : t.ambitoDocker}</div>
          </div>
          <div className="dbc-cuerpo">
            {v.fase.tipo === 'editando' || v.fase.tipo === 'sin-programa' ? <CamposAgente v={v} /> : <ProgresoInstalacion v={v} />}
            {v.fase.tipo === 'sin-programa' && (
              <div className="dbc-error" role="alert">
                {t.sinProgramaA}
                {v.fase.programa}
                {t.sinProgramaB}
              </div>
            )}
            {v.error && <div className="dbc-error" role="alert">{v.error}</div>}
          </div>
          <Pie v={v} onCerrar={o.onCerrar} />
        </form>
      </div>
    </div>
  )
}
