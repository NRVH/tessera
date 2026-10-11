// =============================================================================
// Prueba de la actividad de los agentes con `tssh` (npm run test:actividad-tssh): las líneas que escribe
// el registro de verdad (`lineaAuditoria` + `crearRegistroTssh`) se leen como entradas, del perfil pedido,
// la más reciente primero y con el `.old` detrás; lo que no tiene la forma se salta.
// =============================================================================

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { actividadDe, entradaDeLinea } from './actividadTssh.ts'
import { crearRegistroTssh, leerRegistroTssh } from './adaptadores/registroTssh.ts'
import { lineaAuditoria } from './controlador/puenteTssh.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

const dir = mkdtempSync(path.join(os.tmpdir(), 'tessera-actividad-'))
try {
  hr('1 - Lo que escribe el registro de verdad se lee igual')
  const escribir = crearRegistroTssh(dir)
  escribir(lineaAuditoria({ perfil: 'pa', sub: 'run', alias: 'Servidor "uno"', resto: 'inicio' }))
  escribir(lineaAuditoria({ perfil: 'pa', sub: 'run', alias: 'Servidor "uno"', resto: 'codigo=0 ms=1234' }))
  escribir(lineaAuditoria({ perfil: 'pb', sub: 'run', alias: 'ajena', resto: 'codigo=0 ms=5' }))
  escribir(lineaAuditoria({ perfil: 'pa', sub: 'cp', alias: 'no-existe', resto: 'codigo=4 rechazada' }))
  escribir(lineaAuditoria({ perfil: 'pa', sub: 'doctor', alias: 'caída', resto: 'codigo=255 ms=90 motivo=ssh-inalcanzable' }))
  escribir(lineaAuditoria({ perfil: 'pa', sub: 'run', alias: 'lenta', resto: 'codigo=- ms=30000 tope' }))
  const a = actividadDe(await leerRegistroTssh(dir), 'pa')
  check('(1a) solo las del perfil, sin la de inicio, la más reciente primero', j(a.entradas.map((e) => e.alias)) === j(['lenta', 'caída', 'no-existe', 'Servidor "uno"']) && !a.mas, j(a.entradas.map((e) => e.alias)))
  const [lenta, caida, rechazada, bien] = a.entradas
  check('(1b) terminada bien: código 0 y lo que tardó; el alias con comillas intacto', bien.estado === 'terminada' && bien.codigo === 0 && bien.ms === 1234 && bien.uso === 'run' && bien.alias === 'Servidor "uno"', j(bien))
  check('(1c) rechazada: el código de tssh, sin duración', rechazada.estado === 'rechazada' && rechazada.codigo === 4 && rechazada.ms === null && rechazada.uso === 'cp', j(rechazada))
  check('(1d) con motivo de ssh', caida.motivo === 'ssh-inalcanzable' && caida.codigo === 255 && caida.uso === 'doctor', j(caida))
  check('(1e) cortada por su tope y sin código', lenta.tope && lenta.codigo === null && lenta.ms === 30000, j(lenta))
  check('(1f) la fecha es la ISO del registro', !Number.isNaN(new Date(bien.fecha).getTime()), bien.fecha)

  hr('2 - El .old va detrás, lo raro se salta y hay tope')
  writeFileSync(path.join(dir, 'ssh.log.old'), `[2026-01-01T00:00:00.000Z] perfil=pa sub=run alias="vieja" codigo=1 ms=10\nbasura\n[x] perfil=pa sub=rm alias="a" codigo=0 ms=1\n[2026-01-01T00:00:01.000Z] perfil=pa sub=run alias="rota codigo=0 ms=1\n`)
  const b = actividadDe(await leerRegistroTssh(dir), 'pa')
  check('(2a) la del .old sale la última (es la más antigua); lo que no tiene la forma, fuera', b.entradas.length === 5 && b.entradas[4].alias === 'vieja', j(b.entradas.map((e) => e.alias)))
  const c = actividadDe(await leerRegistroTssh(dir), 'pa', 2)
  check('(2b) con tope: las más recientes y `mas`', c.entradas.length === 2 && c.mas && c.entradas[0].alias === 'lenta', j(c))
  check('(2c) un motivo que no se conoce no se inventa', entradaDeLinea('[t] perfil=pa sub=run alias="a" codigo=255 ms=1 motivo=otro', 'pa')?.motivo === undefined, 'sin motivo')
  check('(2d) un perfil cuyo id es prefijo de otro no se cuela', entradaDeLinea('[t] perfil=pab sub=run alias="a" codigo=0 ms=1', 'pa') === null, 'null')
  const conInicios = [
    '[2026-01-02T00:00:00.000Z] perfil=pa sub=run alias="x" inicio',
    '[2026-01-02T00:00:01.000Z] perfil=pa sub=run alias="x" inicio',
    '[2026-01-02T00:00:02.000Z] perfil=pa sub=cp alias="x" inicio',
    '[2026-01-02T00:00:03.000Z] perfil=pa sub=run alias="x" codigo=0 ms=3000'
  ].join('\n')
  const d = actividadDe(conInicios, 'pa').entradas
  check(
    '(2f) un inicio sin fin se enseña («sin final»); cada fin se lleva el inicio más antiguo de su uso y alias',
    d.length === 3 && d[0].estado === 'terminada' && d[1].estado === 'sinFinal' && d[1].uso === 'cp' && d[2].estado === 'sinFinal' && d[2].fecha === '2026-01-02T00:00:01.000Z',
    j(d.map((e) => `${e.uso}:${e.estado}:${e.fecha.slice(17, 19)}`))
  )
  const vacio = mkdtempSync(path.join(os.tmpdir(), 'tessera-actividad-vacia-'))
  check('(2e) sin registro: ninguna', actividadDe(await leerRegistroTssh(vacio), 'pa').entradas.length === 0, 'vacía')
  rmSync(vacio, { recursive: true, force: true })
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
