// =============================================================================
// DialogoImportarOpenSsh: la revisión de un archivo de OpenSSH con varios `Host` antes de darlos de alta.
// Una fila por `Host` (casilla, nombre y usuario editables, destino y, debajo, la credencial con su método:
// contraseña, archivo de clave o claves del sistema, y el grupo al que va, con «Nuevo grupo…»), un atajo para
// poner el mismo grupo a las marcadas y «Importar N». Una fila desmarcada solo se puede marcar. Las altas van una a una por `crear`: las que fallan se quedan con su error y las demás
// salen de la lista. Lo puro (filas, problemas, altas) vive en `importacionOpenSsh.ts`.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================

import '../../comun/formularioModal.css'
import './conexionesSsh.css'
import { createElement, useId, useState } from 'react'
import { notify } from '../../comun/notifications'
import { PromptDialog } from '../../comun/PromptDialog'
import { IconoCarpetaNueva } from '../../comun/iconosMenu'
import { useDialogo } from '../../comun/useDialogo'
import type { SshGrupo, SshLecturaOpenSsh } from '../../../../shared/ssh-ipc'
import { METODOS_OFRECIDOS } from './borradorSsh'
import { OPCIONES_METODO, ayudaDeMetodo } from './CamposConexionSsh'
import { mensajeDeErrorSsh } from './erroresSsh'
import { IconoArchivoClave } from './iconosSsh'
import {
  conGrupoEnMarcadas,
  conMarca,
  entradaDeFila,
  filasIniciales,
  grupoComun,
  grupoVigente,
  problemaDeFila,
  resumenImportacion,
  textoNoSeImporta,
  tituloImportadas,
  type FilaImportacion
} from './importacionOpenSsh'
import { compararNombres } from './listaSsh'
import { accionesSsh, datosDePerfil, useStoreSsh } from './store'

export interface PropsDialogoImportarOpenSsh {
  perfilId: string
  lectura: SshLecturaOpenSsh
  onCerrar: () => void
}

type CambiarFila = (c: Partial<FilaImportacion>) => void

/** El método de una fila: tres iconos con un clic (su nombre al pasar por encima y para los lectores de pantalla). */
function MetodoFila({ f, ocupado, onCambiar }: { f: FilaImportacion; ocupado: boolean; onCambiar: CambiarFila }): React.JSX.Element {
  return (
    <div className="ssh-importar-metodos" role="radiogroup" aria-label={`Autenticación de ${f.alias || f.candidata.alias}`}>
      {METODOS_OFRECIDOS.map((m) => {
        const o = OPCIONES_METODO[m]
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={f.metodo === m}
            aria-label={o.etiqueta}
            title={o.etiqueta}
            className={`ssh-importar-metodo${f.metodo === m ? ' elegido' : ''}`}
            disabled={ocupado}
            // Otro método, otro secreto: la contraseña no es la frase de una clave.
            onClick={() => f.metodo !== m && onCambiar({ metodo: m, secreto: '', error: null })}
          >
            <o.icono />
          </button>
        )
      })}
    </div>
  )
}

/** Lo que pide el método de una fila: la contraseña, el archivo de clave (y su frase si la tiene) o nada. */
function CredencialFila({ f, perfilId, ocupado, onCambiar }: { f: FilaImportacion; perfilId: string; ocupado: boolean; onCambiar: CambiarFila }): React.JSX.Element {
  const secreto = (etiqueta: string): React.JSX.Element => (
    <input
      type="password"
      aria-label={`${etiqueta} de ${f.alias || f.candidata.alias}`}
      className="ssh-importar-secreto"
      placeholder={`${etiqueta} (vacía: la pedirá la terminal)`}
      autoComplete="new-password"
      value={f.secreto}
      disabled={ocupado}
      onChange={(e) => onCambiar({ secreto: e.target.value, error: null })}
    />
  )
  if (f.metodo === 'contrasena') return secreto('Contraseña')
  if (f.metodo === 'sistema') return <span className="ssh-importar-ayuda">{ayudaDeMetodo('sistema')}</span>
  const elegir = async (): Promise<void> => {
    try {
      const c = await window.tessera.ssh.elegirClave({ profileId: perfilId })
      if (c) onCambiar({ clave: c, secreto: '', error: null })
    } catch (err) {
      onCambiar({ error: mensajeDeErrorSsh(err) })
    }
  }
  return (
    <>
      <button type="button" className="btn ssh-importar-archivo" disabled={ocupado} title={f.clave ? 'Elegir otro archivo de clave' : 'Elegir el archivo de clave'} onClick={() => void elegir()}>
        <IconoArchivoClave />
        <span>{f.clave ? f.clave.nombre : 'Elegir archivo…'}</span>
      </button>
      {f.clave?.cifrada && secreto('Frase')}
    </>
  )
}

/** El valor de la opción «Nuevo grupo…» de un selector: no choca con una id, que es un UUID. */
const OPCION_NUEVO = '__nuevo__'
/** El valor de «Varios grupos», que solo se enseña cuando las filas no comparten grupo. */
const OPCION_VARIOS = '__varios__'

interface PropsSelectorGrupo {
  grupos: readonly SshGrupo[]
  /** El grupo elegido: `null` = «Sin grupo»; `undefined` = varios. */
  valor: string | null | undefined
  etiqueta: string
  disabled?: boolean
  className?: string
  onElegir: (id: string | null) => void
  /** Si se da, el selector ofrece «Nuevo grupo…» al final. */
  onNuevo?: () => void
}

/** Un selector de grupo: «Sin grupo», los del perfil y, si se pide, «Nuevo grupo…». */
function SelectorGrupo({ grupos, valor, etiqueta, disabled, className, onElegir, onNuevo }: PropsSelectorGrupo): React.JSX.Element {
  return (
    <select
      aria-label={etiqueta}
      className={className}
      disabled={disabled}
      value={valor === undefined ? OPCION_VARIOS : (valor ?? '')}
      onChange={(e) => {
        const v = e.target.value
        if (v === OPCION_NUEVO) onNuevo?.()
        else if (v !== OPCION_VARIOS) onElegir(v === '' ? null : v)
      }}
    >
      {/* Botón propio con lo elegido dentro: así un nombre largo se recorta con «…» y la flecha sigue a la vista. */}
      <button type="button" className="ssh-selector-grupo-boton">
        {createElement('selectedcontent')}
      </button>
      {valor === undefined && (
        <option value={OPCION_VARIOS} disabled hidden>
          Varios grupos
        </option>
      )}
      <option value="">Sin grupo</option>
      {grupos.map((g) => (
        <option key={g.id} value={g.id}>
          {g.nombre}
        </option>
      ))}
      {onNuevo && <option value={OPCION_NUEVO}>Nuevo grupo…</option>}
    </select>
  )
}

interface PropsFilaRevision {
  f: FilaImportacion
  problema: string | null
  perfilId: string
  ocupado: boolean
  grupos: readonly SshGrupo[]
  /** El grupo de la fila si aún existe. */
  grupoId: string | null
  onCambiar: CambiarFila
  /** Marcar o desmarcar: también le pone o le quita el grupo (`conMarca`). */
  onMarcar: (elegida: boolean) => void
  onNuevoGrupo: () => void
}

/** Una fila de la revisión: nombre, usuario y destino; debajo, la credencial, su método y el grupo al que va. */
function FilaRevision({ f, problema, perfilId, ocupado, grupos, grupoId, onCambiar, onMarcar, onNuevoGrupo }: PropsFilaRevision): React.JSX.Element {
  const destino = `${f.candidata.host}:${f.candidata.puerto ?? '?'}`
  const error = f.error ?? (f.elegida ? problema : null)
  // Desmarcada no se importa: solo se puede marcar, para que nada haga creer que se guardará.
  const bloqueada = ocupado || !f.elegida
  return (
    <li className={`ssh-importar-fila${f.elegida ? '' : ' descartada'}`}>
      <input type="checkbox" aria-label={`Importar ${f.alias || f.candidata.alias}`} checked={f.elegida} disabled={ocupado} onChange={(e) => onMarcar(e.target.checked)} />
      <div className="ssh-importar-datos">
        <div className="ssh-importar-campos">
          <input aria-label="Nombre" className="ssh-importar-nombre" value={f.alias} disabled={bloqueada} aria-invalid={error !== null} onChange={(e) => onCambiar({ alias: e.target.value, error: null })} />
          <input aria-label="Usuario" className="ssh-importar-usuario" placeholder="usuario" value={f.usuario} disabled={bloqueada} onChange={(e) => onCambiar({ usuario: e.target.value, error: null })} />
          <span className="ssh-importar-destino" title={destino}>
            @{destino}
          </span>
        </div>
        <div className="ssh-importar-credencial">
          <CredencialFila f={f} perfilId={perfilId} ocupado={bloqueada} onCambiar={onCambiar} />
          <MetodoFila f={f} ocupado={bloqueada} onCambiar={onCambiar} />
          <SelectorGrupo
            grupos={grupos}
            valor={grupoId}
            etiqueta={`Grupo de ${f.alias || f.candidata.alias}`}
            className="ssh-importar-grupo"
            disabled={bloqueada}
            onElegir={(id) => onCambiar({ grupoId: id, error: null })}
            onNuevo={onNuevoGrupo}
          />
        </div>
        {f.candidata.claveNoUsable && f.metodo !== 'clave' && <div className="ssh-importar-ayuda">El archivo de clave que traía el config no se pudo usar.</div>}
        {error !== null && (
          <div className="ssh-importar-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * El atajo de arriba: un grupo para las filas marcadas, con «Nuevo grupo…» al lado. Enseña «Varios grupos» si no
 * lo comparten, y sin ninguna marcada no hay a qué ponérselo.
 */
function CampoGrupoMarcadas({ grupos, valor, desactivado, onElegir, onNuevo }: { grupos: readonly SshGrupo[]; valor: string | null | undefined; desactivado: boolean; onElegir: (id: string | null) => void; onNuevo: () => void }): React.JSX.Element {
  return (
    <div className="dbc-fila ssh-fila-grupo-campo">
      <label className="dbc-campo dbc-crece">
        <span className="dbc-etiqueta">Poner las marcadas en el grupo</span>
        <SelectorGrupo grupos={grupos} valor={valor} etiqueta="Poner las marcadas en el grupo" disabled={desactivado} onElegir={onElegir} />
      </label>
      <button type="button" className="btn btn-icon ssh-grupo-nuevo" onClick={onNuevo} disabled={desactivado} title="Nuevo grupo para las marcadas…" aria-label="Nuevo grupo para las marcadas…">
        <IconoCarpetaNueva />
      </button>
    </div>
  )
}

/**
 * Da de alta las filas elegidas una a una, cada una en su grupo (o en «Sin grupo» si el suyo se borró mientras
 * se revisaba); devuelve las filas que quedan (las que fallaron, con su error) y el grupo de cada importada.
 */
async function importarFilas(filas: readonly FilaImportacion[], perfilId: string, vigentes: ReadonlySet<string>): Promise<{ restantes: FilaImportacion[]; grupos: (string | null)[] }> {
  const restantes: FilaImportacion[] = []
  const grupos: (string | null)[] = []
  for (const f of filas) {
    if (!f.elegida) {
      restantes.push(f)
      continue
    }
    const grupoId = grupoVigente(f, vigentes)
    try {
      await window.tessera.ssh.crear(entradaDeFila({ ...f, grupoId }, perfilId))
      grupos.push(grupoId)
    } catch (err) {
      restantes.push({ ...f, error: mensajeDeErrorSsh(err) })
    }
  }
  return { restantes, grupos }
}

/** A quién va el grupo que se crea con «Nuevo grupo…»: a las marcadas o a la fila de ese índice. */
type DestinoGrupoNuevo = 'marcadas' | number

/** Los grupos del perfil más los creados aquí («Nuevo grupo…»), que el store aún puede no traer, y el diálogo para crear uno. */
function useGruposImportacion(perfilId: string) {
  const delPerfil = useStoreSsh((s) => datosDePerfil(s, perfilId).grupos)
  const [creados, setCreados] = useState<SshGrupo[]>([])
  const [nuevo, setNuevo] = useState<{ para: DestinoGrupoNuevo; error: string | null } | null>(null)
  const grupos = [...delPerfil, ...creados.filter((g) => !delPerfil.some((x) => x.id === g.id))].sort((a, b) => compararNombres(a.nombre, b.nombre))
  /** Crea el grupo y se lo da a quien lo pidió. */
  const crear = async (nombre: string, asignar: (para: DestinoGrupoNuevo, id: string) => void): Promise<void> => {
    if (nuevo === null) return
    try {
      const g = await window.tessera.ssh.crearGrupo({ profileId: perfilId, nombre })
      setCreados((cs) => [...cs, g])
      asignar(nuevo.para, g.id)
      setNuevo(null)
    } catch (err) {
      setNuevo({ para: nuevo.para, error: mensajeDeErrorSsh(err) })
    }
  }
  return { grupos, nuevo, abrirNuevo: (para: DestinoGrupoNuevo) => setNuevo({ para, error: null }), cerrarNuevo: () => setNuevo(null), crear }
}

/** El nombre del grupo nuevo, encima de la revisión: el título dice a quién irá. */
function DialogoGrupoNuevo({ para, error, filas, onCrear, onCancelar }: { para: DestinoGrupoNuevo; error: string | null; filas: readonly FilaImportacion[]; onCrear: (nombre: string) => void; onCancelar: () => void }): React.JSX.Element {
  const fila = para === 'marcadas' ? undefined : filas[para]
  return (
    <div className="ssh-dialogo-anidado" onMouseDown={(e) => e.stopPropagation()}>
      <PromptDialog
        title={fila ? `Nuevo grupo para «${fila.alias || fila.candidata.alias}»` : 'Nuevo grupo para las marcadas'}
        label="Nombre del grupo"
        confirmLabel="Crear"
        error={error}
        onConfirm={onCrear}
        onCancel={onCancelar}
      />
    </div>
  )
}

/** Las filas, lo que se puede importar y el alta: al acabar sin fallos se cierra; con fallos quedan sus filas. */
function useFilasImportacion(perfilId: string, lectura: SshLecturaOpenSsh, grupos: readonly SshGrupo[]) {
  const existentes = useStoreSsh((s) => datosDePerfil(s, perfilId).conexiones).map((c) => c.alias)
  const [filas, setFilas] = useState(() => filasIniciales(lectura))
  const [ocupado, setOcupado] = useState(false)
  const { elegidas, listo } = resumenImportacion(filas, existentes)
  const vigentes = new Set(grupos.map((g) => g.id))
  const importar = async (): Promise<void> => {
    if (!listo || ocupado) return
    setOcupado(true)
    const hechas = await importarFilas(filas, perfilId, vigentes)
    setOcupado(false)
    if (hechas.grupos.length > 0) notify('success', tituloImportadas(hechas.grupos.map((id) => grupos.find((g) => g.id === id)?.nombre ?? null)))
    if (hechas.restantes.some((f) => f.elegida)) setFilas(hechas.restantes)
    else accionesSsh.cerrarDialogo()
  }
  const cambiar = (i: number, c: Partial<FilaImportacion>): void => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...c } : f)))
  const ponerGrupo = (para: DestinoGrupoNuevo, id: string | null): void => (para === 'marcadas' ? setFilas((fs) => conGrupoEnMarcadas(fs, id)) : cambiar(para, { grupoId: id, error: null }))
  const comun = grupoComun(filas.map((f) => ({ ...f, grupoId: grupoVigente(f, vigentes) })))
  const marcar = (i: number, elegida: boolean): void => setFilas((fs) => conMarca(fs, i, elegida))
  return { filas, existentes, elegidas, listo, ocupado, importar, cambiar, marcar, ponerGrupo, vigentes, comun }
}

export function DialogoImportarOpenSsh({ perfilId, lectura, onCerrar }: PropsDialogoImportarOpenSsh): React.JSX.Element {
  const idTitulo = useId()
  const g = useGruposImportacion(perfilId)
  const r = useFilasImportacion(perfilId, lectura, g.grupos)
  const { filas, existentes, elegidas, listo, ocupado } = r
  const dialogo = useDialogo({ onClose: onCerrar, cerrable: !ocupado })
  return (
    <div className="modal-overlay" role="presentation">
      <div ref={dialogo.ref} className="modal-card db-conexion-modal ssh-conexion-modal ssh-importar-modal" role="dialog" aria-modal="true" aria-labelledby={idTitulo} onKeyDown={dialogo.alPulsarTecla}>
        <form
          className="dbc-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void r.importar()
          }}
        >
          <div className="dbc-cabecera">
            <div id={idTitulo} className="modal-title">
              Importar desde OpenSSH
            </div>
            <p className="dbc-ayuda">
              {lectura.candidatas.length} conexiones en «{lectura.archivo}». Elige cuáles importar, cómo se llaman y cómo entran: lo que escribas aquí se guarda cifrado y quedan listas para conectar.
            </p>
          </div>
          <div className="dbc-cuerpo">
            <CampoGrupoMarcadas grupos={g.grupos} valor={r.comun} desactivado={ocupado || elegidas === 0} onElegir={(id) => r.ponerGrupo('marcadas', id)} onNuevo={() => g.abrirNuevo('marcadas')} />
            <ul className="ssh-importar-lista" aria-label="Conexiones del archivo">
              {filas.map((f, i) => (
                <FilaRevision
                  key={`${f.candidata.alias}-${i}`}
                  f={f}
                  problema={problemaDeFila(f, filas, existentes)}
                  perfilId={perfilId}
                  ocupado={ocupado}
                  grupos={g.grupos}
                  grupoId={grupoVigente(f, r.vigentes)}
                  onCambiar={(c) => r.cambiar(i, c)}
                  onMarcar={(elegida) => r.marcar(i, elegida)}
                  onNuevoGrupo={() => g.abrirNuevo(i)}
                />
              ))}
            </ul>
            {textoNoSeImporta(lectura) !== null && <p className="dbc-ayuda">{textoNoSeImporta(lectura)}</p>}
          </div>
          <div className="modal-actions dbc-acciones">
            <span className="dbc-hueco" />
            <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={ocupado}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={!listo || ocupado}>
              {ocupado ? 'Importando…' : elegidas === 1 ? 'Importar 1 conexión' : `Importar ${elegidas} conexiones`}
            </button>
          </div>
        </form>
      </div>
      {g.nuevo !== null && <DialogoGrupoNuevo para={g.nuevo.para} error={g.nuevo.error} filas={filas} onCrear={(nombre) => void g.crear(nombre, r.ponerGrupo)} onCancelar={g.cerrarNuevo} />}
    </div>
  )
}
