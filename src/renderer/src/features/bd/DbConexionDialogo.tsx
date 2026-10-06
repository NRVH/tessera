// =============================================================================
// DbConexionDialogo: alta y edición de una CONEXIÓN a base de datos, en un modal.
// Los campos del destino salen del descriptor del motor (`DbConexionCampos`), las
// secciones fijas de `DbConexionSecciones`, y el estado, los efectos y las acciones de
// `useConexionDialogo`. Aquí quedan el modal, el orden del cuerpo, el aviso de «falta
// este driver» y la sección de clientes de base de datos.
// Decisiones: docs/decisiones/bd/ui-conexion-dialogo.md
// =============================================================================

// El formulario común va ANTES que lo propio del diálogo: a igual especificidad gana la segunda.
import '../../comun/formularioModal.css'
import './dialogo.css'
// Los tokens de color de los entornos (los puntos del selector) viven con la marca.
import './marcaEntorno.css'
import type { DbArchivoElegido, DbConnection, DbMotor, DriverRequerido } from '../../../../shared/db-ipc'
import { ayudasTrasFila, ayudasTrasFilaCredenciales, driversDelMotor, type CampoConexion } from './camposConexion'
import { DriversLista, textoProgresoDriver } from './DriversLista'
import { CampoArchivo, FilasDelFormulario } from './DbConexionCampos'
import {
  CabeceraConexion,
  CampoNotas,
  CampoUri,
  CasillaSoloLectura,
  CredencialesConexion,
  FilaNombreMotor,
  PieConexion,
  ResultadoPrueba,
  SelectorEntorno
} from './DbConexionSecciones'
import { useConexionDialogo, type VistaConexion } from './useConexionDialogo'

export interface DbConexionDialogoProps {
  perfilId: string
  /** null = alta. */
  conexion: DbConnection | null
  /** Alta PRECARGADA con un archivo (soltado sobre el árbol): el motor y la ficha del main. Solo en un alta. */
  archivoInicial?: { motor: DbMotor; elegido: DbArchivoElegido } | null
  /** Abrir con «Clientes de base de datos» desplegado (desde «Instalar cliente…»). */
  abrirClientes?: boolean
  /** El driver que pidió la operación que llevó hasta aquí (fila de error del árbol). */
  requiereDriver?: DriverRequerido | null
  /** Se llega desde «Vuelve a escribir la contraseña»: el foco va a la contraseña, no al nombre. */
  enfocarPassword?: boolean
  /** Se guardó (alta o edición). `esNueva` = acaba de nacer. */
  onGuardada?: (c: DbConnection, esNueva: boolean) => void
  onCerrar: () => void
}

/** El diálogo de alta y edición de una conexión; el velo solo cierra si no hay cambios. */
export function DbConexionDialogo({
  perfilId,
  conexion,
  archivoInicial = null,
  abrirClientes = false,
  requiereDriver = null,
  enfocarPassword = false,
  onGuardada,
  onCerrar
}: DbConexionDialogoProps): React.JSX.Element {
  const v = useConexionDialogo({ perfilId, conexion, archivoInicial, abrirClientes, requiereDriver, onGuardada, onCerrar })
  const { e } = v
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={() => {
        if (!v.cambios && !e.guardando) onCerrar()
      }}
    >
      <div
        ref={v.dialogo.ref}
        className="modal-card db-conexion-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={e.idTitulo}
        onMouseDown={(ev) => ev.stopPropagation()}
        onKeyDown={v.dialogo.alPulsarTecla}
      >
        <form
          className="dbc-form"
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault()
            void v.a.guardar()
          }}
        >
          <CabeceraConexion idTitulo={e.idTitulo} esEdicion={e.borrador.id !== undefined} />
          <div className="dbc-cuerpo">
            <FormularioConexion v={v} enfocarPassword={enfocarPassword} />
            <PieDelCuerpo v={v} />
          </div>
          <PieConexion
            probando={e.probando}
            guardando={e.guardando}
            cambios={v.cambios}
            onProbar={() => void v.a.probar()}
            onCerrar={onCerrar}
          />
        </form>
      </div>
    </div>
  )
}

/** Los campos, en el orden del formulario: nombre y motor, archivo o URI, destino, credenciales, lo de la conexión. */
function FormularioConexion({ v, enfocarPassword }: { v: VistaConexion; enfocarPassword: boolean }): React.JSX.Element {
  const { e, a, descriptor } = v
  const { borrador } = e
  const invalido = (c: CampoConexion): true | undefined => (v.marcados.includes(c) ? true : undefined)
  const filas = { borrador, marcados: v.marcados, onTexto: a.editarTexto, onEditar: a.editar, setBorrador: e.setBorrador }
  return (
    <>
      <FilaNombreMotor borrador={borrador} aliasInvalido={invalido('alias')} enfocarPassword={enfocarPassword} editar={a.editar} setBorrador={e.setBorrador} />
      {descriptor.deArchivo && (
        <CampoArchivo
          nombre={borrador.archivo ?? ''}
          invalido={v.marcados.includes('archivo')}
          ocupado={e.eligiendo || e.guardando}
          onElegir={() => void a.elegirArchivo(false)}
          onCrear={() => void a.elegirArchivo(true)}
        />
      )}
      {descriptor.uri && <CampoUri esquema={descriptor.uri} uri={e.uri} setUri={e.setUri} botonRef={v.botonUriRef} aplicarUri={a.aplicarUri} />}
      <FilasDelFormulario filas={descriptor.filas} ayudas={ayudasTrasFila} {...filas} />
      {v.conCredenciales && (
        <CredencialesConexion
          borrador={borrador}
          userInvalido={invalido('user')}
          pista={v.pistaCredencial}
          enfocarPassword={enfocarPassword}
          verPassword={e.verPassword}
          setVerPassword={e.setVerPassword}
          editar={a.editar}
        />
      )}
      {v.conCredenciales && v.avisoPassword && <div className="dbc-aviso">{v.avisoPassword}</div>}
      <FilasDelFormulario filas={descriptor.filasTrasCredenciales} ayudas={ayudasTrasFilaCredenciales} {...filas} />
      <CasillaSoloLectura borrador={borrador} editar={a.editar} />
      <SelectorEntorno borrador={borrador} editar={a.editar} nombreRadio={e.nombreRadioEntorno} idAyuda={e.idAyudaEntorno} />
      <CampoNotas borrador={borrador} editar={a.editar} />
    </>
  )
}

/** Lo que va tras los campos: el resultado de la prueba, el aviso de driver, los clientes y el error. */
function PieDelCuerpo({ v }: { v: VistaConexion }): React.JSX.Element {
  const { e, d, a } = v
  const confiar = (): void => {
    a.editar({ tls: { ...e.borrador.tls, confiarCertificado: true } })
    e.setProbarTrasEditar(true)
  }
  return (
    <>
      {(e.probando || e.resultado) && (
        <ResultadoPrueba probando={e.probando} resultado={e.resultado} borrador={e.borrador} guardando={e.guardando} onConfiar={confiar} />
      )}
      {d.requiere && v.verRequiere && <AvisoDriver v={v} requiere={d.requiere} />}
      {v.verClientes && (
        <details
          ref={d.clientesRef}
          className="dbc-clientes"
          open={d.clientesAbierto}
          onToggle={(ev) => d.setClientesAbierto(ev.currentTarget.open)}
        >
          <summary>Clientes de base de datos</summary>
          <DriversLista
            drivers={driversDelMotor(e.borrador.motor, d.drivers)}
            instalando={d.instalando}
            progreso={d.progreso}
            resaltado={d.requiere?.packId ?? null}
            onInstalar={(id) => void a.instalarDriver(id)}
            onUsarExistente={(id) => void a.usarDriverExistente(id)}
          />
        </details>
      )}
      {e.error && (
        <div className="dbc-error" role="alert">
          {e.error}
        </div>
      )}
    </>
  )
}

/** «Falta este driver»: descargarlo si se puede (si no, la nota de por qué) o señalar su carpeta. */
function AvisoDriver({ v, requiere }: { v: VistaConexion; requiere: DriverRequerido }): React.JSX.Element {
  const { d, a, packRequerido } = v
  return (
    <div className="dbc-driver-aviso" role="status">
      <div>{requiere.motivo}</div>
      <div className="dbc-driver-botones">
        {packRequerido?.descargable === false ? (
          <span className="dbc-driver-nota">
            {packRequerido.noDisponible ??
              'Oracle ya no lo publica para descarga directa: bájalo a mano desde su web y señala la carpeta.'}
          </span>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={d.instalando !== null}
            onClick={() => void a.instalarDriver(requiere.packId)}
          >
            {d.instalando === requiere.packId ? textoProgresoDriver(d.progreso) : 'Descargar e instalar'}
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={d.instalando !== null}
          title="Registrar un cliente que ya tengas descomprimido en este equipo"
          onClick={() => void a.usarDriverExistente(requiere.packId)}
        >
          Seleccionar carpeta…
        </button>
      </div>
    </div>
  )
}
