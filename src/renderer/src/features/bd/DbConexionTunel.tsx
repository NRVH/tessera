// =============================================================================
// «Túnel SSH» del diálogo de conexión: elegir una de las conexiones SSH del perfil (o ninguna)
// para llegar a la base a través de ella. Solo en los motores que declaran 'tunelSsh' (apagado con
// Redis Sentinel o Cluster); la lista sale del store de la feature SSH, sin pedir nada al main.
// Decisiones: docs/decisiones/bd/conexiones-tunel-ssh.md
// =============================================================================
import { descriptor, usaOpcional } from '../../../../shared/motores/index'
import { datosDePerfil, destinoSsh, useStoreSsh } from '../ssh'
import type { BorradorConexion } from './borradorConexion'
import { txConexionDialogo } from './textosConexionDialogo.ts'

type Editar = (cambio: Partial<BorradorConexion>) => void

export function SelectorTunelSsh({ borrador, editar }: { borrador: BorradorConexion; editar: Editar }): React.JSX.Element | null {
  const conexiones = useStoreSsh((s) => datosDePerfil(s, borrador.profileId).conexiones)
  const d = descriptor(borrador.motor)
  if (!usaOpcional(d, 'tunelSsh')) return null
  const apagado = usaOpcional(d, 'topologiaRedis') && borrador.modoRedis !== 'servidor'
  const elegidaFalta = borrador.tunelSsh !== '' && !conexiones.some((c) => c.id === borrador.tunelSsh)
  const t = txConexionDialogo()
  return (
    <>
      <div className="dbc-fila">
        <label className="dbc-campo dbc-crece">
          <span className="dbc-etiqueta">{t.tunelSsh}</span>
          <select data-campo="tunelSsh" disabled={apagado} value={apagado ? '' : borrador.tunelSsh} onChange={(e) => editar({ tunelSsh: e.target.value })}>
            <option value="">{conexiones.length === 0 ? t.ningunoSinSsh : t.ningunoDirecta}</option>
            {elegidaFalta && <option value={borrador.tunelSsh}>{t.conexionSshInexistente}</option>}
            {conexiones.map((c) => (
              <option key={c.id} value={c.id}>
                {`${c.alias} (${destinoSsh(c)})`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/* Por qué Redis Sentinel y Cluster no ofrecen túnel (el selector se pinta apagado). */}
      {apagado && <p className="dbc-ayuda">{t.sinTunelTopologia}</p>}
      {/* Qué cambia con el túnel y lo que necesita la conexión SSH. */}
      {!apagado && borrador.tunelSsh !== '' && <p className="dbc-ayuda">{t.ayudaTunel}</p>}
    </>
  )
}
