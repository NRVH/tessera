// =============================================================================
// El diálogo de una edición del visor de clave: los cuadros que pide la acción, el comando EXACTO que
// se va a ejecutar (se rehace al escribir), el aviso del main si pidió confirmar algo más y el error de
// Redis si lo hubo. En producción lleva la franja y el botón «Ejecutar en producción», como la vista
// previa de «Enviar» (de la que toma el CSS). Lo pinta `PaneClaveBd` por portal.
// Decisiones: docs/decisiones/bd/ui-claves-visor.md
// =============================================================================

import { useId, useState } from 'react'
import type { ConexionBd } from '../../../../../shared/db-ipc'
import { esProduccion } from '../consola/produccionConsola'
import { ModalAviso, Modal, ModalPie } from '../../../comun/Modal'
import { comandoDeAccion, entradasIniciales, textosAccion, type AccionClave, type EntradasClave } from './edicionClaves'
import type { EdicionClave } from './useEdicionClave'
import { txEdicionClaves } from './textosEdicionClaves'
import type { DbKvBytes } from '../../../../../shared/db-claves-ipc'

/** Las teclas del formulario no accionan la consola que lo abrió. */
function aislarTeclas(ev: React.KeyboardEvent<HTMLDivElement>): void {
  if (ev.key !== 'Escape' && ev.key !== 'Tab') ev.stopPropagation()
}

export interface PropsDialogoEdicion {
  conexion: ConexionBd
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
    <div className="modal-campo">
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
    </div>
  )
}

export function Estado(props: { edicion: EdicionClave; motivo: string | null; errorPropio?: string | null }): React.JSX.Element {
  const { aviso, error, enviando } = props.edicion
  const t = txEdicionClaves()
  return (
    <>
      {props.errorPropio && (
        <ModalAviso tono="error">
          <div className="db-envio-error-titulo">{t.noSePudo}</div>
          <div className="db-envio-error-texto">{props.errorPropio}</div>
        </ModalAviso>
      )}
      {aviso && (
        <ModalAviso tono="aviso">
          <div className="db-envio-error-titulo">{aviso.titulo}</div>
          <div className="db-envio-error-texto">{aviso.mensaje}</div>
        </ModalAviso>
      )}
      {error && (
        <ModalAviso tono="error">
          <div className="db-envio-error-titulo">{t.noSePudo}</div>
          <div className="db-envio-error-texto">{error}</div>
        </ModalAviso>
      )}
      {props.motivo && !error && <ModalAviso tono="info">{props.motivo}</ModalAviso>}
      {enviando && (
        <ModalAviso tono="info"><span className="db-envio-estado">
          {t.ejecutando}
        </span></ModalAviso>
      )}
    </>
  )
}

/** La carcasa de claves con la conexión y su base. */
export function MarcoDialogo(p: {
  conexion: ConexionBd
  titulo: string
  base: number
  cerrable: boolean
  pie?: React.ReactNode
  onCerrar: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const produccion = esProduccion(p.conexion.entorno)
  return (
    <Modal titulo={p.titulo} subtitulo={`db${p.base}`} tamano="m"
      className={`db-envio-modal${produccion ? ' es-produccion' : ''}`}
      cerrable={p.cerrable} ocupado={!p.cerrable} cierraConVelo={false} onCerrar={p.onCerrar} pie={p.pie}
    >
      <div className="db-envio-contenido" onKeyDown={aislarTeclas}>
        {produccion && <FranjaProduccion alias={p.conexion.alias} />}
        {p.children}
      </div>
    </Modal>
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
  ocupado?: boolean
  clase: string
  texto: string
  listo: boolean
  focoEnEjecutar: boolean
  onEjecutar: () => void
  /** Ausente, cierra la acción de `edicion`. */
  onCancelar?: () => void
}): React.JSX.Element {
  return (
    <ModalPie>
      <button type="button" className="btn btn-ghost" onClick={p.onCancelar ?? p.edicion.cerrar} disabled={p.edicion.enviando || p.ocupado}>
        {txEdicionClaves().cancelar}
      </button>
      <button type="button" className={`btn ${p.clase}`} onClick={p.onEjecutar} disabled={!p.listo || p.edicion.enviando || p.ocupado} autoFocus={p.focoEnEjecutar}>
        {p.texto}
      </button>
    </ModalPie>
  )
}

export function DialogoEdicionClave(p: PropsDialogoEdicion): React.JSX.Element {
  const { edicion, accion, conexion } = p
  const idBase = useId()
  const [e, setE] = useState<EntradasClave>(() => entradasIniciales(accion))
  const t = textosAccion(accion, p.nombreCampo)
  const produccion = esProduccion(conexion.entorno)
  const cmd = comandoDeAccion(p.clave, accion, e, p.conTtl)
  const boton = edicion.aviso ? edicion.aviso.confirmar : produccion ? txEdicionClaves().ejecutarEnProduccion : t.boton
  const ejecutar = (): void => {
    if (cmd.ok) edicion.ejecutar(cmd.texto, accion.tipo === 'renombrar' ? e.uno : undefined)
  }
  const claseBoton = produccion ? 'danger db-envio-btn-prod' : t.peligro || edicion.aviso ? 'danger' : 'primary'

  return (
    <Modal titulo={t.titulo} subtitulo={p.nombre} tamano="m"
      className={`db-envio-modal${produccion ? ' es-produccion' : ''}`}
      cerrable={!edicion.enviando} ocupado={edicion.enviando} cierraConVelo={false} onCerrar={edicion.cerrar}
      pie={<Botones edicion={edicion} clase={claseBoton} texto={boton} listo={cmd.ok} focoEnEjecutar={!t.etiqueta && !produccion} onEjecutar={ejecutar} />}
    >
      <div className="db-envio-contenido" onKeyDown={aislarTeclas}>
        {produccion && <FranjaProduccion alias={conexion.alias} />}
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
      </div>
    </Modal>
  )
}
