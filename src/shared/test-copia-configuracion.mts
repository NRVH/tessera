// =============================================================================
// Pruebas de `copiaConfiguracion.ts`: la frase, qué ajustes viajan (y cuáles no), cómo se ponen
// encima de los de ahora, la fusión de agentes (se añade lo que falta y lo que ya está no se toca) y
// la elección de qué se importa (`seleccionCopia.ts`), con sus dependencias y la configuración de Docker.
// Uso: node src/shared/test-copia-configuracion.mts
// =============================================================================

import {
  AJUSTES_EXPORTABLES,
  agentesParaExportar,
  ajustesConImportados,
  ajustesParaExportar,
  errorDeFrase,
  fusionarAgentes
} from './copiaConfiguracion.ts'
import { AJUSTES_DEFECTO, type AjustesWorkspace } from './workspace-state-ipc.ts'
import type { DefinicionAgente } from './agentesManuales.ts'
import {
  agentesSeleccionados,
  alternar,
  arbolImportar,
  estadoPerfil,
  haySeleccion,
  leerSeleccionConexiones,
  seleccionInicial,
  seleccionTodo,
  seleccionTrasCambiarDestino,
  todoMarcado,
  recuentoSeleccion,
  seleccionParaImportar,
  type ArbolImportar,
  type ConexionPrevia
} from './seleccionCopia.ts'
import { sustitucionesElegidas } from './sustitucionesCopia.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia = ''): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}
const j = (v: unknown): string => JSON.stringify(v)

function frase(): void {
  hr('(1) La frase')
  check('corta: no vale', errorDeFrase('corta', 'corta') !== null, String(errorDeFrase('corta', 'corta')))
  check('distintas: no vale', errorDeFrase('frase larga 1', 'frase larga 2') !== null, '')
  check('8 o más e iguales: vale', errorDeFrase('ocho car', 'ocho car') === null, '')
}

function ajustes(): void {
  hr('(2) Qué ajustes viajan')
  const mios: AjustesWorkspace = {
    ...AJUSTES_DEFECTO,
    uiFontSize: 15,
    dbFilasPorPagina: 1000,
    ccWidth: 777,
    menuWindowsCarpetas: true,
    agentAccountByTarget: { 'p|x|claude-code': 'cuenta' },
    agentModeByTarget: { 'p|x|codex': 'docker' }
  }
  const fuera = ajustesParaExportar(mios) as Record<string, unknown>
  check('solo los exportables', Object.keys(fuera).sort().join() === [...AJUSTES_EXPORTABLES].sort().join(), Object.keys(fuera).join())
  check('las preferencias van', fuera.uiFontSize === 15 && fuera.dbFilasPorPagina === 1000, j({ ui: fuera.uiFontSize, filas: fuera.dbFilasPorPagina }))
  check(
    'NEGATIVO: ni tamaños, ni proyectos, ni cuentas ni el modo de cada agente, ni el menú del sistema',
    !('ccWidth' in fuera) && !('agentAccountByTarget' in fuera) && !('agentModeByTarget' in fuera) && !('menuWindowsCarpetas' in fuera),
    ''
  )

  hr('(3) Los importados, encima de los de ahora')
  const actual: AjustesWorkspace = { ...AJUSTES_DEFECTO, ccWidth: 500, agentModeByTarget: { 'a|b|codex': 'docker' }, uiFontSize: 13 }
  const r = ajustesConImportados(actual, { uiFontSize: 16, ccWidth: 900, agentModeByTarget: { 'c|d|codex': 'nativo' }, dbFilasPorPagina: 'mucho', menuWindowsCarpetas: true })
  check('un exportable se aplica', r.uiFontSize === 16, String(r.uiFontSize))
  check(
    'NEGATIVO: lo que no viaja no se toca aunque venga',
    r.ccWidth === 500 && j(r.agentModeByTarget) === j({ 'a|b|codex': 'docker' }) && r.menuWindowsCarpetas === false,
    j({ cc: r.ccWidth, m: r.agentModeByTarget })
  )
  check('un valor que no vale se sanea, no rompe', typeof r.dbFilasPorPagina === 'number', String(r.dbFilasPorPagina))
  check('basura: se quedan los de ahora', ajustesConImportados(actual, 'x') === actual, '')
}

const def = (id: string, extra: Partial<DefinicionAgente> = {}): DefinicionAgente => ({ id: id as DefinicionAgente['id'], nombre: id.slice(2), comando: id.slice(2), ...extra })

function perfilesYAgentes(): void {
  // A qué perfil va cada uno (y los que se crean): `test-destino-copia.mts`.
  hr('(5) Agentes: se añaden los que faltan')
  const s = { agentesNativos: [def('m-eco')], agentesDockerPorPerfil: { a: [def('m-orca')], z: [def('m-z')] }, agentesOcultosPorPerfil: { a: ['codex' as const], z: ['codex' as const] } }
  const exp = agentesParaExportar(s, ['a'])
  check('exportar: solo los perfiles elegidos', j(Object.keys(exp.dockerPorPerfil)) === j(['a']) && j(Object.keys(exp.ocultosPorPerfil)) === j(['a']), j(exp))
  const actual = { agentesNativos: [def('m-eco', { comando: 'eco-mio' })], agentesDockerPorPerfil: { a: [def('m-orca')] }, agentesOcultosPorPerfil: { a: ['claude-code' as const] } }
  const copia = {
    nativos: [def('m-eco', { comando: 'eco-otro' }), def('m-lince')],
    dockerPorPerfil: { a: [def('m-orca'), def('m-gato', { instalacion: 'npm i -g gato' })], b: [def('m-pez')], fuera: [def('m-x')] },
    ocultosPorPerfil: { a: ['codex'], b: ['codex'] }
  }
  const f = fusionarAgentes(actual, copia, ['a', 'b'], ['b'])
  check('nativos: el que ya estaba no se pisa; el nuevo entra', f.agentesNativos.length === 2 && f.agentesNativos[0].comando === 'eco-mio', j(f.agentesNativos.map((d) => d.comando)))
  check('Docker: se añaden a su perfil sin repetir', j(f.agentesDockerPorPerfil.a?.map((d) => d.id)) === j(['m-orca', 'm-gato']) && f.agentesDockerPorPerfil.b?.length === 1, j(f.agentesDockerPorPerfil))
  check('NEGATIVO: los de un perfil que no se importa no entran', !('fuera' in f.agentesDockerPorPerfil), '')
  check('ocultos: solo en el perfil nuevo; el existente conserva los suyos', j(f.agentesOcultosPorPerfil.a) === j(['claude-code']) && j(f.agentesOcultosPorPerfil.b) === j(['codex']), j(f.agentesOcultosPorPerfil))
  check('cuántos y qué perfiles tienen que instalar', f.anadidos === 3 && j(f.perfilesConInstalacion) === j(['a']), j({ n: f.anadidos, p: f.perfilesConInstalacion }))
  const nada = fusionarAgentes(actual, null, ['a'], [])
  check('sin agentes en la copia: igual que antes', nada.anadidos === 0 && nada.agentesNativos.length === 1, '')
}

const con = (id: string, perfil: string, depende: string | null = null, yaEsta = false): ConexionPrevia => ({ id, perfil, nombre: id, detalle: null, depende, yaEsta })

function arbolDePrueba(): ArbolImportar {
  return arbolImportar({
    perfiles: [{ id: 'a', nombre: 'A' }, { id: 'b', nombre: 'B' }],
    destinos: { a: 'a', b: null },
    conexiones: {
      // `app` salta por `bastion`; la base `pg` va por el túnel de `app`; `vieja` ya está aquí.
      ssh: [con('bastion', 'b'), con('app', 'b', 'bastion'), con('vieja', 'a', null, true), con('suelta', 'a')],
      bd: [con('pg', 'b', 'app'), con('pg-vieja', 'a', 'vieja')]
    },
    agentes: { nativos: [{ id: 'm-eco', nombre: 'Eco' }, { id: 'm-ya', nombre: 'Ya' }], dockerPorPerfil: { b: [{ id: 'm-orca', nombre: 'Orca' }] } },
    agentesAqui: { nativos: new Set(['m-ya']), dockerPorPerfil: {} },
    ajustes: true
  })
}

function seleccion(): void {
  hr('(6) Elegir qué se importa: lo de serie')
  const a = arbolDePrueba()
  const ini = seleccionInicial(a)
  const s0 = seleccionParaImportar(a, ini)
  check('de serie entra todo lo que no está, ajustes incluidos', j(s0.ssh.sort()) === j(['app', 'bastion', 'suelta']) && j(s0.bd.sort()) === j(['pg', 'pg-vieja']) && s0.ajustes, j(s0))
  check('y cuenta como todo marcado', todoMarcado(a, ini) && !todoMarcado(a, new Set()), '')
  check('NEGATIVO: lo que ya está no se marca (conexión y agente nativo)', !s0.ssh.includes('vieja') && j(s0.nativos) === j(['m-eco']), j(s0.nativos))
  check('el perfil existente con algo nuevo entra; marcado entero', j(s0.perfiles) === j(['a', 'b']) && estadoPerfil(a, ini, 'a') === 'marcado', j(s0.perfiles))
  check('NEGATIVO: una dependencia que ya está aquí no ata', a.perfiles[0].hijos.find((h) => h.id === 'pg-vieja')?.requiere.length === 0, '')

  hr('(7) Desmarcar: suelto, el perfil entero y dependencias')
  const clave = (tipo: string, perfil: string | null, id: string): string => JSON.stringify([tipo, perfil, id])
  const sinSuelta = alternar(a, ini, clave('ssh', 'a', 'suelta'))
  const s1 = seleccionParaImportar(a, sinSuelta.seleccion)
  check('desmarcar una conexión suelta: solo sale ella, sin avisos', !s1.ssh.includes('suelta') && s1.ssh.length === 2 && sinSuelta.avisos.length === 0, j(s1))
  check('su perfil queda a medias', estadoPerfil(a, sinSuelta.seleccion, 'a') === 'medias', estadoPerfil(a, sinSuelta.seleccion, 'a'))
  const sinBastion = alternar(a, ini, clave('ssh', 'b', 'bastion'))
  const s2 = seleccionParaImportar(a, sinBastion.seleccion)
  check('desmarcar el bastión desmarca quien salta por él y la base por su túnel', !s2.ssh.includes('bastion') && !s2.ssh.includes('app') && !s2.bd.includes('pg'), j(s2))
  check('y lo avisa', j(sinBastion.avisos.map((x) => [x.tipo, x.nombre, x.por]).sort()) === j([['desmarcada', 'app', 'bastion'], ['desmarcada', 'pg', 'app']]), j(sinBastion.avisos))
  const conPg = alternar(a, sinBastion.seleccion, clave('bd', 'b', 'pg'))
  const s3 = seleccionParaImportar(a, conPg.seleccion)
  check('marcar la base vuelve a marcar su túnel y el bastión, con aviso', s3.bd.includes('pg') && s3.ssh.includes('app') && s3.ssh.includes('bastion') && conPg.avisos.length === 2, j(conPg.avisos))
  const sinB = alternar(a, ini, clave('perfil', null, 'b'))
  const s4 = seleccionParaImportar(a, sinB.seleccion)
  check('desmarcar un perfil desmarca todo lo suyo', !s4.perfiles.includes('b') && !s4.ssh.includes('app') && !s4.bd.includes('pg') && s4.agentesPorPerfil.b === undefined, j(s4))
  check('volver a pulsarlo lo marca entero', estadoPerfil(a, alternar(a, sinB.seleccion, clave('perfil', null, 'b')).seleccion, 'b') === 'marcado', '')
  const soloOrca = alternar(a, sinB.seleccion, clave('agente', 'b', 'm-orca'))
  check('marcar algo de un perfil nuevo desmarcado marca el perfil (a medias)', seleccionParaImportar(a, soloOrca.seleccion).perfiles.includes('b') && estadoPerfil(a, soloOrca.seleccion, 'b') === 'medias', '')
  const sinAjustes = alternar(a, ini, a.ajustes!.clave)
  check('los ajustes, casilla aparte', !seleccionParaImportar(a, sinAjustes.seleccion).ajustes && seleccionParaImportar(a, sinAjustes.seleccion).perfiles.length === 2, '')
  check('NEGATIVO: con una casilla desmarcada ya no está todo marcado', !todoMarcado(a, sinAjustes.seleccion) && !todoMarcado(a, sinSuelta.seleccion), '')
  {
    const lleno = recuentoSeleccion(a, ini)
    const menos = recuentoSeleccion(a, sinAjustes.seleccion)
    check(
      'la casilla de «Todo» cuenta las cosas, no los perfiles que las agrupan, y dice su estado',
      lleno.estado === 'marcado' && lleno.marcadas === lleno.total && menos.estado === 'medias' && menos.marcadas === lleno.total - 1,
      j({ lleno, menos })
    )
    check('sin nada marcado, desmarcada', recuentoSeleccion(a, new Set()).estado === 'desmarcado', '')
  }
  const vacia = [clave('perfil', null, 'a'), clave('perfil', null, 'b'), clave('nativo', null, 'm-eco'), a.ajustes!.clave].reduce((s, c) => alternar(a, s, c).seleccion, ini)
  check('todo desmarcado: no hay nada que importar', !haySeleccion(seleccionParaImportar(a, vacia)), j(seleccionParaImportar(a, vacia)))

  hr('(8) Los agentes de la copia, reducidos a los elegidos')
  const copia = {
    nativos: [def('m-eco'), def('m-lince')],
    dockerPorPerfil: { a: [def('m-orca'), def('m-gato')], b: [def('m-pez')] },
    ocultosPorPerfil: { a: ['codex', 'm-orca', 'm-gato', 'm-eco', 'm-lince', 'm-ya'] }
  }
  const r = agentesSeleccionados(copia, { nativos: ['m-lince'], agentesPorPerfil: { a: ['m-gato'] } })
  const f = fusionarAgentes({ agentesNativos: [def('m-ya')], agentesDockerPorPerfil: {}, agentesOcultosPorPerfil: {} }, r, ['a'], ['a'])
  check('solo entran los elegidos', j(f.agentesNativos.map((d) => d.id)) === j(['m-ya', 'm-lince']) && j(f.agentesDockerPorPerfil.a?.map((d) => d.id)) === j(['m-gato']) && !('b' in f.agentesDockerPorPerfil), j(f))
  check(
    'ocultos: los de serie y los manuales que entran o ya estaban; NEGATIVO: no los de agentes que no entraron',
    j(f.agentesOcultosPorPerfil.a) === j(['codex', 'm-gato', 'm-lince', 'm-ya']),
    j(f.agentesOcultosPorPerfil)
  )
  check(
    'NEGATIVO: basura en la selección del IPC, vacía',
    j(leerSeleccionConexiones({ ssh: 'x', bd: [1, 'b'], historial: 'todo', reasignar: { a: 1, b: 'c', d: '' }, fusionados: 'a' })) ===
      j({ perfiles: [], ssh: [], bd: ['b'], historial: [], configDocker: [], configGlobal: false, archivosCuentas: [], cuentasNuevas: [], reglasNativas: [], reasignar: { b: 'c' }, fusionados: [] }),
    ''
  )
}

function historial(): void {
  hr('(9) El historial: por cuenta bajo su perfil, el nativo aparte')
  const h = (id: number, perfil: string | null) => ({ id, agente: 'claude-code' as const, perfil, cuenta: perfil ? 'Trabajo' : null, predeterminada: false, conversaciones: 3, bytes: 10 })
  const a = arbolImportar({
    perfiles: [{ id: 'a', nombre: 'A' }],
    destinos: { a: 'a' },
    conexiones: { ssh: [], bd: [] },
    agentesAqui: { nativos: new Set(), dockerPorPerfil: {} },
    ajustes: false,
    historial: [h(0, 'a'), h(1, null), h(2, 'fuera')]
  })
  check('el de la cuenta cuelga de su perfil; el nativo, aparte', a.perfiles[0].hijos.length === 1 && a.perfiles[0].hijos[0].tipo === 'historial' && a.historialNativo.length === 1, j(a.perfiles[0].hijos.map((x) => x.id)))
  check('NEGATIVO: el de un perfil que no viene no aparece', !j(a).includes('"id":"2"'), '')
  const ini = seleccionParaImportar(a, seleccionInicial(a))
  check('de serie (cifrado) entra todo el historial y el perfil que lo recibe', j(ini.historial.sort()) === j(['0', '1']) && j(ini.perfiles) === j(['a']), j(ini))
  const soloNativo = seleccionParaImportar(a, new Set([a.historialNativo[0].clave]))
  check('solo el nativo ya es algo que importar, sin perfil', haySeleccion(soloNativo) && soloNativo.perfiles.length === 0 && j(soloNativo.historial) === j(['1']), j(soloNativo))
  check('NEGATIVO: nada marcado (sin frase), nada', !haySeleccion(seleccionParaImportar(a, new Set())), '')
}

function configDocker(): void {
  hr('(10) La configuración de Docker: la del perfil bajo él, la global aparte; la distinta no viene marcada')
  const entrada = (destinos: Record<string, string | null>) =>
    arbolImportar({
      perfiles: [{ id: 'a', nombre: 'A' }, { id: 'b', nombre: 'B' }, { id: 'c', nombre: 'C' }],
      destinos,
      conexiones: { ssh: [], bd: [] },
      agentesAqui: { nativos: new Set(), dockerPorPerfil: {} },
      ajustes: false,
      configDocker: { global: 'distinta', perfiles: { a: { x: 'igual' }, b: { x: 'distinta' }, c: {} } }
    })
  const a = entrada({ a: 'x', b: 'x', c: 'x' })
  const de = (perfil: string) => a.perfiles.find((g) => g.perfil.id === perfil)?.hijos.find((h) => h.tipo === 'configDocker')
  check('igual a la del destino, ya está', de('a')?.yaEsta === true, j(de('a')))
  check('distinta, se puede marcar y avisa de que sustituye', de('b')?.yaEsta === false && de('b')?.sustituye === true, j(de('b')))
  check('un destino sin configuración la trae', de('c')?.yaEsta === false && de('c')?.sustituye === undefined, j(de('c')))
  const ini = seleccionParaImportar(a, seleccionInicial(a))
  check('de serie solo entra la que no sustituye nada', j(ini.configDocker) === j(['c']) && ini.configGlobal === false, j(ini))
  const conGlobal = seleccionParaImportar(a, new Set([a.configGlobal!.clave]))
  check('la global sola ya es algo que importar, sin perfil', haySeleccion(conGlobal) && conGlobal.configGlobal && conGlobal.perfiles.length === 0, j(conGlobal))
  const nuevo = entrada({ a: null, b: null, c: null })
  check('a un perfil nuevo, siempre se trae', nuevo.perfiles.every((g) => g.hijos.some((h) => h.tipo === 'configDocker' && !h.yaEsta && !h.sustituye)), '')
  const claveB = de('b')!.clave
  const tras = alternar(a, seleccionInicial(a), a.perfiles[1].perfil.clave)
  check('marcar el perfil entero no marca lo que sustituye', !tras.seleccion.has(claveB), j([...tras.seleccion]))
  const deNuevo = entrada({ a: 'x', b: null, c: 'x' })
  const claveNueva = deNuevo.perfiles[1].hijos[0].clave
  const marcada = seleccionInicial(deNuevo)
  check('a un perfil nuevo viene marcada', marcada.has(claveNueva), '')
  check('cambiar el destino a uno con otra la desmarca', !seleccionTrasCambiarDestino(a, marcada, 'b', false).has(claveNueva), '')
  const leida = leerSeleccionConexiones({ configDocker: ['a', 3], configGlobal: 'sí' })
  check('NEGATIVO: la selección por IPC se sanea', j(leida.configDocker) === j(['a']) && leida.configGlobal === false, j(leida))
}

function archivosAgentes(): void {
  hr('(11) Los archivos de los agentes: tres estados, cuentas nuevas y las reglas nativas nunca de serie')
  const entrada = (destinos: Record<string, string | null>): ArbolImportar =>
    arbolImportar({
      perfiles: [{ id: 'a', nombre: 'A' }],
      destinos,
      conexiones: { ssh: [], bd: [] },
      agentesAqui: { nativos: new Set(), dockerPorPerfil: {} },
      ajustes: false,
      configDocker: { global: 'distinta', partesGlobal: { reglas: true, configuracion: false }, perfiles: { a: { x: 'distinta' } } },
      archivosAgentes: {
        cuentas: [
          { id: 'nueva', perfil: 'a', agente: 'claude-code', nombre: 'Trabajo', predeterminada: false, archivos: ['instrucciones', 'configuracion'], frente: {} },
          { id: 'ya', perfil: 'a', agente: 'codex', nombre: 'Personal', predeterminada: false, archivos: ['instrucciones', 'configuracion'], frente: { x: { cuenta: 'Mía', archivos: { instrucciones: 'igual', configuracion: 'distinto' } } } },
          { id: 'traer', perfil: 'a', agente: 'codex', nombre: 'Otra', predeterminada: false, archivos: ['configuracion'], frente: { x: { cuenta: 'Otra', archivos: { configuracion: 'traer' } } } }
        ],
        nativos: [{ agente: 'claude-code', ruta: '~/.claude/CLAUDE.md', estado: 'traer' }, { agente: 'codex', ruta: '/datos/codex/AGENTS.md', estado: 'distinto' }],
        invalidos: []
      }
    })
  const claveCuenta = JSON.stringify(['cuentaAgente', 'a', 'nueva'])
  const claveDe = (id: string): string => JSON.stringify(['archivoCuenta', 'a', id])
  const a = entrada({ a: 'x' })
  const ini = seleccionInicial(a)
  const hijo = (id: string): ArbolImportar['perfiles'][number]['hijos'][number] | undefined => a.perfiles[0].hijos.find((h) => h.id === id)
  check('cuenta nueva y su archivo: casillas, marcadas de serie', ini.has(claveCuenta) && ini.has(claveDe('nueva/instrucciones')))
  check('la cuenta que ya existe no se crea y se nombra como aquí', hijo('ya')?.yaEsta === true && hijo('ya')?.nombre === 'Mía')
  check('igual: sin casilla', hijo('ya/instrucciones')?.archivo?.estado === 'igual' && hijo('ya/instrucciones')?.yaEsta === true && !ini.has(claveDe('ya/instrucciones')))
  check('distinto: sin casilla, se elige aparte, no viene marcado', hijo('ya/configuracion')?.yaEsta === true && !ini.has(claveDe('ya/configuracion')))
  check('falta en una cuenta que existe: casilla marcada', ini.has(claveDe('traer/configuracion')))
  check('NEGATIVO: una regla nativa que falta no viene marcada de serie', !ini.has(a.reglasNativas[0].clave) && a.reglasNativas[0].yaEsta === false)
  const conPerfil = alternar(a, new Set(), a.perfiles[0].perfil.clave)
  check('NEGATIVO: la casilla del perfil tampoco marca nada nativo', !conPerfil.seleccion.has(a.reglasNativas[0].clave))
  check('«Todo» sí marca la regla nativa que falta, como el global', seleccionTodo(a).has(a.reglasNativas[0].clave))
  const sinCuenta = alternar(a, ini, claveCuenta)
  check('desmarcar la cuenta nueva desmarca sus archivos, sin aviso por cada uno', !sinCuenta.seleccion.has(claveDe('nueva/instrucciones')) && !sinCuenta.seleccion.has(claveDe('nueva/configuracion')) && sinCuenta.avisos.length === 0)
  const deNuevo = alternar(a, sinCuenta.seleccion, claveCuenta)
  check('volver a marcarla los trae ya marcados', deNuevo.seleccion.has(claveDe('nueva/configuracion')))
  const s0 = seleccionParaImportar(a, ini)
  check('la cuenta nueva y sus archivos, en la selección', j(s0.cuentasNuevas) === j([{ perfil: 'a', cuenta: 'nueva' }]) && s0.archivosCuentas.some((x) => x.cuenta === 'nueva' && x.tipo === 'configuracion' && !x.sustituir))
  check('NEGATIVO: un archivo igual o distinto sin elegir no se manda', !s0.archivosCuentas.some((x) => x.cuenta === 'ya'))
  const distinto = hijo('ya/configuracion')!
  const conSust = seleccionParaImportar(a, new Set(), new Set(), new Set([distinto.clave]))
  check('sustituir un archivo distinto lo manda y mete su perfil sin marcar nada', j(conSust.perfiles) === j(['a']) && j(conSust.archivosCuentas) === j([{ perfil: 'a', cuenta: 'ya', tipo: 'configuracion', sustituir: true }]))
  const nuevoPerfil = entrada({ a: null })
  check('al cambiar a un destino sin la cuenta, su archivo no sigue elegido a escondidas', !seleccionTrasCambiarDestino(nuevoPerfil, new Set([claveDe('ya/configuracion')]), 'a', false).has(claveDe('ya/configuracion')))
  check('a un perfil nuevo, todas sus cuentas se crean', nuevoPerfil.perfiles[0].hijos.filter((h) => h.tipo === 'cuentaAgente').every((h) => !h.yaEsta))
  check('la regla nativa distinta: sin casilla', a.reglasNativas[1].yaEsta === true && a.reglasNativas[1].archivo?.estado === 'distinto')
  const conNativa = seleccionParaImportar(a, new Set(), new Set(), new Set([a.reglasNativas[1].clave]))
  check('sustituirla se manda aparte, sin perfil, y ya es algo que importar', j(conNativa.reglasNativas) === j([{ agente: 'codex', sustituir: true }]) && haySeleccion(conNativa) && conNativa.perfiles.length === 0)
  const leida = leerSeleccionConexiones({ archivosCuentas: [{ perfil: 'a', cuenta: 'b', tipo: 'otro' }, { perfil: 'a', cuenta: 'b', tipo: 'instrucciones' }, 3], reglasNativas: [{ agente: 'manual' }, { agente: 'codex' }] })
  check('NEGATIVO: la selección por IPC se sanea', leida.archivosCuentas.length === 1 && leida.archivosCuentas[0].sustituir === false && j(leida.reglasNativas) === j([{ agente: 'codex', sustituir: false }]))

  hr('(12) Lo que se va a sustituir, para confirmarlo')
  check('NEGATIVO: si solo se crea, nada que confirmar', sustitucionesElegidas(a, ini, new Set(), new Set()).length === 0)
  const elementos = sustitucionesElegidas(a, new Set([a.configGlobal!.clave, hijo('a')?.clave ?? '']), new Set(), new Set([distinto.clave, a.reglasNativas[1].clave]))
  check('archivos de cuenta y reglas nativas se listan y son recuperables', elementos.some((i) => i.clase === 'archivoCuenta' && i.recuperable && i.cuenta === 'Mía' && i.archivo === 'config.toml') && elementos.some((i) => i.clase === 'reglaNativa' && i.recuperable))
  check('las reglas globales se marcan como no recuperables, y solo la parte que cambia', elementos.some((i) => i.clase === 'reglasGlobales' && !i.recuperable) && !elementos.some((i) => i.clase === 'configGlobal'))
  const conReglas = arbolImportar({
    perfiles: [{ id: 'p', nombre: 'P' }, { id: 'q', nombre: 'Q' }],
    destinos: { p: 'd', q: 'd' },
    reglas: { p: 'distintas', q: 'distintas' },
    conexiones: { ssh: [], bd: [] },
    agentesAqui: { nativos: new Set(), dockerPorPerfil: {} },
    ajustes: true
  })
  const dosReglas = sustitucionesElegidas(conReglas, new Set(), new Set(['p', 'q']), new Set())
  check('las reglas de un perfil no se recuperan, y dos perfiles al mismo destino cuentan una vez', dosReglas.length === 1 && dosReglas[0].clase === 'reglasPerfil' && !dosReglas[0].recuperable)
  check('NEGATIVO: los ajustes no piden confirmación', sustitucionesElegidas(conReglas, new Set([conReglas.ajustes!.clave]), new Set(), new Set()).length === 0)
}

frase()
ajustes()
perfilesYAgentes()
seleccion()
historial()
configDocker()
archivosAgentes()
const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
