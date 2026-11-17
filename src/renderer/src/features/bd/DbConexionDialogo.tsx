// =============================================================================
// DbConexionDialogo: alta y edición de una CONEXIÓN a base de datos, en un modal.
// Los campos del destino salen del descriptor del motor (`DbConexionCampos`), las
// secciones fijas de `DbConexionSecciones`, y el estado, los efectos y las acciones de
// `useConexionDialogo`. Aquí quedan el modal, el orden del cuerpo, el aviso de «falta
// este driver» y la sección de clientes de base de datos.
// Decisiones: docs/decisiones/bd/ui-conexion-dialogo.md
// =============================================================================

// El formulario común va ANTES que lo propio del diálogo: a igual especificidad gana la segunda.
import { useRef } from 'react'
import { Presente } from '../../comun/Presente'
import { ModalAviso, Modal, ModalPie } from '../../comun/Modal'
import { AYUDA, BotonAyuda } from '../academy'
import '../../comun/formularioModal.css'
import './dialogo.css'
// Los tokens de color de los entornos (los puntos del selector) viven con la marca.
import './marcaEntorno.css'
import type { DbArchivoElegido, ConexionBd, DbMotor, DriverRequerido } from '../../../../shared/db-ipc'
import { ayudasTrasFila, ayudasTrasFilaCredenciales, driversDelMotor, type CampoConexion } from './camposConexion'
import { DriversLista, textoProgresoDriver } from './DriversLista'
import { CampoArchivo, FilasDelFormulario } from './DbConexionCampos'
import { SelectorTunelSsh } from './DbConexionTunel'
import { ClaveSentinels, SelectorTopologiaRedis } from './DbConexionTopologia'
import {
  CampoNotas,
  CampoUri,
  CasillaSoloLectura,
  CredencialesConexion,
  FilaNombreMotor,
  ResultadoPrueba,
  SelectorEntorno
} from './DbConexionSecciones'
import { useConexionDialogo, type VistaConexion } from './useConexionDialogo'
import { txConexionDialogo } from './textosConexionDialogo.ts'

export interface PropsDialogoConexionBd {
  perfilId: string
  /** null = alta. */
  conexion: ConexionBd | null
  /** Alta PRECARGADA con un archivo (soltado sobre el árbol): el motor y la ficha del main. Solo en un alta. */
  archivoInicial?: { motor: DbMotor; elegido: DbArchivoElegido } | null
  /** Abrir con «Clientes de base de datos» desplegado (desde «Instalar cliente…»). */
  abrirClientes?: boolean
  /** El driver que pidió la operación que llevó hasta aquí (fila de error del árbol). */
  requiereDriver?: DriverRequerido | null
  /** Se llega desde «Vuelve a escribir la contraseña»: el foco va a la contraseña, no al nombre. */
  enfocarContrasena?: boolean
  /** Se guardó (alta o edición). `esNueva` = acaba de nacer. */
  onGuardada?: (c: ConexionBd, esNueva: boolean) => void
  onCerrar: () => void
}

/** El diálogo de alta y edición de una conexión; el velo solo cierra si no hay cambios. */
export function DbConexionDialogo({
  perfilId,
  conexion,
  archivoInicial = null,
  abrirClientes = false,
  requiereDriver = null,
  enfocarContrasena = false,
  onGuardada,
  onCerrar
}: PropsDialogoConexionBd): React.JSX.Element {
  const v = useConexionDialogo({ perfilId, conexion, archivoInicial, abrirClientes, requiereDriver, onGuardada, onCerrar })
  const { e } = v
  const t = txConexionDialogo()
  const ocupado = e.guardando || e.probando || e.eligiendo || v.d.instalando !== null
  return (
    <Modal
      titulo={e.borrador.id !== undefined ? t.editarConexion : t.nuevaConexion}
      ayuda={<BotonAyuda destino={AYUDA.conexionBd} />}
      subtitulo={e.borrador.id === undefined ? <>{t.ayudaNombreAntes}<code>tdb</code>{t.ayudaNombreDespues}</> : undefined}
      tamano="m"
      className="db-conexion-modal"
      // Solo guardar impide salir: una prueba contra un servidor que no responde se abandona con Cancelar o Esc.
      cerrable={!e.guardando}
      ocupado={ocupado}
      cierraConVelo={!v.cambios}
      onCerrar={onCerrar}
      pie={
        <ModalPie auxiliares={
          <button type="button" className="btn" disabled={ocupado} onClick={() => void v.a.probar()}>
            {e.probando ? t.probando : v.cambios ? t.guardarYProbar : t.probar}
          </button>
        }>
          <button type="button" className="btn btn-ghost" disabled={e.guardando} onClick={onCerrar}>{t.cancelar}</button>
          <button type="submit" form={e.idTitulo} className="btn primary" disabled={ocupado}>{e.guardando ? t.guardando : t.guardar}</button>
        </ModalPie>
      }
    >
      <form
        id={e.idTitulo}
        className="dbc-form"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault()
          if (!ocupado) void v.a.guardar()
        }}
      >
        <div ref={v.camposRef} className="dbc-cuerpo">
          <FormularioConexion v={v} enfocarContrasena={enfocarContrasena} />
          <PieDelCuerpo v={v} />
        </div>
      </form>
    </Modal>
  )
}

/** Los campos, en el orden del formulario: nombre y motor, archivo o URI, destino, credenciales, lo de la conexión. */
function FormularioConexion({ v, enfocarContrasena }: { v: VistaConexion; enfocarContrasena: boolean }): React.JSX.Element {
  const { e, a, descriptor } = v
  const { borrador } = e
  const ultimaUri = useRef(descriptor.uri)
  if (descriptor.uri) ultimaUri.current = descriptor.uri
  const invalido = (c: CampoConexion): true | undefined => (v.marcados.includes(c) ? true : undefined)
  const filas = { borrador, marcados: v.marcados, onTexto: a.editarTexto, onEditar: a.editar, setBorrador: e.setBorrador }
  return (
    <>
      <FilaNombreMotor borrador={borrador} aliasInvalido={invalido('alias')} enfocarContrasena={enfocarContrasena} editar={a.editar} setBorrador={e.setBorrador} />
      <Presente visible={!!(descriptor.deArchivo)} className="mov-despliega">
        <CampoArchivo
          nombre={borrador.archivo ?? ''}
          invalido={v.marcados.includes('archivo')}
          ocupado={e.eligiendo || e.guardando}
          onElegir={() => void a.elegirArchivo(false)}
          onCrear={() => void a.elegirArchivo(true)}
        />
      </Presente>
      <Presente visible={!!descriptor.uri} className="mov-despliega">{ultimaUri.current && <CampoUri esquema={ultimaUri.current} uri={e.uri} setUri={e.setUri} botonRef={v.botonUriRef} aplicarUri={a.aplicarUri} />}</Presente>
      <SelectorTopologiaRedis borrador={borrador} invalido={v.marcados.includes('topologiaRedis')} editar={a.editar} setBorrador={e.setBorrador} />
      <FilasDelFormulario filas={descriptor.filas} ayudas={ayudasTrasFila} {...filas} />
      <Presente visible={!!(v.conCredenciales)} className="mov-despliega">
        <CredencialesConexion
          borrador={borrador}
          usuarioInvalido={invalido('user')}
          pista={v.pistaCredencial}
          enfocarContrasena={enfocarContrasena}
          verContrasena={e.verContrasena}
          setVerContrasena={e.setVerContrasena}
          editar={a.editar}
        />
      </Presente>
      <Presente visible={!!(v.conCredenciales && v.avisoContrasena)} className="mov-despliega"><ModalAviso tono="aviso">{v.avisoContrasena}</ModalAviso></Presente>
      {v.conCredenciales && <ClaveSentinels borrador={borrador} editar={a.editar} />}
      <FilasDelFormulario filas={descriptor.filasTrasCredenciales} ayudas={ayudasTrasFilaCredenciales} {...filas} />
      <SelectorTunelSsh borrador={borrador} editar={a.editar} />
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
      <Presente visible={e.probando || e.resultado !== null} className="mov-despliega">
        <ModalAviso tono={e.probando || !e.resultado ? 'info' : e.resultado.ok ? 'exito' : 'error'}>
          <ResultadoPrueba probando={e.probando} resultado={e.resultado} borrador={e.borrador} guardando={e.guardando} onConfiar={confiar} />
        </ModalAviso>
      </Presente>
      {d.requiere && v.verRequiere && <AvisoDriver v={v} requiere={d.requiere} />}
      {v.verClientes && (
        <details
          ref={d.clientesRef}
          className="dbc-clientes"
          open={d.clientesAbierto}
          onToggle={(ev) => d.setClientesAbierto(ev.currentTarget.open)}
        >
          <summary>{txConexionDialogo().clientesBd}</summary>
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
        <ModalAviso tono="error">{e.error}</ModalAviso>
      )}
    </>
  )
}

/** «Falta este driver»: descargarlo si se puede (si no, la nota de por qué) o señalar su carpeta. */
function AvisoDriver({ v, requiere }: { v: VistaConexion; requiere: DriverRequerido }): React.JSX.Element {
  const { d, a, paqueteDriverRequerido } = v
  const t = txConexionDialogo()
  return (
    <ModalAviso tono="info">
      <div>{requiere.motivo}</div>
      <div className="dbc-driver-botones">
        {paqueteDriverRequerido?.descargable === false ? (
          <span className="dbc-driver-nota">
            {paqueteDriverRequerido.noDisponible ?? t.oracleNoPublica}
          </span>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={d.instalando !== null}
            onClick={() => void a.instalarDriver(requiere.packId)}
          >
            {d.instalando === requiere.packId ? textoProgresoDriver(d.progreso) : t.descargarEInstalar}
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={d.instalando !== null}
          title={t.registrarClienteTitulo}
          onClick={() => void a.usarDriverExistente(requiere.packId)}
        >
          {t.seleccionarCarpeta}
        </button>
      </div>
    </ModalAviso>
  )
}
