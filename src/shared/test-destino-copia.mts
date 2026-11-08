// =============================================================================
// Pruebas de `destinoCopia.ts` y de su paso por `seleccionCopia.ts`: a qué perfil de aquí va de serie
// cada perfil del archivo (mismo id, mismo nombre con otro id, ninguno), qué pasa con sus reglas (vacías
// aquí, iguales, distintas mantenidas o sustituidas), qué se crea y con qué id, los agentes reasignados
// al destino, cambiar de destino y un archivo sin frase.
// Uso: node src/shared/test-destino-copia.mts
// =============================================================================

import { destinoPorDefecto, destinosPorDefecto, emparejarCuenta, estadoReglas, planPerfiles, reasignarAgentes, type EstadoReglas } from './destinoCopia.ts'
import { agentesSeleccionados, arbolImportar, haySeleccion, seleccionInicial, seleccionParaImportar, seleccionTrasCambiarDestino, type ArbolImportar } from './seleccionCopia.ts'
import { fusionarAgentes } from './copiaConfiguracion.ts'
import type { DefinicionAgente } from './agentesManuales.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}
const j = (v: unknown): string => JSON.stringify(v)

interface P {
  id: string
  nombre: string
  color: string
  reglas?: string
  agentes: Array<{ tipo: string; configDir: string }>
}
const perfil = (id: string, nombre: string, reglas?: string, color = '#111111'): P => ({
  id,
  nombre,
  color,
  ...(reglas !== undefined ? { reglas } : {}),
  agentes: [{ tipo: 'claude-code', configDir: `./.tessera/perfiles/${id}/claude` }]
})

// Este equipo: «Personal» (id `personal`, con reglas) y «Trabajo» (id `trabajo`, sin reglas).
const AQUI = [perfil('personal', 'Personal', 'Usa pnpm.\nNo toques main.', '#9814c8'), perfil('trabajo', 'Trabajo')]

function destinos(): void {
  hr('(1) El destino de serie')
  check('mismo id: ese perfil', destinoPorDefecto({ id: 'trabajo', nombre: 'Otro nombre' }, AQUI) === 'trabajo', '')
  check('mismo nombre con otro id (sin distinguir mayúsculas ni espacios de los extremos)', destinoPorDefecto({ id: 'portatil-1', nombre: '  PERSONAL ' }, AQUI) === 'personal', '')
  check('ninguno: perfil nuevo', destinoPorDefecto({ id: 'casa', nombre: 'Casa' }, AQUI) === null, '')
  check('el id manda sobre el nombre', destinoPorDefecto({ id: 'trabajo', nombre: 'Personal' }, AQUI) === 'trabajo', '')
  check('NEGATIVO: un nombre parecido no empareja', destinoPorDefecto({ id: 'x', nombre: 'Personal 2' }, AQUI) === null, '')
  check('de todos a la vez', j(destinosPorDefecto([{ id: 'portatil-1', nombre: 'Personal' }, { id: 'casa', nombre: 'Casa' }], AQUI)) === j({ 'portatil-1': 'personal', casa: null }), '')

  hr('(2) Las reglas frente a las del destino')
  const casos: Array<[string | undefined, string | undefined, EstadoReglas]> = [
    [undefined, undefined, 'ninguna'],
    ['algo', '', 'ninguna'],
    [undefined, 'Usa pnpm.', 'traer'],
    ['', 'Usa pnpm.', 'traer'],
    ['Usa pnpm.\nNo toques main.', 'Usa pnpm.  \r\nNo toques main.\n\n', 'iguales'],
    ['Usa pnpm.', 'Usa yarn.', 'distintas']
  ]
  for (const [aqui, archivo, esperado] of casos) check(`${j(aqui)} frente a ${j(archivo)}: ${esperado}`, estadoReglas(aqui, archivo) === esperado, estadoReglas(aqui, archivo))
}

const def = (id: string, extra: Partial<DefinicionAgente> = {}): DefinicionAgente => ({ id: id as DefinicionAgente['id'], nombre: id.slice(2), comando: id.slice(2), ...extra })

/** El árbol de un archivo con un solo perfil, `delArchivo`, que va a `destino`. */
function arbolDe(delArchivo: P, destino: string | null, conexiones = true): ArbolImportar {
  const reglas: Record<string, EstadoReglas> = {}
  if (destino !== null) reglas[delArchivo.id] = estadoReglas(AQUI.find((p) => p.id === destino)?.reglas, delArchivo.reglas)
  return arbolImportar({
    perfiles: [delArchivo],
    destinos: { [delArchivo.id]: destino },
    reglas,
    conexiones: {
      ssh: conexiones ? [{ id: 'ssh-1', perfil: delArchivo.id, nombre: 'servidor', detalle: null, depende: null, yaEsta: false }] : [],
      bd: []
    },
    agentes: { nativos: [], dockerPorPerfil: { [delArchivo.id]: [{ id: 'm-orca', nombre: 'Orca' }, { id: 'm-pez', nombre: 'Pez' }] } },
    agentesAqui: { nativos: new Set(), dockerPorPerfil: { personal: ['m-orca'] } },
    ajustes: false
  })
}

function arbolYSeleccion(): void {
  hr('(3) Mismo nombre con otro id: se añade a «Personal»')
  const portatil = perfil('portatil-1', 'Personal', 'Usa yarn.', '#ff0000')
  const a = arbolDe(portatil, 'personal')
  const g = a.perfiles[0]
  check('el grupo dice su destino', g.destino === 'personal' && g.perfil.yaEsta, j({ destino: g.destino, ya: g.perfil.yaEsta }))
  check('los agentes «ya están» si los tiene el destino', g.hijos.find((h) => h.id === 'm-orca')?.yaEsta === true && g.hijos.find((h) => h.id === 'm-pez')?.yaEsta === false, '')
  const s = seleccionParaImportar(a, seleccionInicial(a))
  check('entra con su destino, lo que falta y sin reglas de serie', j(s.destinos) === j({ 'portatil-1': 'personal' }) && j(s.ssh) === j(['ssh-1']) && j(s.agentesPorPerfil) === j({ 'portatil-1': ['m-pez'] }), j(s))

  hr('(4) Reglas distintas: mantener (de serie) o sustituir')
  check('reglas distintas: sin casilla, se elige aparte', g.reglas === 'distintas' && g.hijos.find((h) => h.tipo === 'reglas')?.yaEsta === true, j(g.reglas))
  const mantener = planPerfiles(AQUI, [portatil], s)
  check('mantener: las reglas de aquí no cambian', s.reglas.length === 0 && mantener.reglas.length === 0, j(mantener.reglas))
  check('NEGATIVO: no se crea ningún perfil y el de aquí conserva nombre y color', mantener.nuevos.length === 0 && j(mantener.fusionados) === j(['portatil-1']), j(mantener))
  const sSust = seleccionParaImportar(a, seleccionInicial(a), new Set(['portatil-1']))
  const sustituir = planPerfiles(AQUI, [portatil], sSust)
  check('sustituir: las del archivo van al perfil de aquí', j(sustituir.reglas) === j([{ perfil: 'personal', reglas: 'Usa yarn.' }]), j(sustituir.reglas))
  const soloReglas = seleccionParaImportar(a, new Set(), new Set(['portatil-1']))
  check('sustituir sin nada más marcado ya es algo que importar', haySeleccion(soloReglas) && j(soloReglas.perfiles) === j(['portatil-1']) && j(soloReglas.reglas) === j(['portatil-1']), j(soloReglas))

  hr('(5) Reglas vacías aquí: se traen; iguales: nada que elegir')
  const aTrabajo = arbolDe(perfil('t-portatil', 'Trabajo', 'Commits en español.'), 'trabajo')
  const hijoReglas = aTrabajo.perfiles[0].hijos.find((h) => h.tipo === 'reglas')
  check('vacías aquí: una casilla, marcada de serie', aTrabajo.perfiles[0].reglas === 'traer' && hijoReglas?.yaEsta === false && seleccionInicial(aTrabajo).has(hijoReglas.clave), j(hijoReglas))
  const sTraer = seleccionParaImportar(aTrabajo, seleccionInicial(aTrabajo))
  check('y se ponen en el destino', j(planPerfiles(AQUI, [perfil('t-portatil', 'Trabajo', 'Commits en español.')], sTraer).reglas) === j([{ perfil: 'trabajo', reglas: 'Commits en español.' }]), j(sTraer))
  const aIguales = arbolDe(perfil('p2', 'Personal', 'Usa pnpm.\r\nNo toques main.  '), 'personal')
  check('iguales: sin casilla y sin nada que poner', aIguales.perfiles[0].reglas === 'iguales' && seleccionParaImportar(aIguales, seleccionInicial(aIguales)).reglas.length === 0, j(aIguales.perfiles[0]))
  const aSin = arbolDe(perfil('p3', 'Personal'), 'personal')
  check('NEGATIVO: el archivo sin reglas no enseña fila de reglas', aSin.perfiles[0].reglas === null && !aSin.perfiles[0].hijos.some((h) => h.tipo === 'reglas'), '')
  const aNuevo = arbolDe(perfil('casa', 'Casa', 'Algo.'), null)
  check('NEGATIVO: un perfil nuevo se lleva sus reglas sin fila aparte', aNuevo.perfiles[0].reglas === null && !aNuevo.perfiles[0].perfil.yaEsta, '')

  hr('(6) Archivo sin frase: nada elegido, ni sustituir las reglas')
  const vacia = new Set<string>()
  const sSinFrase = seleccionParaImportar(a, vacia)
  check('nada que importar', !haySeleccion(sSinFrase) && planPerfiles(AQUI, [portatil], sSinFrase).reglas.length === 0, j(sSinFrase))
  const conServidor = seleccionParaImportar(aTrabajo, new Set([aTrabajo.perfiles[0].hijos.find((h) => h.tipo === 'ssh')!.clave]))
  check('NEGATIVO: marcar una conexión no trae las reglas', conServidor.reglas.length === 0 && conServidor.perfiles.length === 1, j(conServidor))

  hr('(7) Cambiar el destino')
  const aNuevoPortatil = arbolDe(portatil, null)
  const conFrase = seleccionTrasCambiarDestino(aNuevoPortatil, seleccionInicial(a), 'portatil-1', true)
  const sNuevo = seleccionParaImportar(aNuevoPortatil, conFrase)
  check('a «Perfil nuevo» con frase: se marca entero, los dos agentes incluidos', conFrase.has(aNuevoPortatil.perfiles[0].perfil.clave) && j(sNuevo.agentesPorPerfil) === j({ 'portatil-1': ['m-orca', 'm-pez'] }) && sNuevo.destinos['portatil-1'] === null, j(sNuevo))
  const ssh = aNuevoPortatil.perfiles[0].hijos.find((h) => h.tipo === 'ssh')!.clave
  const sinFrase = seleccionTrasCambiarDestino(aNuevoPortatil, new Set([ssh]), 'portatil-1', false)
  check('sin frase: conserva lo marcado (y su perfil) y no marca nada más', j([...sinFrase].sort()) === j([aNuevoPortatil.perfiles[0].perfil.clave, ssh].sort()), j([...sinFrase]))
  const deVuelta = seleccionTrasCambiarDestino(a, conFrase, 'portatil-1', true)
  check('de vuelta a «Personal»: fuera lo que ya está allí', !deVuelta.has(a.perfiles[0].hijos.find((h) => h.id === 'm-orca')!.clave) && !deVuelta.has(a.perfiles[0].perfil.clave), j([...deVuelta]))
}

function plan(): void {
  hr('(8) Qué perfiles se crean y con qué id')
  const elegir = (perfiles: string[], destinos: Record<string, string | null>) => ({ perfiles, destinos, reglas: [] })
  const casa = perfil('casa', 'Casa')
  const nuevo = planPerfiles(AQUI, [casa], elegir(['casa'], { casa: null }))
  check('nuevo sin choque: con su id, tal cual', nuevo.nuevos[0] === casa && nuevo.destinos.casa === 'casa' && nuevo.fusionados.length === 0, j(nuevo))
  const otroPersonal = perfil('personal', 'Personal', 'Otras.')
  const choque = planPerfiles(AQUI, [otroPersonal], elegir(['personal'], { personal: null }))
  const creado = choque.nuevos[0]
  check('nuevo con el id ocupado: id libre y sus carpetas con él', creado?.id === 'personal-2' && creado.agentes[0].configDir === './.tessera/perfiles/personal-2/claude' && choque.destinos.personal === 'personal-2', j(creado))
  check('NEGATIVO: el perfil del archivo no se toca', otroPersonal.id === 'personal' && otroPersonal.agentes[0].configDir === './.tessera/perfiles/personal/claude', '')
  const dos = planPerfiles(AQUI, [perfil('personal', 'A'), perfil('personal-2', 'B')], elegir(['personal', 'personal-2'], {}))
  check('dos que chocan entre sí tampoco comparten id', j(dos.nuevos.map((p) => p.id)) === j(['personal-2', 'personal-2-2']), j(dos.nuevos.map((p) => p.id)))
  const viejo = planPerfiles(AQUI, [casa], elegir(['casa'], { casa: 'ya-no-existe' }))
  check('un destino que ya no existe: perfil nuevo', viejo.nuevos.length === 1 && viejo.destinos.casa === 'casa', j(viejo))
  const repetido = planPerfiles(AQUI, [casa, perfil('casa', 'Casa bis')], elegir(['casa'], { casa: null }))
  check('un id repetido en el archivo entra una vez', repetido.nuevos.length === 1 && repetido.nuevos[0].nombre === 'Casa', j(repetido.nuevos))
  check('NEGATIVO: lo no elegido no entra', planPerfiles(AQUI, [casa], elegir([], {})).nuevos.length === 0, '')

  hr('(9) Los agentes de la copia, al perfil de destino')
  const copia = {
    nativos: [],
    dockerPorPerfil: { 'portatil-1': [def('m-orca'), def('m-pez', { instalacion: 'npm i -g pez' })], casa: [def('m-gato')] },
    ocultosPorPerfil: { 'portatil-1': ['codex'], casa: ['codex'] }
  }
  const sel = { nativos: [], agentesPorPerfil: { 'portatil-1': ['m-orca', 'm-pez'], casa: ['m-gato'] } }
  const destinosPlan = { 'portatil-1': 'personal', casa: 'casa' }
  const actual = { agentesNativos: [], agentesDockerPorPerfil: { personal: [def('m-orca', { comando: 'orca-mio' })] }, agentesOcultosPorPerfil: { personal: ['claude-code' as const] } }
  const f = fusionarAgentes(actual, reasignarAgentes(agentesSeleccionados(copia, sel), destinosPlan), ['personal', 'casa'], ['casa'])
  check('al destino solo los que le faltan; el suyo no se pisa', j(f.agentesDockerPorPerfil.personal?.map((d) => [d.id, d.comando])) === j([['m-orca', 'orca-mio'], ['m-pez', 'pez']]), j(f.agentesDockerPorPerfil.personal))
  check('NEGATIVO: nada bajo el id del archivo', !('portatil-1' in f.agentesDockerPorPerfil), j(Object.keys(f.agentesDockerPorPerfil)))
  check('los ocultos del destino no cambian; el nuevo toma los suyos', j(f.agentesOcultosPorPerfil.personal) === j(['claude-code']) && j(f.agentesOcultosPorPerfil.casa) === j(['codex']), j(f.agentesOcultosPorPerfil))
  check('la capa se aplica al perfil de destino', j(f.perfilesConInstalacion) === j(['personal']), j(f.perfilesConInstalacion))
  const juntos = reasignarAgentes({ dockerPorPerfil: { a: [def('m-1')], b: [def('m-2')] } }, { a: 'x', b: 'x' }) as { dockerPorPerfil: Record<string, DefinicionAgente[]> }
  check('dos perfiles al mismo destino juntan sus agentes', j(juntos.dockerPorPerfil.x.map((d) => d.id)) === j(['m-1', 'm-2']), j(juntos))
  const dosAlMismo = planPerfiles(
    [{ id: 'personal' }],
    [
      { id: 'a', nombre: 'Personal', reglas: 'Reglas de a.', agentes: [] },
      { id: 'b', nombre: 'Personal', reglas: 'Reglas de b.', agentes: [] }
    ],
    { perfiles: ['a', 'b'], destinos: { a: 'personal', b: 'personal' }, reglas: ['a', 'b'] }
  )
  check('dos perfiles al mismo destino: manda el primero, el segundo no pisa', j(dosAlMismo.reglas) === j([{ perfil: 'personal', reglas: 'Reglas de a.' }]), j(dosAlMismo.reglas))
}

function cuentas(): void {
  hr('Qué cuenta de aquí corresponde a una del archivo')
  const c = (id: string, agente: string, nombre: string, predeterminada = false) => ({ id, agente, nombre, predeterminada })
  const aqui = [c('d-1', 'claude-code', 'Predeterminada', true), c('u-9', 'codex', 'Trabajo'), c('u-8', 'codex', 'Personal')]
  check('la predeterminada con la predeterminada, aunque otro id', emparejarCuenta(c('d-2', 'claude-code', 'Predeterminada', true), aqui)?.id === 'd-1', '')
  check('la misma cuenta renombrada aquí: por su id', emparejarCuenta(c('u-9', 'codex', 'Antes se llamaba así'), aqui)?.id === 'u-9', '')
  check('creada a mano en otro equipo: por el nombre, sin distinguir mayúsculas', emparejarCuenta(c('otro-id', 'codex', ' personal '), aqui)?.id === 'u-8', '')
  check('NEGATIVO: un nombre de otro agente no empareja', emparejarCuenta(c('x', 'claude-code', 'Trabajo'), aqui) === null, '')
  check('NEGATIVO: una predeterminada no empareja con una creada', emparejarCuenta(c('x', 'codex', 'Trabajo', true), aqui) === null, '')
  check('NEGATIVO: sin coincidencia, habría que crearla', emparejarCuenta(c('x', 'codex', 'Nueva'), aqui) === null, '')
}

destinos()
arbolYSeleccion()
plan()
cuentas()
const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
