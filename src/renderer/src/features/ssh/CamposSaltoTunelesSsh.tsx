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
import { txFormularioSsh } from './textosFormulario.ts'

type Editar = (parcial: Partial<BorradorSsh>) => void

function tiposTunel(): ReadonlyArray<{ tipo: SshTipoTunel; etiqueta: string }> {
  const t = txFormularioSsh()
  return [
    { tipo: 'local', etiqueta: t.tunelLocal },
    { tipo: 'remoto', etiqueta: t.tunelRemoto },
    { tipo: 'dinamico', etiqueta: t.tunelSocks }
  ]
}

/** Qué hace un túnel, en una frase, con lo tecleado. */
function ayudaTunel(t: TunelBorrador): string {
  const tx = txFormularioSsh()
  const puerto = t.puerto.trim() || '…'
  const destino = `${t.destinoHost.trim() || '…'}:${t.destinoPuerto.trim() || '…'}`
  if (t.tipo === 'dinamico') return tx.ayudaSocks(puerto)
  if (t.tipo === 'local') return tx.ayudaLocal(puerto, destino)
  return tx.ayudaRemoto(puerto, destino)
}

/** `true` en un campo que falta tras intentar guardar, y `undefined` en el resto (sin `aria-invalid="false"`). */
function falta(marcar: boolean, malo: boolean): true | undefined {
  return marcar && malo ? true : undefined
}

/** El destino de un túnel local o remoto: host y puerto. */
function DestinoTunel({ t, n, marcar, cambiar }: { t: TunelBorrador; n: number; marcar: boolean; cambiar: (t: TunelBorrador) => void }): React.JSX.Element {
  const tx = txFormularioSsh()
  return (
    <>
      <span className="ssh-tunel-flecha" aria-hidden="true">
        →
      </span>
      <input
        className="ssh-tunel-host"
        aria-label={tx.hostDestinoTunel(n)}
        aria-invalid={falta(marcar, t.destinoHost.trim() === '')}
        placeholder={tx.hostDestinoPlaceholder}
        value={t.destinoHost}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => cambiar({ ...t, destinoHost: e.target.value })}
      />
      <input
        className="ssh-tunel-puerto"
        aria-label={tx.puertoDestinoTunel(n)}
        aria-invalid={falta(marcar, !puertoValido(t.destinoPuerto))}
        placeholder={tx.puertoPlaceholder}
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
  const tx = txFormularioSsh()
  return (
    <li className="ssh-tunel">
      <div className="ssh-tunel-fila">
        <select
          aria-label={tx.tipoTunel(n)}
          value={t.tipo}
          data-campo={i === 0 ? 'tuneles' : undefined}
          onChange={(e) => cambiar({ ...t, tipo: e.target.value as SshTipoTunel })}
        >
          {tiposTunel().map((o) => (
            <option key={o.tipo} value={o.tipo}>
              {o.etiqueta}
            </option>
          ))}
        </select>
        <input
          className="ssh-tunel-puerto"
          aria-label={tx.puertoEscuchaTunel(n)}
          aria-invalid={falta(marcar, !puertoValido(t.puerto))}
          placeholder={tx.puertoPlaceholder}
          inputMode="numeric"
          value={t.puerto}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => cambiar({ ...t, puerto: e.target.value })}
        />
        {t.tipo !== 'dinamico' && <DestinoTunel t={t} n={n} marcar={marcar} cambiar={cambiar} />}
        <button type="button" className="btn btn-icon ssh-tunel-quitar" onClick={quitar} title={tx.quitarTunel} aria-label={tx.quitarTunelN(n)}>
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
  const tx = txFormularioSsh()
  return (
    <label className="dbc-campo">
      <span className="dbc-etiqueta">{tx.saltarPor}</span>
      <select data-campo="salto" aria-describedby={idAyuda} value={borrador.saltoId ?? ''} onChange={(e) => editar({ saltoId: e.target.value === '' ? null : e.target.value })}>
        <option value="">{tx.directo}</option>
        {perdido && <option value={borrador.saltoId ?? ''}>{tx.conexionPerdida}</option>}
        {bastiones.map((c) => (
          <option key={c.id} value={c.id}>
            {c.alias}
          </option>
        ))}
      </select>
      <span id={idAyuda} className="dbc-ayuda">
        {borrador.saltoId === null ? tx.ayudaSinBastion : tx.ayudaConBastion}
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
  const tx = txFormularioSsh()
  // Abierta al montar si ya tiene algo; luego, lo que elija el usuario (y siempre si hay un túnel por completar).
  const [abierta, setAbierta] = useState(() => borrador.saltoId !== null || borrador.tuneles.length > 0)
  const cambiar = (i: number, t: TunelBorrador): void => editar({ tuneles: borrador.tuneles.map((x, j) => (j === i ? t : x)) })
  return (
    <details className="ssh-avanzado" open={abierta || marcar} onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary>{tx.bastionYTuneles}</summary>
      <div className="ssh-avanzado-cuerpo">
        <CampoBastionSsh borrador={borrador} bastiones={bastiones} editar={editar} />
        <div className="dbc-campo">
          <span className="dbc-etiqueta">{tx.tuneles}</span>
          <span className="dbc-ayuda">{tx.ayudaTuneles}</span>
          {borrador.tuneles.length > 0 && (
            <ul className="ssh-tuneles">
              {borrador.tuneles.map((t, i) => (
                <FilaTunel key={t.clave} t={t} i={i} marcar={marcar} cambiar={(x) => cambiar(i, x)} quitar={() => editar({ tuneles: borrador.tuneles.filter((_, j) => j !== i) })} />
              ))}
            </ul>
          )}
          <div>
            <button type="button" className="btn" disabled={borrador.tuneles.length >= SSH_TUNELES_MAX} onClick={() => editar({ tuneles: [...borrador.tuneles, tunelNuevo()] })}>
              {tx.anadirTunel}
            </button>
          </div>
        </div>
      </div>
    </details>
  )
}
