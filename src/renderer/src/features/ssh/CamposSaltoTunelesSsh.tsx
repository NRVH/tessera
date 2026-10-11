// =============================================================================
// «Bastión y túneles» en el diálogo de una conexión SSH: plegada salvo que la conexión ya tenga alguno. El
// bastión es otra conexión del perfil (o directo); cada túnel, una fila con su tipo, el puerto que escucha y,
// salvo el SOCKS, su destino. Presentación: el estado es de `useDialogoConexionSsh` y la lógica, de
// `borradorSsh.ts`.
// Decisiones: docs/decisiones/ssh/tuneles-y-bastiones.md
// =============================================================================

import { useId, useState } from 'react'
import type { SshConexion, SshTipoTunel } from '../../../../shared/ssh-ipc'
import { SSH_TUNELES_MAX } from '../../../../shared/ssh-ipc'
import { puertoValido, tunelNuevo, type BorradorSsh, type CampoSsh, type TunelBorrador } from './borradorSsh'

type Editar = (parcial: Partial<BorradorSsh>) => void

const TIPOS: ReadonlyArray<{ tipo: SshTipoTunel; etiqueta: string }> = [
  { tipo: 'local', etiqueta: 'Local (-L)' },
  { tipo: 'remoto', etiqueta: 'Remoto (-R)' },
  { tipo: 'dinamico', etiqueta: 'SOCKS (-D)' }
]

/** Qué hace un túnel, en una frase, con lo tecleado. */
function ayudaTunel(t: TunelBorrador): string {
  const puerto = t.puerto.trim() || '…'
  const destino = `${t.destinoHost.trim() || '…'}:${t.destinoPuerto.trim() || '…'}`
  if (t.tipo === 'dinamico') return `Proxy SOCKS en 127.0.0.1:${puerto} de este equipo: lo que salga por él sale desde el servidor.`
  if (t.tipo === 'local') return `127.0.0.1:${puerto} de este equipo lleva a ${destino}, visto desde el servidor.`
  return `El puerto ${puerto} del servidor lleva a ${destino}, visto desde este equipo.`
}

/** `true` en un campo que falta tras intentar guardar, y `undefined` en el resto (sin `aria-invalid="false"`). */
function falta(marcar: boolean, malo: boolean): true | undefined {
  return marcar && malo ? true : undefined
}

/** El destino de un túnel local o remoto: host y puerto. */
function DestinoTunel({ t, n, marcar, cambiar }: { t: TunelBorrador; n: number; marcar: boolean; cambiar: (t: TunelBorrador) => void }): React.JSX.Element {
  return (
    <>
      <span className="ssh-tunel-flecha" aria-hidden="true">
        →
      </span>
      <input
        className="ssh-tunel-host"
        aria-label={`Host de destino del túnel ${n}`}
        aria-invalid={falta(marcar, t.destinoHost.trim() === '')}
        placeholder="host de destino"
        value={t.destinoHost}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => cambiar({ ...t, destinoHost: e.target.value })}
      />
      <input
        className="ssh-tunel-puerto"
        aria-label={`Puerto de destino del túnel ${n}`}
        aria-invalid={falta(marcar, !puertoValido(t.destinoPuerto))}
        placeholder="puerto"
        inputMode="numeric"
        value={t.destinoPuerto}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => cambiar({ ...t, destinoPuerto: e.target.value })}
      />
    </>
  )
}

/** Una fila de túnel: tipo, puerto que escucha, destino y quitar. */
function FilaTunel({ t, i, marcar, cambiar, quitar }: { t: TunelBorrador; i: number; marcar: boolean; cambiar: (t: TunelBorrador) => void; quitar: () => void }): React.JSX.Element {
  const n = i + 1
  return (
    <li className="ssh-tunel">
      <div className="ssh-tunel-fila">
        <select
          aria-label={`Tipo del túnel ${n}`}
          value={t.tipo}
          data-campo={i === 0 ? 'tuneles' : undefined}
          onChange={(e) => cambiar({ ...t, tipo: e.target.value as SshTipoTunel })}
        >
          {TIPOS.map((o) => (
            <option key={o.tipo} value={o.tipo}>
              {o.etiqueta}
            </option>
          ))}
        </select>
        <input
          className="ssh-tunel-puerto"
          aria-label={`Puerto que escucha el túnel ${n}`}
          aria-invalid={falta(marcar, !puertoValido(t.puerto))}
          placeholder="puerto"
          inputMode="numeric"
          value={t.puerto}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => cambiar({ ...t, puerto: e.target.value })}
        />
        {t.tipo !== 'dinamico' && <DestinoTunel t={t} n={n} marcar={marcar} cambiar={cambiar} />}
        <button type="button" className="btn btn-icon ssh-tunel-quitar" onClick={quitar} title="Quitar el túnel" aria-label={`Quitar el túnel ${n}`}>
          ×
        </button>
      </div>
      <p className="dbc-ayuda">{ayudaTunel(t)}</p>
    </li>
  )
}

/** El bastión: «Directo» y las demás conexiones del perfil; uno guardado que ya no existe se enseña como tal. */
function CampoBastionSsh({ borrador, bastiones, editar }: { borrador: BorradorSsh; bastiones: readonly SshConexion[]; editar: Editar }): React.JSX.Element {
  const idAyuda = useId()
  const perdido = borrador.saltoId !== null && !bastiones.some((c) => c.id === borrador.saltoId)
  return (
    <label className="dbc-campo">
      <span className="dbc-etiqueta">Saltar por</span>
      <select data-campo="salto" aria-describedby={idAyuda} value={borrador.saltoId ?? ''} onChange={(e) => editar({ saltoId: e.target.value === '' ? null : e.target.value })}>
        <option value="">Directo (sin bastión)</option>
        {perdido && <option value={borrador.saltoId ?? ''}>Una conexión que ya no existe</option>}
        {bastiones.map((c) => (
          <option key={c.id} value={c.id}>
            {c.alias}
          </option>
        ))}
      </select>
      <span id={idAyuda} className="dbc-ayuda">
        {borrador.saltoId === null
          ? 'Para un equipo al que solo se llega pasando por otro: elige esa otra conexión.'
          : 'Se entra primero en el bastión, con su usuario y su clave o contraseña, y desde él en este equipo.'}
      </span>
    </label>
  )
}

/** La sección plegable «Bastión y túneles». */
export function SeccionSaltoTunelesSsh({
  borrador,
  bastiones,
  marcados,
  editar
}: {
  borrador: BorradorSsh
  /** Las conexiones del perfil que pueden ser su bastión (todas menos ella). */
  bastiones: readonly SshConexion[]
  marcados: readonly CampoSsh[]
  editar: Editar
}): React.JSX.Element {
  const marcar = marcados.includes('tuneles')
  // Abierta al montar si ya tiene algo; luego, lo que elija el usuario (y siempre si hay un túnel por completar).
  const [abierta, setAbierta] = useState(() => borrador.saltoId !== null || borrador.tuneles.length > 0)
  const cambiar = (i: number, t: TunelBorrador): void => editar({ tuneles: borrador.tuneles.map((x, j) => (j === i ? t : x)) })
  return (
    <details className="ssh-avanzado" open={abierta || marcar} onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary>Bastión y túneles</summary>
      <div className="ssh-avanzado-cuerpo">
        <CampoBastionSsh borrador={borrador} bastiones={bastiones} editar={editar} />
        <div className="dbc-campo">
          <span className="dbc-etiqueta">Túneles</span>
          <span className="dbc-ayuda">Se abren con la terminal de esta conexión y se cierran con ella. Los agentes no los usan.</span>
          {borrador.tuneles.length > 0 && (
            <ul className="ssh-tuneles">
              {borrador.tuneles.map((t, i) => (
                <FilaTunel key={t.clave} t={t} i={i} marcar={marcar} cambiar={(x) => cambiar(i, x)} quitar={() => editar({ tuneles: borrador.tuneles.filter((_, j) => j !== i) })} />
              ))}
            </ul>
          )}
          <div>
            <button type="button" className="btn" disabled={borrador.tuneles.length >= SSH_TUNELES_MAX} onClick={() => editar({ tuneles: [...borrador.tuneles, tunelNuevo()] })}>
              Añadir túnel
            </button>
          </div>
        </div>
      </div>
    </details>
  )
}
