// =============================================================================
// «Actividad de los agentes por SSH»: lo que hicieron los agentes con `tssh` en el perfil (orden remota,
// copia o prueba), con qué conexión, cómo acabó y cuánto tardó, lo más reciente primero. Lo lee del main al
// abrirse y con «Actualizar»; el filtro arranca con el alias de la conexión desde la que se abrió. Nunca
// enseña la orden ni las rutas: el registro no las guarda. Depende de `actividadSsh.ts`.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================

import { useCallback, useEffect, useId, useState } from 'react'
import type { SshActividadPerfil } from '../../../../shared/ssh-ipc'
import { useDialogo } from '../../comun/useDialogo'
import { filtrarActividad, resultadoActividad, textoDuracion, textoUso } from './actividadSsh'
import { mensajeDeErrorSsh } from './erroresSsh'
import { accionesSsh } from './store'
import './conexionesSsh.css'

const FECHA = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'medium' })

/** La fecha ISO del registro, en la hora local; tal cual si no se puede leer. */
function textoFecha(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : FECHA.format(d)
}

type Carga = { estado: 'cargando' } | { estado: 'lista'; datos: SshActividadPerfil } | { estado: 'error'; mensaje: string }

/** La actividad del perfil, pedida al abrir y al pulsar «Actualizar». */
function useActividad(perfilId: string): { carga: Carga; actualizar: () => void } {
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' })
  const actualizar = useCallback(() => {
    window.tessera.ssh
      .actividad({ profileId: perfilId })
      .then((datos) => setCarga({ estado: 'lista', datos }))
      .catch((err) => setCarga({ estado: 'error', mensaje: mensajeDeErrorSsh(err) }))
  }, [perfilId])
  useEffect(actualizar, [actualizar])
  return { carga, actualizar }
}

/** La tabla, o por qué no hay filas. */
function TablaActividad({ carga, filtro, exacto }: { carga: Carga; filtro: string; exacto: boolean }): React.JSX.Element {
  if (carga.estado === 'cargando') return <p className="dbc-ayuda">Cargando…</p>
  if (carga.estado === 'error') return <p className="ssh-actividad-vacia" role="alert">{carga.mensaje}</p>
  const filas = filtrarActividad(carga.datos.entradas, filtro, exacto)
  if (carga.datos.entradas.length === 0) return <p className="ssh-actividad-vacia">Los agentes de este perfil aún no han usado ninguna conexión.</p>
  if (filas.length === 0) return <p className="ssh-actividad-vacia">Ninguna conexión coincide con «{filtro}».</p>
  return (
    <div className="ssh-actividad-tabla-caja">
      <table className="ssh-actividad-tabla">
        <thead>
          <tr>
            <th scope="col">Cuándo</th>
            <th scope="col">Conexión</th>
            <th scope="col">Qué</th>
            <th scope="col">Resultado</th>
            <th scope="col" className="ssh-actividad-num">Duración</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((e, i) => {
            const r = resultadoActividad(e)
            return (
              <tr key={`${e.fecha}-${i}`}>
                <td className="ssh-actividad-fecha">{textoFecha(e.fecha)}</td>
                <td className="ssh-actividad-alias" title={e.alias}>
                  {e.alias}
                </td>
                <td className="ssh-actividad-uso">{textoUso(e.uso)}</td>
                <td className={`ssh-actividad-resultado ssh-actividad-${r.tono}`}>{r.texto}</td>
                <td className="ssh-actividad-num">{textoDuracion(e.ms)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {carga.datos.mas && <p className="dbc-ayuda">Se enseñan las {carga.datos.entradas.length} más recientes.</p>}
    </div>
  )
}

/** El diálogo de la actividad de los agentes de un perfil. */
export function DialogoActividadSsh({ perfilId, alias }: { perfilId: string; alias: string }): React.JSX.Element {
  const dialogo = useDialogo({ onClose: accionesSsh.cerrarDialogo })
  const idTitulo = useId()
  const [filtro, setFiltro] = useState(alias)
  const { carga, actualizar } = useActividad(perfilId)
  return (
    <div className="modal-overlay" role="presentation">
      <div ref={dialogo.ref} className="modal-card db-conexion-modal ssh-actividad-modal" role="dialog" aria-modal="true" aria-labelledby={idTitulo} onKeyDown={dialogo.alPulsarTecla}>
        <div className="dbc-form">
          <div className="dbc-cabecera">
            <div id={idTitulo} className="modal-title">
              Actividad de los agentes por SSH
            </div>
            <p className="dbc-ayuda">Lo que los agentes de este perfil hicieron con tssh, lo más reciente primero. No se guarda la orden ni las rutas.</p>
          </div>
          <div className="dbc-cuerpo">
            <input
              className="modal-input ssh-actividad-filtro"
              value={filtro}
              placeholder="Filtrar por conexión…"
              aria-label="Filtrar por conexión"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setFiltro(e.target.value)}
            />
            {/* Abierta desde una conexión, solo la suya mientras no se toque el filtro. */}
            <TablaActividad carga={carga} filtro={filtro} exacto={alias !== '' && filtro === alias} />
          </div>
          <div className="modal-actions dbc-acciones">
            <button type="button" className="btn btn-ghost" onClick={actualizar}>
              Actualizar
            </button>
            <button type="button" className="btn primary" onClick={accionesSsh.cerrarDialogo}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
