// =============================================================================
// «Túnel SSH» del diálogo de conexión: elegir una de las conexiones SSH del perfil (o ninguna)
// para llegar a la base a través de ella. Solo en los motores que declaran 'tunelSsh' (apagado con
// Redis Sentinel o Cluster); la lista sale del store de la feature SSH, sin pedir nada al main.
// Decisiones: docs/decisiones/bd/conexiones-tunel-ssh.md
// =============================================================================
import { descriptor, usaOpcional } from '../../../../shared/motores/index'
import { datosDePerfil, destinoSsh, useStoreSsh } from '../ssh'
import type { BorradorConexion } from './borradorConexion'

type Editar = (cambio: Partial<BorradorConexion>) => void

/** La ayuda bajo el selector: qué cambia con el túnel y lo que necesita la conexión SSH. */
const AYUDA_TUNEL =
  'Tessera llega a la base a través de esa conexión SSH: el host y el puerto de arriba son los del servidor de base de datos visto desde el servidor SSH. ' +
  'La huella del servidor SSH tiene que estar confirmada y su contraseña o clave, guardada.'

/** Por qué Redis Sentinel y Cluster no ofrecen túnel (el selector se pinta apagado). */
const SIN_TUNEL_TOPOLOGIA =
  'Sentinel y Cluster no van por túnel SSH: Tessera se conecta a servidores que el túnel no lleva (el maestro que den los sentinels, los nodos del cluster). Para usar un túnel, elige «Un servidor».'

export function SelectorTunelSsh({ borrador, editar }: { borrador: BorradorConexion; editar: Editar }): React.JSX.Element | null {
  const conexiones = useStoreSsh((s) => datosDePerfil(s, borrador.profileId).conexiones)
  const d = descriptor(borrador.motor)
  if (!usaOpcional(d, 'tunelSsh')) return null
  const apagado = usaOpcional(d, 'topologiaRedis') && borrador.modoRedis !== 'servidor'
  const elegidaFalta = borrador.tunelSsh !== '' && !conexiones.some((c) => c.id === borrador.tunelSsh)
  return (
    <>
      <div className="dbc-fila">
        <label className="dbc-campo dbc-crece">
          <span className="dbc-etiqueta">Túnel SSH</span>
          <select data-campo="tunelSsh" disabled={apagado} value={apagado ? '' : borrador.tunelSsh} onChange={(e) => editar({ tunelSsh: e.target.value })}>
            <option value="">{conexiones.length === 0 ? 'Ninguno (este perfil no tiene conexiones SSH)' : 'Ninguno (conexión directa)'}</option>
            {elegidaFalta && <option value={borrador.tunelSsh}>Una conexión SSH que ya no existe</option>}
            {conexiones.map((c) => (
              <option key={c.id} value={c.id}>
                {`${c.alias} (${destinoSsh(c)})`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {apagado && <p className="dbc-ayuda">{SIN_TUNEL_TOPOLOGIA}</p>}
      {!apagado && borrador.tunelSsh !== '' && <p className="dbc-ayuda">{AYUDA_TUNEL}</p>}
    </>
  )
}
