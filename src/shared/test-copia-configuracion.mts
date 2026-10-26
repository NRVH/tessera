// =============================================================================
// Pruebas de `copiaConfiguracion.ts`: la frase, qué ajustes viajan (y cuáles no), cómo se ponen
// encima de los de ahora, la fusión de perfiles y agentes (se añade lo que falta y lo que ya está
// no se toca) y la elección de qué se importa (`seleccionCopia.ts`), con sus dependencias.
// Uso: node src/shared/test-copia-configuracion.mts
// =============================================================================

import {
  AJUSTES_EXPORTABLES,
  agentesParaExportar,
  ajustesConImportados,
  ajustesParaExportar,
  errorDeFrase,
  fusionarAgentes,
  perfilesAFusionar
} from './copiaConfiguracion.ts'
import { DEFAULT_SETTINGS, type WorkspaceSettings } from './workspace-state-ipc.ts'
import type { DefinicionAgente } from './agentesManuales.ts'
import {
  agentesSeleccionados,
  alternar,
  arbolImportar,
  estadoPerfil,
  haySeleccion,
  leerSeleccionConexiones,
  seleccionInicial,
  todoMarcado,
  recuentoSeleccion,
  seleccionParaImportar,
  type ArbolImportar,
  type ConexionPrevia
} from './seleccionCopia.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
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
  const mios: WorkspaceSettings = {
    ...DEFAULT_SETTINGS,
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
  const actual: WorkspaceSettings = { ...DEFAULT_SETTINGS, ccWidth: 500, agentModeByTarget: { 'a|b|codex': 'docker' }, uiFontSize: 13 }
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
  hr('(4) Perfiles: se crean los que faltan')
  const { nuevos, existentes } = perfilesAFusionar([{ id: 'a' }], [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'b', n: 3 }])
  check('a ya está, b es nuevo (una vez)', j(nuevos) === j([{ id: 'b', n: 2 }]) && existentes.length === 1, j({ nuevos, existentes }))

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
    perfilesAqui: new Set(['a']),
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
  check('NEGATIVO: basura en la selección del IPC, vacía', j(leerSeleccionConexiones({ ssh: 'x', bd: [1, 'b'] })) === j({ perfiles: [], ssh: [], bd: ['b'] }), '')
}

frase()
ajustes()
perfilesYAgentes()
seleccion()
const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
