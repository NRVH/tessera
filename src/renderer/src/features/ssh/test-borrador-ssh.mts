#!/usr/bin/env node
// =============================================================================
// Prueba del borrador del diálogo de una conexión SSH (npm run test:borrador-ssh): los valores de
// un alta, el puerto, el usuario vacío, el archivo de clave, las marcas tras intentar guardar, lo que
// viaja al main, los cambios que dejan cerrar el velo, los botones (el primario y «Probar» / «Guardar
// y probar») y el secreto de solo escritura: contraseña y frase, «(sin cambios)», olvidarlo, cuándo se
// descarta la guardada y el aviso de una ilegible, y que lo tecleado mientras vuelve un guardado no se pise.
// Decisiones: docs/decisiones/terminales/pestanas-ssh-del-perfil.md, docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import {
  METODOS_OFRECIDOS,
  PUERTO_SSH_POR_DEFECTO,
  borradorDesde,
  borradorNuevo,
  camposAMarcar,
  claveElegida,
  conCambio,
  entradaDe,
  etiquetaProbar,
  hayCambios,
  marcasVisibles,
  puertoValido,
  trasGuardar,
  usaSecreto,
  type BorradorSsh
} from './borradorSsh.ts'
import { avisoSecretoIlegible, ayudaSecreto, destinoSecreto, marcadorSecreto } from './secretoSsh.ts'
import { pideSecretoSsh, type SshConexion } from '../../../../shared/ssh-ipc.ts'

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
const j = (v: unknown): string => JSON.stringify(v)

/** Un borrador válido: lo único que cada caso cambia es lo que prueba. */
function valido(extra: Partial<BorradorSsh> = {}): BorradorSsh {
  return { ...borradorNuevo('personal'), alias: 'Producción', host: 'srv.ejemplo', usuario: 'root', ...extra }
}

function conexion(extra: Partial<SshConexion> = {}): SshConexion {
  return {
    id: 'c1',
    profileId: 'personal',
    alias: 'Router',
    grupoId: 'g1',
    host: '192.0.2.10',
    puerto: 2222,
    usuario: 'admin',
    metodo: 'sistema',
    tieneSecreto: false,
    disponibleAgentes: false,
    huellaServidor: [],
    ...extra
  }
}

hr('(1) Un alta nace con puerto 22, contraseña y disponible para los agentes')
{
  const b = borradorNuevo('personal')
  check('puerto 22 (como texto, para poder teclearlo)', b.puerto === '22' && PUERTO_SSH_POR_DEFECTO === 22, b.puerto)
  check('autenticación por contraseña', b.metodo === 'contrasena', b.metodo)
  check('«Disponible para los agentes» nace marcada', b.disponibleAgentes === true, String(b.disponibleAgentes))
  check('sin id, sin grupo y con el perfil dado', b.id === undefined && b.grupoId === null && b.profileId === 'personal', j(b))
  check('un alta en un grupo (desde su menú) nace con ese grupo', borradorNuevo('personal', 'g7').grupoId === 'g7', borradorNuevo('personal', 'g7').grupoId ?? 'null')
}

hr('(2) El puerto: solo dígitos y de 1 a 65535')
{
  const casos: [string, boolean][] = [
    ['22', true],
    ['1', true],
    ['65535', true],
    [' 2222 ', true],
    ['0', false],
    ['65536', false],
    ['abc', false],
    ['', false],
    ['22a', false],
    ['-1', false],
    ['2.5', false],
    ['123456', false]
  ]
  const mal = casos.filter(([t, ok]) => puertoValido(t) !== ok)
  check('doce casos, acierta todos', mal.length === 0, mal.length === 0 ? casos.map(([t, ok]) => `${j(t)}:${ok}`).join(' ') : `mal: ${j(mal)}`)
  for (const t of ['0', '65536', 'abc']) {
    check(`el puerto ${j(t)} se marca`, camposAMarcar(valido({ puerto: t })).join() === 'puerto', camposAMarcar(valido({ puerto: t })).join())
  }
}

hr('(3) Qué campos se marcan, y en qué orden (el del foco)')
{
  check('un borrador válido no marca nada', camposAMarcar(valido()).length === 0, j(camposAMarcar(valido())))
  check('el usuario vacío se marca (y uno de solo espacios)', camposAMarcar(valido({ usuario: '' })).join() === 'usuario' && camposAMarcar(valido({ usuario: '   ' })).join() === 'usuario', 'usuario')
  check('el nombre vacío y el host vacío se marcan', camposAMarcar(valido({ alias: ' ' })).join() === 'alias' && camposAMarcar(valido({ host: '' })).join() === 'host', 'alias · host')
  check(
    'un alta en blanco marca nombre, host y usuario, en el orden del formulario',
    camposAMarcar(borradorNuevo('personal')).join() === 'alias,host,usuario',
    camposAMarcar(borradorNuevo('personal')).join()
  )
  check('un nombre más largo que el tope se marca', camposAMarcar(valido({ alias: 'x'.repeat(121) })).join() === 'alias', 'alias')
  check('los tres métodos se ofrecen, en el orden del conmutador', METODOS_OFRECIDOS.join() === 'contrasena,clave,sistema', METODOS_OFRECIDOS.join())
  check('un alta con «Archivo de clave» y sin archivo marca la clave', camposAMarcar(valido({ metodo: 'clave' })).join() === 'clave', camposAMarcar(valido({ metodo: 'clave' })).join())
  const conClave = valido({ metodo: 'clave', clave: claveElegida({ token: 't1', nombre: 'id_ed25519', tipo: 'Ed25519', cifrada: false }) })
  check('con el archivo elegido no marca nada', camposAMarcar(conClave).length === 0, j(camposAMarcar(conClave)))
  check(
    'la clave va la última, en el orden del formulario',
    camposAMarcar({ ...borradorNuevo('personal'), metodo: 'clave' }).join() === 'alias,host,usuario,clave',
    camposAMarcar({ ...borradorNuevo('personal'), metodo: 'clave' }).join()
  )
  check('con otro método, la falta de archivo no importa', camposAMarcar(valido({ metodo: 'sistema', clave: null })).length === 0, 'sistema sin clave')
}

hr('(4) Las marcas solo se pintan tras intentar guardar')
{
  const vacio = borradorNuevo('personal')
  check('antes del intento: ninguna, aunque falte todo', marcasVisibles(vacio, false).length === 0, j(marcasVisibles(vacio, false)))
  check('tras el intento: las de siempre', marcasVisibles(vacio, true).join() === 'alias,host,usuario', marcasVisibles(vacio, true).join())
  check('tras el intento, con todo bien: ninguna', marcasVisibles(valido(), true).length === 0, j(marcasVisibles(valido(), true)))
}

hr('(5) Lo que viaja al main')
{
  const e = entradaDe(valido({ alias: '  Producción ', host: ' srv.ejemplo ', usuario: ' root ', puerto: ' 2200 ' }))
  check(
    'recortado, con el puerto como número y disponible para los agentes',
    e.alias === 'Producción' && e.host === 'srv.ejemplo' && e.usuario === 'root' && e.puerto === 2200 && e.disponibleAgentes === true,
    j(e)
  )
  check('sin secreto ni clave: la contraseña se teclea en el prompt de ssh', !('secreto' in e) && !('clave' in e), Object.keys(e).join())
  check('el grupo viaja tal cual (null = Sin grupo)', entradaDe(valido()).grupoId === null && entradaDe(valido({ grupoId: 'g1' })).grupoId === 'g1', 'null · g1')
  const nueva = claveElegida({ token: 'ficha-1', nombre: 'id_prod.pem', tipo: 'RSA', cifrada: true })
  const conNueva = entradaDe(valido({ metodo: 'clave', clave: nueva }))
  check('con una clave recién elegida viaja SOLO su ficha (ni nombre ni ruta)', j(conNueva.clave) === '{"tipo":"elegida","token":"ficha-1"}', j(conNueva.clave))
  const guardada = entradaDe(valido({ metodo: 'clave', clave: { ...nueva, token: null } }))
  check('con la clave ya guardada (sin ficha) no viaja nada: el main la conserva', !('clave' in guardada), Object.keys(guardada).join())
  const otroMetodo = entradaDe(valido({ metodo: 'contrasena', clave: nueva }))
  check('con otro método, la clave elegida no viaja (mitad negativa)', !('clave' in otroMetodo), Object.keys(otroMetodo).join())
}

hr('(6) Editar: el borrador sale de la conexión y conserva lo que no se enseña')
{
  const b = borradorDesde(conexion())
  check(
    'trae id, grupo, puerto como texto y método',
    b.id === 'c1' && b.grupoId === 'g1' && b.puerto === '2222' && b.metodo === 'sistema' && b.alias === 'Router',
    j(b)
  )
  check('disponibleAgentes se conserva aunque sea false', b.disponibleAgentes === false && entradaDe(b).disponibleAgentes === false, String(b.disponibleAgentes))
  check('un grupo desconocido se edita como «Sin grupo»', borradorDesde(conexion({ grupoId: null, grupoDesconocido: true })).grupoId === null, 'null')
  const conArchivo = borradorDesde(conexion({ metodo: 'clave', clave: { nombre: 'id_prod.pem', tipo: 'RSA', cifrada: true } }))
  check(
    'una conexión con archivo de clave trae su método y su clave, sin ficha',
    conArchivo.metodo === 'clave' && j(conArchivo.clave) === '{"nombre":"id_prod.pem","tipo":"RSA","cifrada":true,"token":null}',
    j(conArchivo.clave)
  )
  check('al editar, sin elegir otra, la guardada basta: no se marca', camposAMarcar(conArchivo).length === 0, j(camposAMarcar(conArchivo)))
  const sinTipo = borradorDesde(conexion({ metodo: 'clave', clave: { nombre: 'k', tipo: '', cifrada: true } }))
  check('un tipo vacío (no se sabía) llega como null', sinTipo.clave?.tipo === null, j(sinTipo.clave))
  const pasaAClave = { ...borradorDesde(conexion()), metodo: 'clave' as const }
  check('al pasar a «Archivo de clave» una que no lo usaba, falta el archivo', camposAMarcar(pasaAClave).join() === 'clave', camposAMarcar(pasaAClave).join())
}

hr('(7) Hay cambios (decide si el velo puede cerrar el diálogo)')
{
  const original = borradorDesde(conexion())
  check('sin tocar nada: no hay cambios', !hayCambios(borradorDesde(conexion()), original), 'false')
  check('un espacio al final no es un cambio', !hayCambios({ ...original, alias: 'Router ' }, original), 'false')
  check(
    'cada campo que se enseña cuenta',
    hayCambios({ ...original, alias: 'Otro' }, original) &&
      hayCambios({ ...original, grupoId: null }, original) &&
      hayCambios({ ...original, host: 'otro' }, original) &&
      hayCambios({ ...original, puerto: '22' }, original) &&
      hayCambios({ ...original, usuario: 'otro' }, original) &&
      hayCambios({ ...original, metodo: 'contrasena' }, original),
    'alias · grupo · host · puerto · usuario · método'
  )
  const alta = borradorNuevo('personal')
  check('un alta sin rellenar no tiene cambios; con un nombre, sí', !hayCambios(alta, borradorNuevo('personal')) && hayCambios({ ...alta, alias: 'x' }, borradorNuevo('personal')), 'false · true')
  const conArchivo = borradorDesde(conexion({ metodo: 'clave', clave: { nombre: 'k', tipo: 'RSA', cifrada: false } }))
  const otraClave = { ...conArchivo, clave: claveElegida({ token: 't9', nombre: 'k2', tipo: 'Ed25519', cifrada: false }) }
  check('elegir otro archivo de clave es un cambio; la misma guardada, no', hayCambios(otraClave, conArchivo) && !hayCambios(borradorDesde(conexion({ metodo: 'clave', clave: { nombre: 'k', tipo: 'RSA', cifrada: false } })), conArchivo), 'true · false')
  check(
    'marcar o desmarcar «Disponible para los agentes» es un cambio (el velo no lo tira y «Probar» guarda antes)',
    hayCambios({ ...original, disponibleAgentes: !original.disponibleAgentes }, original) && hayCambios({ ...alta, disponibleAgentes: false }, borradorNuevo('personal')),
    'true · true'
  )
}


hr('(9) El secreto: de solo escritura, solo con el método que lo usa')
{
  const alta = valido({ secreto: 'mi contraseña' })
  check('(9a) un alta con contraseña tecleada la manda tal cual', entradaDe(alta).secreto === 'mi contraseña', j(entradaDe(alta).secreto))
  check('(9b) vacía no viaja: ni la contraseña ni nada que la borre', !('secreto' in entradaDe(valido())), Object.keys(entradaDe(valido())).join())
  const guardada = borradorDesde(conexion({ metodo: 'contrasena', tieneSecreto: true }))
  check('(9c) al editar, el borrador NO trae la guardada (no sale del main): solo que hay', guardada.secreto === '' && guardada.tieneSecreto && !guardada.olvidarSecreto, j(guardada))
  check('(9d) editar sin tocarla no la manda (el main la conserva)', !('secreto' in entradaDe(guardada)), Object.keys(entradaDe(guardada)).join())
  const olvidada = { ...guardada, olvidarSecreto: true }
  check("(9e) «Olvidarla» manda '' (el main la borra)", entradaDe(olvidada).secreto === '', j(entradaDe(olvidada).secreto))
  check('(9f) una nueva gana a «olvidar»', entradaDe({ ...olvidada, secreto: 'nueva' }).secreto === 'nueva', 'nueva')
  check('(9g) con «Claves del sistema» no viaja nunca', !('secreto' in entradaDe(valido({ metodo: 'sistema', secreto: 'x' }))), 'sistema')
  const conFrase = valido({ metodo: 'clave', clave: claveElegida({ token: 't1', nombre: 'id', tipo: 'Ed25519', cifrada: true }), secreto: 'frase' })
  const sinFrase = valido({ metodo: 'clave', clave: claveElegida({ token: 't1', nombre: 'id', tipo: 'Ed25519', cifrada: false }), secreto: 'frase' })
  check('(9h) la frase viaja solo con una clave que la tiene', entradaDe(conFrase).secreto === 'frase' && !('secreto' in entradaDe(sinFrase)), `${j(entradaDe(conFrase).secreto)} · ${j(entradaDe(sinFrase).secreto)}`)
  check('(9i) usaSecreto: contraseña, o clave con frase', usaSecreto(valido()) && usaSecreto(conFrase) && !usaSecreto(sinFrase) && !usaSecreto(valido({ metodo: 'sistema' })), 'contraseña · frase')
  const cambiado = conCambio(valido({ secreto: 'tecleada', olvidarSecreto: true }), { metodo: 'clave' })
  check('(9j) cambiar de método vacía lo tecleado: una contraseña no viaja como frase', cambiado.secreto === '' && !cambiado.olvidarSecreto && cambiado.metodo === 'clave', j(cambiado))
  check('(9k) otro cambio no lo toca', conCambio(valido({ secreto: 'tecleada' }), { alias: 'otro' }).secreto === 'tecleada', 'se queda')
  check('(9l) más de 1000 bytes se marca (501 «ñ»), 1000 justos no', camposAMarcar(valido({ secreto: 'ñ'.repeat(501) })).join() === 'secreto' && camposAMarcar(valido({ secreto: 'ñ'.repeat(500) })).length === 0, camposAMarcar(valido({ secreto: 'ñ'.repeat(501) })).join())
  check('(9m) teclear una contraseña o pedir olvidarla son cambios', hayCambios({ ...guardada, secreto: 'x' }, guardada) && hayCambios(olvidada, guardada) && !hayCambios(guardada, guardada), 'true · true · false')
}

hr('(10) Qué pasará con la guardada: marcador, ayuda y aviso de una ilegible')
{
  const guardada = borradorDesde(conexion({ metodo: 'contrasena', tieneSecreto: true }))
  const casos: Array<[string, BorradorSsh, BorradorSsh, string]> = [
    ['un alta sin teclear', valido(), valido(), 'ninguno'],
    ['tecleada', { ...guardada, secreto: 'x' }, guardada, 'nuevo'],
    ['editar sin tocar', guardada, guardada, 'se-conserva'],
    ['pedir olvidarla', { ...guardada, olvidarSecreto: true }, guardada, 'se-olvida'],
    ['otro host (la contraseña viaja al servidor)', { ...guardada, host: 'otro' }, guardada, 'se-descarta'],
    ['otro usuario', { ...guardada, usuario: 'otro' }, guardada, 'se-descarta'],
    ['otro puerto', { ...guardada, puerto: '22' }, guardada, 'se-descarta'],
    ['el mismo puerto escrito de otra forma', { ...guardada, puerto: ' 02222 ' }, guardada, 'se-conserva'],
    ['otro método', { ...guardada, metodo: 'sistema' }, guardada, 'ninguno']
  ]
  for (const [nombre, b, o, esperado] of casos) check(`(10a) ${nombre}: ${esperado}`, destinoSecreto(b, o) === esperado, destinoSecreto(b, o))
  const conClave = borradorDesde(conexion({ metodo: 'clave', tieneSecreto: true, clave: { nombre: 'k', tipo: 'Ed25519', cifrada: true } }))
  const otraClave = { ...conClave, clave: claveElegida({ token: 't2', nombre: 'k2', tipo: 'RSA', cifrada: true }) }
  check('(10b) la frase guardada se conserva con su clave y se descarta con otra (C68)', destinoSecreto(conClave, conClave) === 'se-conserva' && destinoSecreto(otraClave, conClave) === 'se-descarta', `${destinoSecreto(conClave, conClave)} · ${destinoSecreto(otraClave, conClave)}`)
  check('(10c) marcador: «(sin cambios)» solo si se conserva', marcadorSecreto('se-conserva') === '(sin cambios)' && marcadorSecreto('nuevo') === '' && marcadorSecreto('ninguno') === '' && marcadorSecreto('se-olvida') === '(se olvidará al guardar)', 'sin cambios')
  check('(10d) ayuda de un alta', ayudaSecreto('ninguno', false) === 'Se guarda cifrada; si la dejas vacía, la pedirá la terminal.', ayudaSecreto('ninguno', false))
  check('(10e) ayuda al descartar, distinta para la frase', ayudaSecreto('se-descarta', false).includes('servidor o usuario') && ayudaSecreto('se-descarta', true).includes('otra clave'), ayudaSecreto('se-descarta', true))
  check('(10f) el aviso de una ilegible nombra el almacén que se le pasa', avisoSecretoIlegible(false, 'EL ALMACÉN') === 'La contraseña guardada no se puede leer con EL ALMACÉN. Vuelve a escribirla.' && avisoSecretoIlegible(true, 'X').startsWith('La frase guardada'), avisoSecretoIlegible(false, 'EL ALMACÉN'))
  check('(10g) el borrador trae si la guardada es ilegible', borradorDesde(conexion({ tieneSecreto: true, secretoIlegible: true })).secretoIlegible && !borradorDesde(conexion()).secretoIlegible, 'true · false')
}

hr('(11) «Probar» prueba lo guardado: con cambios o en un alta, «Guardar y probar»')
{
  const guardada = borradorDesde(conexion())
  check('(11a) una edición sin cambios: «Probar»', etiquetaProbar(guardada, false) === 'Probar', etiquetaProbar(guardada, false))
  check('(11b) con cambios: «Guardar y probar»', etiquetaProbar(guardada, true) === 'Guardar y probar', etiquetaProbar(guardada, true))
  check('(11c) un alta aún sin guardar: «Guardar y probar» aunque no haya cambios', etiquetaProbar(borradorNuevo('personal'), false) === 'Guardar y probar', etiquetaProbar(borradorNuevo('personal'), false))
}

hr('(12) Lo tecleado mientras vuelve un guardado no se pisa (C106)')
{
  const guardado = borradorDesde(conexion({ alias: 'Guardada', host: 'h1', tieneSecreto: true }))
  const enviado = valido({ alias: 'Guardada', host: 'h1', secreto: 'abc' })
  check('(12a) sin teclear nada, el borrador pasa a lo guardado: el secreto tecleado ya está guardado y se vacía', j(trasGuardar(enviado, enviado, guardado)) === j(guardado), j(trasGuardar(enviado, enviado, guardado)))
  const tecleado = { ...enviado, usuario: 'otro', alias: 'Guardada 2' }
  const r = trasGuardar(tecleado, enviado, guardado)
  check('(12b) un campo tocado durante el guardado conserva lo tecleado, y el resto, lo guardado', r.usuario === 'otro' && r.alias === 'Guardada 2' && r.host === 'h1' && r.id === guardado.id && r.secreto === '', j(r))
  check('(12c) lo tecleado cuenta como cambios frente a lo guardado (el velo no lo tira y «Probar» guarda antes)', hayCambios(r, guardado), 'true')
  const nuevaFrase = trasGuardar({ ...enviado, secreto: 'abcd' }, enviado, guardado)
  check('(12d) el secreto que siguió tecleándose se conserva entero', nuevaFrase.secreto === 'abcd', nuevaFrase.secreto)
  const clave = claveElegida({ token: 't7', nombre: 'k', tipo: 'Ed25519', cifrada: false })
  check('(12e) una clave importada durante el guardado no se pierde', trasGuardar({ ...enviado, clave }, enviado, guardado).clave === clave, 'la ficha sigue')
  check('(12f) MITAD NEGATIVA: lo que no cambió no viaja del actual al guardado (el id y si tiene secreto son del main)', trasGuardar({ ...enviado, id: 'falso', tieneSecreto: false }, enviado, guardado).id === guardado.id && trasGuardar({ ...enviado, tieneSecreto: false }, enviado, guardado).tieneSecreto, guardado.id ?? '')
}

hr('(13) usaSecreto delega en la regla única de shared')
{
  check(
    '(13a) las mismas respuestas que pideSecretoSsh para los tres métodos con y sin frase',
    (['contrasena', 'clave', 'sistema'] as const).every((metodo) =>
      [null, { nombre: 'k', tipo: null, cifrada: true, token: null }, { nombre: 'k', tipo: null, cifrada: false, token: null }].every(
        (clave) => usaSecreto({ metodo, clave }) === pideSecretoSsh({ metodo, clave })
      )
    ),
    'coinciden'
  )
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
