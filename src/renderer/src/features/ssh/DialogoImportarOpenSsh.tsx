// =============================================================================
// DialogoImportarOpenSsh: la revisión de un archivo de OpenSSH con varios `Host` antes de darlos de alta.
// Una fila por `Host` (casilla, nombre y usuario editables, destino y, debajo, la credencial con su método:
// contraseña, archivo de clave o claves del sistema), un grupo para todas y
// «Importar N». Las altas van una a una por `crear`: las que fallan se quedan con su error y las demás
// salen de la lista. Lo puro (filas, problemas, altas) vive en `importacionOpenSsh.ts`.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================

import '../../comun/formularioModal.css'
import './conexionesSsh.css'
import { useId, useState } from 'react'
import { notify } from '../../comun/notifications'
import { PromptDialog } from '../../comun/PromptDialog'
import { IconoCarpetaNueva } from '../../comun/iconosMenu'
import { useDialogo } from '../../comun/useDialogo'
import type { SshGrupo, SshLecturaOpenSsh } from '../../../../shared/ssh-ipc'
import { METODOS_OFRECIDOS } from './borradorSsh'
import { OPCIONES_METODO, ayudaDeMetodo } from './CamposConexionSsh'
import { mensajeDeErrorSsh } from './erroresSsh'
import { IconoArchivoClave } from './iconosSsh'
import { entradaDeFila, filasIniciales, problemaDeFila, resumenImportacion, textoNoSeImporta, tituloImportadas, type FilaImportacion } from './importacionOpenSsh'
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

/** Una fila de la revisión: nombre, usuario y destino; debajo, la credencial y su método. */
function FilaRevision({ f, problema, perfilId, ocupado, onCambiar }: { f: FilaImportacion; problema: string | null; perfilId: string; ocupado: boolean; onCambiar: CambiarFila }): React.JSX.Element {
  const destino = `${f.candidata.host}:${f.candidata.puerto ?? '?'}`
  const error = f.error ?? (f.elegida ? problema : null)
  return (
    <li className={`ssh-importar-fila${f.elegida ? '' : ' descartada'}`}>
      <input type="checkbox" aria-label={`Importar ${f.alias || f.candidata.alias}`} checked={f.elegida} disabled={ocupado} onChange={(e) => onCambiar({ elegida: e.target.checked, error: null })} />
      <div className="ssh-importar-datos">
        <div className="ssh-importar-campos">
          <input aria-label="Nombre" className="ssh-importar-nombre" value={f.alias} disabled={ocupado} aria-invalid={error !== null} onChange={(e) => onCambiar({ alias: e.target.value, error: null })} />
          <input aria-label="Usuario" className="ssh-importar-usuario" placeholder="usuario" value={f.usuario} disabled={ocupado} onChange={(e) => onCambiar({ usuario: e.target.value, error: null })} />
          <span className="ssh-importar-destino" title={destino}>
            @{destino}
          </span>
        </div>
        <div className="ssh-importar-credencial">
          <CredencialFila f={f} perfilId={perfilId} ocupado={ocupado} onCambiar={onCambiar} />
          <MetodoFila f={f} ocupado={ocupado} onCambiar={onCambiar} />
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

/** El grupo para todas, con «Nuevo grupo…» al lado. */
function CampoGrupoImportacion({ grupos, grupoId, onElegir, onNuevo }: { grupos: readonly SshGrupo[]; grupoId: string | null; onElegir: (id: string | null) => void; onNuevo: () => void }): React.JSX.Element {
  return (
    <div className="dbc-fila ssh-fila-grupo-campo">
      <label className="dbc-campo dbc-crece">
        <span className="dbc-etiqueta">Grupo para las importadas</span>
        <select value={grupoId ?? ''} onChange={(e) => onElegir(e.target.value === '' ? null : e.target.value)}>
          <option value="">Sin grupo</option>
          {grupos.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nombre}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn-icon ssh-grupo-nuevo" onClick={onNuevo} title="Nuevo grupo…" aria-label="Nuevo grupo…">
        <IconoCarpetaNueva />
      </button>
    </div>
  )
}

/** Da de alta las filas elegidas una a una; devuelve las filas que quedan (las que fallaron, con su error). */
async function importarFilas(filas: readonly FilaImportacion[], perfilId: string, grupoId: string | null): Promise<{ restantes: FilaImportacion[]; hechas: number }> {
  const restantes: FilaImportacion[] = []
  let hechas = 0
  for (const f of filas) {
    if (!f.elegida) {
      restantes.push(f)
      continue
    }
    try {
      await window.tessera.ssh.crear(entradaDeFila(f, perfilId, grupoId))
      hechas++
    } catch (err) {
      restantes.push({ ...f, error: mensajeDeErrorSsh(err) })
    }
  }
  return { restantes, hechas }
}

/** El grupo elegido para todas y los creados aquí («Nuevo grupo…»), que el store aún puede no traer. */
function useGrupoImportacion(perfilId: string) {
  const delPerfil = useStoreSsh((s) => datosDePerfil(s, perfilId).grupos)
  const [grupoId, setGrupoId] = useState<string | null>(null)
  const [creados, setCreados] = useState<SshGrupo[]>([])
  const [nuevo, setNuevo] = useState<{ abierto: boolean; error: string | null }>({ abierto: false, error: null })
  const grupos = [...delPerfil, ...creados.filter((g) => !delPerfil.some((x) => x.id === g.id))].sort((a, b) => compararNombres(a.nombre, b.nombre))
  const crear = async (nombre: string): Promise<void> => {
    try {
      const g = await window.tessera.ssh.crearGrupo({ profileId: perfilId, nombre })
      setCreados((cs) => [...cs, g])
      setGrupoId(g.id)
      setNuevo({ abierto: false, error: null })
    } catch (err) {
      setNuevo({ abierto: true, error: mensajeDeErrorSsh(err) })
    }
  }
  return { grupos, grupoId, setGrupoId, nuevo, abrirNuevo: () => setNuevo({ abierto: true, error: null }), cerrarNuevo: () => setNuevo({ abierto: false, error: null }), crear }
}

/** Las filas, lo que se puede importar y el alta: al acabar sin fallos se cierra; con fallos quedan sus filas. */
function useFilasImportacion(perfilId: string, lectura: SshLecturaOpenSsh, grupoId: string | null, nombreGrupo: string | null) {
  const existentes = useStoreSsh((s) => datosDePerfil(s, perfilId).conexiones).map((c) => c.alias)
  const [filas, setFilas] = useState(() => filasIniciales(lectura))
  const [ocupado, setOcupado] = useState(false)
  const { elegidas, listo } = resumenImportacion(filas, existentes)
  const importar = async (): Promise<void> => {
    if (!listo || ocupado) return
    setOcupado(true)
    const { restantes, hechas } = await importarFilas(filas, perfilId, grupoId)
    setOcupado(false)
    if (hechas > 0) notify('success', tituloImportadas(hechas, nombreGrupo))
    if (restantes.some((f) => f.elegida)) setFilas(restantes)
    else accionesSsh.cerrarDialogo()
  }
  const cambiar = (i: number, c: Partial<FilaImportacion>): void => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...c } : f)))
  return { filas, existentes, elegidas, listo, ocupado, importar, cambiar }
}

export function DialogoImportarOpenSsh({ perfilId, lectura, onCerrar }: PropsDialogoImportarOpenSsh): React.JSX.Element {
  const idTitulo = useId()
  const g = useGrupoImportacion(perfilId)
  const r = useFilasImportacion(perfilId, lectura, g.grupoId, g.grupos.find((x) => x.id === g.grupoId)?.nombre ?? null)
  const { filas, existentes, elegidas, listo, ocupado } = r
  const dialogo = useDialogo({ onClose: onCerrar, cerrable: !ocupado })
  const noSeImporta = textoNoSeImporta(lectura)
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
            <CampoGrupoImportacion grupos={g.grupos} grupoId={g.grupoId} onElegir={g.setGrupoId} onNuevo={g.abrirNuevo} />
            <ul className="ssh-importar-lista" aria-label="Conexiones del archivo">
              {filas.map((f, i) => (
                <FilaRevision key={`${f.candidata.alias}-${i}`} f={f} problema={problemaDeFila(f, filas, existentes)} perfilId={perfilId} ocupado={ocupado} onCambiar={(c) => r.cambiar(i, c)} />
              ))}
            </ul>
            {noSeImporta !== null && <p className="dbc-ayuda">{noSeImporta}</p>}
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
      {g.nuevo.abierto && (
        <div className="ssh-dialogo-anidado" onMouseDown={(e) => e.stopPropagation()}>
          <PromptDialog title="Nuevo grupo" label="Nombre del grupo" confirmLabel="Crear" error={g.nuevo.error} onConfirm={(nombre) => void g.crear(nombre)} onCancel={g.cerrarNuevo} />
        </div>
      )}
    </div>
  )
}
