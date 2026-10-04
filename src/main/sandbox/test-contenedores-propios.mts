// =============================================================================
// Prueba de `contenedoresPropios.ts` (npm run test:contenedores-propios): solo es de Tessera
// un contenedor con el prefijo Y nacido de la imagen del sandbox, con las mitades negativas;
// la lectura de `docker inspect` parcial o ilegible; el listado con un Docker simulado; y,
// si hay Docker, tres contenedores reales sin arrancar (se salta con su motivo si no).
// Decisiones: docs/decisiones/sandbox/contenedores-propios.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import {
  ETIQUETA_IMAGEN_SANDBOX,
  FILTRO_NOMBRE_PROPIO,
  contenedoresDeTessera,
  esContenedorDeTessera,
  leerFichas,
  listarContenedoresDeTessera,
  mensajeContenedorAjeno,
  type EjecutarDocker,
  type FichaContenedor
} from './contenedoresPropios.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
const saltadas: string[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
function salta(name: string, motivo: string): void {
  saltadas.push(name)
  console.log(`  [SALTA] ${name} -> ${motivo}`)
}
const j = (v: unknown): string => JSON.stringify(v)

const IMAGEN = 'tessera-sandbox-base'
const ficha = (nombre: string, imagen: string, etiquetas: Record<string, string> | null = null): FichaContenedor => ({
  Name: `/${nombre}`,
  Config: { Image: imagen, Labels: etiquetas }
})
const conEtiqueta = { [ETIQUETA_IMAGEN_SANDBOX]: '4' }

async function main(): Promise<void> {
  hr('(1) esContenedorDeTessera')
  check('el de un perfil, con la etiqueta de la imagen', esContenedorDeTessera(ficha('tessera-qa', IMAGEN, conEtiqueta), IMAGEN), 'sí')
  check('la sonda de red, con la etiqueta', esContenedorDeTessera(ficha('tessera-sonda-red-1-1', IMAGEN, conEtiqueta), IMAGEN), 'sí')
  check(
    'uno ANTERIOR a la etiqueta: por la referencia de imagen (con y sin tag)',
    esContenedorDeTessera(ficha('tessera-qa', IMAGEN), IMAGEN) &&
      esContenedorDeTessera(ficha('tessera-qa', `${IMAGEN}:latest`, {}), IMAGEN),
    'sí'
  )
  check(
    'la etiqueta basta aunque la imagen ya se rehorneara (Config.Image es un sha)',
    esContenedorDeTessera(ficha('tessera-qa', 'sha256:abc', conEtiqueta), IMAGEN),
    'sí'
  )
  check(
    'NEGATIVO: el nombre CONTIENE el prefijo pero no empieza por él (el fallo de antes)',
    !esContenedorDeTessera(ficha('mi-tessera-db', IMAGEN, conEtiqueta), IMAGEN),
    'no'
  )
  check(
    'NEGATIVO: una base del usuario llamada «tessera-postgres» (otra imagen, sin etiqueta)',
    !esContenedorDeTessera(ficha('tessera-postgres', 'postgres:16-alpine', { maintainer: 'x' }), IMAGEN),
    'no'
  )
  check(
    'NEGATIVO: una imagen que solo EMPIEZA como la nuestra',
    !esContenedorDeTessera(ficha('tessera-x', `${IMAGEN}-otra`), IMAGEN) &&
      !esContenedorDeTessera(ficha('tessera-x', `${IMAGEN}2:latest`), IMAGEN),
    'no'
  )
  check(
    'NEGATIVO: nuestra imagen con OTRO nombre (lo levantó el usuario a mano)',
    !esContenedorDeTessera(ficha('pruebas', IMAGEN, conEtiqueta), IMAGEN),
    'no'
  )
  check(
    'NEGATIVO: etiqueta vacía y sin Labels caen a la imagen (y la imagen es ajena)',
    !esContenedorDeTessera(ficha('tessera-x', 'node:22', { [ETIQUETA_IMAGEN_SANDBOX]: '' }), IMAGEN) &&
      !esContenedorDeTessera({ Name: '/tessera-x', Config: null }, IMAGEN) &&
      !esContenedorDeTessera({}, IMAGEN),
    'no'
  )

  hr('(2) leerFichas')
  const dos = j([ficha('tessera-a', IMAGEN, conEtiqueta), ficha('tessera-b', 'redis:7')])
  check('un array de inspect', leerFichas(dos).length === 2, String(leerFichas(dos).length))
  check('vacío / ilegible / no-array = ninguno (el lado seguro para borrar)', leerFichas('').length === 0 && leerFichas('Error: x').length === 0 && leerFichas('{}').length === 0, 'ok')
  check('contenedoresDeTessera se queda con el propio y sin la barra', j(contenedoresDeTessera(dos, IMAGEN)) === j(['tessera-a']), j(contenedoresDeTessera(dos, IMAGEN)))

  hr('(3) listarContenedoresDeTessera con un Docker simulado')
  const llamadas: string[][] = []
  const falso: EjecutarDocker = async (args) => {
    llamadas.push(args)
    if (args[0] === 'ps') return { status: 0, stdout: 'tessera-qa\ntessera-postgres\n', stderr: '' }
    // Uno desapareció entre el ps y el inspect: status 1 pero imprime el otro.
    return { status: 1, stdout: j([ficha('tessera-qa', IMAGEN, conEtiqueta)]), stderr: 'Error: No such object: tessera-postgres' }
  }
  const lista = await listarContenedoresDeTessera(falso, IMAGEN)
  check('el ps filtra por el nombre ANCLADO', j(llamadas[0]) === j(['ps', '-a', '--filter', FILTRO_NOMBRE_PROPIO, '--format', '{{.Names}}']) && FILTRO_NOMBRE_PROPIO === 'name=^tessera-', j(llamadas[0]))
  check('un inspect fallido a medias se lee igual', j(lista) === j(['tessera-qa']), j(lista))
  const caido: EjecutarDocker = async () => ({ status: null, stdout: '', stderr: 'timeout' })
  check('Docker caído: null («no se sabe»), no []', (await listarContenedoresDeTessera(caido, IMAGEN)) === null, 'null')
  let inspecciones = 0
  const vacio: EjecutarDocker = async (args) => {
    if (args[0] === 'inspect') inspecciones++
    return { status: 0, stdout: '\n', stderr: '' }
  }
  check('sin candidatos: [] y sin un inspect vacío', j(await listarContenedoresDeTessera(vacio, IMAGEN)) === '[]' && inspecciones === 0, String(inspecciones))
  const inspectCaido: EjecutarDocker = async (args) =>
    args[0] === 'ps' ? { status: 0, stdout: 'tessera-qa\n', stderr: '' } : { status: null, stdout: '', stderr: 'timeout' }
  check(
    'el inspect se cae SIN salida (timeout): null, no «ninguno» (el cierre desmontaría con ellos vivos)',
    (await listarContenedoresDeTessera(inspectCaido, IMAGEN)) === null,
    'null'
  )
  const todosSeFueron: EjecutarDocker = async (args) =>
    args[0] === 'ps'
      ? { status: 0, stdout: 'tessera-qa\n', stderr: '' }
      : { status: 1, stdout: '[]\n', stderr: 'Error: No such object: tessera-qa' }
  check(
    'NEGATIVO: si desaparecieron todos entre el ps y el inspect, es [] y no null',
    j(await listarContenedoresDeTessera(todosSeFueron, IMAGEN)) === '[]',
    'ok'
  )
  check('el mensaje del contenedor ajeno dice qué hacer', /no creó Tessera/.test(mensajeContenedorAjeno('tessera-qa')) && /docker rename/.test(mensajeContenedorAjeno('tessera-qa')), mensajeContenedorAjeno('tessera-qa'))

  hr('(4) contra el Docker de verdad')
  const docker = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
    const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }
  const hay = (img: string): boolean => docker(['image', 'inspect', img]).status === 0
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) {
    salta('(4) Docker real', 'no hay Docker (o no arranca el daemon)')
  } else if (!hay(`${IMAGEN}:latest`) || !hay('node:22-alpine')) {
    salta('(4) Docker real', `faltan imágenes: ${IMAGEN}:latest (la hornea la app) y node:22-alpine`)
  } else {
    const sufijo = `${process.pid}`
    const propio = `tessera-prueba-propio-${sufijo}`
    const ajeno = `tessera-prueba-ajeno-${sufijo}`
    const contiene = `mi-tessera-prueba-${sufijo}`
    const creados = [propio, ajeno, contiene]
    try {
      // `create` y no `run`: no arranca nada, solo existe.
      docker(['create', '--name', propio, `${IMAGEN}:latest`, 'true'])
      docker(['create', '--name', ajeno, 'node:22-alpine', 'true'])
      docker(['create', '--name', contiene, 'node:22-alpine', 'true'])
      const real: EjecutarDocker = async (args) => docker(args)
      const l = (await listarContenedoresDeTessera(real, IMAGEN)) ?? []
      check('el propio sale', l.includes(propio), j(l))
      check('NEGATIVO: el ajeno con el prefijo NO sale', !l.includes(ajeno), j(l))
      check('NEGATIVO: el que lo CONTIENE no sale', !l.includes(contiene), j(l))
    } finally {
      docker(['rm', '-f', ...creados])
    }
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  const extra = saltadas.length > 0 ? ` (${saltadas.length} saltadas)` : ''
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}${extra}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('error inesperado:', err)
  process.exit(1)
})
