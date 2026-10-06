// =============================================================================
// Las secciones fijas del diálogo de conexión, las que no dependen del descriptor del
// motor: cabecera, nombre y motor, «Pegar URI…», usuario y contraseña, la casilla de los
// agentes, el entorno, las notas, el resultado de «Probar» y los botones del pie.
// Cada una devuelve el mismo elemento (o fragmento) que pintaba el diálogo.
// Decisiones: docs/decisiones/bd/ui-conexion-dialogo.md
// =============================================================================

import { ALIAS_MAX, type DbMotor, type DbTestResult } from '../../../../shared/db-ipc'
import { cambiarMotor, type BorradorConexion } from './borradorConexion'
import {
  ayudaEntorno,
  ayudaSoloLectura,
  descriptorDe,
  entornoDeRadio,
  ETIQUETA_SOLO_LECTURA,
  MOTORES_CONEXION,
  OPCIONES_ENTORNO,
  proponeConfiarCertificado,
  valorRadioEntorno,
  type EsquemaUri
} from './camposConexion'
import { pegarRecortado } from '../../util/pasteTrim'
import { IconoMotor } from './iconosBd'
import { IconoOjo } from '../../comun/iconosFormulario'
import { uriCerrada, type EstadoUri } from './useConexionDialogoEstado'

type Editar = (parcial: Partial<BorradorConexion>) => void
type SetBorrador = React.Dispatch<React.SetStateAction<BorradorConexion>>

/** El título y, en un alta, la frase de para qué sirve el nombre. */
export function CabeceraConexion({ idTitulo, esEdicion }: { idTitulo: string; esEdicion: boolean }): React.JSX.Element {
  return (
    <div className="dbc-cabecera">
      <div id={idTitulo} className="modal-title">
        {esEdicion ? 'Editar conexión' : 'Nueva conexión'}
      </div>
      {!esEdicion && (
        <p className="dbc-ayuda">
          Llámala como quieras: el nombre es solo tuyo. El agente podrá explorarla con <code>tdb</code> sin
          que le dictes credenciales.
        </p>
      )}
    </div>
  )
}

/** Nombre y motor, en una fila. */
export function FilaNombreMotor({
  borrador,
  aliasInvalido,
  enfocarPassword,
  editar,
  setBorrador
}: {
  borrador: BorradorConexion
  aliasInvalido: true | undefined
  enfocarPassword: boolean
  editar: Editar
  setBorrador: SetBorrador
}): React.JSX.Element {
  return (
    <div className="dbc-fila">
      <label className="dbc-campo dbc-crece">
        <span className="dbc-etiqueta">
          Nombre <span className="dbc-ayuda-inline">(el que uses para referirte a ella)</span>
        </span>
        <input
          data-campo="alias"
          aria-invalid={aliasInvalido}
          value={borrador.alias}
          autoFocus={!enfocarPassword}
          maxLength={ALIAS_MAX}
          placeholder="DEV-VENTAS"
          spellCheck={false}
          onChange={(e) => editar({ alias: e.target.value })}
          onPaste={pegarRecortado((v) => editar({ alias: v }))}
        />
      </label>
      <label className="dbc-campo dbc-motor">
        <span className="dbc-etiqueta">Motor</span>
        {/* La marca del motor elegido va DENTRO de la caja del selector: un <option> no
            admite imágenes, y un conmutador de botones con logo no escala con los motores. */}
        <span className="dbc-motor-control">
          <span className="dbc-motor-logo" aria-hidden="true">
            <IconoMotor motor={borrador.motor} />
          </span>
          <select value={borrador.motor} onChange={(e) => setBorrador((b) => cambiarMotor(b, e.target.value as DbMotor))}>
            {MOTORES_CONEXION.map((m) => (
              <option key={m} value={m}>
                {descriptorDe(m).etiqueta}
              </option>
            ))}
          </select>
        </span>
      </label>
    </div>
  )
}

interface PropsUri {
  esquema: EsquemaUri
  uri: EstadoUri
  setUri: React.Dispatch<React.SetStateAction<EstadoUri>>
  botonRef: React.RefObject<HTMLButtonElement>
  aplicarUri: (texto: string) => void
}

/** El campo abierto: al pegar se rellena solo, «Rellenar» (o Intro) sirve para lo tecleado y Esc cierra el campo, no el diálogo. */
function uriAbierta({ esquema, uri, setUri, aplicarUri }: PropsUri): React.JSX.Element {
  return (
    <>
      <div className="dbc-fila">
        <label className="dbc-campo dbc-crece">
          <span className="dbc-etiqueta">URI de conexión</span>
          <span className="dbc-archivo dbc-uri">
            <input
              autoFocus
              aria-invalid={uri.error !== null || undefined}
              value={uri.texto}
              placeholder={esquema.ejemplo}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setUri((u) => ({ ...u, texto: e.target.value, error: null }))}
              onPaste={(e) => {
                const pegado = e.clipboardData.getData('text').trim()
                if (pegado === '') return
                e.preventDefault()
                aplicarUri(pegado)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  aplicarUri(uri.texto)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setUri(uriCerrada())
                }
              }}
            />
            <button type="button" className="btn" disabled={uri.texto.trim() === ''} onClick={() => aplicarUri(uri.texto)}>
              Rellenar
            </button>
            <button type="button" className="btn" onClick={() => setUri(uriCerrada())}>
              Cancelar
            </button>
          </span>
        </label>
      </div>
      {uri.error !== null ? (
        <p className="dbc-error" role="alert">
          {uri.error}
        </p>
      ) : (
        <p className="dbc-ayuda">{esquema.ayuda}</p>
      )}
    </>
  )
}

function botonUri({ uri, setUri, botonRef }: PropsUri): React.JSX.Element {
  return (
    <>
      <div className="dbc-fila">
        <button
          ref={botonRef}
          type="button"
          className="btn"
          onClick={() => setUri({ abierta: true, texto: '', error: null, aviso: null })}
        >
          Pegar URI…
        </button>
      </div>
      {uri.aviso !== null && <div className="dbc-aviso">{uri.aviso}</div>}
    </>
  )
}

/** «Pegar URI…», con un motor que lo declara (`uri`): un botón que abre el campo donde se pega. */
export function CampoUri(p: PropsUri): React.JSX.Element {
  return p.uri.abierta ? uriAbierta(p) : botonUri(p)
}

/** Usuario y contraseña (de solo escritura, con su ojo). */
export function CredencialesConexion({
  borrador,
  userInvalido,
  pista,
  enfocarPassword,
  verPassword,
  setVerPassword,
  editar
}: {
  borrador: BorradorConexion
  userInvalido: true | undefined
  pista: string | undefined
  enfocarPassword: boolean
  verPassword: boolean
  setVerPassword: React.Dispatch<React.SetStateAction<boolean>>
  editar: Editar
}): React.JSX.Element {
  return (
    <div className="dbc-fila">
      <label className="dbc-campo dbc-crece">
        <span className="dbc-etiqueta">Usuario</span>
        <input
          data-campo="user"
          aria-invalid={userInvalido}
          value={borrador.user}
          placeholder={pista}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => editar({ user: e.target.value })}
          onPaste={pegarRecortado((v) => editar({ user: v }))}
        />
      </label>
      <label className="dbc-campo dbc-crece">
        <span className="dbc-etiqueta">Contraseña</span>
        <span className="dbc-pass">
          <input
            type={verPassword ? 'text' : 'password'}
            autoFocus={enfocarPassword}
            value={borrador.password ?? ''}
            placeholder={borrador.id !== undefined ? '(sin cambios)' : (pista ?? '')}
            autoComplete="new-password"
            onChange={(e) => editar({ password: e.target.value })}
            onPaste={pegarRecortado((v) => editar({ password: v }))}
          />
          <button
            type="button"
            className="dbc-pass-ojo"
            title={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={verPassword}
            // tabIndex -1: al tabular por el formulario se salta el ojo y se
            // pasa al siguiente CAMPO, que es lo que se espera al rellenar.
            tabIndex={-1}
            onClick={() => setVerPassword((v) => !v)}
          >
            <IconoOjo tachado={verPassword} />
          </button>
        </span>
      </label>
    </div>
  )
}

/** «Solo lectura para los agentes» con su ayuda por motor. */
export function CasillaSoloLectura({ borrador, editar }: { borrador: BorradorConexion; editar: Editar }): React.JSX.Element {
  return (
    <>
      <label className="dbc-check">
        <input
          type="checkbox"
          checked={borrador.readonly}
          onChange={(e) => editar({ readonly: e.target.checked })}
        />
        {ETIQUETA_SOLO_LECTURA}
      </label>
      <p className="dbc-ayuda">{ayudaSoloLectura(borrador.motor)}</p>
    </>
  )
}

/** El entorno: radios nativos con aspecto de conmutador, y la ayuda de lo que cambia con lo elegido. */
export function SelectorEntorno({
  borrador,
  editar,
  nombreRadio,
  idAyuda
}: {
  borrador: BorradorConexion
  editar: Editar
  nombreRadio: string
  idAyuda: string
}): React.JSX.Element {
  return (
    <>
      <fieldset className="dbc-entorno" aria-describedby={idAyuda}>
        <legend className="dbc-etiqueta">Entorno</legend>
        <div className="dbc-entorno-opciones">
          {OPCIONES_ENTORNO.map((o) => {
            const valor = valorRadioEntorno(o.valor)
            return (
              <label key={valor || 'ninguno'} className={`dbc-entorno-opcion dbc-entorno-${o.valor ?? 'ninguno'}`}>
                <input
                  type="radio"
                  name={nombreRadio}
                  value={valor}
                  checked={borrador.entorno === o.valor}
                  onChange={(e) => editar({ entorno: entornoDeRadio(e.target.value) })}
                />
                <span className="dbc-entorno-punto" aria-hidden="true" />
                {o.etiqueta}
              </label>
            )
          })}
        </div>
      </fieldset>
      <p id={idAyuda} className="dbc-ayuda dbc-entorno-ayuda">
        {ayudaEntorno(borrador.entorno)}
      </p>
    </>
  )
}

/** Las notas de la conexión. */
export function CampoNotas({ borrador, editar }: { borrador: BorradorConexion; editar: Editar }): React.JSX.Element {
  return (
    <label className="dbc-campo">
      <span className="dbc-etiqueta">Notas</span>
      <textarea
        value={borrador.notas}
        rows={3}
        placeholder="Para qué es, quién la administra, qué no tocar…"
        onChange={(e) => editar({ notas: e.target.value })}
      />
    </label>
  )
}

/** El resultado de «Probar»: el mensaje CRUDO del servidor, el banner, los ms y, si aplica, «Confiar en el certificado y probar». */
export function ResultadoPrueba({
  probando,
  resultado,
  borrador,
  guardando,
  onConfiar
}: {
  probando: boolean
  resultado: DbTestResult | null
  borrador: BorradorConexion
  guardando: boolean
  onConfiar: () => void
}): React.JSX.Element {
  return (
    <div className={`dbc-prueba${probando ? '' : resultado?.ok ? ' ok' : ' falla'}`} role="status" aria-live="polite">
      {probando || !resultado ? (
        'Probando…'
      ) : (
        <>
          <div className="dbc-prueba-linea">
            <span aria-hidden="true">{resultado.ok ? '✓' : '✗'}</span>
            <span className="dbc-prueba-mensaje">{resultado.mensaje}</span>
            {resultado.ms !== undefined && <span className="dbc-prueba-ms">{resultado.ms} ms</span>}
          </div>
          {resultado.servidor && <div className="dbc-prueba-servidor">{resultado.servidor}</div>}
          {/* Un certificado que no se pudo verificar: la salida es un clic, no buscar la casilla. */}
          {proponeConfiarCertificado(borrador.motor, resultado, borrador.tls) && (
            <div className="dbc-driver-botones">
              <button type="button" className="btn" disabled={probando || guardando} onClick={onConfiar}>
                Confiar en el certificado y probar
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** El pie: «Probar» a la izquierda (actúa sobre el servidor), Cancelar y Guardar a la derecha. */
export function PieConexion({
  probando,
  guardando,
  cambios,
  onProbar,
  onCerrar
}: {
  probando: boolean
  guardando: boolean
  cambios: boolean
  onProbar: () => void
  onCerrar: () => void
}): React.JSX.Element {
  return (
    <div className="modal-actions dbc-acciones">
      <button type="button" className="btn" disabled={probando || guardando} onClick={onProbar}>
        {probando ? 'Probando…' : cambios ? 'Guardar y probar' : 'Probar'}
      </button>
      <span className="dbc-hueco" />
      <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>
        Cancelar
      </button>
      <button type="submit" className="btn primary" disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}
