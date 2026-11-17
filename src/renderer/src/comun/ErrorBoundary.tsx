// =============================================================================
// ErrorBoundary: red de seguridad de React. Un error de render sin capturar deja la pantalla en
// blanco; este boundary lo intercepta y pinta un fallback, y el resto de la app sigue usable.
// Variante 'full' (raíz): pantalla completa con «Recargar». Variante 'pane' (región): tarjeta con
// «Reintentar», que vuelve a montar el subárbol. Solo captura errores de render y de ciclo de
// vida; los asíncronos (IPC, xterm, timers) van a los listeners de main.tsx. Solo depende de React.
// =============================================================================

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { txComun } from './textos.ts'

interface PropsErrorBoundary {
  children: ReactNode
  /** Nombre de la zona (para el log y el mensaje): "Explorador", "Claude Code"… */
  etiqueta?: string
  /** 'full' = raíz (recargar); 'pane' = región aislada (reintentar). */
  variante?: 'full' | 'pane'
}

interface EstadoErrorBoundary {
  error: Error | null
}

export class ErrorBoundary extends Component<PropsErrorBoundary, EstadoErrorBoundary> {
  state: EstadoErrorBoundary = { error: null }

  static getDerivedStateFromError(error: Error): EstadoErrorBoundary {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[ui] error de render en ${this.props.etiqueta ?? 'la interfaz'}:`,
      error,
      info.componentStack
    )
  }

  private reiniciar = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const completo = this.props.variante === 'full'
    const t = txComun()
    const zone = this.props.etiqueta ?? t.errorInterfaz
    return (
      <div className={`error-boundary${completo ? ' error-boundary-full' : ' error-boundary-pane'}`}>
        <div className="error-boundary-card" role="alert">
          <div className="error-boundary-title">
            {completo ? t.errorTotal : t.errorEn(zone)}
          </div>
          <div className="error-boundary-msg">{error.message || String(error)}</div>
          <div className="error-boundary-actions">
            {completo ? (
              <button className="btn primary" onClick={() => window.location.reload()}>
                {t.recargarInterfaz}
              </button>
            ) : (
              <button className="btn" onClick={this.reiniciar}>
                {t.reintentar}
              </button>
            )}
          </div>
          <div className="error-boundary-hint">
            {t.trabajoASalvo}{completo ? t.alRecargar : ''}
          </div>
        </div>
      </div>
    )
  }
}
