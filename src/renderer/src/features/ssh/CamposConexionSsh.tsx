// =============================================================================
// Los campos del diálogo de una conexión SSH: cabecera, nombre, grupo (selector y «Nuevo grupo…»), host y
// puerto, usuario, el conmutador de autenticación, «Disponible para los agentes» y el pie con «Probar».
// Las clases `dbc-*` son las del formulario común (`comun/formularioModal.css`); el conmutador reutiliza
// las de «Entorno». Cada campo lleva `data-campo` para que el foco vaya al primero que falta.
// Presentación: el estado es de `useDialogoConexionSsh`.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/ssh/askpass-y-secretos.md,
// docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================

import { IconoCarpetaNueva } from '../../comun/iconosMenu'
import { pegarRecortado } from '../../util/pasteTrim'
import { nombresSistema } from '../../../../shared/nombresSistema'
import { SSH_ALIAS_MAX, type SshGrupo, type SshMetodo } from '../../../../shared/ssh-ipc'
import { METODOS_OFRECIDOS, type BorradorSsh, type CampoSsh } from './borradorSsh'
import { IconoArchivoClave, IconoClavesSistema, IconoContrasena, IconoImportar } from './iconosSsh'

type Editar = (parcial: Partial<BorradorSsh>) => void

/** `true` en un campo marcado, y `undefined` en el resto (así React no pinta `aria-invalid="false"`). */
function invalido(marcados: readonly CampoSsh[], campo: CampoSsh): true | undefined {
  return marcados.includes(campo) ? true : undefined
}

/** El título y, en un alta, para qué sirve. */
export function CabeceraConexionSsh({
  idTitulo,
  esEdicion,
  importar
}: {
  idTitulo: string
  esEdicion: boolean
  /** Solo en un alta: «Importar desde OpenSSH…», que cierra el formulario. Con algo escrito no se ofrece: se perdería. */
  importar?: { onImportar: () => void; conCambios: boolean; ocupado: boolean; leyendo: boolean }
}): React.JSX.Element {
  return (
    <div className="dbc-cabecera">
      <div className="ssh-cabecera-titulo">
        <div id={idTitulo} className="modal-title">
          {esEdicion ? 'Editar conexión SSH' : 'Nueva conexión SSH'}
        </div>
        {!esEdicion && importar && (
          <button
            type="button"
            className="btn ssh-importar-boton"
            disabled={importar.ocupado || importar.conCambios}
            title={importar.conCambios ? 'Vacía el formulario para importar: lo escrito se perdería' : 'Importa las conexiones de un archivo de configuración de OpenSSH'}
            onClick={importar.onImportar}
          >
            <IconoImportar />
            {importar.leyendo ? 'Leyendo…' : 'Importar desde OpenSSH…'}
          </button>
        )}
      </div>
      {!esEdicion && <p className="dbc-ayuda">Se guarda en este perfil y se abre en una pestaña de la terminal.</p>}
    </div>
  )
}

/** El nombre de la conexión: es solo del usuario y da nombre a la pestaña. */
export function CampoNombreSsh({ borrador, marcados, editar }: { borrador: BorradorSsh; marcados: readonly CampoSsh[]; editar: Editar }): React.JSX.Element {
  return (
    <label className="dbc-campo">
      <span className="dbc-etiqueta">
        Nombre <span className="dbc-ayuda-inline">(el de la pestaña)</span>
      </span>
      <input
        data-campo="alias"
        aria-invalid={invalido(marcados, 'alias')}
        value={borrador.alias}
        maxLength={SSH_ALIAS_MAX}
        placeholder="Cómo quieres llamarla"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => editar({ alias: e.target.value })}
        onPaste={pegarRecortado((v) => editar({ alias: v }))}
      />
    </label>
  )
}

/** El grupo: un selector nativo («Sin grupo» y los del perfil) y, a su lado, el botón de «Nuevo grupo…». */
export function CampoGrupoSsh({
  borrador,
  grupos,
  editar,
  onNuevoGrupo
}: {
  borrador: BorradorSsh
  grupos: readonly SshGrupo[]
  editar: Editar
  onNuevoGrupo: () => void
}): React.JSX.Element {
  return (
    <div className="dbc-fila ssh-fila-grupo-campo">
      <label className="dbc-campo dbc-crece">
        <span className="dbc-etiqueta">Grupo</span>
        <select data-campo="grupo" value={borrador.grupoId ?? ''} onChange={(e) => editar({ grupoId: e.target.value === '' ? null : e.target.value })}>
          <option value="">Sin grupo</option>
          {grupos.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nombre}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn-icon ssh-grupo-nuevo" onClick={onNuevoGrupo} title="Nuevo grupo…" aria-label="Nuevo grupo…">
        <IconoCarpetaNueva />
      </button>
    </div>
  )
}

/** Host y puerto, en una fila (el puerto, estrecho). */
export function FilaHostPuertoSsh({ borrador, marcados, editar }: { borrador: BorradorSsh; marcados: readonly CampoSsh[]; editar: Editar }): React.JSX.Element {
  return (
    <div className="dbc-fila">
      <label className="dbc-campo dbc-crece">
        <span className="dbc-etiqueta">Host</span>
        <input
          data-campo="host"
          aria-invalid={invalido(marcados, 'host')}
          value={borrador.host}
          placeholder="nombre del equipo o IP"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => editar({ host: e.target.value })}
          onPaste={pegarRecortado((v) => editar({ host: v }))}
        />
      </label>
      <label className="dbc-campo dbc-puerto">
        <span className="dbc-etiqueta">Puerto</span>
        <input
          data-campo="puerto"
          aria-invalid={invalido(marcados, 'puerto')}
          value={borrador.puerto}
          inputMode="numeric"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => editar({ puerto: e.target.value })}
          onPaste={pegarRecortado((v) => editar({ puerto: v }))}
        />
      </label>
    </div>
  )
}

/** El usuario con el que se entra. */
export function CampoUsuarioSsh({ borrador, marcados, editar }: { borrador: BorradorSsh; marcados: readonly CampoSsh[]; editar: Editar }): React.JSX.Element {
  return (
    <label className="dbc-campo">
      <span className="dbc-etiqueta">Usuario</span>
      <input
        data-campo="usuario"
        aria-invalid={invalido(marcados, 'usuario')}
        value={borrador.usuario}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => editar({ usuario: e.target.value })}
        onPaste={pegarRecortado((v) => editar({ usuario: v }))}
      />
    </label>
  )
}

/** Las opciones del conmutador; el orden lo da `METODOS_OFRECIDOS`. */
export const OPCIONES_METODO: Record<SshMetodo, { etiqueta: string; icono: () => React.JSX.Element }> = {
  contrasena: { etiqueta: 'Contraseña', icono: IconoContrasena },
  clave: { etiqueta: 'Archivo de clave', icono: IconoArchivoClave },
  sistema: { etiqueta: 'Claves del sistema', icono: IconoClavesSistema }
}

/** La ayuda de cada método; la de las claves nombra lo que hay detrás en el sistema de quien la lee. */
export function ayudaDeMetodo(metodo: SshMetodo): string {
  if (metodo === 'contrasena') return 'Tessera puede guardarla cifrada y darla sola al conectar.'
  if (metodo === 'sistema') return `Usa ${nombresSistema(window.tessera.plataforma).agenteClavesSsh} y las claves de tu carpeta .ssh`
  return 'Tessera guarda una copia protegida de la clave; el archivo original no se toca.'
}

/** La autenticación: radios nativos con aspecto de conmutador, y la ayuda de lo elegido. */
export function SelectorMetodoSsh({
  borrador,
  marcados,
  nombreRadio,
  idAyuda,
  editar
}: {
  borrador: BorradorSsh
  marcados: readonly CampoSsh[]
  nombreRadio: string
  idAyuda: string
  editar: Editar
}): React.JSX.Element {
  return (
    <>
      <fieldset className={`dbc-entorno ssh-autenticacion${invalido(marcados, 'metodo') ? ' invalido' : ''}`} aria-describedby={idAyuda}>
        <legend className="dbc-etiqueta">Autenticación</legend>
        <div className="dbc-entorno-opciones">
          {METODOS_OFRECIDOS.map((m, i) => {
            const o = OPCIONES_METODO[m]
            return (
              <label key={m} className="dbc-entorno-opcion">
                <input
                  type="radio"
                  name={nombreRadio}
                  value={m}
                  data-campo={i === 0 ? 'metodo' : undefined}
                  checked={borrador.metodo === m}
                  onChange={() => editar({ metodo: m })}
                />
                <span className="ssh-metodo-icono" aria-hidden="true">
                  <o.icono />
                </span>
                {o.etiqueta}
              </label>
            )
          })}
        </div>
      </fieldset>
      <p id={idAyuda} className="dbc-ayuda dbc-entorno-ayuda">
        {ayudaDeMetodo(borrador.metodo)}
      </p>
    </>
  )
}

/**
 * «Disponible para los agentes»: marcada al dar de alta. Desmarcada, `tssh` no la lista ni conecta con ella
 * (un contrato que cumple `tssh`, no un cerrojo: ver el ADR de `tssh`).
 */
export function CasillaAgentesSsh({ borrador, idAyuda, editar }: { borrador: BorradorSsh; idAyuda: string; editar: Editar }): React.JSX.Element {
  return (
    <div className="ssh-agentes">
      <label className="ssh-casilla">
        <input
          type="checkbox"
          data-campo="agentes"
          checked={borrador.disponibleAgentes}
          aria-describedby={idAyuda}
          onChange={(e) => editar({ disponibleAgentes: e.target.checked })}
        />
        Disponible para los agentes
      </label>
      <p id={idAyuda} className="dbc-ayuda">
        {borrador.disponibleAgentes
          ? 'Los agentes del perfil pueden usarla con tssh, sin ver la contraseña.'
          : 'Los agentes no la ven: tssh no la lista ni conecta con ella.'}
      </p>
    </div>
  )
}

/**
 * El pie: «Probar» a la izquierda (actúa sobre el servidor; con cambios, «Guardar y probar»), y Cancelar y
 * el primario a la derecha.
 */
export function PieConexionSsh({
  guardando,
  probando,
  etiquetaProbar,
  onProbar,
  onCerrar
}: {
  guardando: boolean
  probando: boolean
  etiquetaProbar: string
  onProbar: () => void
  onCerrar: () => void
}): React.JSX.Element {
  return (
    <div className="modal-actions dbc-acciones">
      <button type="button" className="btn" disabled={guardando || probando} onClick={onProbar}>
        {probando ? 'Probando…' : etiquetaProbar}
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
