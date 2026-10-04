// =============================================================================
// La barra de la consola de Redis: alias, entorno, base y estado a la izquierda; iconos grises
// a la derecha. Sin transacción, plan ni historial: en la consola no existen (un MULTI se
// escribe a mano) y un botón apagado para siempre es ruido. Siempre hay selector de base.
// Depende de `documentos/piezasBarra` y de `useBarraConsola`, que llevan lo común con la de MongoDB.
// =============================================================================

import type { DbConnection } from '../../../../../shared/db-ipc'
import { etiquetaAcorde, etiquetasAcorde } from '../../../util/atajos'
import { etiquetaBaseClaves } from '../arbolClaves'
import { IconoDetener, IconoEjecutar, IconoEjecutarTodo } from '../iconosBd'
import type { EnCurso } from '../documentos/consolaComun'
import { BotonBase, BotonCandado, BotonIcono, IdentidadBarra } from '../documentos/piezasBarra'
import { useBarraConsola, type DatosBarraConsola } from '../documentos/useBarraConsola'
import { SelectorBaseClaves } from './SelectorBaseClaves'

interface PropsBarraConsolaClaves {
  conexion: DbConnection
  base: number
  altoFila: number
  enCurso: EnCurso | null
  cargado: boolean
  textoEstado: string | null
  onEjecutar: () => void
  onEjecutarTodo: () => void
  onDetener: () => void
  onElegirBase: (base: number) => void
  onEditarConexion: () => void
}

function BotonesEjecucion({ p, b }: { p: PropsBarraConsolaClaves; b: DatosBarraConsola }): React.JSX.Element {
  return (
    <>
      <BotonIcono
        className="db-consola-run"
        titulo={`Ejecutar el comando del cursor o las líneas seleccionadas · ${etiquetaAcorde('ejecutar')}`}
        etiqueta="Ejecutar"
        habilitado={b.puedeEjecutar}
        motivo={b.motivoEjecutar}
        onClick={p.onEjecutar}
      >
        <IconoEjecutar />
      </BotonIcono>
      <BotonIcono
        className="db-consola-run-todo"
        titulo={`Ejecutar todos los comandos · ${etiquetasAcorde('ejecutarTodo').join(' o ')}`}
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
        habilitado={b.corriendo}
        motivo="No hay nada en ejecución"
        onClick={p.onDetener}
      >
        <IconoDetener />
      </BotonIcono>
    </>
  )
}

function AccionesClaves({ p, b }: { p: PropsBarraConsolaClaves; b: DatosBarraConsola }): React.JSX.Element {
  const nombreBase = etiquetaBaseClaves(p.base)
  const tituloBase = b.corriendo ? 'Espera a que termine la ejecución para cambiar la base' : `Base: ${nombreBase}. Pulsa para cambiar`
  return (
    <div className="panel-actions">
      <BotonesEjecucion p={p} b={b} />
      <span className="panel-actions-sep" aria-hidden="true" />
      <BotonBase
        corriendo={b.corriendo}
        titulo={tituloBase}
        etiqueta={`Base de la consola: ${nombreBase}`}
        abierto={b.ancla !== null}
        botonRef={b.botonBaseRef}
        onAbrir={b.abrirBase}
      />
      {p.conexion.readonly && <BotonCandado onEditarConexion={p.onEditarConexion} />}
    </div>
  )
}

/** La barra de la consola de Redis, con el selector de base anclado a su botón. */
export function BarraConsolaClaves(p: PropsBarraConsolaClaves): React.JSX.Element {
  const b = useBarraConsola(p.enCurso, p.cargado, p.textoEstado)
  const nombreBase = etiquetaBaseClaves(p.base)
  const produccion = p.conexion.entorno === 'produccion'
  return (
    <div className={`panel-header db-consola-barra${produccion ? ' db-consola-barra-produccion' : ''}`}>
      <IdentidadBarra conexion={p.conexion} estado={b.estado} anunciado={b.anunciado}>
        <span className="db-consola-dato db-consola-esquema" title={`Base actual: ${nombreBase} (también la cambia «SELECT n»)`}>
          {nombreBase}
        </span>
      </IdentidadBarra>
      <AccionesClaves p={p} b={b} />
      {b.ancla && (
        <SelectorBaseClaves
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
