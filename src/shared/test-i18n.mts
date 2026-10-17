// =============================================================================
// Pruebas de `i18n.ts`: el idioma del sistema (el primero que Tessera habla, si no inglés), la
// preferencia guardada, el argumento de la ventana y que `crearTextos` siga al idioma activo.
// Uso: node src/shared/test-i18n.mts
// =============================================================================

import {
  ARGUMENTO_IDIOMA,
  crearTextos,
  fijarIdioma,
  idiomaActual,
  idiomaDeArgumentos,
  idiomaDeLocales,
  localeActual,
  normalizarPreferenciaIdioma,
  resolverIdioma
} from './i18n.ts'
import { nombresSistema } from './nombresSistema.ts'

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

hr('(1) El idioma del sistema')
check('es-MX es español', idiomaDeLocales(['es-MX']) === 'es', '')
check('en-GB es inglés', idiomaDeLocales(['en-GB']) === 'en', '')
check('el primero que se habla manda: fr, es, en -> es', idiomaDeLocales(['fr-FR', 'es-ES', 'en-US']) === 'es', '')
check('con guion bajo también', idiomaDeLocales(['ES_es']) === 'es', '')
check('NEGATIVO: ninguno que se hable -> inglés', idiomaDeLocales(['de-DE', 'ja']) === 'en', '')
check('NEGATIVO: sin lista -> inglés', idiomaDeLocales([]) === 'en', '')

hr('(2) La preferencia guardada')
check('sistema sigue al equipo', resolverIdioma('sistema', ['en-US']) === 'en', '')
check('una elegida manda sobre el equipo', resolverIdioma('es', ['en-US']) === 'es', '')
check('un valor raro vuelve a «sistema»', normalizarPreferenciaIdioma('fr') === 'sistema' && normalizarPreferenciaIdioma(undefined) === 'sistema', '')
check('es y en se conservan', normalizarPreferenciaIdioma('en') === 'en' && normalizarPreferenciaIdioma('es') === 'es', '')

hr('(3) El argumento de la ventana')
check('lo lee', idiomaDeArgumentos(['x', `${ARGUMENTO_IDIOMA}en`]) === 'en', '')
check('NEGATIVO: sin argumento, español', idiomaDeArgumentos(['x']) === 'es', '')
check('NEGATIVO: uno desconocido, español', idiomaDeArgumentos([`${ARGUMENTO_IDIOMA}fr`]) === 'es', '')

hr('(4) Los textos siguen al idioma activo')
const tx = crearTextos(
  { hola: 'Hola', n: (n: number) => `${n} perfil${n === 1 ? '' : 'es'}`, grupo: { a: 'A' } },
  { hola: 'Hello', n: (n) => `${n} profile${n === 1 ? '' : 's'}`, grupo: { a: 'A-en' } }
)
check('por defecto, español', idiomaActual() === 'es' && tx().hola === 'Hola' && tx().n(2) === '2 perfiles', tx().n(2))
fijarIdioma('en')
check('en inglés, el inglés', tx().hola === 'Hello' && tx().n(1) === '1 profile' && tx().grupo.a === 'A-en', tx().n(1))
check('el locale de fechas y números también', localeActual() === 'en-US', localeActual())
check('los nombres del sistema, en inglés', nombresSistema('mac').papelera === 'the Trash', nombresSistema('mac').papelera)
fijarIdioma('es')
check('y de vuelta', tx().hola === 'Hola' && nombresSistema('mac').papelera === 'la Papelera' && localeActual() === 'es-ES', '')

const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
