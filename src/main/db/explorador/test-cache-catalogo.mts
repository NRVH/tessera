#!/usr/bin/env node
// =============================================================================
// Prueba de la caché del catálogo (`CacheCatalogo.ts`): cargas compartidas, invalidación por generación, LRU por conexión
// y claves con base. Pura: las cargas son promesas controlables, sin electron ni trabajador.
// (node src/main/db/explorador/test-cache-catalogo.mts  ·  npm run test:db-cache-catalogo)
// =============================================================================

import type { DbEventoCatalogo } from '../../../shared/db-explorador-ipc.ts'
import { CacheCatalogo, type ClaveCache } from './CacheCatalogo.ts'

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

class Diferido<T> {
  promesa: Promise<T>
  resolver!: (v: T) => void
  rechazar!: (e: unknown) => void
  constructor() {
    this.promesa = new Promise<T>((res, rej) => {
      this.resolver = res
      this.rechazar = rej
    })
  }
}

const tic = (): Promise<void> => new Promise((r) => setImmediate(r))

const TABLAS: ClaveCache = { familia: 'objetos', esquema: 'public', resto: ['tabla'] }

function nueva(max?: number): { cache: CacheCatalogo; eventos: DbEventoCatalogo[] } {
  const eventos: DbEventoCatalogo[] = []
  const cache = new CacheCatalogo({ emitir: (e) => eventos.push(e), maxPorConexion: max })
  return { cache, eventos }
}

async function main(): Promise<void> {
  hr('(1) Deduplicación, lo guardado y los errores')
  {
    const { cache } = nueva()
    const d = new Diferido<string[]>()
    let cargas = 0
    const cargar = (): Promise<string[]> => {
      cargas++
      return d.promesa
    }
    const a = cache.memo('c1', TABLAS, cargar)
    const b = cache.memo('c1', TABLAS, cargar)
    await tic()
    check('dos peticiones simultáneas: una sola carga', cargas === 1, `cargas=${cargas}`)
    d.resolver(['a'])
    const [ra, rb] = await Promise.all([a, b])
    check('las dos reciben el mismo valor', JSON.stringify(ra) === '["a"]' && ra === rb, JSON.stringify([ra, rb]))
    const c = await cache.memo('c1', TABLAS, cargar)
    check('lo guardado se sirve sin volver a cargar', cargas === 1 && JSON.stringify(c) === '["a"]', `cargas=${cargas}`)

    let fallos = 0
    const clave: ClaveCache = { familia: 'detalle', esquema: 'public', resto: ['t'] }
    const falla = (): Promise<string> => {
      fallos++
      return Promise.reject(new Error('sin red'))
    }
    await cache.memo('c1', clave, falla).catch(() => undefined)
    const otra = await cache.memo('c1', clave, async () => 'bien')
    check('un error no se cachea: el siguiente intento vuelve a cargar', fallos === 1 && otra === 'bien', `fallos=${fallos} valor=${otra}`)
  }

  hr('(2) Invalidar con una carga en vuelo')
  {
    // Resuelve primero la NUEVA y después la vieja.
    const { cache } = nueva()
    const vieja = new Diferido<string[]>()
    const nuevaCarga = new Diferido<string[]>()
    const pv = cache.memo('c1', TABLAS, () => vieja.promesa)
    await tic()
    cache.invalidar('c1', { esquema: 'public', motivo: 'ddl' })
    let cargoNueva = false
    const pn = cache.memo('c1', TABLAS, () => {
      cargoNueva = true
      return nuevaCarga.promesa
    })
    await tic()
    check('tras invalidar, la petición nueva NO se engancha a la carga vieja', cargoNueva && pn !== pv, `cargó=${cargoNueva}`)
    nuevaCarga.resolver(['a', 'b'])
    const rn = await pn
    vieja.resolver(['a'])
    const rv = await pv
    check('cada llamador recibe la carga que pidió', JSON.stringify(rv) === '["a"]' && JSON.stringify(rn) === '["a","b"]', `${JSON.stringify(rv)} / ${JSON.stringify(rn)}`)
    const guardado = cache.obtener<string[]>('c1', TABLAS)
    check('lo guardado es lo de DESPUÉS del DDL, aunque la vieja termine la última', JSON.stringify(guardado) === '["a","b"]', JSON.stringify(guardado))
  }
  {
    // Resuelve primero la VIEJA: no guarda nada ni borra el vuelo nuevo.
    const { cache } = nueva()
    const vieja = new Diferido<string[]>()
    const nuevaCarga = new Diferido<string[]>()
    const pv = cache.memo('c1', TABLAS, () => vieja.promesa)
    await tic()
    cache.invalidar('c1', { motivo: 'refrescar' })
    let cargas = 0
    const pn = cache.memo('c1', TABLAS, () => {
      cargas++
      return nuevaCarga.promesa
    })
    await tic()
    vieja.resolver(['a'])
    await pv
    check('la carga vieja que termina primero no se guarda', cache.obtener('c1', TABLAS) === undefined, JSON.stringify(cache.obtener('c1', TABLAS)))
    const tercera = cache.memo('c1', TABLAS, () => {
      cargas++
      return Promise.resolve(['otra'])
    })
    await tic()
    check('ni borra la nueva: una tercera petición se engancha a ella', cargas === 1, `cargas=${cargas}`)
    nuevaCarga.resolver(['a', 'b'])
    const [rn, rt] = await Promise.all([pn, tercera])
    check('la tercera recibe el dato nuevo y queda guardado', rn === rt && JSON.stringify(cache.obtener('c1', TABLAS)) === '["a","b"]', JSON.stringify(rt))
  }
  {
    // La invalidación de OTRA conexión no afecta a esta.
    const { cache } = nueva()
    const d = new Diferido<string[]>()
    let cargas = 0
    const cargar = (): Promise<string[]> => {
      cargas++
      return d.promesa
    }
    const a = cache.memo('c1', TABLAS, cargar)
    await tic()
    cache.invalidar('c2', { motivo: 'refrescar' })
    const b = cache.memo('c1', TABLAS, cargar)
    await tic()
    d.resolver(['x'])
    await Promise.all([a, b])
    check('invalidar otra conexión no rompe el compartir', cargas === 1, `cargas=${cargas}`)
  }

  hr('(3) Invalidación por esquema y evento')
  {
    const { cache, eventos } = nueva()
    const enVentas: ClaveCache = { familia: 'objetos', esquema: 'ventas', resto: ['tabla'] }
    cache.guardar('c1', TABLAS, ['a'])
    cache.guardar('c1', enVentas, ['f'])
    cache.invalidar('c1', { esquema: 'public', motivo: 'ddl' })
    check('solo se borra el esquema invalidado', cache.obtener('c1', TABLAS) === undefined && cache.obtener('c1', enVentas) !== undefined, `tamaño=${cache.tamano('c1')}`)
    const ev = eventos[eventos.length - 1]
    check('emite dbx:ev:catalogo con el esquema', ev?.conexionId === 'c1' && ev.esquema === 'public' && ev.motivo === 'ddl', JSON.stringify(ev))
    cache.invalidar('c9', { motivo: 'refrescar' })
    check('emite aunque la conexión no tuviera nada', eventos.length === 2 && eventos[1].conexionId === 'c9', `${eventos.length} eventos`)
  }
  {
    // las FK que ENTRAN en `public.padre` las crea un DDL en OTRO esquema.
    const { cache } = nueva()
    const fksPadre: ClaveCache = { familia: 'fks', esquema: 'public', resto: ['padre'] }
    const detalleVentas: ClaveCache = { familia: 'detalle', esquema: 'ventas', resto: ['t', 'columnas'] }
    cache.guardar('c1', fksPadre, { salientes: [], entrantes: [] })
    cache.guardar('c1', detalleVentas, ['x'])
    cache.guardar('c2', fksPadre, { salientes: [], entrantes: [] })
    cache.invalidar('c1', { esquema: 'compras', motivo: 'ddl' })
    check(
      'un DDL en otro esquema borra las FK (cruzan esquemas) y nada más',
      cache.obtener('c1', fksPadre) === undefined && cache.obtener('c1', detalleVentas) !== undefined,
      `tamaño=${cache.tamano('c1')}`
    )
    check('… y solo en su conexión', cache.obtener('c2', fksPadre) !== undefined, 'c2 intacta')
    cache.guardar('c1', fksPadre, { salientes: [], entrantes: [] })
    cache.invalidar('c1', { esquema: 'compras', motivo: 'ddl', familias: ['objetos'] })
    check('una invalidación restringida a otras familias no las toca', cache.obtener('c1', fksPadre) !== undefined, 'intacta')
  }

  hr('(4) Tope LRU por conexión')
  {
    const { cache } = nueva(2)
    const k = (n: string): ClaveCache => ({ familia: 'detalle', esquema: 'public', resto: [n] })
    cache.guardar('c1', k('a'), 1)
    cache.guardar('c1', k('b'), 2)
    cache.obtener('c1', k('a'))
    cache.guardar('c1', k('c'), 3)
    check('se expulsa lo menos usado (b), no lo recién leído (a)', cache.obtener('c1', k('b')) === undefined && cache.obtener('c1', k('a')) === 1 && cache.tamano('c1') === 2, `tamaño=${cache.tamano('c1')}`)
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

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
