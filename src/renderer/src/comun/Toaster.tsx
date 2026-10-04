// =============================================================================
// Toaster: pila de notificaciones abajo a la derecha. Consume el store de `notifications.ts`.
// Errores y avisos usan role="alert"; info y éxito, role="status". La acción opcional
// (`toast.accion`) es un botón de texto bajo el título que descarta el aviso antes de actuar.
// Su CSS vive en `toaster.css`; el resto está en styles.css.
// =============================================================================

import { useToasts, dismiss, type Toast, type ToastKind } from './notifications'
import './toaster.css'

export function Toaster(): React.JSX.Element | null {
  const toasts = useToasts()
  if (toasts.length === 0) return null
  return (
    <div className="toaster" aria-label="Notificaciones">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  )
}

function ToastCard({ toast }: { toast: Toast }): React.JSX.Element {
  const loud = toast.kind === 'error' || toast.kind === 'warn'
  return (
    <div
      className={`toast toast-${toast.kind}`}
      role={loud ? 'alert' : 'status'}
      aria-live={loud ? 'assertive' : 'polite'}
    >
      <span className="toast-icon" aria-hidden="true">
        <ToastGlyph kind={toast.kind} />
      </span>
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        {toast.detail && <div className="toast-detail">{toast.detail}</div>}
        {toast.accion && (
          <button
            type="button"
            className="toast-accion"
            onClick={() => {
              const accion = toast.accion
              dismiss(toast.id)
              accion?.onClick()
            }}
          >
            {toast.accion.etiqueta}
          </button>
        )}
      </div>
      <button
        className="toast-close"
        onClick={() => dismiss(toast.id)}
        aria-label="Descartar notificación"
        title="Descartar"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}

function ToastGlyph({ kind }: { kind: ToastKind }): React.JSX.Element {
  if (kind === 'success') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12.5l2.5 2.5L16 9" />
      </svg>
    )
  }
  if (kind === 'info') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
    )
  }
  // error / warn: triángulo de aviso.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5L22 20H2z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  )
}
