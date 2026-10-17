// =============================================================================
// Ida y vuelta de las conexiones por la copia de la configuración, con los registros REALES: un
// equipo A exporta (con sus secretos en claro dentro del contenido) y un equipo B, que ya tiene
// cosas, importa. Se comprueba que se conservan los ids y los enlaces (grupo, bastión, túnel de una
// base), que los secretos se vuelven a cifrar, que lo que ya está no se toca, lo que se salta, la
// vista previa sin secretos y que solo entra lo elegido.
// Uso: node src/main/configuracion/test-copia-conexiones.mts
// =============================================================================

import { register } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SshConexionInput } from '../../shared/ssh-ipc.ts'

const resolverTs = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolverTs))
const { ConnectionStore } = await import('../db/ConnectionStore.ts')
const { ConexionesSsh } = await import('../ssh/ConexionesSsh.ts')
const { importarSshDeCopia } = await import('../ssh/controlador/copiaSsh.ts')
const { armarContenido, leerContenido, previaConexiones, seleccionarContenido } = await import('./contenido.ts')

const resultados: { nombre: string; pasa: boolean; evidencia: string }[] = []
function hr(titulo: string): void {
  console.log(`\n${'='.repeat(78)}\n${titulo}\n${'='.repeat(78)}`)
}
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push({ nombre, pasa, evidencia })
  console.log(`${pasa ? 'PASS' : 'FAIL'}  ${nombre}\n      -> ${evidencia}`)
}

/** Cada «equipo» cifra a su manera: lo de A no se descifra en B. */
const cifradoDe = (marca: string) => ({
  disponible: () => true,
  cifrar: (s: string) => Buffer.from(`${marca}:${s}`, 'utf-8'),
  descifrar: (b: Buffer) => {
    const t = Buffer.from(b).toString('utf-8')
    if (!t.startsWith(`${marca}:`)) throw new Error('otro equipo')
    return t.slice(marca.length + 1)
  }
})

const raiz = mkdtempSync(path.join(tmpdir(), 'tessera-copia-'))
function equipo(nombre: string) {
  const dir = path.join(raiz, nombre)
  const cifrado = cifradoDe(nombre)
  const ssh = new ConexionesSsh({ storePath: path.join(dir, 'ssh.json'), dirHuellas: path.join(dir, 'huellas'), dirClaves: path.join(dir, 'claves'), cifrado, log: () => {} })
  const bd = new ConnectionStore({ storePath: path.join(dir, 'bd.json'), cifrado })
  bd.conocerConexionesSsh((perfil, id) => ssh.listar(perfil).conexiones.some((c) => c.id === id))
  return { dir, ssh, bd }
}

const PERFIL = { id: 'trabajo', nombre: 'Trabajo', color: '#336699', agentes: [{ tipo: 'claude-code', configDir: './x' }], sandbox: { habilitado: false } }
const sshBase = { profileId: 'trabajo', grupoId: null, puerto: 22, usuario: 'yo', metodo: 'contrasena' as const, disponibleAgentes: false }
const pg = { profileId: 'trabajo', motor: 'postgres' as const, host: 'db.interna', port: 5432, database: 'app', user: 'app', readonly: true }

function montarA() {
  const a = equipo('A')
  const grupo = a.ssh.crearGrupo('trabajo', 'Producción')
  const bastion = a.ssh.crear({ ...sshBase, alias: 'bastión', host: 'salto.ejemplo', secreto: 'clave-bastion' })
  const app = a.ssh.crear({ ...sshBase, alias: 'servidor', host: 'app.ejemplo', grupoId: grupo.id, saltoId: bastion.id, secreto: 'clave-app' })
  a.ssh.escribirHuellas(app.id, 'app.ejemplo ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHuellaDePrueba\n')
  const base = a.bd.create({ ...pg, alias: 'principal', password: 'clave-bd', tunelSsh: { conexionId: app.id } })
  const archivo = a.bd.create({ profileId: 'trabajo', alias: 'local', motor: 'sqlite', host: '', port: 0, user: '', readonly: false, rutaArchivo: path.join(raiz, 'no-existe.sqlite') })
  return { a, grupo, bastion, app, base, archivo }
}

const { a, grupo, bastion, app, base, archivo } = montarA()
const fuentes = { ssh: (id: string) => a.ssh.paraCopia(id), bd: (id: string) => a.bd.paraCopia(id) }
const armado = armarContenido({ frase: 'x'.repeat(8), perfiles: [PERFIL as never], apartados: { ssh: true, bd: true, agentes: false, ajustes: false } }, fuentes)
// Por el camino de verdad: texto JSON (lo que se cifra) y vuelta a leer.
const leido = leerContenido(JSON.stringify(armado.contenido))
const contenido = leido!.contenido

hr('(1) Exportar')
check('resumen: 2 SSH y 2 bases, ninguna sin secreto', armado.resumen.ssh === 2 && armado.resumen.bd === 2 && armado.resumen.sinSecreto.length === 0, JSON.stringify(armado.resumen))
const textoContenido = JSON.stringify(armado.contenido)
check('los secretos van en claro DENTRO del contenido (que luego se cifra con la frase)', textoContenido.includes('clave-bd') && textoContenido.includes('clave-app'), '')
check('NEGATIVO: no viaja lo cifrado con el almacén de A', !textoContenido.includes('secretEnc') && !textoContenido.includes('A:clave'), '')
check('NEGATIVO: ni la verificación ni el driver de este equipo', !textoContenido.includes('verificadaEn') && !textoContenido.includes('driverId'), '')
check('las huellas viajan', textoContenido.includes('HuellaDePrueba'), '')

// B ya tiene un grupo con el mismo nombre (otro id) y una base que se llama como una de la copia.
const b = equipo('B')
const grupoB = b.ssh.crearGrupo('trabajo', 'producción')
b.bd.create({ ...pg, alias: 'local', host: 'otro' })
const perfiles = new Set(['trabajo'])

hr('(2) Importar SSH: ids, grupo reutilizado, bastión antes')
// Al revés a propósito: quien salta por el bastión llega antes que el bastión.
const sshAlReves = { ...contenido.ssh, conexiones: [...(contenido.ssh?.conexiones ?? [])].reverse() }
const depsB = { conexiones: b.ssh, deCopia: async () => { throw new Error('sin claves') }, crear: (input: SshConexionInput, id: string) => void b.ssh.crear(input, { id }) }
const rSsh = await importarSshDeCopia(sshAlReves, perfiles, depsB)
check('las dos entran', rSsh.anadidas === 2 && rSsh.saltadas.length === 0, JSON.stringify(rSsh))
const appB = b.ssh.conexion(app.id)
check('con el mismo id', appB !== undefined && b.ssh.conexion(bastion.id) !== undefined, String(appB?.id))
check('el grupo que ya se llamaba igual se reutiliza (no se duplica)', appB?.grupoId === grupoB.id && b.ssh.listar('trabajo').grupos.length === 1, `${appB?.grupoId} vs ${grupo.id}`)
check('el bastión se conserva', appB?.saltoId === bastion.id, String(appB?.saltoId))
check('el secreto se cifra con el almacén de B', b.ssh.secretoDe(app.id) === 'clave-app' && appB?.secretEnc?.startsWith(Buffer.from('B:').toString('base64').slice(0, 2)) === true, String(b.ssh.secretoDe(app.id)))
check('las huellas quedan en su known_hosts', (b.ssh.textoHuellas(app.id) ?? '').includes('HuellaDePrueba'), '')

hr('(3) Importar bases: túnel, archivo y nombres')
const rBd = (contenido.bd ?? []).map((c) => ({ alias: c.registro.alias, motivo: b.bd.importarDeCopia(c.registro, c.secreto) }))
const principal = b.bd.get(base.id)
check('la base por túnel entra con su id y su túnel', principal?.tunelSsh?.conexionId === app.id, JSON.stringify(principal?.tunelSsh))
check('su contraseña, cifrada con B', b.bd.secretOf(base.id) === 'clave-bd', String(b.bd.secretOf(base.id)))
check('NEGATIVO: sin verificar en B', principal?.verificada === false, String(principal?.verificada))
const local = rBd.find((r) => r.alias === 'local')
check('la que choca de nombre con una de B se salta con su motivo', typeof local?.motivo === 'string' && b.bd.get(archivo.id) === undefined, String(local?.motivo))

hr('(4) Importar otra vez no toca nada')
const otraSsh = await importarSshDeCopia(contenido.ssh, perfiles, depsB)
check('SSH: todas «ya está»', otraSsh.anadidas === 0 && otraSsh.saltadas.every((s) => s.motivo === 'ya está en este equipo'), JSON.stringify(otraSsh))
check('bases: «ya está»', b.bd.importarDeCopia(contenido.bd?.[0]?.registro, 'otra') === 'ya está en este equipo' && b.bd.secretOf(base.id) === 'clave-bd', '')
check('NEGATIVO: un perfil que no se importa no recibe nada', (await importarSshDeCopia(contenido.ssh, new Set(['otro']), depsB)).anadidas === 0, '')

hr('(5) Lo que A no puede descifrar viaja sin secreto, y se dice')
const c = equipo('C')
c.bd.create({ ...pg, alias: 'rota', password: 'x' })
const registroC = JSON.parse(readFileSync(path.join(c.dir, 'bd.json'), 'utf8'))
// Lo cifra «otro equipo»: aquí ya no se descifra.
registroC.connections[0].secretEnc = Buffer.from('Z:x').toString('base64')
writeFileSync(path.join(c.dir, 'bd2.json'), JSON.stringify(registroC))
const c2 = new ConnectionStore({ storePath: path.join(c.dir, 'bd2.json'), cifrado: cifradoDe('C') })
const exportC = armarContenido({ frase: 'x'.repeat(8), perfiles: [PERFIL as never], apartados: { ssh: false, bd: true, agentes: false, ajustes: false } }, { ssh: () => ({ grupos: [], conexiones: [] }), bd: (id) => c2.paraCopia(id) })
check('sinSecreto la nombra', JSON.stringify(exportC.resumen.sinSecreto) === '["rota"]', JSON.stringify(exportC.resumen))
check('y viaja sin secreto', exportC.contenido.bd?.[0]?.secreto === null, '')
check('el archivo de B sigue existiendo y legible', existsSync(path.join(b.dir, 'bd.json')), '')

hr('(6) Sin almacén de secretos en el equipo nuevo: entran sin su secreto, no se pierden')
const sinAlmacen = { ...cifradoDe('D'), disponible: () => false }
const dDir = path.join(raiz, 'D')
const dSsh = new ConexionesSsh({ storePath: path.join(dDir, 'ssh.json'), dirHuellas: path.join(dDir, 'huellas'), dirClaves: path.join(dDir, 'claves'), cifrado: sinAlmacen, log: () => {} })
const dBd = new ConnectionStore({ storePath: path.join(dDir, 'bd.json'), cifrado: sinAlmacen })
const rD = await importarSshDeCopia(contenido.ssh, perfiles, { conexiones: dSsh, deCopia: async () => { throw new Error('sin claves') }, crear: (input: SshConexionInput, id: string) => void dSsh.crear(input, { id }) })
check('SSH: entran las dos, sin secreto, y se dice', rD.anadidas === 2 && rD.sinSecreto.length === 2 && dSsh.secretoDe(app.id) === null, JSON.stringify(rD))
const motivoD = dBd.importarDeCopia(contenido.bd?.find((c) => c.registro.alias === 'principal')?.registro, 'clave-bd')
check('base: entra sin contraseña', motivoD === null && dBd.get(base.id)?.tieneSecreto === false, String(motivoD))

hr('(7) Vista previa: lista sin secretos y lo que ya está')
const previa = previaConexiones(contenido, { ssh: (id: string) => b.ssh.idOcupado(id), bd: (id: string) => b.bd.idOcupado(id) })
const textoPrevia = JSON.stringify(previa)
check('trae las conexiones con nombre, grupo y dependencia', previa.ssh.length === 2 && previa.bd.length === 2 && previa.ssh.find((c) => c.id === app.id)?.detalle === 'Producción' && previa.ssh.find((c) => c.id === app.id)?.depende === bastion.id && previa.bd.find((c) => c.id === base.id)?.depende === app.id, textoPrevia)
check('NEGATIVO: ningún secreto, clave ni huella cruza al renderer', !textoPrevia.includes('clave-') && !textoPrevia.includes('HuellaDePrueba') && !textoPrevia.includes('secreto'), textoPrevia)
check('lo que B ya tiene sale como «ya está»', previa.ssh.every((c) => c.yaEsta) && previa.bd.find((c) => c.id === base.id)?.yaEsta === true && previa.bd.find((c) => c.id === archivo.id)?.yaEsta === false, textoPrevia)

hr('(8) Importar solo lo elegido')
/** Lo mismo que hace el IPC de CONEXIONES con una selección. */
async function importarElegido(eq: ReturnType<typeof equipo>, sel: { perfiles: string[]; ssh: string[]; bd: string[] }) {
  const c = seleccionarContenido(contenido, sel)
  const perfilesSel = new Set(c.perfiles.map((p) => p.id))
  const ssh = await importarSshDeCopia(c.ssh, perfilesSel, { conexiones: eq.ssh, deCopia: async () => { throw new Error('sin claves') }, crear: (input: SshConexionInput, id: string) => void eq.ssh.crear(input, { id }) })
  const bd = (c.bd ?? []).filter((x) => perfilesSel.has(x.registro.profileId)).map((x) => ({ alias: x.registro.alias, motivo: eq.bd.importarDeCopia(x.registro, x.secreto) }))
  return { ssh, bd }
}
const e = equipo('E')
const rE = await importarElegido(e, { perfiles: ['trabajo'], ssh: [bastion.id], bd: [] })
check('solo entra la conexión marcada', rE.ssh.anadidas === 1 && e.ssh.conexion(bastion.id) !== undefined, JSON.stringify(rE.ssh))
check('NEGATIVO: lo desmarcado no entra (ni la SSH ni las bases)', e.ssh.conexion(app.id) === undefined && e.bd.get(base.id) === undefined && e.bd.get(archivo.id) === undefined && rE.bd.length === 0, '')
check('NEGATIVO: el grupo de una conexión no elegida no viaja', e.ssh.listar('trabajo').grupos.length === 0, JSON.stringify(e.ssh.listar('trabajo').grupos))
const rE2 = await importarElegido(e, { perfiles: ['trabajo'], ssh: [app.id], bd: [] })
check('el grupo viaja con su conexión', e.ssh.conexion(app.id)?.grupoId != null && e.ssh.listar('trabajo').grupos.map((g) => g.nombre).join() === 'Producción', JSON.stringify(rE2.ssh))
const f = equipo('F')
const rF = await importarElegido(f, { perfiles: ['trabajo'], ssh: [], bd: [base.id] })
check('una base elegida sin su túnel no entra a medias: se salta con su motivo', f.bd.get(base.id) === undefined && typeof rF.bd[0]?.motivo === 'string', JSON.stringify(rF.bd))
const rF2 = await importarElegido(f, { perfiles: [], ssh: [bastion.id, app.id], bd: [base.id] })
check('NEGATIVO: sin su perfil elegido no entra nada', rF2.ssh.anadidas === 0 && rF2.bd.length === 0 && f.ssh.conexion(bastion.id) === undefined, '')

rmSync(raiz, { recursive: true, force: true })
const pasan = resultados.filter((r) => r.pasa).length
const todo = pasan === resultados.length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(todo ? 0 : 1)
