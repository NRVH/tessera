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
import { AvisoConPresencia, AvisoModal, Modal } from '../../comun/Modal'
import { AYUDA, BotonAyuda } from '../academy'
import { etiquetaProbar, usaSecreto } from './borradorSsh'
import {
  AccionImportarConexionSsh,
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
import { SeccionSaltoTunelesSsh } from './CamposSaltoTunelesSsh'
import { leerOpenSsh, seguirLectura } from './importacionSsh'
import { ResultadoPruebaSsh } from './ResultadoPruebaSsh'
import { txSsh } from './textos.ts'
import { txFormularioSsh } from './textosFormulario.ts'
import { useDialogoConexionSsh, type OpcionesDialogoConexionSsh, type VistaDialogoConexionSsh } from './useDialogoConexionSsh'

/** El diálogo anidado «Nuevo grupo…»: el error del main se enseña dentro de él, tal cual. */
function DialogoGrupoNuevo({ v }: { v: VistaDialogoConexionSsh }): React.JSX.Element {
  const t = txFormularioSsh()
  return (
    // El velo y la tarjeta de este diálogo son del anidado: su `mousedown` no sube al velo del de la conexión.
    <div className="ssh-dialogo-anidado" onMouseDown={(e) => e.stopPropagation()}>
      <PromptDialog
        title={txSsh().nuevoGrupo}
        label={t.nombreGrupo}
        confirmLabel={t.crear}
        error={v.grupoNuevo.error}
        onConfirm={(nombre) => void v.crearGrupo(nombre)}
        onCancel={v.cerrarGrupoNuevo}
      />
    </div>
  )
}

/** La confirmación anidada de «Olvidar la huella guardada…»: acepta la que presente el servidor y vuelve a probar. */
function ConfirmarOlvidoHuella({ v }: { v: VistaDialogoConexionSsh }): React.JSX.Element {
  const t = txFormularioSsh()
  return (
    <div className="ssh-dialogo-anidado" onMouseDown={(e) => e.stopPropagation()}>
      <ConfirmDialog
        danger
        title={t.olvidarHuellaTitulo}
        message={`${t.olvidarHuellaMensaje1}\n${t.olvidarHuellaMensaje2}`}
        confirmLabel={t.olvidarYProbar}
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
        <>
          <CampoClaveSsh
            clave={borrador.clave}
            invalido={marcados.includes('clave')}
            ocupado={v.clave.importando}
            error={null}
            onElegir={() => void v.elegirClave()}
            onSoltar={(archivo) => void v.soltarClave(archivo)}
          />
          <AvisoConPresencia>{v.clave.error !== null && <AvisoModal tono="error">{v.clave.error}</AvisoModal>}</AvisoConPresencia>
        </>
      )}
      {usaSecreto(borrador) && <CampoSecretoSsh borrador={borrador} destino={v.destinoSecreto} marcados={marcados} editar={editar} />}
      <CasillaAgentesSsh borrador={borrador} idAyuda={v.idAyudaAgentes} editar={editar} />
      <SeccionSaltoTunelesSsh borrador={borrador} bastiones={v.bastiones} marcados={marcados} editar={editar} />
      <AvisoConPresencia>{v.error !== null && (
        <AvisoModal tono="error">{v.error}</AvisoModal>
      )}</AvisoConPresencia>
      <AvisoConPresencia>{(v.prueba.probando || v.prueba.resultado !== null) && (
        <AvisoModal tono={v.prueba.probando || !v.prueba.resultado ? 'info' : v.prueba.resultado.ok ? 'exito' : 'error'}>
          <ResultadoPruebaSsh probando={v.prueba.probando} resultado={v.prueba.resultado} host={borrador.host.trim()} onOlvidarHuella={v.pedirOlvidoHuella} />
        </AvisoModal>
      )}</AvisoConPresencia>
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
      setNota(txFormularioSsh().noSeRelleno)
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
  const t = txFormularioSsh()
  const ocupado = v.guardando || v.prueba.probando || v.clave.importando || leyendo
  return (
    <>
      <Modal
        titulo={v.esEdicion ? t.editarConexion : t.nuevaConexion}
        ayuda={<BotonAyuda destino={AYUDA.conexionSsh} />}
        subtitulo={!v.esEdicion ? t.ayudaAlta : undefined}
        acciones={!v.esEdicion ? <AccionImportarConexionSsh importar={{ conCambios: v.cambios, ocupado, leyendo, onImportar: () => void importar() }} /> : undefined}
        tamano="m"
        className="db-conexion-modal ssh-conexion-modal"
        cerrable={!v.guardando}
        ocupado={ocupado}
        cierraConVelo={!v.cambios}
        onCerrar={o.onCerrar}
        pie={
          <PieConexionSsh
            formulario={v.idTitulo}
            ocupado={ocupado}
            guardando={v.guardando}
            probando={v.prueba.probando}
            etiquetaProbar={etiquetaProbar(v.borrador, v.cambios)}
            onProbar={() => void v.probar()}
            onCerrar={o.onCerrar}
          />
        }
      >
        <form
          ref={v.formularioRef}
          id={v.idTitulo}
          className="dbc-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!ocupado) void v.guardar()
          }}
        >
          <div className="dbc-cuerpo">
            <AvisoConPresencia>{nota !== null && (
              <AvisoModal tono="info">{nota}</AvisoModal>
            )}</AvisoConPresencia>
            <CuerpoConexionSsh v={v} />
          </div>
        </form>
      </Modal>
      {v.grupoNuevo.abierto && <DialogoGrupoNuevo v={v} />}
      {v.prueba.confirmarOlvido && <ConfirmarOlvidoHuella v={v} />}
    </>
  )
}
