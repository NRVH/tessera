-- Siembra idempotente de MySQL y MariaDB de pruebas (la corre `mysql.sh levantar` como root).
-- Los usuarios y sus claves los crea el guion aparte: aquí no se escribe ninguna clave.
-- Vale igual en los dos servidores: lo que solo existe en uno se evita.
SET SESSION sql_mode = '';
CREATE DATABASE IF NOT EXISTS pruebas CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS otra CHARACTER SET utf8mb4;
USE pruebas;

CREATE TABLE IF NOT EXISTS t (id INT PRIMARY KEY, nombre VARCHAR(50));
INSERT IGNORE INTO t VALUES (1, 'uno'), (2, 'dos'), (3, 'tres');

CREATE TABLE IF NOT EXISTS clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL COMMENT 'Nombre visible',
  correo VARCHAR(120),
  alta DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clientes_correo (correo)
) COMMENT = 'Clientes de ejemplo';
INSERT IGNORE INTO clientes (id, nombre, correo, alta) VALUES
  (1, 'Ana Ejemplo', 'ana@ejemplo.test', '2024-01-02 03:04:05'),
  (2, 'Luis Prueba', 'luis@ejemplo.test', '2024-02-03 04:05:06');

CREATE TABLE IF NOT EXISTS pedidos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  importe DECIMAL(12, 2) NOT NULL,
  estado ENUM('nuevo', 'pagado', 'enviado') NOT NULL DEFAULT 'nuevo',
  KEY ix_pedidos_cliente (cliente_id),
  CONSTRAINT fk_pedidos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id)
);
INSERT IGNORE INTO pedidos (id, cliente_id, importe, estado) VALUES (1, 1, 10.50, 'pagado'), (2, 1, 99.99, 'nuevo');

CREATE TABLE IF NOT EXISTS tipos (
  id INT PRIMARY KEY,
  j JSON,
  e ENUM('a', 'b'),
  s SET('x', 'y', 'z'),
  b BIT(8),
  bl BLOB,
  f DATE,
  fh DATETIME(3),
  ts TIMESTAMP NULL,
  u INT UNSIGNED,
  big BIGINT UNSIGNED,
  d DECIMAL(30, 10),
  fl FLOAT,
  db DOUBLE,
  g GEOMETRY,
  hora TIME,
  y YEAR,
  bin VARBINARY(16),
  tx TEXT,
  ch CHAR(3),
  bo TINYINT(1)
);
INSERT IGNORE INTO tipos VALUES (
  1, '{"a": 1, "b": [true, null]}', 'b', 'x,z', b'10100101', X'00FF10', '0000-00-00', '2024-05-06 07:08:09.123',
  NULL, 4294967295, 18446744073709551615, 12345678901234567890.0123456789, 1.5, 2.25,
  ST_GeomFromText('POINT(1 2)'), '-12:34:56', 2024, X'DEADBEEF', 'texto largo', 'abc', 1
);

CREATE TABLE IF NOT EXISTS sin_pk (a INT, b VARCHAR(10));
INSERT INTO sin_pk SELECT 1, 'x' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM sin_pk);
CREATE TABLE IF NOT EXISTS unica (a INT NOT NULL, b VARCHAR(10), UNIQUE KEY uq_unica_a (a));
INSERT IGNORE INTO unica VALUES (1, 'uno');

CREATE OR REPLACE VIEW v_clientes AS SELECT id, nombre FROM clientes;

DROP PROCEDURE IF EXISTS contar_clientes;
DROP FUNCTION IF EXISTS doble;
DROP TRIGGER IF EXISTS trg_pedidos_importe;
DROP EVENT IF EXISTS ev_limpieza;
DELIMITER //
CREATE PROCEDURE contar_clientes(IN minimo INT, OUT total INT)
BEGIN
  SELECT COUNT(*) INTO total FROM clientes WHERE id >= minimo;
  SELECT id, nombre FROM clientes WHERE id >= minimo;
END //
CREATE FUNCTION doble(x INT) RETURNS INT DETERMINISTIC
BEGIN
  RETURN x * 2;
END //
CREATE TRIGGER trg_pedidos_importe BEFORE INSERT ON pedidos FOR EACH ROW
BEGIN
  IF NEW.importe < 0 THEN SET NEW.importe = 0; END IF;
END //
CREATE EVENT ev_limpieza ON SCHEDULE EVERY 1 DAY DISABLE DO DELETE FROM sin_pk WHERE a < 0 //
DELIMITER ;

USE otra;
CREATE TABLE IF NOT EXISTS notas (id INT PRIMARY KEY, texto VARCHAR(200));
INSERT IGNORE INTO notas VALUES (1, 'nota de ejemplo');
