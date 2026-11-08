// =============================================================================
// Traducción pública del SSH del host: nunca propone montar carpetas ni rutas privadas.
// Verifica las tres plataformas para mantener el aislamiento al generar la configuración del contenedor.
// Decisiones: docs/decisiones/sandbox/ssh-global.md
// =============================================================================
import { configPublico } from '../ssh/agente/configuracion.ts'
let fallidas = 0
function hr(titulo: string): void { console.log('\n' + '='.repeat(70) + '\n' + titulo) }
function check(id: string, valido: boolean): void { if (!valido) fallidas++; console.log(`${valido ? 'PASS' : 'FAIL'} ${id}`) }
hr('SSH público en las plataformas')
for (const plataforma of ['windows', 'mac', 'linux'] as const) {
  const home = plataforma === 'windows' ? 'C:/Users/usuario' : '/home/usuario'
  const ruta = plataforma === 'windows' ? 'C:\\Users\\usuario\\.ssh\\id_ed25519' : home + '/.ssh/id_ed25519'
  const texto = 'Host empresa\n HostName git.empresa.test\n IdentityFile ~/.ssh/id_ed25519\n IdentityFile ~/.ssh/personal\nInclude secretos/*\nUseKeychain yes'
  const resultado = configPublico(texto, { home, usuario: 'usuario', plataforma }, [ruta])
  check(plataforma + ' solo pública', /IdentityFile \/home\/agente\/\.ssh\/[a-f0-9]+\.pub/.test(resultado))
  check(plataforma + ' sin privadas', !resultado.includes('id_ed25519') && !resultado.includes('personal'))
  check(plataforma + ' sin includes', !resultado.includes('Include'))
  check(plataforma + ' alias conservado', resultado.includes('Host empresa'))
}
check('sin config', configPublico('', { home: '/home/u', usuario: 'u', plataforma: 'linux' }, []).includes('IdentityFile none'))
console.log(`VEREDICTO: ${fallidas ? 'FALLA' : 'PASS'}`)
process.exit(fallidas ? 1 : 0)
