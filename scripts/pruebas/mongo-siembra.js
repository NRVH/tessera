// =============================================================================
// Siembra de `pruebas-mongo` (la corre `mongo.sh levantar` con mongosh, como raíz).
// Idempotente: los usuarios se crean o se les reescribe la clave y las colecciones se vacían
// y rellenan. Los datos tienen formas distintas en la misma colección, subdocumentos, arrays
// y los tipos BSON sin equivalente JSON (ObjectId, Date, Decimal128, Long, Binary, Regex);
// `grande` tiene 5 000 documentos para el paginado. `db`, `ObjectId`, `ISODate`… son
// globales de mongosh (y `process` también): se declaran para el lint, no se importan.
// =============================================================================
/* global db, process, ObjectId, ISODate, NumberDecimal, NumberLong, BinData */
const pw = process.env.PW
const b = db.getSiblingDB('pruebas')

function usuario(nombre, roles) {
  if (b.getUser(nombre)) b.updateUser(nombre, { pwd: pw, roles })
  else b.createUser({ user: nombre, pwd: pw, roles })
}
usuario('tessera', [{ role: 'readWrite', db: 'pruebas' }, { role: 'dbAdmin', db: 'pruebas' }])
usuario('lector', [{ role: 'read', db: 'pruebas' }])

b.clientes.drop()
b.clientes.insertMany([
  { _id: ObjectId('650000000000000000000001'), nombre: 'Ana', edad: 34, alta: ISODate('2024-01-15T10:00:00Z'),
    direccion: { calle: 'Mayor 1', ciudad: 'Madrid', cp: '28001' }, etiquetas: ['vip', 'norte'],
    saldo: NumberDecimal('1234.50') },
  { _id: ObjectId('650000000000000000000002'), nombre: 'Luis', edad: 51, alta: ISODate('2023-06-01T08:30:00Z'),
    direccion: { calle: 'Sol 7', ciudad: 'Sevilla' }, etiquetas: [], visitas: NumberLong('9007199254740993') },
  { _id: ObjectId('650000000000000000000003'), nombre: 'Marta', activo: false,
    pedidos: [{ id: 1, total: 20.5 }, { id: 2, total: 7 }], foto: BinData(0, 'AAECAwQ='), patron: /^ma/i },
  { _id: 'texto-como-id', nombre: 'Sin ObjectId', nota: null }
])
b.clientes.createIndex({ nombre: 1 })
b.clientes.createIndex({ 'direccion.ciudad': 1, edad: -1 }, { name: 'ciudad_edad' })

b.grande.drop()
const lote = []
for (let i = 0; i < 5000; i++) lote.push({ n: i, par: i % 2 === 0, grupo: 'g' + (i % 10), texto: 'fila ' + i })
b.grande.insertMany(lote)

b.vacia.drop()
b.createCollection('vacia')

if (!b.getCollectionNames().includes('vista_vip'))
  b.createView('vista_vip', 'clientes', [{ $match: { etiquetas: 'vip' } }])
