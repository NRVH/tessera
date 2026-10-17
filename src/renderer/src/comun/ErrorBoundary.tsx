// =============================================================================
// ErrorBoundary: red de seguridad de React. Un error de render sin capturar deja la pantalla en
// blanco; este boundary lo intercepta y pinta un fallback, y el resto de la app sigue usable.
// Variante 'full' (raíz): pantalla completa con «Recargar». Variante 'pane' (región): tarjeta con
// «Reintentar», que vuelve a montar el subárbol. Solo captura errores de render y de ciclo de
// vida; los asíncronos (IPC, xterm, timers) van a los listeners de main.tsx. Solo depende de React.
// =============================================================================

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { txComun } from './textos.ts'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Nombre de la zona (para el log y el mensaje): "Explorador", "Claude Code"… */
  label?: string
  /** 'full' = raíz (recargar); 'pane' = región aislada (reintentar). */
  variant?: 'full' | 'pane'
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[ui] error de render en ${this.props.label ?? 'la interfaz'}:`,
      error,
      info.componentStack
    )
  }

  private reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const full = this.props.variant === 'full'
    const t = txComun()
    const zone = this.props.label ?? t.errorInterfaz
    return (
      <div className={`error-boundary${full ? ' error-boundary-full' : ' error-boundary-pane'}`}>
        <div className="error-boundary-card" role="alert">
          <div className="error-boundary-title">
            {full ? t.errorTotal : t.errorEn(zone)}
          </div>
          <div className="error-boundary-msg">{error.message || String(error)}</div>
          <div className="error-boundary-actions">
            {full ? (
              <button className="btn primary" onClick={() => window.location.reload()}>
                {t.recargarInterfaz}
              </button>
            ) : (
              <button className="btn" onClick={this.reset}>
                {t.reintentar}
              </button>
            )}
          </div>
          <div className="error-boundary-hint">
            {t.trabajoASalvo}{full ? t.alRecargar : ''}
          </div>
        </div>
      </div>
    )
  }
}
