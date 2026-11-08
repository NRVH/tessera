// =============================================================================
// Sección plegable de cuentas de Docker en cada fila de Configuración › Agentes.
// Lista cuentas y ofrece las acciones compartidas, también para agentes ocultos.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import './cuentasConfiguracion.css'
import './cuentaAgente.css'
import type { IdAgente, DefinicionAgente } from '../../../../shared/agentesManuales'
import { Cruce, Presente } from '../../comun/Presente'
import { IconoCaret, IconoContenedor, IconoMas } from './iconosAgentPane'
import { useStorePestanas, selectGlobalActiveProject } from '../pestanas'
import { SobreAjustes } from './SobreAjustes'
import { txPane } from './textosPane'
import { txCuentasConfiguracion } from './textosCuentasConfiguracion'
import { nombreVisible, vistaSelectorCuenta } from './selectorCuenta'
import { estadoCuenta } from './modeloCuentasConfiguracion'
import { MenuCuenta, EditorNombre, entradasCuenta } from './controlesCuenta'
import { NuevaCuenta, ConfirmarCuenta } from './DialogosCuenta'
import { ModalLoginCuenta } from './ModalLoginCuenta'
import { useCuentasConfiguracion } from './useCuentasConfiguracion'

export function CuentasConfiguracion(p: { profileId: string; agente: IdAgente; nombre: string; manual?: DefinicionAgente }): React.JSX.Element {
  const { estado: e, store, acciones, releer } = useCuentasConfiguracion(p.profileId, p.agente)
  const proyecto = useStorePestanas((s) => s.tabs.activeProfileId === p.profileId ? selectGlobalActiveProject(s.tabs)?.projectHostPath : undefined)
  const t = txCuentasConfiguracion()
  const textos = txPane().menus
  const modelo = { profileId: p.profileId, cuenta: acciones, ui: { setConfirm: (confirmacion) => store.setState({ confirmacion }) } } satisfies Parameters<typeof entradasCuenta>[1]
  const filas = vistaSelectorCuenta(e.cuentas, null).docker
  const etiqueta = `${e.desplegado ? t.plegar(p.nombre) : t.desplegar(p.nombre)} (${t.numeroCuentas(filas.length)})`
  return (
    <>
      {/* Con el número a la vista se sabe que ahí están las cuentas sin tener que descubrir el chevron. */}
      <button type="button" className="btn cuentas-desplegar" title={etiqueta} aria-label={etiqueta} aria-expanded={e.desplegado} onClick={() => store.setState({ desplegado: !e.desplegado })}>
        <IconoContenedor tam={14} />
        <span className="cuentas-desplegar-n">{filas.length}</span>
        <IconoCaret />
      </button>
      <Presente visible={e.desplegado} como="section" className="mov-despliega cuentas-configuracion" aria-label={t.titulo}>
        <div className="cuenta-seccion-titulo">{t.titulo}</div>
        <Cruce clave={e.cuentas.map((c) => c.id).join(':')} className="cuentas-configuracion-lista">
          {filas.map((f) => {
            const nombre = nombreVisible(f.cuenta, textos.predeterminada)
            const estado = estadoCuenta(f.cuenta, e.usos[f.cuenta.id] ?? null)
            return e.editando === f.cuenta.id
              ? <EditorNombre key={f.cuenta.id} f={f} m={modelo} onTerminar={() => store.setState({ editando: null })} />
              : <div key={f.cuenta.id} className="cuentas-configuracion-fila">
                <span className={f.cuenta.conSesion ? 'cuenta-punto con-sesion' : 'cuenta-punto'} aria-hidden="true" />
                <span className="cuentas-configuracion-nombre" title={nombre}>{nombre}</span>
                <Cruce clave={estado} className="cuentas-configuracion-estado"><span>{estado}</span></Cruce>
                <Presente visible={!f.cuenta.conSesion} como="span" className="mov-aparece" title={proyecto ? undefined : t.sinProyecto}>
                  <button type="button" className="btn" disabled={!proyecto} onClick={() => store.setState({ login: f.cuenta })}>{t.iniciar}</button>
                </Presente>
                <MenuCuenta nombre={nombre} entradas={entradasCuenta(f, modelo, () => store.setState({ editando: f.cuenta.id }), () => {})} />
              </div>
          })}
        </Cruce>
        <Presente visible={e.error !== null} className="mov-despliega" role="alert">{e.error}</Presente>
        <button type="button" className="cuenta-nueva" onClick={() => store.setState({ creando: true })}><IconoMas />{textos.nuevaCuenta}</button>
      </Presente>
      {e.creando && <SobreAjustes><NuevaCuenta cuenta={acciones} primera={e.cuentas.length === 0} nombre={p.nombre} onCerrar={() => store.setState({ creando: false })} /></SobreAjustes>}
      {e.confirmacion && <SobreAjustes><ConfirmarCuenta cuenta={acciones} confirm={e.confirmacion} onCerrar={() => store.setState({ confirmacion: null })} /></SobreAjustes>}
      {e.login && <SobreAjustes><ModalLoginCuenta cuenta={e.login} manual={p.manual} projectHostPath={proyecto} releer={releer} onCerrar={() => store.setState({ login: null })} /></SobreAjustes>}
    </>
  )
}
