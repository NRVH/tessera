#!/usr/bin/env node
// =============================================================================
// Prueba de `usuarioImagen` (npm run test:usuario-imagen): qué uid y gid se hornean en cada
// plataforma (solo Linux, nunca root), los `--build-arg`, que el sello coincide con el `LABEL` del
// Dockerfile y cuándo una imagen inspeccionada sigue valiendo (una anterior a la etiqueta no fuerza
// un rebuild en Windows ni en macOS).
// =============================================================================

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { argsBuildUsuario, imagenAlDia, nombreImagen, selloUsuario, usuarioImagenPara } from './usuarioImagen.ts'

let passed = 0
let failed = 0

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}

function check(name: string, pass: boolean, evidence: string): void {
  if (pass) passed++
  else failed++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

hr('(1) Qué usuario se hornea')
check('(1a) Linux con uid 1000', JSON.stringify(usuarioImagenPara('linux', 1000, 1000)) === '{"uid":1000,"gid":1000}', 'uid 1000')
check('(1b) Windows nunca', usuarioImagenPara('windows', -1, -1) === null, 'null')
check('(1c) macOS nunca', usuarioImagenPara('mac', 501, 20) === null, 'null')
check('(1d) Linux como root: el de la imagen', usuarioImagenPara('linux', 0, 0) === null, 'null')
check('(1e) uid raro: el de la imagen', usuarioImagenPara('linux', Number.NaN, 1000) === null, 'null')

hr('(2) Build-args y sello')
check('(2a) sin usuario no hay build-args', argsBuildUsuario(null).length === 0, '[]')
const args = argsBuildUsuario({ uid: 1000, gid: 1001 })
check('(2b) con usuario, los dos', args.join(' ') === '--build-arg AGENTE_UID=1000 --build-arg AGENTE_GID=1001', args.join(' '))
check('(2c) sello por defecto = el del Dockerfile sin argumentos', selloUsuario(null) === '1001:1001', selloUsuario(null))
{
  const aqui = path.dirname(fileURLToPath(import.meta.url))
  const texto = readFileSync(path.resolve(aqui, '../../../../docker/sandbox/Dockerfile'), 'utf8')
  const label = /LABEL\s+tessera\.sandbox\.usuario="([^"]+)"/.exec(texto)?.[1] ?? ''
  const uid = /ARG\s+AGENTE_UID=(\d+)/.exec(texto)?.[1]
  const gid = /ARG\s+AGENTE_GID=(\d+)/.exec(texto)?.[1]
  check('(2d) el LABEL del Dockerfile es uid:gid', label === '${AGENTE_UID}:${AGENTE_GID}', label)
  check('(2e) los valores por defecto del Dockerfile son los de USUARIO_POR_DEFECTO', `${uid}:${gid}` === selloUsuario(null), `${uid}:${gid}`)
}

hr('(3) ¿La imagen sigue valiendo?')
const base = { version: '4', extras: 'libfoo|0' }
check('(3a) Windows: imagen sin etiqueta de usuario vale', imagenAlDia('4|libfoo|0|<no value>', { ...base, usuario: null }), 'ok')
check('(3b) Linux: imagen sin etiqueta no vale', !imagenAlDia('4|libfoo|0|<no value>', { ...base, usuario: { uid: 1000, gid: 1000 } }), 'rebuild')
check('(3c) Linux: mismo usuario vale', imagenAlDia('4|libfoo|0|1000:1000\n', { ...base, usuario: { uid: 1000, gid: 1000 } }), 'ok')
check('(3d) Linux: otro usuario no vale', !imagenAlDia('4|libfoo|0|1001:1001', { ...base, usuario: { uid: 1000, gid: 1000 } }), 'rebuild')
check('(3e) otra versión no vale', !imagenAlDia('3|libfoo|0|1001:1001', { ...base, usuario: null }), 'rebuild')
check('(3f) otros extras no valen', !imagenAlDia('4|libbar|0|1001:1001', { ...base, usuario: null }), 'rebuild')
check('(3g) salida rota no vale', !imagenAlDia('', { ...base, usuario: null }), 'rebuild')
check('(3h) extras vacíos', imagenAlDia('4||0|1001:1001', { version: '4', extras: '|0', usuario: null }), 'ok')

hr('(4) Una imagen por usuario del Docker')
check('(4a) sin usuario horneado, la base de siempre', nombreImagen('tessera-sandbox-base', null) === 'tessera-sandbox-base', nombreImagen('tessera-sandbox-base', null))
check(
  '(4b) dos usuarios de Linux, dos imágenes (ninguno rehornea la del otro)',
  nombreImagen('tessera-sandbox-base', { uid: 1000, gid: 1000 }) === 'tessera-sandbox-base:u1000' &&
    nombreImagen('tessera-sandbox-base', { uid: 1001, gid: 100 }) !== nombreImagen('tessera-sandbox-base', { uid: 1000, gid: 1000 }),
  nombreImagen('tessera-sandbox-base', { uid: 1000, gid: 1000 })
)

const total = passed + failed
hr(`VEREDICTO: ${passed}/${total} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed === 0 ? 0 : 1)
