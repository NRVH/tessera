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
import { txArbolAcciones } from './textosArbolAcciones.ts'

/** La cabecera del lateral. */
export function CabeceraArbol({ a }: { a: CtxArbol }): React.JSX.Element {
  const { motivos, motivoNuevaConsola, conexionSel, porId } = a.d
  const sinConexiones = motivos.sinConexiones
  const conexionSelObj = conexionSel ? porId.get(conexionSel) : undefined
  // «Desconectar»: misma regla que el menú contextual de la conexión.
  const accionDesconectar = accionDesconectarCabecera(conexionSelObj, a.p.sesiones)
  const t = txArbolAcciones()
  return (
    <div className="sidebar-header">
      <span className="sidebar-title">{t.tituloCabecera}</span>
      <div className="sidebar-actions">
        <BotonCabecera titulo={t.nuevaConexion} etiqueta={t.nuevaConexionSinPuntos} motivo={motivos.nuevaConexion} onClick={() => a.e.setDialogo({ conexionId: null })}>
          <IconoNuevaConexion />
        </BotonCabecera>
        <BotonCabecera
          titulo={t.nuevaConsolaTitulo(conexionSelObj ? conexionSelObj.alias : null, etiquetaAcorde('nuevaConsola', a.plataforma))}
          etiqueta={t.nuevaConsola}
          motivo={motivoNuevaConsola}
          onClick={() => a.p.onNuevaConsola(conexionSel)}
        >
          <IconoNuevaConsola />
        </BotonCabecera>
        <BotonCabecera
          titulo={conexionSelObj ? t.refrescarAlias(conexionSelObj.alias) : t.refrescarTodo}
          etiqueta={t.refrescar}
          motivo={sinConexiones}
          onClick={() => refrescarCabecera(a)}
        >
          <IconoRefrescar />
        </BotonCabecera>
        <BotonCabecera
          titulo={t.plegarTodo}
          etiqueta={t.plegarTodo}
          motivo={sinConexiones ?? (a.p.expandidos.size === 0 ? t.nadaDesplegado : null)}
          onClick={a.p.onPlegarTodo}
        >
          <IconoPlegarTodo />
        </BotonCabecera>
        <BotonCabecera
          titulo={accionDesconectar.titulo}
          etiqueta={t.desconectar}
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
