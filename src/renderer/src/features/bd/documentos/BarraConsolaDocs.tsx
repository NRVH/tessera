// =============================================================================
// La barra de la consola de MongoDB: alias, entorno, base y estado a la izquierda; iconos
// grises a la derecha. Sin transacción, plan ni historial: no existen en esta consola y un
// botón apagado para siempre es ruido. Con la base fijada en la conexión no hay selector.
// Depende de `piezasBarra` y de `useBarraConsola`, que llevan lo común con la de Redis.
// =============================================================================

import type { DbConnection } from '../../../../../shared/db-ipc'
import { etiquetaAcorde, etiquetasAcorde } from '../../../util/atajos'
import { IconoDetener, IconoEjecutar, IconoEjecutarTodo } from '../iconosBd'
import type { EnCurso } from './consolaComun'
import { BotonBase, BotonCandado, BotonIcono, IdentidadBarra } from './piezasBarra'
import { SelectorBaseDocs } from './SelectorBaseDocs'
import { useBarraConsola, type DatosBarraConsola } from './useBarraConsola'

interface PropsBarraConsolaDocs {
  conexion: DbConnection
  base: string | null
  altoFila: number
  conSelectorBase: boolean
  enCurso: EnCurso | null
  detenible: boolean
  cargado: boolean
  textoEstado: string | null
  onEjecutar: () => void
  onEjecutarTodo: () => void
  onDetener: () => void
  onElegirBase: (base: string) => void
  onEditarConexion: () => void
}

function BotonesEjecucion({ p, b }: { p: PropsBarraConsolaDocs; b: DatosBarraConsola }): React.JSX.Element {
  return (
    <>
      <BotonIcono
        className="db-consola-run"
        titulo={`Ejecutar la sentencia del cursor o la selección · ${etiquetaAcorde('ejecutar')}`}
        etiqueta="Ejecutar"
        habilitado={b.puedeEjecutar}
        motivo={b.motivoEjecutar}
        onClick={p.onEjecutar}
      >
        <IconoEjecutar />
      </BotonIcono>
      <BotonIcono
        className="db-consola-run-todo"
        titulo={`Ejecutar todo · ${etiquetasAcorde('ejecutarTodo').join(' o ')}`}
        etiqueta="Ejecutar todo"
        habilitado={b.puedeEjecutar}
        motivo={b.motivoEjecutar}
        onClick={p.onEjecutarTodo}
      >
        <IconoEjecutarTodo />
      </BotonIcono>
      <BotonIcono
        className="db-consola-detener"
        titulo={`Detener · ${etiquetaAcorde('detener')}`}
        etiqueta="Detener"
        habilitado={p.detenible}
        motivo="No hay nada en ejecución"
        onClick={p.onDetener}
      >
        <IconoDetener />
      </BotonIcono>
    </>
  )
}

function AccionesDocs({ p, b }: { p: PropsBarraConsolaDocs; b: DatosBarraConsola }): React.JSX.Element {
  const tituloBase = b.corriendo
    ? 'Espera a que termine la ejecución para cambiar la base'
    : p.base
      ? `Base: ${p.base}. Pulsa para cambiar`
      : 'Base de la consola. Pulsa para elegir'
  return (
    <div className="panel-actions">
      <BotonesEjecucion p={p} b={b} />
      {p.conSelectorBase && (
        <>
          <span className="panel-actions-sep" aria-hidden="true" />
          <BotonBase
            corriendo={b.corriendo}
            titulo={tituloBase}
            etiqueta={p.base ? `Base de la consola: ${p.base}` : 'Base de la consola'}
            abierto={b.ancla !== null}
            botonRef={b.botonBaseRef}
            onAbrir={b.abrirBase}
          />
        </>
      )}
      {p.conexion.readonly && <BotonCandado onEditarConexion={p.onEditarConexion} />}
    </div>
  )
}

/** La barra de la consola de MongoDB, con el selector de base anclado a su botón. */
export function BarraConsolaDocs(p: PropsBarraConsolaDocs): React.JSX.Element {
  const b = useBarraConsola(p.enCurso, p.cargado, p.textoEstado)
  const produccion = p.conexion.entorno === 'produccion'
  return (
    <div className={`panel-header db-consola-barra${produccion ? ' db-consola-barra-produccion' : ''}`}>
      <IdentidadBarra conexion={p.conexion} estado={b.estado} anunciado={b.anunciado}>
        <span
          className="db-consola-dato db-consola-esquema"
          title={p.base ? `Base actual: ${p.base}` : 'Sin base elegida: elige una o escribe «use nombre»'}
        >
          {p.base ?? 'Sin base'}
        </span>
      </IdentidadBarra>
      <AccionesDocs p={p} b={b} />
      {b.ancla && (
        <SelectorBaseDocs
          conexion={p.conexion}
          actual={p.base}
          ancla={b.ancla}
          altoFila={p.altoFila}
          onElegir={p.onElegirBase}
          onCerrar={b.cerrarSelector}
        />
      )}
    </div>
  )
}
