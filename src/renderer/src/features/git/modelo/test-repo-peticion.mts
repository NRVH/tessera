// =============================================================================
// La regla "nunca preguntes sin decir de quién" (ver repoDePeticion.ts).
//
// Es una función de tres líneas y aun así tiene test propio, porque lo que fija
// no es el cálculo sino el INVARIANTE: que del par (repo elegido, contenedora)
// nunca sale `undefined` habiendo proyecto. Ese `undefined` es exactamente lo que
// dejaba al panel de Git·Log enseñando la historia de otro perfil con la cabecera
// de este.
// =============================================================================
import { repoDePeticion } from './repoDePeticion.ts'

let total = 0
let pasadas = 0

function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}

function check(nombre: string, ok: boolean, evidencia: string): void {
  total += 1
  if (ok) pasadas += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

const PROY_A = 'D:\\Proyectos\\demo'
const PROY_B = 'D:\\Proyectos\\proyecto-b'
const REPO_B = `${PROY_B}\\cli-admin`

hr('(1) con repo elegido manda el repo')
check(
  'un repo escaneado gana a la contenedora',
  repoDePeticion(REPO_B, PROY_B) === REPO_B,
  `-> ${repoDePeticion(REPO_B, PROY_B)}`
)

hr('(2) SIN repo elegido manda la CONTENEDORA, nunca nada')
check(
  'sin repo cae a la contenedora del proyecto',
  repoDePeticion(null, PROY_A) === PROY_A,
  `-> ${repoDePeticion(null, PROY_A)}`
)
check(
  'y por tanto NUNCA es null habiendo proyecto',
  repoDePeticion(null, PROY_A) !== null && repoDePeticion(null, PROY_B) !== null,
  'este es el invariante: con proyecto, siempre hay identidad que mandar'
)

hr('(3) sin proyecto no hay nada que preguntar')
check(
  'sin proyecto devuelve null (quien llama debe CORTAR, no mandar undefined)',
  repoDePeticion(null, null) === null,
  '-> null'
)

hr('(4) dos proyectos distintos NUNCA producen la misma identidad')
{
  // El fallo real: el panel montado en el perfil B preguntaba sin identidad y el
  // backend le contestaba con el repo del perfil A. Con la regla, lo que viaja
  // distingue a los dos proyectos aunque ninguno tenga repo escaneado.
  const a = repoDePeticion(null, PROY_A)
  const b = repoDePeticion(null, PROY_B)
  check(
    'la contenedora ya distingue los proyectos sin repos escaneados',
    a !== b && a !== null && b !== null,
    `${a} != ${b}`
  )
}

hr('RESULTADO (PASS/FAIL)')
const allPass = pasadas === total
console.log(`VEREDICTO: ${pasadas}/${total} PASS${allPass ? ' — TODO PASS' : ' — HAY FALLOS'}`)
process.exit(allPass ? 0 : 1)
