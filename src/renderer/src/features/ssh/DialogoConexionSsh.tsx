// =============================================================================
// DialogoConexionSsh: alta y edición de una CONEXIÓN SSH del perfil, en un modal. Los campos son de
// `CamposConexionSsh` (y el secreto, de `CampoSecretoSsh`), el estado y las acciones de
// `useDialogoConexionSsh` y el borrador de `borradorSsh` (puro). Aquí quedan el modal, el orden del
// cuerpo, el resultado de «Probar» y los diálogos anidados («Nuevo grupo…» y la confirmación de olvidar
// la huella), cuyo Esc cierra solo a ellos (la pila de `useDialogo`) y cuyo velo no cierra a este.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

// El formulario común va ANTES que lo propio del diálogo: a igual especificidad gana la segunda.
import '../../comun/formularioModal.css'
import './conexionesSsh.css'
import { useRef, useState } from 'react'
import { ConfirmDialog } from '../../comun/ConfirmDialog'
import { PromptDialog } from '../../comun/PromptDialog'
import { etiquetaProbar, usaSecreto } from './borradorSsh'
import {
  CabeceraConexionSsh,
  CampoGrupoSsh,
  CasillaAgentesSsh,
  CampoNombreSsh,
  CampoUsuarioSsh,
  FilaHostPuertoSsh,
  PieConexionSsh,
  SelectorMetodoSsh
} from './CamposConexionSsh'
import { CampoClaveSsh } from './CampoClaveSsh'
import { CampoSecretoSsh } from './CampoSecretoSsh'
import { leerOpenSsh, seguirLectura } from './importacionSsh'
import { ResultadoPruebaSsh } from './ResultadoPruebaSsh'
import { useDialogoConexionSsh, type OpcionesDialogoConexionSsh, type VistaDialogoConexionSsh } from './useDialogoConexionSsh'

/** El diálogo anidado «Nuevo grupo…»: el error del main se enseña dentro de él, tal cual. */
function DialogoGrupoNuevo({ v }: { v: VistaDialogoConexionSsh }): React.JSX.Element {
  return (
    // El velo y la tarjeta de este diálogo son del anidado: su `mousedown` no sube al velo del de la conexión.
    <div className="ssh-dialogo-anidado" onMouseDown={(e) => e.stopPropagation()}>
      <PromptDialog
        title="Nuevo grupo"
        label="Nombre del grupo"
        confirmLabel="Crear"
        error={v.grupoNuevo.error}
        onConfirm={(nombre) => void v.crearGrupo(nombre)}
        onCancel={v.cerrarGrupoNuevo}
      />
    </div>
  )
}

/** La confirmación anidada de «Olvidar la huella guardada…»: acepta la que presente el servidor y vuelve a probar. */
function ConfirmarOlvidoHuella({ v }: { v: VistaDialogoConexionSsh }): React.JSX.Element {
  return (
    <div className="ssh-dialogo-anidado" onMouseDown={(e) => e.stopPropagation()}>
      <ConfirmDialog
        danger
        title="Olvidar la huella guardada"
        message={
          'La próxima conexión aceptará la huella que presente el servidor, sea la que sea.\n' +
          'Hazlo solo si sabes por qué cambió (lo reinstalaron, cambió de equipo…) o si la has comprobado por otra vía.'
        }
        confirmLabel="Olvidar y volver a probar"
        onConfirm={() => void v.olvidarHuellaYProbar()}
        onCancel={v.cancelarOlvidoHuella}
      />
    </div>
  )
}

/** Los campos, en el orden del formulario, y el resultado de «Probar». */
function CuerpoConexionSsh({ v }: { v: VistaDialogoConexionSsh }): React.JSX.Element {
  const { borrador, marcados, editar } = v
  return (
    <>
      <CampoNombreSsh borrador={borrador} marcados={marcados} editar={editar} />
      <CampoGrupoSsh borrador={borrador} grupos={v.grupos} editar={editar} onNuevoGrupo={v.abrirGrupoNuevo} />
      <FilaHostPuertoSsh borrador={borrador} marcados={marcados} editar={editar} />
      <CampoUsuarioSsh borrador={borrador} marcados={marcados} editar={editar} />
      <SelectorMetodoSsh borrador={borrador} marcados={marcados} nombreRadio={v.nombreRadioMetodo} idAyuda={v.idAyudaMetodo} editar={editar} />
      {borrador.metodo === 'clave' && (
        <CampoClaveSsh
          clave={borrador.clave}
          invalido={marcados.includes('clave')}
          ocupado={v.clave.importando}
          error={v.clave.error}
          onElegir={() => void v.elegirClave()}
          onSoltar={(archivo) => void v.soltarClave(archivo)}
        />
      )}
      {usaSecreto(borrador) && <CampoSecretoSsh borrador={borrador} destino={v.destinoSecreto} marcados={marcados} editar={editar} />}
      <CasillaAgentesSsh borrador={borrador} idAyuda={v.idAyudaAgentes} editar={editar} />
      {v.error !== null && (
        <div className="dbc-error" role="alert">
          {v.error}
        </div>
      )}
      <ResultadoPruebaSsh probando={v.prueba.probando} resultado={v.prueba.resultado} host={borrador.host.trim()} onOlvidarHuella={v.pedirOlvidoHuella} />
    </>
  )
}

/** El diálogo de alta y edición de una conexión SSH; el velo solo cierra si no hay cambios. */
/**
 * «Importar desde OpenSSH…» dentro del alta: el formulario sigue abierto mientras se elige el archivo
 * (cancelar vuelve a él tal cual) y, con un solo `Host`, se rellena aquí con una nota de lo leído.
 */
function useImportarEnFormulario(o: OpcionesDialogoConexionSsh, editar: VistaDialogoConexionSsh['editar'], cambios: boolean) {
  const [leyendo, setLeyendo] = useState(false)
  const [nota, setNota] = useState<string | null>(o.importada?.nota ?? null)
  // Lo escrito MIENTRAS se leía el archivo (las claves tardan): al llegar la lectura no se pisa.
  const cambiosAhora = useRef(cambios)
  cambiosAhora.current = cambios
  const importar = async (): Promise<void> => {
    setLeyendo(true)
    const l = await leerOpenSsh(o.perfilId)
    setLeyendo(false)
    if (l === null) return
    if (cambiosAhora.current) {
      setNota('No se rellenó: escribiste en el formulario mientras se leía el archivo. Vacíalo y vuelve a importar.')
      return
    }
    seguirLectura(o.perfilId, l, (i) => {
      editar(i.prefijo)
      setNota(i.nota)
    })
  }
  return { leyendo, nota, importar }
}

export function DialogoConexionSsh(o: OpcionesDialogoConexionSsh): React.JSX.Element {
  const v = useDialogoConexionSsh(o)
  const { leyendo, nota, importar } = useImportarEnFormulario(o, v.editar, v.cambios)
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={() => {
        if (!v.cambios && !v.guardando) o.onCerrar()
      }}
    >
      <div
        ref={v.dialogo.ref}
        className="modal-card db-conexion-modal ssh-conexion-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={v.idTitulo}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={v.dialogo.alPulsarTecla}
      >
        <form
          className="dbc-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void v.guardar()
          }}
        >
          <CabeceraConexionSsh
            idTitulo={v.idTitulo}
            esEdicion={v.esEdicion}
            importar={{ conCambios: v.cambios, ocupado: v.guardando || leyendo, leyendo, onImportar: () => void importar() }}
          />
          <div className="dbc-cuerpo">
            {nota !== null && (
              <p className="ssh-nota-importada" role="status">
                {nota}
              </p>
            )}
            <CuerpoConexionSsh v={v} />
          </div>
          <PieConexionSsh
            guardando={v.guardando}
            probando={v.prueba.probando}
            etiquetaProbar={etiquetaProbar(v.borrador, v.cambios)}
            onProbar={() => void v.probar()}
            onCerrar={o.onCerrar}
          />
        </form>
      </div>
      {v.grupoNuevo.abierto && <DialogoGrupoNuevo v={v} />}
      {v.prueba.confirmarOlvido && <ConfirmarOlvidoHuella v={v} />}
    </div>
  )
}
