// =============================================================================
// Configuración › Agentes: la entrada al contexto de los agentes, con un resumen del global y el botón que abre
// su diálogo. Una sola fila, que no crece con los perfiles ni con las cuentas: crecen dentro del diálogo.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================
import '../configAgente.css'
import { AYUDA, BotonAyuda } from '../../academy'
import { usePerfilActivo } from '../GestionAgentes'
import { abrirContexto } from './storeContextoAbierto'
import { useStoreContextoGlobal } from './storeContextoGlobal'
import { txContexto } from './textosContexto.ts'

export function EntradaContexto(): React.JSX.Element {
  const t = txContexto()
  const perfil = usePerfilActivo()
  const global = useStoreContextoGlobal((s) => s.global)
  return (
    <div className="gestion-config">
      <div className="gestion-config-intro">
        <p className="ajustes-fila-ayuda">{t.entradaAyuda}</p>
        <BotonAyuda destino={AYUDA.contextoDeLosAgentes} />
      </div>
      <ul className="gestion-config-lista gestion-config-tarjeta">
        <li className="gestion-config-fila">
          <span className="gestion-config-nombre">
            <span className="gestion-config-identidad">{t.titulo}</span>
            <span className="gestion-config-archivos">{t.entradaResumen(global.reglas.length, global.documentos.length)}</span>
          </span>
          <button
            type="button"
            className="btn"
            aria-label={t.entradaAria}
            onClick={() => abrirContexto({ nivel: perfil.profileId ? { tipo: 'perfil', profileId: perfil.profileId } : { tipo: 'global' } })}
          >
            {t.entradaBoton}
          </button>
        </li>
      </ul>
    </div>
  )
}
