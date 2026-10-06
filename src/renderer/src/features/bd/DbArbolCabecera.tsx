// =============================================================================
// La cabecera del lateral de BD: «Bases de datos» y sus cinco botones de icono (nueva
// conexión, nueva consola, refrescar, plegar todo y desconectar). Un botón apagado dice su
// porqué (`motivosCabeceraArbol`, `accionDesconectarCabecera`) desde un envoltorio vivo,
// porque Chromium no da eventos de ratón a un control deshabilitado (el botón es `comun/BotonCabecera`).
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import { BotonCabecera } from '../../comun/BotonCabecera'
import { IconoDesconectar, IconoNuevaConexion, IconoNuevaConsola, IconoPlegarTodo, IconoRefrescar } from './iconosBd'
import { accionDesconectarCabecera } from './filasArbolBd'
import { etiquetaAcorde } from '../../util/atajos'
import { desconectar, refrescarCabecera } from './DbArbolAcciones'
import type { CtxArbol } from './DbArbolTipos'

/** La cabecera del lateral. */
export function CabeceraArbol({ a }: { a: CtxArbol }): React.JSX.Element {
  const { motivos, motivoNuevaConsola, conexionSel, porId } = a.d
  const sinConexiones = motivos.sinConexiones
  const conexionSelObj = conexionSel ? porId.get(conexionSel) : undefined
  // «Desconectar»: misma regla que el menú contextual de la conexión.
  const accionDesconectar = accionDesconectarCabecera(conexionSelObj, a.p.sesiones)
  return (
    <div className="sidebar-header">
      <span className="sidebar-title">Bases de datos</span>
      <div className="sidebar-actions">
        <BotonCabecera titulo="Nueva conexión…" etiqueta="Nueva conexión" motivo={motivos.nuevaConexion} onClick={() => a.e.setDialogo({ conexionId: null })}>
          <IconoNuevaConexion />
        </BotonCabecera>
        <BotonCabecera
          titulo={`Nueva consola${conexionSelObj ? ` en ${conexionSelObj.alias}` : ''} (${etiquetaAcorde('nuevaConsola', a.plataforma)})`}
          etiqueta="Nueva consola"
          motivo={motivoNuevaConsola}
          onClick={() => a.p.onNuevaConsola(conexionSel)}
        >
          <IconoNuevaConsola />
        </BotonCabecera>
        <BotonCabecera
          titulo={conexionSelObj ? `Refrescar ${conexionSelObj.alias}` : 'Refrescar todo'}
          etiqueta="Refrescar"
          motivo={sinConexiones}
          onClick={() => refrescarCabecera(a)}
        >
          <IconoRefrescar />
        </BotonCabecera>
        <BotonCabecera
          titulo="Plegar todo"
          etiqueta="Plegar todo"
          motivo={sinConexiones ?? (a.p.expandidos.size === 0 ? 'No hay nada desplegado' : null)}
          onClick={a.p.onPlegarTodo}
        >
          <IconoPlegarTodo />
        </BotonCabecera>
        <BotonCabecera
          titulo={accionDesconectar.titulo}
          etiqueta="Desconectar"
          motivo={accionDesconectar.motivo}
          onClick={() => {
            if (conexionSelObj) void desconectar(a, conexionSelObj)
          }}
        >
          <IconoDesconectar />
        </BotonCabecera>
      </div>
    </div>
  )
}
