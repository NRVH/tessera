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

type Editar = (cambio: Partial<BorradorConexion>) => void

const AYUDAS: Record<ModoRedis, string> = {
  servidor: '',
  sentinel:
    'En Host van los sentinels separados por comas (sentinel1:26379, sentinel2:26379); el puerto de al lado vale para los que no lo digan. ' +
    'Tessera les pregunta por el maestro y, tras un failover, vuelve a preguntar.',
  cluster: 'En Host van uno o varios nodos separados por comas (nodo1:6379, nodo2:6379); el resto del cluster se descubre. En Cluster solo existe la base 0.'
}

const MODOS: readonly { valor: ModoRedis; etiqueta: string }[] = [
  { valor: 'servidor', etiqueta: 'Un servidor' },
  { valor: 'sentinel', etiqueta: 'Sentinel (maestro y réplicas)' },
  { valor: 'cluster', etiqueta: 'Cluster' }
]

const CLAVES: readonly { valor: DbClaveSentinel; etiqueta: string }[] = [
  { valor: 'ninguna', etiqueta: 'Ninguna' },
  { valor: 'misma', etiqueta: 'La misma de la conexión' },
  { valor: 'propia', etiqueta: 'Otra' }
]

const esModo = (v: string): v is ModoRedis => MODOS.some((m) => m.valor === v)
const esClave = (v: string): v is DbClaveSentinel => CLAVES.some((c) => c.valor === v)

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
  const ayuda = AYUDAS[borrador.modoRedis]
  return (
    <>
      <div className="dbc-fila">
        <label className="dbc-campo dbc-crece">
          <span className="dbc-etiqueta">Conexión a</span>
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
            {MODOS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </label>
        {sentinel && (
          <label className="dbc-campo dbc-sid">
            <span className="dbc-etiqueta">Maestro</span>
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
  return (
    <div className="dbc-fila">
      <label className="dbc-campo dbc-crece">
        <span className="dbc-etiqueta">Contraseña de los sentinels</span>
        <select
          value={borrador.claveSentinel}
          onChange={(e) => {
            const v = e.target.value
            if (esClave(v)) editar({ claveSentinel: v })
          }}
        >
          {CLAVES.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.etiqueta}
            </option>
          ))}
        </select>
      </label>
      {borrador.claveSentinel === 'propia' && (
        <label className="dbc-campo dbc-crece">
          <span className="dbc-etiqueta">La de los sentinels</span>
          <input
            type="password"
            value={borrador.passwordSentinel ?? ''}
            placeholder={borrador.id !== undefined ? '(sin cambios)' : ''}
            autoComplete="new-password"
            onChange={(e) => editar({ passwordSentinel: e.target.value })}
            onPaste={pegarRecortado((v) => editar({ passwordSentinel: v }))}
          />
        </label>
      )}
    </div>
  )
}
