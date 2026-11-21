// =============================================================================
// Sección plegable de cuentas de Docker en cada fila de Configuración › Agentes.
// Lista cuentas y ofrece las acciones compartidas, también para agentes ocultos.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import './cuentasConfiguracion.css'
import './cuentaAgente.css'
import type { IdAgente, DefinicionAgente } from '../../../../shared/agentesManuales'
import { Cruce, Presente } from '../../comun/Presente'
import { IconoCaret, IconoContenedor, IconoGlobal, IconoMas } from './iconosPaneAgente'
import { useStorePestanas } from '../pestanas'
import { SobreAjustes } from './SobreAjustes'
import { txPane } from './textosPane'
import { txCuentasConfiguracion } from './textosCuentasConfiguracion'
import { nombreVisible, porDisponibilidad, vistaSelectorCuenta, type FilaCuenta } from './selectorCuenta'
import { estadoCuenta } from './modeloCuentasConfiguracion'
import { MenuCuenta, EditorNombre, entradasCuenta } from './controlesCuenta'
import { NuevaCuenta, ConfirmarCuenta } from './DialogosCuenta'
import { useCuentasConfiguracion } from './useCuentasConfiguracion'

export function CuentasConfiguracion(p: { perfilId: string; agente: IdAgente; nombre: string; manual?: DefinicionAgente }): React.JSX.Element {
  const { estado: e, store, acciones, proyecto, iniciarSesion } = useCuentasConfiguracion(p.perfilId, p.agente, p.manual)
  const t = txCuentasConfiguracion()
  const textos = txPane().menus
  const modelo = { perfilId: p.perfilId, cuenta: acciones, ui: { setConfirmacion: (confirmacion) => store.setState({ confirmacion }) } } satisfies Parameters<typeof entradasCuenta>[1]
  const filas = vistaSelectorCuenta(e.cuentas, null).docker
  const { globales, privadas } = porDisponibilidad(filas)
  const nombrePerfil = useStorePestanas((s) => s.pestanas.perfiles.find((x) => x.id === p.perfilId)?.nombre ?? '')
  const etiqueta = `${e.desplegado ? t.plegar(p.nombre) : t.desplegar(p.nombre)} (${t.numeroCuentas(filas.length)})`
  const pintarFila = (f: FilaCuenta): React.JSX.Element => {
    const nombre = nombreVisible(f.cuenta, textos.predeterminada)
    const estado = estadoCuenta(f.cuenta)
    return e.editando === f.cuenta.id
      ? <EditorNombre key={f.cuenta.id} f={f} m={modelo} onTerminar={() => store.setState({ editando: null })} />
      : <div key={f.cuenta.id} className="cuentas-configuracion-fila">
        <span className={f.cuenta.conSesion ? 'cuenta-punto con-sesion' : 'cuenta-punto'} aria-hidden="true" />
        {f.cuenta.global && <span className="cuentas-configuracion-icono" title={textos.global}><IconoGlobal tam={14} /></span>}
        <span className="cuentas-configuracion-nombre" title={nombre}>{nombre}</span>
        <Cruce clave={estado} className="cuentas-configuracion-estado"><span>{estado}</span></Cruce>
        <Presente visible={!f.cuenta.conSesion} como="span" className="mov-aparece" title={proyecto ? undefined : t.sinProyecto}>
          <button type="button" className="btn" disabled={!proyecto} onClick={() => iniciarSesion(f.cuenta)}>{t.iniciar}</button>
        </Presente>
        <MenuCuenta nombre={nombre} entradas={entradasCuenta(f, modelo, () => store.setState({ editando: f.cuenta.id }), () => {})} />
      </div>
  }
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
          {/* Sin globales, la lista es la de siempre: no hay nada que distinguir. */}
          {globales.length > 0 && <div className="cuentas-configuracion-grupo"><span>{textos.globales}</span><span>{textos.globalesNota}</span></div>}
          {globales.map(pintarFila)}
          {globales.length > 0 && privadas.length > 0 && <div className="cuentas-configuracion-grupo"><span>{textos.privadasPerfil}</span><span>{nombrePerfil}</span></div>}
          {privadas.map(pintarFila)}
        </Cruce>
        <Presente visible={e.error !== null} className="mov-despliega" role="alert">{e.error}</Presente>
        <button type="button" className="cuenta-nueva" onClick={() => store.setState({ creando: true })}><IconoMas />{textos.nuevaCuenta}</button>
      </Presente>
      {e.creando && <SobreAjustes><NuevaCuenta cuenta={acciones} primera={e.cuentas.length === 0} nombre={p.nombre} agente={p.agente} onCerrar={() => store.setState({ creando: false })} /></SobreAjustes>}
      {e.confirmacion && <SobreAjustes><ConfirmarCuenta cuenta={acciones} confirmar={e.confirmacion} onCerrar={() => store.setState({ confirmacion: null })} /></SobreAjustes>}
    </>
  )
}
