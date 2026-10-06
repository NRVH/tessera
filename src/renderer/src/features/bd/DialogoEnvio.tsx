// =============================================================================
// DialogoEnvio: vista previa de «Enviar» de la rejilla. Enseña el DML, cuántos cambios son y,
// al aceptar, la pestaña lo manda al main, que lo aplica todo o nada con COMMIT.
// Las líneas salen de `sentenciaDeCambio`, la misma función con la que el main construye lo que
// ejecuta (aquí con literales para leerlas; lo que viaja son binds). El foco lo decide
// `focoEnvio` (`rejilla/cambiosRejilla.ts`). Lo abre `DbDatosPane` por portal.
// Decisiones: docs/decisiones/bd/ui-rejilla-editor-y-envio.md
// =============================================================================

import { useEffect, useId, useRef } from 'react'
import type { DbEntorno } from '../../../../shared/db-ipc'
import { esDeUnaListaDeSelect, useDialogo } from '../../comun/useDialogo'
import { IconoCopiar } from '../../comun/iconosMenu'
import { MarcaEntorno } from './MarcaEntorno'
import { notify, notifyError } from '../../comun/notifications'
import {
  AVISO_ENVIO_INCIERTO,
  esEnvioIncierto,
  focoEnvio,
  textoCambios,
  type EstadoEnvio,
  type FocoEnvio
} from './rejilla/cambiosRejilla'
import './rejilla.css'

// El tipo vive con la lógica pura que lo decide; se reexporta para quien abre el diálogo.
export type { EstadoEnvio }

export interface DialogoEnvioProps {
  alias: string
  entorno?: DbEntorno
  /** Tabla calificada, como la dice la pestaña. */
  tabla: string
  /** «1 actualización, 2 inserciones y 1 borrado». */
  resumen: string
  lineas: readonly string[]
  estado: EstadoEnvio
  onEnviar: () => void
  onDetener: () => void
  onCerrar: () => void
}

type RefBoton = React.RefObject<HTMLButtonElement>

interface RefsEnvio {
  enviarRef: RefBoton
  cancelarRef: RefBoton
  detenerRef: RefBoton
  preRef: React.RefObject<HTMLPreElement>
}

/** Los tres efectos de foco y desplazamiento del diálogo, en su orden. */
function useFocoEnvio(p: DialogoEnvioProps, produccion: boolean, indiceError: number | null): RefsEnvio {
  const enviando = p.estado.tipo === 'enviando'
  const incierto = esEnvioIncierto(p.estado)
  const enviarRef = useRef<HTMLButtonElement>(null)
  const cancelarRef = useRef<HTMLButtonElement>(null)
  const detenerRef = useRef<HTMLButtonElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const refDe: Record<FocoEnvio, RefBoton> = {
    enviar: enviarRef,
    cancelar: cancelarRef,
    detener: detenerRef
  }

  // Foco inicial, UNA vez: en producción, Cancelar (un Intro reflejo no escribe en producción).
  useEffect(() => {
    refDe[focoEnvio(p.estado, produccion)].current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Al pasar a «enviando» el botón con el foco desaparece: el foco va a Detener. Al terminar
  // con error, a donde diga `focoEnvio` (Cancelar en producción o con el COMMIT incierto).
  useEffect(() => {
    if (enviando || p.estado.tipo === 'error') refDe[focoEnvio(p.estado, produccion)].current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enviando, p.estado.tipo, produccion, incierto])

  // La sentencia que falló, a la vista dentro de la lista.
  useEffect(() => {
    if (indiceError === null) return
    const linea = preRef.current?.querySelector<HTMLElement>(`[data-linea="${indiceError}"]`)
    linea?.scrollIntoView({ block: 'nearest' })
  }, [indiceError])

  return { enviarRef, cancelarRef, detenerRef, preRef }
}

/** Cabecera «Vista previa del SQL» con «Copiar» y el `<pre>` con una línea por cambio. */
function SqlEnvio(props: {
  lineas: readonly string[]
  indiceError: number | null
  preRef: React.RefObject<HTMLPreElement>
}): React.JSX.Element {
  const { lineas, indiceError } = props
  const copiar = (): void => {
    window.tessera.clipboard
      .write(lineas.join('\n'))
      .then(() => notify('success', 'SQL copiado', `${textoCambios(lineas.length)} en el portapapeles.`))
      .catch((err: unknown) => notifyError('No se pudo copiar', err))
  }
  return (
    <>
      <div className="db-envio-cab">
        <span className="db-envio-cab-texto">Vista previa del SQL</span>
        <button type="button" className="btn btn-icon" onClick={copiar} title="Copiar el SQL" aria-label="Copiar el SQL">
          <IconoCopiar />
        </button>
      </div>
      <pre ref={props.preRef} className="db-envio-sql" tabIndex={0} aria-label="Vista previa del SQL">
        {lineas.map((l, i) => (
          <div
            key={i}
            data-linea={i}
            className={`db-envio-linea${i === indiceError ? ' con-error' : ''}`}
            aria-current={i === indiceError ? 'true' : undefined}
          >
            {l}
          </div>
        ))}
      </pre>
    </>
  )
}

/** Aviso de COMMIT incierto, error del envío y «Enviando…», en ese orden. */
function EstadoDelEnvio({ estado }: { estado: EstadoEnvio }): React.JSX.Element {
  return (
    <>
      {estado.tipo === 'listo' && esEnvioIncierto(estado) && (
        // Reabierto tras un COMMIT incierto: la duda sigue en pie hasta refrescar.
        <div className="db-envio-error" role="alert">
          <div className="db-envio-error-titulo">{AVISO_ENVIO_INCIERTO.titulo}</div>
          <div className="db-envio-error-texto">{AVISO_ENVIO_INCIERTO.texto}</div>
        </div>
      )}
      {estado.tipo === 'error' && (
        <div className="db-envio-error" role="alert">
          <div className="db-envio-error-titulo">{estado.titulo}</div>
          {estado.mensaje && <div className="db-envio-error-texto">{estado.mensaje}</div>}
        </div>
      )}
      {estado.tipo === 'enviando' && (
        <div className="db-envio-estado" role="status">
          Enviando…
        </div>
      )}
    </>
  )
}

/** Botonera: «Detener» mientras envía; si no, Cancelar y Enviar (o «Ejecutar en producción»). */
function AccionesEnvio(props: {
  p: DialogoEnvioProps
  produccion: boolean
  refs: RefsEnvio
}): React.JSX.Element {
  const { p, produccion, refs } = props
  return (
    <div className="modal-actions">
      {p.estado.tipo === 'enviando' ? (
        <button ref={refs.detenerRef} type="button" className="btn btn-ghost" onClick={p.onDetener}>
          Detener
        </button>
      ) : (
        <>
          <button ref={refs.cancelarRef} type="button" className="btn btn-ghost" onClick={p.onCerrar}>
            Cancelar
          </button>
          {/* En producción el contorno es rojo literal, no el color del perfil de `.btn.danger`. */}
          <button
            ref={refs.enviarRef}
            type="button"
            className={`btn ${produccion ? 'db-envio-btn-prod' : 'primary'}`}
            onClick={p.onEnviar}
          >
            {produccion ? 'Ejecutar en producción' : 'Enviar'}
          </button>
        </>
      )}
    </div>
  )
}

export function DialogoEnvio(p: DialogoEnvioProps): React.JSX.Element {
  const enviando = p.estado.tipo === 'enviando'
  const produccion = p.entorno === 'produccion'
  // Mientras envía no se cierra (ni Esc ni el velo): el único botón es «Detener».
  const dlg = useDialogo({ onClose: p.onCerrar, cerrable: !enviando })
  const idBase = useId()
  const indiceError = p.estado.tipo === 'error' ? p.estado.indice : null
  const refs = useFocoEnvio(p, produccion, indiceError)

  const n = p.lineas.length
  const titulo = n === 1 ? 'Enviar 1 cambio' : `Enviar ${n} cambios`

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={() => !enviando && p.onCerrar()}>
      {/* Dos clases: el CSS del componente se inyecta antes que styles.css. Las teclas no suben
          por el árbol de React salvo Esc (la rejilla no debe ver un Intro tecleado aquí). */}
      <div
        ref={dlg.ref}
        className={`modal-card db-envio-modal${produccion ? ' es-produccion' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idBase}-titulo`}
        aria-describedby={`${idBase}-mensaje`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Con la lista de un select desplegada, sus teclas son de la lista (es del DOM y burbujea).
          if (esDeUnaListaDeSelect(e.target)) return
          dlg.alPulsarTecla(e)
          if (e.key !== 'Escape') e.stopPropagation()
        }}
      >
        {produccion && (
          <div className="db-envio-franja" role="note">
            <span className="db-envio-franja-texto">PRODUCCIÓN</span>
            <span className="db-envio-franja-alias">· {p.alias}</span>
          </div>
        )}
        <div className="db-envio-cuerpo">
          <div className="modal-title db-envio-titulo" id={`${idBase}-titulo`}>
            <span>{titulo}</span>
            <span className="db-envio-tabla">· {p.tabla}</span>
          </div>
          <div className="db-envio-conexion">
            {!produccion && <MarcaEntorno entorno={p.entorno} />}
            <span className="db-envio-alias">{p.alias}</span>
          </div>
          <div className="modal-message db-envio-mensaje" id={`${idBase}-mensaje`}>
            {p.resumen ? `${p.resumen}, ` : ''}en UNA transacción: si uno falla, no se aplica ninguno.
          </div>
          <SqlEnvio lineas={p.lineas} indiceError={indiceError} preRef={refs.preRef} />
          <EstadoDelEnvio estado={p.estado} />
          <AccionesEnvio p={p} produccion={produccion} refs={refs} />
        </div>
      </div>
    </div>
  )
}
