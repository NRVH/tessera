// =============================================================================
// DialogoEnvio: vista previa de «Enviar». Enseña una línea por cambio, cuántos son y, al aceptar,
// la pestaña los manda al main. En la rejilla SQL las líneas salen de `sentenciaDeCambio`, la misma
// función con la que el main construye lo que ejecuta (con literales; lo que viaja son binds); en
// una colección de MongoDB, de `documentos/envioDocs.ts`. El foco lo decide `focoEnvio`
// (`rejilla/cambiosRejilla.ts`). Lo abren por portal `DbDatosPane` y `documentos/DialogosColeccion.tsx`.
// Decisiones: docs/decisiones/bd/ui-rejilla-editor-y-envio.md
// =============================================================================

import { useEffect, useId, useRef } from 'react'
import type { DbEntorno } from '../../../../shared/db-ipc'
import { esDeUnaListaDeSelect, useDialogo } from '../../comun/useDialogo'
import { IconoCopiar } from '../../comun/iconosMenu'
import { MarcaEntorno } from './MarcaEntorno'
import { notify, notifyError } from '../../comun/notifications'
import {
  avisoEnvioIncierto,
  esEnvioIncierto,
  focoEnvio,
  textoCambios,
  type EstadoEnvio,
  type FocoEnvio
} from './rejilla/cambiosRejilla'
import { txConsolaBd } from './textosConsolaBd.ts'
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
  /** Qué se enseña: el DML de la rejilla (por defecto) o las órdenes del shell de una colección. */
  lenguaje?: 'sql' | 'shell'
  /** Lo que va tras el resumen; por defecto, que va en UNA transacción. */
  mensaje?: string
  onEnviar: () => void
  /** Solo hace falta si el diálogo se queda abierto mientras envía. */
  onDetener?: () => void
  onCerrar: () => void
}

/** Los rótulos de la vista previa según lo que enseña. */
function rotulosDe(lenguaje: 'sql' | 'shell'): Rotulos {
  const t = txConsolaBd()
  return lenguaje === 'shell' ? t.envioShell : t.envioSql
}

interface Rotulos {
  readonly cabecera: string
  readonly copiar: string
  readonly copiado: string
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

/** Cabecera «Vista previa del SQL» (o de las órdenes) con «Copiar» y el `<pre>` con una línea por cambio. */
function SqlEnvio(props: {
  lineas: readonly string[]
  indiceError: number | null
  preRef: React.RefObject<HTMLPreElement>
  rotulos: Rotulos
}): React.JSX.Element {
  const { lineas, indiceError, rotulos } = props
  const copiar = (): void => {
    window.tessera.clipboard
      .write(lineas.join('\n'))
      .then(() => notify('success', rotulos.copiado, txConsolaBd().enElPortapapeles(textoCambios(lineas.length))))
      .catch((err: unknown) => notifyError(txConsolaBd().noSePudoCopiar, err))
  }
  return (
    <>
      <div className="db-envio-cab">
        <span className="db-envio-cab-texto">{rotulos.cabecera}</span>
        <button type="button" className="btn btn-icon" onClick={copiar} title={rotulos.copiar} aria-label={rotulos.copiar}>
          <IconoCopiar />
        </button>
      </div>
      <pre ref={props.preRef} className="db-envio-sql" tabIndex={0} aria-label={rotulos.cabecera}>
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
          <div className="db-envio-error-titulo">{avisoEnvioIncierto().titulo}</div>
          <div className="db-envio-error-texto">{avisoEnvioIncierto().texto}</div>
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
          {txConsolaBd().enviando}
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
  const t = txConsolaBd()
  return (
    <div className="modal-actions">
      {p.estado.tipo === 'enviando' ? (
        <button ref={refs.detenerRef} type="button" className="btn btn-ghost" onClick={p.onDetener}>
          {t.detener}
        </button>
      ) : (
        <>
          <button ref={refs.cancelarRef} type="button" className="btn btn-ghost" onClick={p.onCerrar}>
            {t.cancelar}
          </button>
          {/* En producción el contorno es rojo literal, no el color del perfil de `.btn.danger`. */}
          <button
            ref={refs.enviarRef}
            type="button"
            className={`btn ${produccion ? 'db-envio-btn-prod' : 'primary'}`}
            onClick={p.onEnviar}
          >
            {produccion ? t.ejecutarEnProduccion : t.enviar}
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
  const t = txConsolaBd()
  const titulo = n === 1 ? t.enviarUnCambio : t.enviarCambios(n)

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
            <span className="db-envio-franja-texto">{t.produccion}</span>
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
            {p.resumen ? `${p.resumen}, ` : ''}
            {p.mensaje ?? t.enUnaTransaccion}
          </div>
          <SqlEnvio lineas={p.lineas} indiceError={indiceError} preRef={refs.preRef} rotulos={rotulosDe(p.lenguaje ?? 'sql')} />
          <EstadoDelEnvio estado={p.estado} />
          <AccionesEnvio p={p} produccion={produccion} refs={refs} />
        </div>
      </div>
    </div>
  )
}
