#!/usr/bin/env node
// =============================================================================
// La franja y el mosaico se reparten por perfil durante el desacople.
// Fija el aislamiento entre perfiles y el retorno de cada panel a la principal.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================
import { ANCHO_CC_MIN } from '../../../../shared/workspace-state-ipc.ts'
import {
  ANCHO_COMPLETA_FRANJA_MIN,
  agenteVisibleEnFranja,
  cambioDeVistaFranja,
  casoDeControlesFranja,
  controlesDeFranja,
  firmaVistaFranja,
  TERMINAL_JUNTO_AL_AGENTE,
  conCompactaDeFranja,
  conVentanaDeFranja,
  entraEnMosaico,
  panelDeHija,
  repartirFranja,
  sinPerfilDeFranja,
  vistaDeFranjaDesacoplada,
  type CasoControlesFranja,
  type EntradaVistaFranja,
  type EstadoVistaFranja
} from './franjaDesacoplada.ts'

let total = 0
let aciertos = 0

function hr(titulo: string): void {
  console.log(`\n=== ${titulo} ===`)
}

function check(nombre: string, pasa: boolean): void {
  total++
  if (pasa) aciertos++
  console.log(`  [${pasa ? 'PASS' : 'FAIL'}] ${nombre}`)
}

hr('Franja y riel por perfil')
const inicio = new Map<string, string>()
let desacopladas: ReadonlyMap<string, string> = inicio
const estado = (perfil: string, panel: 'terminal' | 'gitlog' | null) => repartirFranja(desacopladas, perfil, panel)
check('el arranque muestra el panel elegido en la principal', estado('alfa', 'terminal').panelPrincipal === 'terminal')
check('una franja cerrada conserva sus botones de panel', !estado('alfa', null).acoplarEnRiel)
desacopladas = conVentanaDeFranja(desacopladas, 'alfa', 'terminal')
check('abrir una ventana conserva la foto anterior', inicio.size === 0 && desacopladas.has('alfa'))
check('desacoplar oculta la terminal y sustituye sus botones', estado('alfa', 'terminal').panelPrincipal === null && estado('alfa', 'terminal').acoplarEnRiel)
check('otro perfil conserva Git en la principal y su riel habitual', estado('beta', 'gitlog').panelPrincipal === 'gitlog' && !estado('beta', 'gitlog').acoplarEnRiel)
desacopladas = conVentanaDeFranja(desacopladas, 'beta', 'gitlog')
check('también se puede desacoplar el segundo perfil mostrando Git', estado('beta', 'gitlog').panelPrincipal === null && estado('beta', 'gitlog').acoplarEnRiel)
desacopladas = conVentanaDeFranja(desacopladas, 'alfa')
check('acoplar un perfil devuelve su terminal sin afectar al otro', estado('alfa', 'terminal').panelPrincipal === 'terminal' && estado('beta', 'gitlog').acoplarEnRiel)

hr('Mosaico')
check('el agente de la terminal acoplada puede entrar', entraEnMosaico(desacopladas, 'alfa', 'terminal'))
check('solo el agente de la terminal desacoplada queda fuera', !entraEnMosaico(desacopladas, 'beta', 'terminal')
  && entraEnMosaico(desacopladas, 'beta', 'proyecto') && entraEnMosaico(desacopladas, 'beta', 'datos'))
desacopladas = conVentanaDeFranja(desacopladas, 'beta')
check('al acoplar Git vuelve a la principal y su agente puede entrar', estado('beta', 'gitlog').panelPrincipal === 'gitlog'
  && !estado('beta', 'gitlog').acoplarEnRiel && entraEnMosaico(desacopladas, 'beta', 'terminal'))
check('la hija conserva un panel visible y sigue un cambio explícito', panelDeHija('', 'terminal') === 'terminal'
  && panelDeHija('gitlog', 'terminal') === 'gitlog')

hr('Vista compacta de la ventana desacoplada')
check('el suelo de la vista completa suma la terminal y el mínimo del agente',
  ANCHO_COMPLETA_FRANJA_MIN === TERMINAL_JUNTO_AL_AGENTE + ANCHO_CC_MIN)

const baseVista: EntradaVistaFranja = {
  compactaPedida: false,
  anchoVentana: 1060,
  panel: 'terminal',
  hayAgente: true,
  agentePedido: true,
  hayTerminales: true,
  agenteMaximizadoPedido: false
}

const completa = vistaDeFranjaDesacoplada(baseVista)
check('en ventana ancha y sin compacta se ven el riel, el riel SSH y el agente',
  !completa.compacta && !completa.impuestaPorAncho && completa.rielVisible && !completa.rielSshOculto && completa.agenteVisible)
check('con el agente pedido, el botón está activo y a la vista',
  completa.botonAgenteActivo && completa.botonAgenteVisible)

const compactaManual = vistaDeFranjaDesacoplada({ ...baseVista, compactaPedida: true, anchoVentana: 1400 })
check('en ventana grande, pedir compacta oculta riel, SSH y agente',
  compactaManual.compacta && compactaManual.compactaPedida && !compactaManual.impuestaPorAncho
  && !compactaManual.rielVisible && compactaManual.rielSshOculto && !compactaManual.agenteVisible)
check('la compacta pedida quita el botón del agente y conserva la preferencia',
  !compactaManual.botonAgenteVisible && compactaManual.botonAgenteActivo)

const compactaGit = vistaDeFranjaDesacoplada({ ...baseVista, compactaPedida: true, panel: 'gitlog' })
check('en compacta mostrando Git también se oculta el agente',
  compactaGit.compacta && !compactaGit.agenteVisible)

const enElLimite = vistaDeFranjaDesacoplada({ ...baseVista, anchoVentana: ANCHO_COMPLETA_FRANJA_MIN })
const bajoElLimite = vistaDeFranjaDesacoplada({ ...baseVista, anchoVentana: ANCHO_COMPLETA_FRANJA_MIN - 1 })
check('justo en el ancho mínimo sigue la vista completa',
  !enElLimite.impuestaPorAncho && !enElLimite.compacta)
check('por debajo del ancho mínimo la compacta se impone',
  bajoElLimite.impuestaPorAncho && bajoElLimite.compacta
  && !bajoElLimite.rielVisible && bajoElLimite.rielSshOculto && !bajoElLimite.agenteVisible)
check('la compacta impuesta también quita el botón del agente',
  !bajoElLimite.botonAgenteVisible)

const sinMedir = vistaDeFranjaDesacoplada({ ...baseVista, anchoVentana: 0 })
check('con ancho 0 (sin medir) no impone compacta', !sinMedir.impuestaPorAncho && !sinMedir.compacta)

const agenteMaxCompleta = vistaDeFranjaDesacoplada({ ...baseVista, agenteMaximizadoPedido: true })
const agenteMaxCompacta = vistaDeFranjaDesacoplada({ ...baseVista, compactaPedida: true, agenteMaximizadoPedido: true })
check('con el agente maximizado en completa, la columna de terminal se pliega',
  agenteMaxCompleta.agenteMaximizado && agenteMaxCompleta.terminalPlegada)
check('al pasar a compacta, la terminal deja de plegarse para quedar a la vista',
  !agenteMaxCompacta.agenteMaximizado && !agenteMaxCompacta.terminalPlegada && !agenteMaxCompacta.agenteVisible)

const sinAgente = vistaDeFranjaDesacoplada({ ...baseVista, hayAgente: false, agentePedido: false, anchoVentana: 520 })
check('sin agente, una ventana estrecha impone igualmente la vista compacta',
  sinAgente.compacta && sinAgente.impuestaPorAncho && !sinAgente.agenteVisible && !sinAgente.rielVisible)

hr('Agente a la vista en la hija')
const sinTerminales = { ...baseVista, hayTerminales: false }
const soloAgente = vistaDeFranjaDesacoplada(sinTerminales)
check('cerrar la última terminal deja el agente visible y pliega la columna de la terminal',
  soloAgente.agenteVisible && soloAgente.terminalPlegada && !soloAgente.agenteMaximizado)
const sinPreparar = vistaDeFranjaDesacoplada({ ...sinTerminales, hayAgente: false })
check('con la preferencia puesta y el agente por preparar, el botón está activo y la terminal no se pliega',
  sinPreparar.botonAgenteActivo && sinPreparar.botonAgenteVisible && !sinPreparar.agenteVisible && !sinPreparar.terminalPlegada)
const oculto = vistaDeFranjaDesacoplada({ ...sinTerminales, hayAgente: false, agentePedido: false })
check('sin agente pedido, el botón está inactivo y disponible para mostrarlo aunque no haya terminales',
  !oculto.botonAgenteActivo && oculto.botonAgenteVisible && !oculto.agenteVisible && !oculto.terminalPlegada)
const gitConAgente = vistaDeFranjaDesacoplada({ ...sinTerminales, panel: 'gitlog' })
check('Git conserva su panel junto al agente y el botón está disponible',
  gitConAgente.agenteVisible && !gitConAgente.terminalPlegada && gitConAgente.botonAgenteVisible)
check('el agente visible deja de contar en compacta pedida aunque haya ancho',
  !agenteVisibleEnFranja(true, true, ANCHO_COMPLETA_FRANJA_MIN + 100))
check('la compacta impuesta también lo oculta y vuelve a contar al ensanchar',
  !agenteVisibleEnFranja(true, false, ANCHO_COMPLETA_FRANJA_MIN - 1)
  && agenteVisibleEnFranja(true, false, ANCHO_COMPLETA_FRANJA_MIN))
check('sin agente, la vista completa no lo da por visible',
  !agenteVisibleEnFranja(false, false, ANCHO_COMPLETA_FRANJA_MIN))

hr('Controles de cada cabecera y de la barra lateral')
const casoDe = (enHija: boolean, pantallaCompleta: boolean, vista: ReturnType<typeof vistaDeFranjaDesacoplada> | null): CasoControlesFranja =>
  casoDeControlesFranja({ enHija, pantallaCompleta, vista })
const vistaCompletaHija = vistaDeFranjaDesacoplada(baseVista)
const vistaPedidaHija = vistaDeFranjaDesacoplada({ ...baseVista, compactaPedida: true })
const vistaImpuestaHija = vistaDeFranjaDesacoplada({ ...baseVista, anchoVentana: ANCHO_COMPLETA_FRANJA_MIN - 1 })
check('cada situación cae en su caso',
  casoDe(false, false, null) === 'principal' && casoDe(false, true, null) === 'principal-completa'
  && casoDe(true, true, vistaCompletaHija) === 'hija-completa'
  && casoDe(true, true, vistaPedidaHija) === 'hija-compacta-pedida'
  && casoDe(true, true, vistaImpuestaHija) === 'hija-compacta-impuesta')
check('una hija sin vista calculada se trata como la principal, no como una vista inventada',
  casoDe(true, false, null) === 'principal')

const principal = controlesDeFranja('principal')
check('principal acoplada: maximizar con flecha, sin icono suelto de desacoplar ni controles de vista',
  principal.maximizar === 'dividido' && !principal.desacoplarIcono
  && principal.vista === null && !principal.conmutador && principal.menuVista.length === 0)
const principalCompleta = controlesDeFranja('principal-completa')
check('principal a pantalla completa: solo el icono de desacoplar tras el filete (maximizar y ocultar viven en el riel)',
  principalCompleta.maximizar === null && principalCompleta.desacoplarIcono && principalCompleta.vista === null)
const hijaCompleta = controlesDeFranja('hija-completa')
check('hija completa: la vista es un icono simple, sin flecha ni conmutador',
  hijaCompleta.vista === 'icono' && !hijaCompleta.conmutador
  && hijaCompleta.maximizar === null && !hijaCompleta.desacoplarIcono && hijaCompleta.menuVista.length === 0)
const hijaPedida = controlesDeFranja('hija-compacta-pedida')
check('hija compacta pedida: conmutador y «Vista» con flecha; la flecha ofrece la vista completa y acoplar',
  hijaPedida.conmutador && hijaPedida.vista === 'dividido' && !hijaPedida.vistaPrincipalDeshabilitada
  && hijaPedida.menuVista.join() === 'vistaCompleta,acoplar')
const hijaImpuesta = controlesDeFranja('hija-compacta-impuesta')
check('hija compacta impuesta: la parte principal queda deshabilitada y la flecha sigue sirviendo para acoplar',
  hijaImpuesta.conmutador && hijaImpuesta.vista === 'dividido' && hijaImpuesta.vistaPrincipalDeshabilitada
  && hijaImpuesta.menuVista.includes('acoplar'))

hr('Elección efímera por perfil')
let compactas: Readonly<Record<string, boolean>> = {}
const mismo = conCompactaDeFranja(compactas, 'alfa', false)
check('fijar el valor que ya tenía conserva la referencia', mismo === compactas)
compactas = conCompactaDeFranja(compactas, 'alfa', true)
check('la elección es por perfil y no afecta a otros perfiles',
  compactas.alfa === true && !compactas.beta)
desacopladas = conVentanaDeFranja(desacopladas, 'alfa', 'terminal')
desacopladas = conVentanaDeFranja(desacopladas, 'alfa')
desacopladas = conVentanaDeFranja(desacopladas, 'alfa', 'terminal')
check('acoplar y volver a desacoplar en la misma ejecución conserva la elección del perfil',
  compactas.alfa === true)
compactas = sinPerfilDeFranja(compactas, 'alfa')
check('al borrar el perfil se poda su elección efímera', !('alfa' in compactas))

hr('Cómo se anima el cambio de vista de la ventana desacoplada')
const estadoDeVista = (cambios: Partial<EntradaVistaFranja>): EstadoVistaFranja => {
  const e = { ...baseVista, ...cambios }
  return { proyecto: 'alfa', panel: e.panel, vista: vistaDeFranjaDesacoplada(e) }
}
const vistaCompleta = estadoDeVista({})
check('sin cambio no hay transición', cambioDeVistaFranja(vistaCompleta, estadoDeVista({})) === null)
const vistaConTerminalPlegada = estadoDeVista({ hayTerminales: false })
check('cambiar de proyecto es instantáneo aunque cambie el reparto',
  cambioDeVistaFranja(vistaCompleta, vistaConTerminalPlegada) !== null
  && cambioDeVistaFranja(vistaCompleta, { ...vistaConTerminalPlegada, proyecto: 'beta' }) === null)
check('cambiar de proyecto actualiza la firma aunque no cambie el reparto',
  firmaVistaFranja(vistaCompleta) !== firmaVistaFranja({ ...vistaCompleta, proyecto: 'beta' }))
const destinoPendiente = estadoDeVista({ compactaPedida: true })
const destinoSiguiente = estadoDeVista({ hayAgente: false })
check('una vista posterior con otras salidas invalida el destino de la captura pendiente',
  cambioDeVistaFranja(vistaCompleta, destinoPendiente)?.seVan.join() === 'riel,agente'
  && cambioDeVistaFranja(vistaCompleta, destinoSiguiente)?.seVan.join() === 'agente'
  && firmaVistaFranja(destinoPendiente) !== firmaVistaFranja(destinoSiguiente))
const alCompactar = cambioDeVistaFranja(vistaCompleta, estadoDeVista({ compactaPedida: true }))
check('pedir la vista compacta: se van la barra lateral y el agente, es un cierre y el panel no cambia',
  alCompactar !== null && alCompactar.tipo === 'cierre' && alCompactar.seVan.join() === 'riel,agente'
  && alCompactar.aparecen.length === 0 && !alCompactar.cruce)
const alCompletar = cambioDeVistaFranja(estadoDeVista({ compactaPedida: true }), vistaCompleta)
check('volver a la vista completa: entran la barra lateral y el agente, es una apertura',
  alCompletar !== null && alCompletar.tipo === 'apertura' && alCompletar.aparecen.join() === 'riel,agente'
  && alCompletar.seVan.length === 0)
const alOcultarAgente = cambioDeVistaFranja(vistaCompleta, estadoDeVista({ hayAgente: false }))
check('ocultar el agente: solo se va su columna, y la barra lateral se queda',
  alOcultarAgente !== null && alOcultarAgente.tipo === 'cierre' && alOcultarAgente.seVan.join() === 'agente')
const alMostrarAgente = cambioDeVistaFranja(estadoDeVista({ hayAgente: false }), vistaCompleta)
check('mostrar el agente: solo entra su columna',
  alMostrarAgente !== null && alMostrarAgente.tipo === 'apertura' && alMostrarAgente.aparecen.join() === 'agente'
  && alMostrarAgente.seVan.length === 0)
const alCambiarPanel = cambioDeVistaFranja(vistaCompleta, estadoDeVista({ panel: 'gitlog' }))
check('cambiar de Terminal a Git·Log es un fundido cruzado en su sitio: no sale ni entra ninguna zona',
  alCambiarPanel !== null && alCambiarPanel.cruce && alCambiarPanel.seVan.length === 0 && alCambiarPanel.aparecen.length === 0)
check('la vista compacta que impone el ancho no se anima: la ventana se está redimensionando',
  cambioDeVistaFranja(vistaCompleta, estadoDeVista({ anchoVentana: ANCHO_COMPLETA_FRANJA_MIN - 10 })) === null
  && cambioDeVistaFranja(estadoDeVista({ anchoVentana: ANCHO_COMPLETA_FRANJA_MIN - 10 }), vistaCompleta) === null)
check('qué botón del pie aparece pulsado no es un cambio de vista',
  cambioDeVistaFranja(vistaCompleta, estadoDeVista({ agentePedido: false })) === null)
const alMaximizarAgente = cambioDeVistaFranja(vistaCompleta, estadoDeVista({ agenteMaximizadoPedido: true }))
check('maximizar el agente reparte de nuevo la franja sin que salga ni entre una zona',
  alMaximizarAgente !== null && alMaximizarAgente.seVan.length === 0 && alMaximizarAgente.aparecen.length === 0 && !alMaximizarAgente.cruce)
check('la firma de una vista ausente es vacía', firmaVistaFranja(null) === '')
check('pasar a la compacta y volver cierra y abre la lista de conexiones con el borde de la terminal (morfa)',
  alCompactar?.morfa === true && alCompletar?.morfa === true)
check('mostrar u ocultar el agente o cambiar de panel no mueve la lista de conexiones',
  alOcultarAgente?.morfa === false && alMostrarAgente?.morfa === false && alCambiarPanel?.morfa === false)
check('en Git·Log, que no tiene lista de conexiones, la vista compacta no es morfa',
  cambioDeVistaFranja(estadoDeVista({ panel: 'gitlog' }), estadoDeVista({ panel: 'gitlog', compactaPedida: true }))?.morfa === false)

console.log(`\nVEREDICTO: ${aciertos}/${total} PASS`)
process.exit(aciertos === total ? 0 : 1)
