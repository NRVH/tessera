// =============================================================================
// Modal: la carcasa común de todo diálogo de Tessera. Cabecera con el título, su ⓘ, sus acciones y la ✕ arriba a la
// derecha, siempre; cuerpo, que es lo único que desplaza; y pie solo si hay algo que confirmar. Se pinta en su propia
// capa (`CapaDialogos`), así que ningún panel ni la tarjeta de otro diálogo lo recorta ni lo mueve. El comportamiento
// (Esc, foco, trampa de Tab, salida animada) es el de `useDialogo`.
// Decisiones: docs/decisiones/renderer/modales.md
// =============================================================================
import './modal.css'
import { useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useCapaVisible } from './capaVisible'
import { IconoCerrar } from './iconosMenu'
import { hayDialogos } from './pilaDialogos'
import { Cruce, Presente } from './Presente'
import { useAbriendo, useUltimoValor } from './presencia'
import { txComun } from './textos'
import { alClicEnVelo, useDialogo } from './useDialogo'

/** El id del `div` de la capa de los diálogos. Uno por ventana, después de la capa flotante. */
export const ID_CAPA_DIALOGOS = 'capa-dialogos'

/** La capa de los diálogos; la monta cada ventana una vez, dentro de `.shell` (hereda el color del perfil). */
export function CapaDialogos(): React.JSX.Element {
  return <div id={ID_CAPA_DIALOGOS} className="capa-dialogos" />
}

/** S confirmar o preguntar un dato · M formularios · L espacios de trabajo · XL los que llevan un riel. */
export type TamanoModal = 's' | 'm' | 'l' | 'xl'

/** Cuánto importa lo que el diálogo avisa o pregunta. La forma del icono también lo dice, no solo el color. */
export type SeveridadModal = 'peligro' | 'advertencia' | 'info'

const FORMA_SEVERIDAD: Record<SeveridadModal, React.JSX.Element> = {
  peligro: (
    <>
      <path d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2z" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </>
  ),
  advertencia: (
    <>
      <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4.5M12 17.5h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v5.5M12 7.5h.01" />
    </>
  )
}

function SelloSeveridad({ severidad }: { severidad: SeveridadModal }): React.JSX.Element {
  return (
    <span className={`modal-sello es-${severidad}`} role="img" aria-label={txComun().severidad[severidad]}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {FORMA_SEVERIDAD[severidad]}
      </svg>
    </span>
  )
}

export interface PropsModal {
  titulo: ReactNode
  /** Solo en lo que advierte o pide una decisión; una ventana de trabajo no lleva icono. */
  severidad?: SeveridadModal
  /** El botón ⓘ de ayuda, junto al título. */
  ayuda?: ReactNode
  /** Una línea bajo el título. */
  subtitulo?: ReactNode
  /** Lo que ocupa el centro de la cabecera (p. ej. un buscador). */
  centro?: ReactNode
  /** Acciones de cabecera, a la izquierda de la ✕. */
  acciones?: ReactNode
  /** Las acciones del pie; sin ellas no hay pie (un diálogo informativo se cierra con la ✕). */
  pie?: ReactNode
  tamano?: TamanoModal
  /** Clases propias de la tarjeta (su ancho o su alto, si no le basta el tamaño). */
  className?: string
  /** Clases propias del cuerpo (su rejilla, su relleno). */
  cuerpoClassName?: string
  rol?: 'dialog' | 'alertdialog'
  /** `false` mientras no se pueda abandonar (un proceso a medias): la ✕ queda desactivada, no se oculta. */
  cerrable?: boolean
  /** Si un clic en el velo lo cierra: no, con cambios sin guardar o una pregunta que hay que contestar. */
  cierraConVelo?: boolean
  /** Trampa de Tab dentro de la tarjeta (por defecto sí). */
  trampaTab?: boolean
  ocupado?: boolean
  onCerrar: () => void
  children: ReactNode
}

export function Modal(p: PropsModal): React.JSX.Element {
  const cerrable = p.cerrable !== false
  const dialogo = useDialogo({ onClose: p.onCerrar, cerrable })
  const visible = useCapaVisible()
  const idTitulo = useId()
  // Si al abrirse ya había otro abierto, este va encima con el velo más ligero.
  const [anidado] = useState(() => hayDialogos())
  const abriendo = useAbriendo()
  const t = txComun()
  const contenido = (
    <div
      className={`modal-overlay${anidado ? ' modal-anidado' : ''}`}
      role="presentation"
      hidden={!visible}
      onMouseDown={p.cierraConVelo !== false && cerrable ? alClicEnVelo(p.onCerrar) : undefined}
    >
      <div
        ref={dialogo.ref}
        className={`modal-card modal-estandar modal-${p.tamano ?? 'm'}${p.severidad ? ' modal-con-sello' : ''}${p.className ? ` ${p.className}` : ''}`}
        role={p.rol ?? 'dialog'}
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-busy={p.ocupado || undefined}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={p.trampaTab === false ? undefined : dialogo.alPulsarTecla}
        {...abriendo}
      >
        <header className="modal-cabecera">
          {p.severidad && (
            <Cruce clave={p.severidad}>
              <SelloSeveridad severidad={p.severidad} />
            </Cruce>
          )}
          <div className="modal-titulos">
            <div className="modal-titulo-fila">
              <h2 id={idTitulo} className="modal-title">
                {p.titulo}
              </h2>
              {p.ayuda}
            </div>
            {p.subtitulo && <p className="modal-subtitulo">{p.subtitulo}</p>}
          </div>
          {p.centro && <div className="modal-cabecera-centro">{p.centro}</div>}
          <div className="modal-cabecera-acciones">
            {p.acciones}
            <button type="button" className="btn btn-icon modal-cerrar" title={t.cerrarEsc} aria-label={t.cerrar} disabled={!cerrable} onClick={p.onCerrar}>
              <IconoCerrar />
            </button>
          </div>
        </header>
        <div className={`modal-cuerpo${p.cuerpoClassName ? ` ${p.cuerpoClassName}` : ''}`}>{p.children}</div>
        {p.pie && <footer className="modal-pie">{p.pie}</footer>}
      </div>
    </div>
  )
  return createPortal(contenido, document.getElementById(ID_CAPA_DIALOGOS) ?? document.body)
}

/** El pie estándar: acciones auxiliares a la izquierda; Cancelar y el primario (el último) a la derecha. */
export function PieModal({ auxiliares, children }: { auxiliares?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <>
      {auxiliares && <div className="modal-pie-auxiliares">{auxiliares}</div>}
      <div className="modal-pie-hueco" />
      {children}
    </>
  )
}

/** Un aviso del diálogo, al final del cuerpo o bajo el campo al que se refiere; nunca dentro del pie. */
export function AvisoModal({ tono, children }: { tono: 'error' | 'aviso' | 'info' | 'exito'; children: ReactNode }): React.JSX.Element {
  return (
    <div className={`modal-aviso es-${tono}`} role={tono === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

/** Conserva el aviso durante su salida sin obligar al formulario a retener el error. */
export function AvisoConPresencia({ children }: { children: ReactNode }): React.JSX.Element {
  const contenido = useUltimoValor(children ? children : null)
  return <Presente visible={!!children} className="mov-despliega">{contenido}</Presente>
}
