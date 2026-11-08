// =============================================================================
// Compatibilidad de perfiles existentes, denegación inicial y aislamiento de rutas por perfil.
// Comprueba la normalización y conservación de permisos para que guardar un perfil no restaure accesos.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { permiteClave, conservarPermisosSsh } from './permisos.ts'
let fallidas = 0
function hr(titulo: string): void { console.log('\n' + '='.repeat(70) + '\n' + titulo) }
function check(id: string, valido: boolean): void { if (!valido) fallidas++; console.log(`${valido ? 'PASS' : 'FAIL'} ${id}`) }
hr('Permisos de perfiles')
check('perfil existente sin campo', permiteClave({}, '/home/u/.ssh/id_rsa', 'linux'))
check('perfil nuevo vacío', !permiteClave({ clavesSshPermitidas: [] }, '/home/u/.ssh/id_rsa', 'linux'))
check('clave permitida', permiteClave({ clavesSshPermitidas: ['/a/id'] }, '/a/id', 'mac'))
check('otra clave', !permiteClave({ clavesSshPermitidas: ['/a/id'] }, '/b/id', 'linux'))
check('normalización Windows', permiteClave({ clavesSshPermitidas: ['C:\\Users\\U\\.ssh\\id_rsa'] }, 'c:/users/u/.ssh/id_rsa', 'windows'))
check('Linux distingue caja', !permiteClave({ clavesSshPermitidas: ['/A/id'] }, '/a/id', 'linux'))
const perfiles = conservarPermisosSsh<{ id: string; clavesSshPermitidas?: string[] }>([{ id: 'viejo' }, { id: 'revocado', clavesSshPermitidas: [] }], [{ id: 'viejo', clavesSshPermitidas: [] }, { id: 'revocado', clavesSshPermitidas: ['/clave'] }, { id: 'nuevo', clavesSshPermitidas: ['/clave'] }])
check('guardado general conserva compatibilidad del viejo', perfiles[0].clavesSshPermitidas === undefined)
check('guardado atrasado no revierte revocación', perfiles[1].clavesSshPermitidas?.length === 0)
check('alta nueva sin concesiones implícitas', perfiles[2].clavesSshPermitidas?.length === 0)
console.log(`VEREDICTO: ${fallidas ? 'FALLA' : 'PASS'}`)
process.exit(fallidas ? 1 : 0)
