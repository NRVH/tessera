// =============================================================================
// El diálogo de una edición del visor de clave: los cuadros que pide la acción, el comando EXACTO que
// se va a ejecutar (se rehace al escribir), el aviso del main si pidió confirmar algo más y el error de
// Redis si lo hubo. En producción lleva la franja y el botón «Ejecutar en producción», como la vista
// previa de «Enviar» (de la que toma el CSS). Lo pinta `DbClavePane` por portal.
// Decisiones: docs/decisiones/bd/ui-claves-visor.md
// =============================================================================

import { useId, useState } from 'react'
import type { DbConnection } from '../../../../../shared/db-ipc'
import { esProduccion } from '../consola/produccionConsola'
import { alClicEnVelo, useDialogo, type Dialogo } from '../../../comun/useDialogo'
import { comandoDeAccion, entradasIniciales, textosAccion, type AccionClave, type EntradasClave } from './edicionClaves'
import type { EdicionClave } from './useEdicionClave'
import { txEdicionClaves } from './textosEdicionClaves'
import type { DbKvBytes } from '../../../../../shared/db-claves-ipc'

export interface PropsDialogoEdicion {
  conexion: DbConnection
  base: number
  clave: DbKvBytes
  nombre: string
  /** La clave caduca: reescribir un string conserva su caducidad. */
  conTtl: boolean
  /** El nombre del campo, pintado, para los títulos de un hash. */
  nombreCampo?: string
  accion: AccionClave
  edicion: EdicionClave
}

export function Cuadro(props: { id: string; etiqueta: string; valor: string; multilinea: boolean; foco: boolean; onCambio: (v: string) => void; onEnter: () => void }): React.JSX.Element {
  const comun = {
    id: props.id,
    className: 'modal-input',
    value: props.valor,
    autoFocus: props.foco,
    spellCheck: false,
    autoComplete: 'off'
  }
  return (
    <>
      <label className="modal-label" htmlFor={props.id}>
        {props.etiqueta}
      </label>
      {props.multilinea ? (
        <textarea {...comun} className="modal-input db-clave-edicion-texto" rows={6} onChange={(e) => props.onCambio(e.target.value)} />
      ) : (
        <input
          {...comun}
          onChange={(e) => props.onCambio(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            props.onEnter()
          }}
        />
      )}
    </>
  )
}

export function Estado(props: { edicion: EdicionClave; motivo: string | null; errorPropio?: string | null }): React.JSX.Element {
  const { aviso, error, enviando } = props.edicion
  const t = txEdicionClaves()
  return (
    <>
      {props.errorPropio && (
        <div className="db-envio-error" role="alert">
          <div className="db-envio-error-titulo">{t.noSePudo}</div>
          <div className="db-envio-error-texto">{props.errorPropio}</div>
        </div>
      )}
      {aviso && (
        <div className="db-envio-error" role="alert">
          <div className="db-envio-error-titulo">{aviso.titulo}</div>
          <div className="db-envio-error-texto">{aviso.mensaje}</div>
        </div>
      )}
      {error && (
        <div className="db-envio-error" role="alert">
          <div className="db-envio-error-titulo">{t.noSePudo}</div>
          <div className="db-envio-error-texto">{error}</div>
        </div>
      )}
      {props.motivo && !error && <div className="modal-hint">{props.motivo}</div>}
      {enviando && (
        <div className="db-envio-estado" role="status">
          {t.ejecutando}
        </div>
      )}
    </>
  )
}

/** El marco de un diálogo de claves: velo, tarjeta con su franja de producción y el título con la base. */
export function MarcoDialogo(p: {
  dlg: Dialogo
  conexion: DbConnection
  titulo: string
  base: number
  onCerrar: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const idTitulo = useId()
  const produccion = esProduccion(p.conexion.entorno)
  return (
    <div className="modal-overlay" role="presentation" onMouseDown={alClicEnVelo(p.onCerrar)}>
      <div
        ref={p.dlg.ref}
        className={`modal-card db-envio-modal${produccion ? ' es-produccion' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onMouseDown={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          p.dlg.alPulsarTecla(ev)
          if (ev.key !== 'Escape') ev.stopPropagation()
        }}
      >
        {produccion && <FranjaProduccion alias={p.conexion.alias} />}
        <div className="db-envio-cuerpo">
          <div className="modal-title db-envio-titulo" id={idTitulo}>
            <span>{p.titulo}</span>
            <span className="db-envio-tabla">· db{p.base}</span>
          </div>
          {p.children}
        </div>
      </div>
    </div>
  )
}

export function FranjaProduccion({ alias }: { alias: string }): React.JSX.Element {
  return (
    <div className="db-envio-franja" role="note">
      <span className="db-envio-franja-texto">{txEdicionClaves().produccionFranja}</span>
      <span className="db-envio-franja-alias">· {alias}</span>
    </div>
  )
}

/** El comando exacto que se ejecutará, en la caja de la vista previa de «Enviar». */
export function ComandoPrevio({ base, texto }: { base: number; texto: string }): React.JSX.Element {
  const t = txEdicionClaves()
  return (
    <>
      <div className="db-envio-cab">
        <span className="db-envio-cab-texto">{t.seEjecutaraEn(base)}</span>
      </div>
      <pre className="db-envio-sql" tabIndex={0} aria-label={t.comandoQueSeEjecutara}>
        <div className="db-envio-linea">{texto}</div>
      </pre>
    </>
  )
}

/** Cancelar y el botón de la acción. Sin cuadro que rellenar, el foco va a la acción salvo en producción. */
export function Botones(p: {
  edicion: EdicionClave
  clase: string
  texto: string
  listo: boolean
  focoEnEjecutar: boolean
  onEjecutar: () => void
  /** Ausente, cierra la acción de `edicion`. */
  onCancelar?: () => void
}): React.JSX.Element {
  return (
    <div className="modal-actions">
      <button type="button" className="btn btn-ghost" onClick={p.onCancelar ?? p.edicion.cerrar} disabled={p.edicion.enviando}>
        {txEdicionClaves().cancelar}
      </button>
      <button type="button" className={`btn ${p.clase}`} onClick={p.onEjecutar} disabled={!p.listo || p.edicion.enviando} autoFocus={p.focoEnEjecutar}>
        {p.texto}
      </button>
    </div>
  )
}

export function DialogoEdicionClave(p: PropsDialogoEdicion): React.JSX.Element {
  const { edicion, accion, conexion } = p
  const dlg = useDialogo({ onClose: edicion.cerrar, cerrable: !edicion.enviando })
  const idBase = useId()
  const [e, setE] = useState<EntradasClave>(() => entradasIniciales(accion))
  const t = textosAccion(accion, p.nombreCampo)
  const produccion = esProduccion(conexion.entorno)
  const cmd = comandoDeAccion(p.clave, accion, e, p.conTtl)
  const boton = edicion.aviso ? edicion.aviso.confirmar : produccion ? txEdicionClaves().ejecutarEnProduccion : t.boton
  const ejecutar = (): void => {
    if (cmd.ok) edicion.ejecutar(cmd.texto, accion.tipo === 'renombrar' ? e.uno : undefined)
  }
  const claseBoton = produccion ? 'db-envio-btn-prod' : t.peligro || edicion.aviso ? 'danger' : 'primary'

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={alClicEnVelo(edicion.cerrar)}>
      <div
        ref={dlg.ref}
        className={`modal-card db-envio-modal${produccion ? ' es-produccion' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idBase}-titulo`}
        onMouseDown={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          dlg.alPulsarTecla(ev)
          if (ev.key !== 'Escape') ev.stopPropagation()
        }}
      >
        {produccion && <FranjaProduccion alias={conexion.alias} />}
        <div className="db-envio-cuerpo">
          <div className="modal-title db-envio-titulo" id={`${idBase}-titulo`}>
            <span>{t.titulo}</span>
            <span className="db-envio-tabla">· {p.nombre}</span>
          </div>
          {t.etiqueta && (
            <Cuadro
              id={`${idBase}-uno`}
              etiqueta={t.etiqueta}
              valor={e.uno}
              multilinea={t.multilinea}
              foco
              onCambio={(uno) => setE((x) => ({ ...x, uno }))}
              onEnter={t.etiquetaDos ? () => undefined : ejecutar}
            />
          )}
          {t.etiquetaDos && (
            <Cuadro id={`${idBase}-dos`} etiqueta={t.etiquetaDos} valor={e.dos} multilinea={false} foco={false} onCambio={(dos) => setE((x) => ({ ...x, dos }))} onEnter={ejecutar} />
          )}
          <ComandoPrevio base={p.base} texto={cmd.ok ? cmd.texto : '—'} />
          <Estado edicion={edicion} motivo={cmd.ok ? null : cmd.motivo} />
          <Botones edicion={edicion} clase={claseBoton} texto={boton} listo={cmd.ok} focoEnEjecutar={!t.etiqueta && !produccion} onEjecutar={ejecutar} />
        </div>
      </div>
    </div>
  )
}
