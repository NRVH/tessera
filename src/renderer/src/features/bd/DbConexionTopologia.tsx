// =============================================================================
// Redis a un servidor, a Sentinel o a Cluster en el diálogo de conexión: el selector con el maestro de
// Sentinel (encima del destino) y la contraseña de los sentinels (tras las credenciales). Solo en los
// motores que declaran 'topologiaRedis'; la lógica es de `borradorConexion` y `camposConexion`.
// Decisiones: docs/decisiones/bd/redis-sentinel-y-cluster.md
// =============================================================================
import type { DbClaveSentinel } from '../../../../shared/db-ipc'
import { descriptor, usaOpcional } from '../../../../shared/motores/index'
import { conModoRedis, type BorradorConexion, type ModoRedis } from './borradorConexion'
import { avisoTopologiaRedis } from './camposConexion'
import { pegarRecortado } from '../../util/pasteTrim'
import { txConexionDialogo } from './textosConexionDialogo.ts'

type Editar = (cambio: Partial<BorradorConexion>) => void

function ayudas(): Record<ModoRedis, string> {
  const t = txConexionDialogo()
  return { servidor: '', sentinel: t.ayudaSentinel, cluster: t.ayudaCluster }
}

function modos(): readonly { valor: ModoRedis; etiqueta: string }[] {
  const t = txConexionDialogo()
  return [
    { valor: 'servidor', etiqueta: t.modoServidor },
    { valor: 'sentinel', etiqueta: t.modoSentinel },
    { valor: 'cluster', etiqueta: t.modoCluster }
  ]
}

function claves(): readonly { valor: DbClaveSentinel; etiqueta: string }[] {
  const t = txConexionDialogo()
  return [
    { valor: 'ninguna', etiqueta: t.claveNinguna },
    { valor: 'misma', etiqueta: t.claveMisma },
    { valor: 'propia', etiqueta: t.clavePropia }
  ]
}

const esModo = (v: string): v is ModoRedis => modos().some((m) => m.valor === v)
const esClave = (v: string): v is DbClaveSentinel => claves().some((c) => c.valor === v)

/** ¿Pinta el motor del borrador la topología de Redis? */
function conTopologia(b: BorradorConexion): boolean {
  return usaOpcional(descriptor(b.motor), 'topologiaRedis')
}

/** «Conexión a» (un servidor, Sentinel o Cluster) y, con Sentinel, el maestro; con su ayuda y su aviso en vivo. */
export function SelectorTopologiaRedis({
  borrador,
  invalido,
  editar,
  setBorrador
}: {
  borrador: BorradorConexion
  invalido: boolean
  editar: Editar
  setBorrador: React.Dispatch<React.SetStateAction<BorradorConexion>>
}): React.JSX.Element | null {
  if (!conTopologia(borrador)) return null
  const sentinel = borrador.modoRedis === 'sentinel'
  const aviso = avisoTopologiaRedis(borrador)
  const ayuda = ayudas()[borrador.modoRedis]
  const t = txConexionDialogo()
  return (
    <>
      <div className="dbc-fila">
        <label className="dbc-campo dbc-crece">
          <span className="dbc-etiqueta">{t.conexionA}</span>
          <select
            // El foco del «falta» va al maestro cuando lo hay: es lo que se puede corregir.
            data-campo={sentinel ? undefined : 'topologiaRedis'}
            aria-invalid={(!sentinel && invalido) || undefined}
            value={borrador.modoRedis}
            onChange={(e) => {
              const v = e.target.value
              if (esModo(v)) setBorrador((b) => conModoRedis(b, v))
            }}
          >
            {modos().map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </label>
        {sentinel && (
          <label className="dbc-campo dbc-sid">
            <span className="dbc-etiqueta">{t.maestro}</span>
            <input
              data-campo="topologiaRedis"
              aria-invalid={invalido || undefined}
              value={borrador.maestroSentinel}
              placeholder="mymaster"
              spellCheck={false}
              onChange={(e) => editar({ maestroSentinel: e.target.value })}
              onPaste={pegarRecortado((v) => editar({ maestroSentinel: v }))}
            />
          </label>
        )}
      </div>
      {ayuda !== '' && <p className="dbc-ayuda">{ayuda}</p>}
      {aviso !== null && (
        <p className="dbc-error" role="status">
          {aviso}
        </p>
      )}
    </>
  )
}

/** Con Sentinel: qué contraseña llevan los sentinels y, si es otra, cuál. */
export function ClaveSentinels({ borrador, editar }: { borrador: BorradorConexion; editar: Editar }): React.JSX.Element | null {
  if (!conTopologia(borrador) || borrador.modoRedis !== 'sentinel') return null
  const t = txConexionDialogo()
  return (
    <div className="dbc-fila">
      <label className="dbc-campo dbc-crece">
        <span className="dbc-etiqueta">{t.contrasenaSentinels}</span>
        <select
          value={borrador.claveSentinel}
          onChange={(e) => {
            const v = e.target.value
            if (esClave(v)) editar({ claveSentinel: v })
          }}
        >
          {claves().map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.etiqueta}
            </option>
          ))}
        </select>
      </label>
      {borrador.claveSentinel === 'propia' && (
        <label className="dbc-campo dbc-crece">
          <span className="dbc-etiqueta">{t.laDeLosSentinels}</span>
          <input
            type="password"
            value={borrador.passwordSentinel ?? ''}
            placeholder={borrador.id !== undefined ? t.sinCambios : ''}
            autoComplete="new-password"
            onChange={(e) => editar({ passwordSentinel: e.target.value })}
            onPaste={pegarRecortado((v) => editar({ passwordSentinel: v }))}
          />
        </label>
      )}
    </div>
  )
}
