#!/usr/bin/env node
// =============================================================================
// Prueba de `scripts/firmarMac.mjs` (`npm run test:firma-mac`): qué firma toca según el entorno
// (certificado con su llavero, ad-hoc sin él, y error si el llavero no existe o si la firma es
// obligatoria y falta), y que el requisito designado se reconozca solo si es el del certificado
// de Tessera para el identificador del ejecutable principal.
// =============================================================================

import { decidirFirma, HUELLA_CERTIFICADO, identificadorDelRequisito, requisitoDelCertificado } from './firmarMac.mjs'

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
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
function mensajeDe(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const existe = (r: string): boolean => r === '/ruta/firma.keychain-db'
const huella = HUELLA_CERTIFICADO.toLowerCase()
const requisito = (identificador: string, h: string, eslabon = 'leaf'): string =>
  `Executable=/x/Tessera.app/Contents/MacOS/Tessera\ndesignated => identifier "${identificador}" and certificate ${eslabon} = H"${h}"\n`

function main(): void {
  hr('1. decidirFirma')
  const conLlavero = decidirFirma({ TESSERA_FIRMA_MAC_LLAVERO: '/ruta/firma.keychain-db' }, existe)
  check(
    '(1a) con llavero existente: certificado con ese llavero',
    conLlavero.tipo === 'certificado' && conLlavero.llavero === '/ruta/firma.keychain-db',
    JSON.stringify(conLlavero)
  )
  const obligatoriaConLlavero = decidirFirma(
    { TESSERA_FIRMA_MAC_LLAVERO: ' /ruta/firma.keychain-db ', TESSERA_FIRMA_MAC_OBLIGATORIA: '1' },
    existe
  )
  check('(1b) obligatoria y con llavero (con espacios alrededor): certificado', obligatoriaConLlavero.tipo === 'certificado', JSON.stringify(obligatoriaConLlavero))
  const sinNada = decidirFirma({}, existe)
  check('(1c) sin llavero ni obligación: ad-hoc', sinNada.tipo === 'adhoc', JSON.stringify(sinNada))
  check('(1d) un llavero vacío cuenta como ninguno', decidirFirma({ TESSERA_FIRMA_MAC_LLAVERO: '  ' }, existe).tipo === 'adhoc', 'adhoc')
  const noExiste = mensajeDe(() => decidirFirma({ TESSERA_FIRMA_MAC_LLAVERO: '/no/esta.keychain-db' }, existe))
  check('(1e) un llavero que no existe lanza, no se queda en ad-hoc', noExiste?.includes('/no/esta.keychain-db') === true, String(noExiste))
  const falta = mensajeDe(() => decidirFirma({ TESSERA_FIRMA_MAC_OBLIGATORIA: '1' }, existe))
  check('(1f) obligatoria sin llavero lanza y nombra la variable', falta?.includes('TESSERA_FIRMA_MAC_LLAVERO') === true, String(falta))
  check('(1g) solo «1» la hace obligatoria', decidirFirma({ TESSERA_FIRMA_MAC_OBLIGATORIA: 'true' }, existe).tipo === 'adhoc', 'adhoc')

  hr('2. requisitoDelCertificado')
  check('(2a) el requisito del certificado y el identificador: sí', requisitoDelCertificado(requisito('com.noe.tessera', huella)), 'sí')
  check(
    '(2b) la huella en mayúsculas también: codesign la escribe en minúsculas',
    requisitoDelCertificado(requisito('com.noe.tessera', HUELLA_CERTIFICADO)),
    'sí'
  )
  check(
    '(2b2) escrito como raíz (un autofirmado es hoja y raíz): sí',
    requisitoDelCertificado(requisito('com.noe.tessera', huella, 'root')),
    'sí'
  )
  check('(2b3) otro eslabón de la cadena (intermedio): no', !requisitoDelCertificado(requisito('com.noe.tessera', huella, '1')), 'no')
  check('(2c) otro certificado: no', !requisitoDelCertificado(requisito('com.noe.tessera', '0'.repeat(40))), 'no')
  check('(2d) el identificador de un proceso auxiliar: no', !requisitoDelCertificado(requisito('com.noe.tessera.helper', huella)), 'no')
  check(
    '(2e) una firma ad-hoc (requisito por cdhash): no',
    !requisitoDelCertificado('designated => cdhash H"0123456789abcdef0123456789abcdef01234567"\n'),
    'no'
  )
  const conOr = requisito('com.noe.tessera', huella).replace(/"\n$/, '" or cdhash H"0123456789abcdef0123456789abcdef01234567"\n')
  check('(2f) el del certificado con un «or» añadido: no (lo debilita)', !requisitoDelCertificado(conOr), conOr.trim().split('\n')[1])
  check('(2g) sin línea «designated»: no', !requisitoDelCertificado('Executable=/x\n'), 'no')

  hr('3. identificadorDelRequisito (procesos auxiliares)')
  const aux = identificadorDelRequisito(requisito('com.noe.tessera.helper.Renderer', huella, 'root'))
  check('(3a) el de un auxiliar firmado con el certificado: su identificador', aux === 'com.noe.tessera.helper.Renderer', String(aux))
  check('(3b) un auxiliar con otro certificado: null', identificadorDelRequisito(requisito('com.noe.tessera.helper', 'f'.repeat(40))) === null, 'null')

  hr('RESUMEN')
  for (const x of results) {
    console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}`)
    console.log(`      -> ${x.evidence}`)
  }
  const passed = results.filter((x) => x.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
