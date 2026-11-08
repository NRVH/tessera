// =============================================================================
// Capa de diálogos situada por encima de Configuración y dentro del perfil.
// Aísla Tab de la trampa de foco del modal inferior y conserva Escape.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { EnCapaFlotante } from '../../comun/capaFlotante'

/** Por encima del modal de Configuración, en la capa flotante: dentro de `.shell`, hereda el color del perfil. */
export function SobreAjustes({ children }: { children: React.ReactNode }): React.JSX.Element {
  // El árbol de React sigue pasando por Configuración: su trampa de foco, sin esto, se llevaría Mayús+Tab detrás
  // de este modal. Solo Tab: Esc tiene que llegar a `window`, donde lo atiende el diálogo de la cima.
  return (
    <EnCapaFlotante>
      <div className="sobre-ajustes" onKeyDown={(e) => { if (e.key === 'Tab') e.stopPropagation() }}>
        {children}
      </div>
    </EnCapaFlotante>
  )
}
