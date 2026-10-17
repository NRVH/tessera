#!/usr/bin/env node
// =============================================================================
// Prueba de `java:decompile` por el canal REGISTRADO (npm run test:java-service): cada petición se
// resuelve en el proyecto de su `raiz`, con el ancla en otro; una contenedora nunca anclada o una
// petición sin `raiz` responden con su error sin llegar al motor. El motor es un doble: no hace
// falta JVM. Fixture temporal.
// =============================================================================

import { register } from 'node:module'
import { mkdtempSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { JAVA_CHANNELS } from '../../shared/java-ipc.ts'
import type { DescompilarRequest, DescompilarResult } from '../../shared/java-ipc.ts'

// Resolver-hook: 'electron' a un stub inerte + reintento .ts para los imports sin extensión.
// Se registra ANTES de cargar el servicio, de ahí el import DINÁMICO.
const electronStub =
  'export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };' +
  'export const app = { getAppPath: () => process.cwd(), getPath: () => process.env.TEMP || "/tmp" };'
// El motor es un doble (el real usa sintaxis que Node no borra sin compilar): guarda su única
// instancia en `globalThis.__descompiladorFalso` para que la prueba mire qué se le pidió.
const decompilerStub =
  'export class Decompiler {' +
  ' constructor() { globalThis.__descompiladorFalso = this; this.pedidos = [] }' +
  ' async barrerTemporales() {} dispose() {}' +
  ' async descompilar(req) { this.pedidos.push(req.origen.absContenedor);' +
  ' return { estado: "ok", fuente: "class A {}", path: req.path, targetKey: req.targetKey, token: req.token } } }'
const resolveTsHook = `
const ELECTRON_STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(electronStub)});
const DECOMPILER_STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(decompilerStub)});
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') {
    return { url: ELECTRON_STUB, shortCircuit: true };
  }
  if (/(^|\\/)Decompiler(\\.ts)?$/.test(spec)) {
    return { url: DECOMPILER_STUB, shortCircuit: true };
  }
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))
const { JavaService } = await import('./JavaService.ts')
const { registrarIpcJava } = await import('./ipc.ts')

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

async function main(): Promise<void> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-java-')))
  const ancla = path.join(base, 'ancla')
  const otro = path.join(base, 'otro')
  const conocidas = new Map<string, string>([
    [ancla, ancla],
    [otro, otro]
  ])
  /** Cada resolución que se hizo: contenedora pedida y ruta relativa. */
  const resueltas: { raiz: string; rel: string }[] = []

  const dir = mkdtempSync(path.join(base, 'datos-'))
  const java = new JavaService({
    jar: {} as never,
    proyecto: (raiz) => {
      if (typeof raiz !== 'string' || !conocidas.has(raiz)) throw new Error('proyecto desconocido')
      return {
        resolver: (rel) => {
          resueltas.push({ raiz, rel })
          return path.join(raiz, ...rel.split('/'))
        }
      }
    },
    rutaDatos: dir,
    dirMotores: dir,
    log: () => {}
  })
  // Contra qué carpeta se le pidió al motor (doble, sin JVM).
  const motorRecibio = (globalThis as unknown as { __descompiladorFalso: { pedidos: string[] } })
    .__descompiladorFalso.pedidos

  const handlers = new Map<string, (e: unknown, req: unknown) => unknown>()
  registrarIpcJava({
    ipc: { handle: (canal: string, fn: (e: unknown, req: unknown) => unknown) => void handlers.set(canal, fn) } as never,
    java
  })
  const decompile = async (req: Partial<DescompilarRequest>): Promise<DescompilarResult> =>
    (await handlers.get(JAVA_CHANNELS.DECOMPILE)!(null, req)) as DescompilarResult

  const base1 = { path: 'target/classes/com/A.class', motor: 'auto', targetKey: 'k', token: 1 } as const

  try {
    hr('java:decompile se atiende en el proyecto de la petición')

    // El ancla es `ancla`; la petición es de `otro`.
    const r1 = await decompile({ ...base1, raiz: otro })
    check(
      '(1a) una petición de otro proyecto se resuelve en el suyo, no en el anclado',
      r1.estado === 'ok' &&
        resueltas.length === 1 &&
        resueltas[0].raiz === otro &&
        motorRecibio[0] === path.join(otro, 'target', 'classes', 'com', 'A.class'),
      JSON.stringify({ resueltas, motorRecibio })
    )

    const antes = motorRecibio.length
    const r2 = await decompile({ ...base1, raiz: path.join(base, 'nunca-anclada') })
    check(
      '(1b) una contenedora nunca anclada responde con error, sin llegar al motor',
      r2.estado === 'entrada-no-soportada' && r2.mensaje !== '' && motorRecibio.length === antes,
      JSON.stringify({ estado: r2.estado, mensaje: r2.mensaje })
    )

    const r3 = await decompile({ ...base1 })
    check(
      '(1c) una petición sin `raiz` no se lee',
      r3.estado === 'entrada-no-soportada' && r3.mensaje !== '' && motorRecibio.length === antes,
      JSON.stringify({ estado: r3.estado, mensaje: r3.mensaje })
    )

    const r4 = await decompile({ ...base1, raiz: ancla, path: 'lib/x.jar!/com/A.class' })
    check(
      '(1d) una ruta virtual resuelve el .jar contenedor en el proyecto de la petición',
      r4.estado === 'ok' && resueltas[resueltas.length - 1].raiz === ancla && resueltas[resueltas.length - 1].rel === 'lib/x.jar',
      JSON.stringify(resueltas[resueltas.length - 1])
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

await main()
