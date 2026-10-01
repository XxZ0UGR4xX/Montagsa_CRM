-- =====================================================================
--  MONTAGSA · CRM + ERP + SCM
--  Base de datos PostgreSQL (16+)
--
--  Este script es RE-EJECUTABLE: borra todo y lo vuelve a crear.
--    psql -U postgres -d montagsa -f db/database.sql
--
--  Crea el esquema y los datos maestros (usuarios, clientes, equipos,
--  refacciones, empleados, catálogo de cuentas). Los movimientos de
--  ejemplo (rentas, servicios, facturas, pagos) se cargan después con:
--    npm run demo
-- =====================================================================

SET client_min_messages TO WARNING;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS auditoria, actividades, adjuntos, notas, oportunidades,
    periodos_contables, poliza_movimientos, polizas,
    cuentas_bancarias, cuentas_contables,
    pagos, factura_conceptos, facturas,
    requisicion_items, requisiciones,
    equipo_preventivo, secuencia_preventivo, config_preventivo,
    lecturas_horometro, ot_refacciones, ordenes_trabajo,
    rentas, traspasos,
    orden_compra_items, ordenes_compra, movimientos_inventario,
    productos, equipos, empleados, interacciones, clientes,
    proveedores, usuarios CASCADE;
DROP FUNCTION IF EXISTS actualizar_fecha() CASCADE;

-- ---------------------------------------------------------------------
-- Utilidad: fecha de actualización automática
-- ---------------------------------------------------------------------
CREATE FUNCTION actualizar_fecha() RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
--  SEGURIDAD
-- =====================================================================
CREATE TABLE usuarios (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(120) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    -- admin: todo · almacen · comercial · produccion · administracion · contabilidad
    rol             VARCHAR(20) NOT NULL DEFAULT 'comercial'
                    CHECK (rol IN ('admin','almacen','comercial','produccion','administracion','contabilidad')),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_usuarios_fecha BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION actualizar_fecha();

-- =====================================================================
--  CRM
-- =====================================================================
CREATE TABLE clientes (
    id              SERIAL PRIMARY KEY,
    razon_social    VARCHAR(160) NOT NULL,
    rfc             VARCHAR(13),
    contacto        VARCHAR(120),
    telefono        VARCHAR(30),
    email           VARCHAR(150),
    direccion       TEXT,
    etapa           VARCHAR(20) NOT NULL DEFAULT 'prospecto'
                    CHECK (etapa IN ('prospecto','activo','frecuente','inactivo')),
    -- Créditos (área de Administración)
    limite_credito  NUMERIC(12,2) NOT NULL DEFAULT 0,
    dias_credito    INTEGER NOT NULL DEFAULT 0 CHECK (dias_credito >= 0),
    credito_estado  VARCHAR(20) NOT NULL DEFAULT 'sin_credito'
                    CHECK (credito_estado IN ('sin_credito','activo','suspendido')),
    notas           TEXT,
    creado          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_clientes_fecha BEFORE UPDATE ON clientes
    FOR EACH ROW EXECUTE FUNCTION actualizar_fecha();

CREATE TABLE interacciones (
    id              SERIAL PRIMARY KEY,
    cliente_id      INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    usuario_id      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    tipo            VARCHAR(20) NOT NULL
                    CHECK (tipo IN ('llamada','correo','visita','whatsapp','cotizacion','soporte')),
    descripcion     TEXT NOT NULL,
    fecha           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_interacciones_cliente ON interacciones(cliente_id);

-- =====================================================================
--  ADMINISTRACIÓN · RRHH
-- =====================================================================
CREATE TABLE empleados (
    id              SERIAL PRIMARY KEY,
    numero          TEXT GENERATED ALWAYS AS ('EMP-' || LPAD(id::TEXT, 3, '0')) STORED,
    nombre          VARCHAR(120) NOT NULL,
    puesto          VARCHAR(80) NOT NULL,
    area            VARCHAR(20) NOT NULL
                    CHECK (area IN ('direccion','almacen','comercial','administracion','taller')),
    telefono        VARCHAR(30),
    email           VARCHAR(150),
    fecha_ingreso   DATE NOT NULL DEFAULT CURRENT_DATE,
    salario_mensual NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (salario_mensual >= 0),
    estado          VARCHAR(10) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','baja')),
    creado          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
--  ADMINISTRACIÓN · COMPRAS (proveedores)
-- =====================================================================
CREATE TABLE proveedores (
    id                  SERIAL PRIMARY KEY,
    nombre              VARCHAR(160) NOT NULL,
    rfc                 VARCHAR(13),
    contacto            VARCHAR(120),
    telefono            VARCHAR(30),
    email               VARCHAR(150),
    tiempo_entrega_dias INTEGER NOT NULL DEFAULT 7 CHECK (tiempo_entrega_dias > 0),
    dias_credito        INTEGER NOT NULL DEFAULT 30 CHECK (dias_credito >= 0),
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    creado              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
--  ALMACÉN · EQUIPOS (flota: activos con número económico)
-- =====================================================================
CREATE TABLE equipos (
    id                  SERIAL PRIMARY KEY,
    numero_economico    VARCHAR(20) NOT NULL UNIQUE,
    tipo                VARCHAR(20) NOT NULL DEFAULT 'montacargas'
                        CHECK (tipo IN ('montacargas','patin','apilador','plataforma','otro')),
    marca               VARCHAR(60) NOT NULL,
    modelo              VARCHAR(60),
    serie               VARCHAR(60),
    anio                INTEGER,
    capacidad_kg        INTEGER,
    combustible         VARCHAR(20)
                        CHECK (combustible IN ('gas LP','electrico','diesel','gasolina','manual')),
    horometro           NUMERIC(10,1) NOT NULL DEFAULT 0,
    -- Estados de traspaso: disponible · renta · venta · reparacion
    -- (vendido y baja son estados finales)
    estado              VARCHAR(20) NOT NULL DEFAULT 'disponible'
                        CHECK (estado IN ('disponible','renta','venta','reparacion','vendido','baja')),
    ubicacion           VARCHAR(80) DEFAULT 'Patio principal',
    costo_adquisicion   NUMERIC(12,2) NOT NULL DEFAULT 0,
    tarifa_diaria       NUMERIC(10,2) NOT NULL DEFAULT 0,
    tarifa_semanal      NUMERIC(10,2) NOT NULL DEFAULT 0,
    tarifa_mensual      NUMERIC(10,2) NOT NULL DEFAULT 0,
    precio_venta        NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- Depreciación en línea recta (Contabilidad)
    vida_util_meses         INTEGER NOT NULL DEFAULT 60 CHECK (vida_util_meses > 0),
    valor_residual          NUMERIC(12,2) NOT NULL DEFAULT 0,
    depreciacion_acumulada  NUMERIC(12,2) NOT NULL DEFAULT 0,
    notas               TEXT,
    creado              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_equipos_fecha BEFORE UPDATE ON equipos
    FOR EACH ROW EXECUTE FUNCTION actualizar_fecha();

-- =====================================================================
--  COMERCIAL · TRASPASOS (historial de cambios de estado de un equipo)
-- =====================================================================
CREATE TABLE traspasos (
    id              SERIAL PRIMARY KEY,
    equipo_id       INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    estado_origen   VARCHAR(20) NOT NULL,
    estado_destino  VARCHAR(20) NOT NULL,
    motivo          TEXT,
    referencia      VARCHAR(40),       -- p. ej. R-1003, OS-1002, F-1010
    usuario_id      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_traspasos_equipo ON traspasos(equipo_id);

-- =====================================================================
--  ALMACÉN · INVENTARIO (refacciones y consumibles) con máximos/mínimos
-- =====================================================================
CREATE TABLE productos (
    id              SERIAL PRIMARY KEY,
    sku             VARCHAR(30) NOT NULL UNIQUE,
    nombre          VARCHAR(160) NOT NULL,
    categoria       VARCHAR(40) NOT NULL DEFAULT 'Refacciones',
    unidad          VARCHAR(15) NOT NULL DEFAULT 'pza',
    stock           INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    minimo          INTEGER NOT NULL DEFAULT 0 CHECK (minimo >= 0),
    maximo          INTEGER NOT NULL DEFAULT 0 CHECK (maximo >= 0),
    costo           NUMERIC(10,2) NOT NULL DEFAULT 0,
    precio          NUMERIC(10,2) NOT NULL DEFAULT 0,
    proveedor_id    INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
    ubicacion       VARCHAR(40),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (maximo = 0 OR maximo >= minimo)
);

CREATE TABLE movimientos_inventario (
    id                SERIAL PRIMARY KEY,
    producto_id       INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    tipo              VARCHAR(10) NOT NULL CHECK (tipo IN ('entrada','salida','ajuste')),
    cantidad          INTEGER NOT NULL,
    stock_resultante  INTEGER NOT NULL,
    motivo            TEXT,
    referencia        VARCHAR(40),
    usuario_id        INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_movinv_producto ON movimientos_inventario(producto_id);

-- =====================================================================
--  ADMINISTRACIÓN · COMPRAS
-- =====================================================================
CREATE TABLE ordenes_compra (
    id                SERIAL PRIMARY KEY,
    folio             TEXT GENERATED ALWAYS AS ('OC-' || (1000 + id)) STORED,
    proveedor_id      INTEGER NOT NULL REFERENCES proveedores(id),
    estado            VARCHAR(12) NOT NULL DEFAULT 'borrador'
                      CHECK (estado IN ('borrador','enviada','recibida','cancelada')),
    fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_recepcion   DATE,
    subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,
    iva               NUMERIC(12,2) NOT NULL DEFAULT 0,
    total             NUMERIC(12,2) NOT NULL DEFAULT 0,
    pagada            BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_pago        DATE,
    notas             TEXT,
    usuario_id        INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orden_compra_items (
    id              SERIAL PRIMARY KEY,
    orden_id        INTEGER NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
    producto_id     INTEGER NOT NULL REFERENCES productos(id),
    cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
    costo_unitario  NUMERIC(10,2) NOT NULL DEFAULT 0
);

-- =====================================================================
--  COMERCIAL · RENTAS
-- =====================================================================
CREATE TABLE rentas (
    id                  SERIAL PRIMARY KEY,
    folio               TEXT GENERATED ALWAYS AS ('R-' || (1000 + id)) STORED,
    cliente_id          INTEGER NOT NULL REFERENCES clientes(id),
    equipo_id           INTEGER NOT NULL REFERENCES equipos(id),
    periodo             VARCHAR(10) NOT NULL CHECK (periodo IN ('diaria','semanal','mensual')),
    cantidad_periodos   INTEGER NOT NULL DEFAULT 1 CHECK (cantidad_periodos > 0),
    tarifa              NUMERIC(10,2) NOT NULL,
    importe             NUMERIC(12,2) NOT NULL,
    deposito            NUMERIC(10,2) NOT NULL DEFAULT 0,
    fecha_inicio        DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_fin           DATE NOT NULL,
    fecha_devolucion    DATE,
    horometro_salida    NUMERIC(10,1),
    horometro_regreso   NUMERIC(10,1),
    estado              VARCHAR(12) NOT NULL DEFAULT 'activa'
                        CHECK (estado IN ('activa','finalizada','cancelada')),
    factura_id          INTEGER,
    notas               TEXT,
    usuario_id          INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
--  PRODUCCIÓN · ÓRDENES DE TRABAJO (rondas, preventivos, servicios,
--  maniobras y refacciones). Una sola tabla para las 5; el flujo de
--  estados válido por tipo se controla en lib/negocio.js.
-- =====================================================================
CREATE TABLE ordenes_trabajo (
    id                  SERIAL PRIMARY KEY,
    folio               TEXT GENERATED ALWAYS AS ('OT-' || (1000 + id)) STORED,
    tipo                VARCHAR(12) NOT NULL
                        CHECK (tipo IN ('ronda','preventivo','servicio','maniobra','refaccion')),
    cliente_id          INTEGER REFERENCES clientes(id),     -- NULL = interno (flota propia)
    equipo_id           INTEGER REFERENCES equipos(id),      -- equipo propio de Montagsa
    equipo_cliente      VARCHAR(160),                        -- descripción si el equipo es del cliente
    tecnico_id          INTEGER REFERENCES empleados(id) ON DELETE SET NULL,  -- técnico u operador
    -- Servicios: evaluacion -> requiere_cotizacion -> cotizacion_interna -> cotizacion_comercial
    --            -> autorizada/rechazada -> en_ejecucion -> cerrada -> facturada (+ cancelada)
    -- Maniobras: programada -> en_ruta -> entregada -> cerrada -> facturada (+ cancelada)
    -- Rondas: se crean directamente en 'cerrada'. Preventivos y refacciones: 'abierta' -> 'cerrada' -> 'facturada'
    estado              VARCHAR(24) NOT NULL DEFAULT 'evaluacion'
                        CHECK (estado IN ('evaluacion','requiere_cotizacion','cotizacion_interna','cotizacion_comercial',
                                           'autorizada','rechazada','en_ejecucion','abierta','programada','en_ruta',
                                           'entregada','cerrada','facturada','cancelada')),
    diagnostico         TEXT,                                -- evaluación (servicios)
    descripcion         TEXT,
    horometro           NUMERIC(10,1),                       -- lectura (rondas) u horómetro del servicio (preventivos)
    mano_obra_horas     NUMERIC(6,2) NOT NULL DEFAULT 0,
    costo_hora          NUMERIC(10,2) NOT NULL DEFAULT 0,     -- costo interno por hora de mano de obra
    costo_refacciones   NUMERIC(12,2) NOT NULL DEFAULT 0,     -- suma de ot_refacciones al costo
    costo_mano_obra     NUMERIC(12,2) NOT NULL DEFAULT 0,     -- mano_obra_horas * costo_hora
    costo_interno       NUMERIC(12,2) NOT NULL DEFAULT 0,     -- costo_refacciones + costo_mano_obra (cotización interna)
    margen              NUMERIC(12,2) NOT NULL DEFAULT 0,     -- lo agrega Comercial
    precio_cliente      NUMERIC(12,2) NOT NULL DEFAULT 0,     -- precio autorizado (o fijado en maniobras/refacciones)
    autorizado_por      VARCHAR(120),                         -- quién autorizó del lado del cliente
    fecha_autorizacion  DATE,
    origen_maniobra     VARCHAR(160),
    destino_maniobra    VARCHAR(160),
    unidad_transporte   VARCHAR(80),
    fecha_programada    DATE DEFAULT CURRENT_DATE,
    fecha_cierre        DATE,
    factura_id          INTEGER,
    notas               TEXT,
    usuario_id          INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (tipo IN ('ronda','preventivo') AND equipo_id IS NOT NULL) OR
        (tipo IN ('servicio','maniobra') AND (equipo_id IS NOT NULL OR equipo_cliente IS NOT NULL)) OR
        (tipo = 'refaccion')
    )
);
CREATE TRIGGER trg_ot_fecha BEFORE UPDATE ON ordenes_trabajo
    FOR EACH ROW EXECUTE FUNCTION actualizar_fecha();
CREATE INDEX idx_ot_equipo ON ordenes_trabajo(equipo_id);
CREATE INDEX idx_ot_tipo_estado ON ordenes_trabajo(tipo, estado);

CREATE TABLE ot_refacciones (
    id              SERIAL PRIMARY KEY,
    ot_id           INTEGER NOT NULL REFERENCES ordenes_trabajo(id) ON DELETE CASCADE,
    producto_id     INTEGER NOT NULL REFERENCES productos(id),
    cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
    costo_unitario  NUMERIC(10,2) NOT NULL,
    precio_unitario NUMERIC(10,2) NOT NULL DEFAULT 0
);

-- Rondas: bitácora de lecturas de horómetro de equipos en renta
CREATE TABLE lecturas_horometro (
    id          SERIAL PRIMARY KEY,
    equipo_id   INTEGER NOT NULL REFERENCES equipos(id),
    ot_id       INTEGER REFERENCES ordenes_trabajo(id) ON DELETE SET NULL,
    lectura     NUMERIC(10,1) NOT NULL,
    fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
    usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_lecturas_equipo ON lecturas_horometro(equipo_id);

-- Preventivos: intervalo (horas) y secuencia de servicios, configurables
CREATE TABLE config_preventivo (
    id              SERIAL PRIMARY KEY,
    intervalo_horas NUMERIC(6,1) NOT NULL DEFAULT 250 CHECK (intervalo_horas > 0)
);

-- > [!warning] Por verificar
-- > El pizarrón del taller dice "4C / 1 / 4C / 1"; su significado exacto
-- > (qué incluye cada servicio "4C" y cada servicio "1") no está confirmado.
-- > Se cargó como ejemplo editable desde Producción › Preventivos.
CREATE TABLE secuencia_preventivo (
    id              SERIAL PRIMARY KEY,
    orden           INTEGER NOT NULL UNIQUE CHECK (orden > 0),
    nombre_servicio VARCHAR(80) NOT NULL,
    descripcion     TEXT
);

-- En qué paso de la secuencia va cada equipo y cuándo fue su último preventivo
CREATE TABLE equipo_preventivo (
    equipo_id                  INTEGER PRIMARY KEY REFERENCES equipos(id) ON DELETE CASCADE,
    paso_actual                INTEGER NOT NULL DEFAULT 1,
    horometro_ultimo_servicio  NUMERIC(10,1) NOT NULL DEFAULT 0,
    fecha_ultimo_servicio      DATE
);

-- Requisiciones de refacciones (Producción las genera, Almacén las surte)
CREATE TABLE requisiciones (
    id              SERIAL PRIMARY KEY,
    folio           TEXT GENERATED ALWAYS AS ('RQ-' || (1000 + id)) STORED,
    ot_id           INTEGER NOT NULL REFERENCES ordenes_trabajo(id),
    estado          VARCHAR(12) NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','surtida','cancelada')),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_surtido   DATE,
    usuario_id      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    surtido_por     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_requisiciones_ot ON requisiciones(ot_id);

CREATE TABLE requisicion_items (
    id              SERIAL PRIMARY KEY,
    requisicion_id  INTEGER NOT NULL REFERENCES requisiciones(id) ON DELETE CASCADE,
    producto_id     INTEGER NOT NULL REFERENCES productos(id),
    cantidad        INTEGER NOT NULL CHECK (cantidad > 0)
);

-- =====================================================================
--  COMERCIAL · FACTURACIÓN
-- =====================================================================
CREATE TABLE facturas (
    id                  SERIAL PRIMARY KEY,
    folio               TEXT GENERATED ALWAYS AS ('F-' || (1000 + id)) STORED,
    cliente_id          INTEGER NOT NULL REFERENCES clientes(id),
    origen              VARCHAR(15) NOT NULL CHECK (origen IN ('renta','servicio','venta','otro','maniobra','refaccion_ot')),
    origen_id           INTEGER,
    fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_vencimiento   DATE NOT NULL DEFAULT CURRENT_DATE,
    subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
    iva                 NUMERIC(12,2) NOT NULL DEFAULT 0,
    total               NUMERIC(12,2) NOT NULL DEFAULT 0,
    pagado              NUMERIC(12,2) NOT NULL DEFAULT 0,
    estado              VARCHAR(12) NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente','parcial','pagada','cancelada')),
    notas               TEXT,
    usuario_id          INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_facturas_cliente ON facturas(cliente_id);

ALTER TABLE rentas          ADD CONSTRAINT fk_rentas_factura FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE SET NULL;
ALTER TABLE ordenes_trabajo ADD CONSTRAINT fk_ot_factura     FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE SET NULL;

CREATE TABLE factura_conceptos (
    id              SERIAL PRIMARY KEY,
    factura_id      INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    descripcion     TEXT NOT NULL,
    cantidad        NUMERIC(10,2) NOT NULL DEFAULT 1,
    precio_unitario NUMERIC(12,2) NOT NULL,
    importe         NUMERIC(12,2) NOT NULL
);

-- =====================================================================
--  ADMINISTRACIÓN · COBRANZA
-- =====================================================================
-- Un pago mal capturado no se borra: se anula (poliza de reversa + motivo),
-- igual que las polizas manuales. cuenta_bancaria_id se guarda para que la
-- reversa golpee exactamente la misma cuenta que el cobro original.
CREATE TABLE pagos (
    id                  SERIAL PRIMARY KEY,
    factura_id          INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
    monto               NUMERIC(12,2) NOT NULL CHECK (monto > 0),
    metodo              VARCHAR(15) NOT NULL DEFAULT 'transferencia'
                        CHECK (metodo IN ('transferencia','efectivo','cheque','tarjeta')),
    referencia          VARCHAR(60),
    cuenta_bancaria_id  INTEGER,
    cancelado           BOOLEAN NOT NULL DEFAULT FALSE,
    motivo_cancelacion  TEXT,
    cancelado_por       INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_cancelacion   TIMESTAMP,
    usuario_id          INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
--  ADMINISTRACIÓN · CONTABILIDAD (partida doble)
-- =====================================================================
-- Catálogo jerárquico: cuentas de mayor (nivel 1, padre_id NULL) y
-- subcuentas (p. ej. una por banco, colgada de "Bancos" 1102).
-- naturaleza decide el signo de saldo "normal" (no siempre coincide con el
-- tipo: la depreciación acumulada es tipo 'activo' pero naturaleza 'acreedora'
-- porque es una cuenta complementaria/contra-activo).
CREATE TABLE cuentas_contables (
    id                    SERIAL PRIMARY KEY,
    codigo                VARCHAR(10) NOT NULL UNIQUE,
    nombre                VARCHAR(120) NOT NULL,
    tipo                  VARCHAR(10) NOT NULL CHECK (tipo IN ('activo','pasivo','capital','ingreso','costo','gasto')),
    naturaleza            VARCHAR(10) NOT NULL CHECK (naturaleza IN ('deudora','acreedora')),
    padre_id              INTEGER REFERENCES cuentas_contables(id),
    nivel                 INTEGER NOT NULL DEFAULT 1 CHECK (nivel > 0),
    codigo_agrupador_sat  VARCHAR(10),
    activa                BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_cuentas_padre ON cuentas_contables(padre_id);

-- Cuentas bancarias de la empresa: cada una es una subcuenta de "Bancos" (1102).
CREATE TABLE cuentas_bancarias (
    id                  SERIAL PRIMARY KEY,
    banco               VARCHAR(80) NOT NULL,
    numero_enmascarado  VARCHAR(30) NOT NULL,
    cuenta_contable_id  INTEGER NOT NULL REFERENCES cuentas_contables(id),
    saldo_inicial       NUMERIC(12,2) NOT NULL DEFAULT 0,
    activa              BOOLEAN NOT NULL DEFAULT TRUE,
    creado              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE pagos ADD CONSTRAINT fk_pagos_cuenta_bancaria
    FOREIGN KEY (cuenta_bancaria_id) REFERENCES cuentas_bancarias(id) ON DELETE SET NULL;

CREATE TABLE polizas (
    id          SERIAL PRIMARY KEY,
    folio       TEXT GENERATED ALWAYS AS ('P-' || (1000 + id)) STORED,
    fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo        VARCHAR(10) NOT NULL CHECK (tipo IN ('ingreso','egreso','diario')),
    concepto    TEXT NOT NULL,
    referencia  VARCHAR(40),
    automatica  BOOLEAN NOT NULL DEFAULT TRUE,
    cancelada   BOOLEAN NOT NULL DEFAULT FALSE,
    usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE poliza_movimientos (
    id          SERIAL PRIMARY KEY,
    poliza_id   INTEGER NOT NULL REFERENCES polizas(id) ON DELETE CASCADE,
    cuenta_id   INTEGER NOT NULL REFERENCES cuentas_contables(id),
    cargo       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cargo >= 0),
    abono       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (abono >= 0),
    conciliado  BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_polmov_cuenta ON poliza_movimientos(cuenta_id);

-- Cierre de periodo: ningún mes cerrado admite pólizas nuevas (lib/negocio.js
-- lo valida en crearPoliza antes de insertar). Solo admin puede reabrir.
CREATE TABLE periodos_contables (
    id            SERIAL PRIMARY KEY,
    anio          INTEGER NOT NULL CHECK (anio >= 2000),
    mes           INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
    cerrado       BOOLEAN NOT NULL DEFAULT FALSE,
    cerrado_por   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_cierre  TIMESTAMP,
    UNIQUE (anio, mes)
);

-- =====================================================================
--  COLABORACION (bitacora por registro, estilo "chatter")
--  notas, adjuntos y actividades cuelgan de cualquier registro de las
--  entidades de abajo mediante (entidad, entidad_id). No hay FK real
--  porque apuntan a seis tablas distintas; quien consulta la bitacora
--  tiene que tener permiso de esa entidad (ver lib/auth.js#puedeEntidad).
-- =====================================================================
CREATE TABLE notas (
    id          SERIAL PRIMARY KEY,
    entidad     VARCHAR(15) NOT NULL
                CHECK (entidad IN ('cliente','renta','ot','factura','orden_compra','equipo')),
    entidad_id  INTEGER NOT NULL,
    usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    texto       TEXT NOT NULL,
    fecha       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notas_entidad ON notas(entidad, entidad_id);

-- El archivo vive en uploads/ (fuera de public/): solo se descarga por
-- GET /api/adjuntos/:id, que vuelve a revisar el permiso de la entidad.
CREATE TABLE adjuntos (
    id          SERIAL PRIMARY KEY,
    entidad     VARCHAR(15) NOT NULL
                CHECK (entidad IN ('cliente','renta','ot','factura','orden_compra','equipo')),
    entidad_id  INTEGER NOT NULL,
    nombre      VARCHAR(200) NOT NULL,
    ruta        TEXT NOT NULL,
    tipo        VARCHAR(100),
    tamano      INTEGER NOT NULL DEFAULT 0,
    usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_adjuntos_entidad ON adjuntos(entidad, entidad_id);

CREATE TABLE actividades (
    id            SERIAL PRIMARY KEY,
    entidad       VARCHAR(15) NOT NULL
                  CHECK (entidad IN ('cliente','renta','ot','factura','orden_compra','equipo')),
    entidad_id    INTEGER NOT NULL,
    tipo          VARCHAR(20) NOT NULL
                  CHECK (tipo IN ('llamada','visita','correo','tarea','recoger_equipo','entregar_equipo')),
    asignado_a    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    fecha_limite  DATE NOT NULL DEFAULT CURRENT_DATE,
    nota          TEXT,
    hecha         BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_hecha   TIMESTAMP,
    creado_por    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    creado        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_actividades_entidad ON actividades(entidad, entidad_id);
CREATE INDEX idx_actividades_pendientes ON actividades(asignado_a, hecha, fecha_limite);

-- =====================================================================
--  AUDITORIA
--  Rastro de las operaciones sensibles (dinero, credito y accesos).
--  'antes'/'despues' guardan el registro completo en JSONB; nunca se
--  guardan hashes de contrasena (ver routes/comun.js#sinSecretos).
-- =====================================================================
CREATE TABLE auditoria (
    id          SERIAL PRIMARY KEY,
    usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    accion      VARCHAR(30) NOT NULL,
    entidad     VARCHAR(30) NOT NULL,
    entidad_id  INTEGER,
    antes       JSONB,
    despues     JSONB,
    ip          VARCHAR(45),
    fecha       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_auditoria_fecha ON auditoria(fecha DESC);
CREATE INDEX idx_auditoria_entidad ON auditoria(entidad, entidad_id);

-- =====================================================================
--  CRM · EMBUDO DE OPORTUNIDADES
--  Una oportunidad es de un cliente ya registrado o de un prospecto
--  suelto (todavia sin ficha de cliente): por eso cliente_id es opcional.
-- =====================================================================
CREATE TABLE oportunidades (
    id                     SERIAL PRIMARY KEY,
    folio                  TEXT GENERATED ALWAYS AS ('OP-' || (1000 + id)) STORED,
    cliente_id             INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    prospecto              VARCHAR(160),
    titulo                 VARCHAR(160) NOT NULL,
    valor_estimado         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_estimado >= 0),
    probabilidad           INTEGER NOT NULL DEFAULT 50 CHECK (probabilidad BETWEEN 0 AND 100),
    etapa                  VARCHAR(12) NOT NULL DEFAULT 'nuevo'
                           CHECK (etapa IN ('nuevo','calificado','cotizado','negociacion','ganado','perdido')),
    responsable_id         INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_cierre_estimada  DATE,
    motivo_perdida         TEXT,
    notas                  TEXT,
    creado                 TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (cliente_id IS NOT NULL OR prospecto IS NOT NULL),
    CHECK (etapa <> 'perdido' OR motivo_perdida IS NOT NULL)
);
CREATE TRIGGER trg_oportunidades_fecha BEFORE UPDATE ON oportunidades
    FOR EACH ROW EXECUTE FUNCTION actualizar_fecha();
CREATE INDEX idx_oportunidades_etapa ON oportunidades(etapa);

-- =====================================================================
--  DATOS MAESTROS
-- =====================================================================

-- Usuarios (contraseñas con bcrypt vía pgcrypto)
INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES
('Administrador General', 'admin@montagsa.mx',     crypt('Admin#MG2026',  gen_salt('bf', 10)), 'admin'),
('Jorge Almacén',         'almacen@montagsa.mx',   crypt('Almacen#MG2026', gen_salt('bf', 10)), 'almacen'),
('Karla Comercial',       'comercial@montagsa.mx', crypt('Comercial#MG2026', gen_salt('bf', 10)), 'comercial'),
('Beto Producción',       'produccion@montagsa.mx', crypt('Produccion#MG2026', gen_salt('bf', 10)), 'produccion'),
('Rosa Administración',   'admon@montagsa.mx',     crypt('Admon#MG2026',  gen_salt('bf', 10)), 'administracion'),
('Contabilidad Montagsa', 'contabilidad@montagsa.mx', crypt('Contabilidad#MG2026', gen_salt('bf', 10)), 'contabilidad');

-- Catálogo de cuentas (jerárquico: cuentas de mayor; las subcuentas de banco
-- se crean cuando se registra una cuenta bancaria, ver lib/negocio.js#crearCuentaBancaria)
INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, nivel) VALUES
('1101', 'Caja',                              'activo',   'deudora',   1),
('1102', 'Bancos',                            'activo',   'deudora',   1),
('1105', 'Clientes',                          'activo',   'deudora',   1),
('1150', 'Inventario de refacciones',         'activo',   'deudora',   1),
('1151', 'IVA acreditable',                   'activo',   'deudora',   1),
('1152', 'IVA por acreditar',                 'activo',   'deudora',   1),
('1201', 'Equipo de renta (flota)',           'activo',   'deudora',   1),
('1202', 'Depreciación acumulada de flota',   'activo',   'acreedora', 1),
('2101', 'Proveedores',                       'pasivo',   'acreedora', 1),
('2102', 'Acreedores diversos',               'pasivo',   'acreedora', 1),
('2105', 'IVA trasladado cobrado',            'pasivo',   'acreedora', 1),
('2106', 'IVA trasladado no cobrado',         'pasivo',   'acreedora', 1),
('2110', 'ISR y retenciones por pagar',       'pasivo',   'acreedora', 1),
('3101', 'Capital social',                    'capital',  'acreedora', 1),
('4101', 'Ingresos por rentas',               'ingreso',  'acreedora', 1),
('4102', 'Ingresos por servicios',            'ingreso',  'acreedora', 1),
('4103', 'Ingresos por venta de equipo',      'ingreso',  'acreedora', 1),
('4104', 'Otros ingresos',                    'ingreso',  'acreedora', 1),
('4105', 'Ingresos por maniobras',            'ingreso',  'acreedora', 1),
('4106', 'Ingresos por venta de refacciones', 'ingreso',  'acreedora', 1),
('5101', 'Costo de refacciones usadas',       'costo',    'deudora',   1),
('5102', 'Costo de equipo vendido',           'costo',    'deudora',   1),
('6101', 'Sueldos y salarios',                'gasto',    'deudora',   1),
('6102', 'Gastos generales',                  'gasto',    'deudora',   1),
('6103', 'Gasto por depreciación',            'gasto',    'deudora',   1);

-- Clientes (empresas ficticias)
INSERT INTO clientes (razon_social, rfc, contacto, telefono, email, direccion, etapa, limite_credito, dias_credito, credito_estado) VALUES
('Logística del Bajío S.A. de C.V.',   'LBA150312AB1', 'Ing. Marco Ruiz',     '449 910 2233', 'compras@logbajio.mx',     'Parque Industrial San Francisco, Ags.',  'frecuente', 250000, 30, 'activo'),
('Autopartes Hidrocálidas S.A.',        'AHI090807CD2', 'Lic. Ana Torres',     '449 915 4411', 'atorres@autohidro.mx',    'Parque Industrial del Valle, Ags.',      'activo',    150000, 30, 'activo'),
('Distribuidora La Perla',              'DLP120110EF3', 'Sr. Tomás Gallegos',  '449 918 7700', 'tgallegos@laperla.mx',    'Av. Aguascalientes Sur 1200',            'activo',     80000, 15, 'activo'),
('Textiles San Marcos S.A. de C.V.',    'TSM180522GH4', 'Lic. Paola Ibarra',   '449 921 3344', 'pibarra@txsanmarcos.mx',  'Blvd. Siglo XXI 450, Ags.',              'prospecto',      0,  0, 'sin_credito'),
('Frigoríficos del Centro',             'FCE110304IJ5', 'Ing. Luis Medina',    '449 930 5566', 'lmedina@frigocentro.mx',  'Carr. a Calvillo km 4',                  'activo',    120000, 30, 'suspendido'),
('Constructora Altavista',              'CAL160918KL6', 'Arq. Sofía Rangel',   '449 940 8899', 'srangel@altavista.mx',    'Av. Universidad 1001, Ags.',             'inactivo',   50000, 15, 'activo');

-- Proveedores
INSERT INTO proveedores (nombre, rfc, contacto, telefono, email, tiempo_entrega_dias, dias_credito) VALUES
('Refacciones Industriales del Norte', 'RIN100101AA1', 'Carlos Pérez',  '81 8333 1122', 'ventas@rinorte.mx',      5, 30),
('Baterías y Energía Tracción',        'BET120202BB2', 'Mónica Salas',  '33 3615 7788', 'contacto@betraccion.mx', 10, 15),
('Llantas Sólidas de México',          'LSM130303CC3', 'Raúl Estrada',  '55 5580 4433', 'raul@llantassolidas.mx',  7, 30),
('Lubricantes del Bajío',              'LUB140404DD4', 'Elena Cruz',    '449 912 6655', 'pedidos@lubbajio.mx',     3, 0);

-- Equipos (flota)
INSERT INTO equipos (numero_economico, tipo, marca, modelo, serie, anio, capacidad_kg, combustible, horometro, estado, ubicacion, costo_adquisicion, tarifa_diaria, tarifa_semanal, tarifa_mensual, precio_venta) VALUES
('MG-001', 'montacargas', 'Toyota',     '8FGU25',   'TY8F-60231', 2019, 2500, 'gas LP',    8120.5, 'disponible', 'Patio principal', 420000, 1200, 6500, 19500, 380000),
('MG-002', 'montacargas', 'Toyota',     '8FGU25',   'TY8F-60588', 2020, 2500, 'gas LP',    6340.0, 'disponible', 'Patio principal', 445000, 1200, 6500, 19500, 400000),
('MG-003', 'montacargas', 'Hyster',     'H50FT',    'HY50-11874', 2018, 2250, 'gas LP',   10450.2, 'disponible', 'Patio principal', 390000, 1100, 6000, 18000, 320000),
('MG-004', 'montacargas', 'Yale',       'GLP050',   'YL05-33410', 2021, 2250, 'gas LP',    3980.7, 'disponible', 'Patio principal', 460000, 1250, 6800, 20000, 430000),
('MG-005', 'montacargas', 'Crown',      'FC5200',   'CR52-90021', 2022, 1800, 'electrico', 2150.0, 'disponible', 'Nave de carga',   520000, 1400, 7500, 22500, 480000),
('MG-006', 'montacargas', 'Caterpillar','DP25N',    'CAT25-4471', 2017, 2500, 'diesel',   12880.4, 'disponible', 'Patio principal', 410000, 1150, 6200, 18500, 300000),
('MG-007', 'apilador',    'Crown',      'SX3000',   'CRSX-55120', 2021, 1350, 'electrico', 1540.0, 'disponible', 'Nave de carga',   180000,  650, 3500, 10500, 160000),
('MG-008', 'patin',       'Jungheinrich','EJE 120', 'JH12-77810', 2023, 2000, 'electrico',  420.0, 'disponible', 'Nave de carga',    75000,  350, 1800,  5200,  70000),
('MG-009', 'patin',       'Uline',      'H-1043',   'UL10-43002', 2022, 2500, 'manual',       0.0, 'disponible', 'Almacén',           9500,   90,  450,  1300,   9000),
('MG-010', 'plataforma',  'Genie',      'GS-1930',  'GN19-30077', 2019,  227, 'electrico', 1880.0, 'disponible', 'Patio principal', 260000,  900, 4800, 14500, 210000),
('MG-011', 'montacargas', 'Nissan',     'MCUGJ02',  'NS02-12093', 2016, 2500, 'gas LP',   14210.9, 'venta',      'Exhibición',      195000, 1000, 5500, 16500, 245000),
('MG-012', 'montacargas', 'Hyster',     'H70FT',    'HY70-20931', 2020, 3200, 'diesel',    7010.3, 'disponible', 'Patio principal', 540000, 1500, 8200, 24500, 470000);

-- Refacciones y consumibles (con máximos y mínimos)
INSERT INTO productos (sku, nombre, categoria, unidad, stock, minimo, maximo, costo, precio, proveedor_id, ubicacion) VALUES
('REF-FIL-AC01', 'Filtro de aceite motor Toyota 4Y',           'Filtros',       'pza', 14,  6, 30,   180,   320, 1, 'A-01'),
('REF-FIL-AI02', 'Filtro de aire Toyota 8FGU',                 'Filtros',       'pza',  4,  6, 25,   260,   450, 1, 'A-01'),
('REF-FIL-HI03', 'Filtro hidráulico universal',                'Filtros',       'pza',  9,  5, 20,   310,   540, 1, 'A-02'),
('REF-BUJ-004',  'Bujía NGK para motor gas LP',                'Motor',         'pza', 40, 16, 60,    75,   140, 1, 'A-03'),
('REF-BAN-005',  'Banda de alternador',                        'Motor',         'pza',  2,  4, 12,   220,   390, 1, 'A-03'),
('REF-LLA-006',  'Llanta sólida 6.50-10 negra',                'Llantas',       'pza',  8,  8, 24,  2100,  3200, 3, 'B-01'),
('REF-LLA-007',  'Llanta sólida 18x7-8 no marcante',           'Llantas',       'pza', 30,  6, 20,  1850,  2900, 3, 'B-01'),
('REF-BAT-008',  'Batería de tracción 36V 750Ah',              'Eléctrico',     'pza',  1,  1,  3, 68000, 89000, 2, 'C-01'),
('REF-CAR-009',  'Cargador de batería 36V',                    'Eléctrico',     'pza',  2,  1,  4, 21000, 29500, 2, 'C-01'),
('REF-CAD-010',  'Cadena de mástil (tramo 1 m)',               'Mástil',        'm',   12,  5, 25,   640,  1050, 1, 'B-02'),
('REF-RUL-011',  'Rodillo de mástil',                          'Mástil',        'pza',  3,  4, 16,   890,  1450, 1, 'B-02'),
('CON-ACE-012',  'Aceite hidráulico ISO 68 (cubeta 19 L)',     'Lubricantes',   'cub',  6,  4, 15,  1150,  1700, 4, 'D-01'),
('CON-ACE-013',  'Aceite de motor 15W40 (garrafa 4 L)',        'Lubricantes',   'pza', 18,  8, 30,   420,   690, 4, 'D-01'),
('CON-GRA-014',  'Grasa de litio (cartucho)',                  'Lubricantes',   'pza', 25, 10, 40,    95,   170, 4, 'D-02'),
('CON-GAS-015',  'Tanque de gas LP 20 kg (recarga)',           'Combustible',   'pza', 10,  6, 20,   480,   650, 4, 'Patio');

-- Empleados (RRHH)
INSERT INTO empleados (nombre, puesto, area, telefono, email, fecha_ingreso, salario_mensual) VALUES
('Ricardo Montañez',    'Director general',          'direccion',      '449 100 0001', 'direccion@montagsa.mx', '2012-03-01', 65000),
('Jorge Almacén',       'Jefe de almacén',           'almacen',        '449 100 0002', 'almacen@montagsa.mx',   '2016-07-15', 22000),
('Karla Comercial',     'Ejecutiva comercial',       'comercial',      '449 100 0003', 'comercial@montagsa.mx', '2019-01-10', 20000),
('Rosa Administración', 'Contadora',                 'administracion', '449 100 0004', 'admon@montagsa.mx',     '2015-05-20', 26000),
('Héctor Villalobos',   'Técnico mecánico',          'taller',         '449 100 0005', NULL,                    '2018-09-03', 16500),
('Iván Esparza',        'Técnico eléctrico',         'taller',         '449 100 0006', NULL,                    '2021-02-22', 15500),
('Miguel Ángel Lara',   'Operador de entregas',      'almacen',        '449 100 0007', NULL,                    '2020-11-09', 12500),
('Daniela Robles',      'Auxiliar de cobranza',      'administracion', '449 100 0008', 'cobranza@montagsa.mx',  '2023-04-17', 13500),
('Beto Producción',      'Supervisor de taller',      'taller',         '449 100 0009', 'produccion@montagsa.mx','2014-02-10', 24000);

-- Producción: intervalo y secuencia de mantenimiento preventivo
INSERT INTO config_preventivo (intervalo_horas) VALUES (250);

INSERT INTO secuencia_preventivo (orden, nombre_servicio, descripcion) VALUES
(1, '4C', 'Servicio de 4 componentes: cambio de aceite de motor, filtro de aceite, filtro de aire y filtro hidráulico [POR CONFIRMAR]'),
(2, '1',  'Servicio 1: revisión general, engrasado y ajuste de frenos [POR CONFIRMAR]'),
(3, '4C', 'Servicio de 4 componentes: cambio de aceite de motor, filtro de aceite, filtro de aire y filtro hidráulico [POR CONFIRMAR]'),
(4, '1',  'Servicio 1: revisión general, engrasado y ajuste de frenos [POR CONFIRMAR]');

-- Póliza de apertura: capital inicial en bancos, flota e inventario
DO $$
DECLARE
    p INTEGER;
    flota NUMERIC := (SELECT COALESCE(SUM(costo_adquisicion),0) FROM equipos);
    inv   NUMERIC := (SELECT COALESCE(SUM(stock * costo),0) FROM productos);
    bancos NUMERIC := 850000;
BEGIN
    INSERT INTO polizas (fecha, tipo, concepto, referencia, automatica)
    VALUES (date_trunc('year', CURRENT_DATE)::date, 'diario', 'Póliza de apertura', 'APERTURA', FALSE)
    RETURNING id INTO p;
    INSERT INTO poliza_movimientos (poliza_id, cuenta_id, cargo, abono) VALUES
        (p, (SELECT id FROM cuentas_contables WHERE codigo='1102'), bancos, 0),
        (p, (SELECT id FROM cuentas_contables WHERE codigo='1201'), flota, 0),
        (p, (SELECT id FROM cuentas_contables WHERE codigo='1150'), inv, 0),
        (p, (SELECT id FROM cuentas_contables WHERE codigo='3101'), 0, bancos + flota + inv);
END $$;

-- Verificación rápida
SELECT 'usuarios' AS tabla, COUNT(*) FROM usuarios
UNION ALL SELECT 'clientes', COUNT(*) FROM clientes
UNION ALL SELECT 'equipos', COUNT(*) FROM equipos
UNION ALL SELECT 'productos', COUNT(*) FROM productos
UNION ALL SELECT 'empleados', COUNT(*) FROM empleados
UNION ALL SELECT 'secuencia_preventivo', COUNT(*) FROM secuencia_preventivo;
