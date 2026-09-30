// routes/crm-almacen.js — CRM (clientes, interacciones) y Almacén (equipos, inventario, máximos/mínimos)
const express = require('express');
const { pool, tx, uno, todos, ruta, ErrorNegocio } = require('../lib/db');
const { puede } = require('../lib/auth');
const N = require('../lib/negocio');
const { insertar, actualizar } = require('./comun');

const router = express.Router();

// =====================================================================
//  CRM · CLIENTES
// =====================================================================
const CAMPOS_CLIENTE = ['razon_social', 'rfc', 'contacto', 'telefono', 'email', 'direccion', 'etapa', 'notas'];

router.get('/clientes', puede('clientes'), ruta(async (req, res) => {
    const { q, etapa } = req.query;
    const params = [];
    const w = [];
    if (q) { params.push(`%${q}%`); w.push(`(c.razon_social ILIKE $${params.length} OR c.rfc ILIKE $${params.length} OR c.contacto ILIKE $${params.length})`); }
    if (etapa) { params.push(etapa); w.push(`c.etapa = $${params.length}`); }
    res.json(await todos(pool,
        `SELECT c.*,
                COALESCE((SELECT SUM(total - pagado) FROM facturas f WHERE f.cliente_id = c.id AND f.estado IN ('pendiente','parcial')), 0) AS saldo,
                (SELECT COUNT(*)::int FROM rentas r WHERE r.cliente_id = c.id AND r.estado = 'activa') AS rentas_activas,
                (SELECT MAX(fecha) FROM interacciones i WHERE i.cliente_id = c.id) AS ultima_interaccion
         FROM clientes c ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY c.razon_social`, params));
}));

router.get('/clientes/:id', puede('clientes'), ruta(async (req, res) => {
    const id = req.params.id;
    const cliente = await uno(pool, 'SELECT * FROM clientes WHERE id = $1', [id]);
    if (!cliente) throw new ErrorNegocio(404, 'Cliente no encontrado');
    const [saldo, rentas, facturas, servicios, interacciones] = await Promise.all([
        N.saldoCliente(pool, id),
        todos(pool, `SELECT r.*, e.numero_economico FROM rentas r JOIN equipos e ON e.id = r.equipo_id WHERE r.cliente_id = $1 ORDER BY r.id DESC LIMIT 20`, [id]),
        todos(pool, `SELECT id, folio, origen, fecha, fecha_vencimiento, total, pagado, estado FROM facturas WHERE cliente_id = $1 ORDER BY id DESC LIMIT 20`, [id]),
        todos(pool, `SELECT id, folio, tipo, estado, fecha_programada FROM ordenes_trabajo WHERE cliente_id = $1 ORDER BY id DESC LIMIT 20`, [id]),
        todos(pool, `SELECT i.*, u.nombre AS usuario FROM interacciones i LEFT JOIN usuarios u ON u.id = i.usuario_id WHERE cliente_id = $1 ORDER BY fecha DESC LIMIT 30`, [id]),
    ]);
    res.json({ ...cliente, saldo, rentas, facturas, servicios, interacciones });
}));

router.post('/clientes', puede('clientes'), ruta(async (req, res) => {
    if (!req.body.razon_social) throw new ErrorNegocio(400, 'La razón social es obligatoria');
    res.status(201).json(await insertar(pool, 'clientes', CAMPOS_CLIENTE, req.body));
}));

router.put('/clientes/:id', puede('clientes'), ruta(async (req, res) => {
    res.json(await actualizar(pool, 'clientes', req.params.id, CAMPOS_CLIENTE, req.body));
}));

// =====================================================================
//  CRM · INTERACCIONES
// =====================================================================
router.get('/interacciones', puede('interacciones'), ruta(async (req, res) => {
    const params = [];
    let w = '';
    if (req.query.cliente_id) { params.push(req.query.cliente_id); w = 'WHERE i.cliente_id = $1'; }
    res.json(await todos(pool,
        `SELECT i.*, c.razon_social, u.nombre AS usuario FROM interacciones i
         JOIN clientes c ON c.id = i.cliente_id LEFT JOIN usuarios u ON u.id = i.usuario_id
         ${w} ORDER BY i.fecha DESC LIMIT 200`, params));
}));

router.post('/interacciones', puede('interacciones'), ruta(async (req, res) => {
    const { cliente_id, tipo, descripcion } = req.body || {};
    if (!cliente_id || !tipo || !descripcion) throw new ErrorNegocio(400, 'Cliente, tipo y descripción son obligatorios');
    res.status(201).json(await uno(pool,
        'INSERT INTO interacciones (cliente_id, usuario_id, tipo, descripcion) VALUES ($1,$2,$3,$4) RETURNING *',
        [cliente_id, req.usuario.id, tipo, descripcion]));
}));

// =====================================================================
//  ALMACÉN · EQUIPOS
// =====================================================================
// El estado NO se edita aquí: solo cambia por traspasos, rentas, servicios o venta.
const CAMPOS_EQUIPO = ['numero_economico', 'tipo', 'marca', 'modelo', 'serie', 'anio', 'capacidad_kg', 'combustible',
    'horometro', 'ubicacion', 'costo_adquisicion', 'tarifa_diaria', 'tarifa_semanal', 'tarifa_mensual', 'precio_venta', 'notas'];

router.get('/equipos', puede('equipos'), ruta(async (req, res) => {
    const params = [];
    let w = '';
    if (req.query.estado) { params.push(req.query.estado); w = 'WHERE e.estado = $1'; }
    res.json(await todos(pool,
        `SELECT e.*,
                (SELECT r.folio || ' · ' || c.razon_social FROM rentas r JOIN clientes c ON c.id = r.cliente_id
                  WHERE r.equipo_id = e.id AND r.estado = 'activa' LIMIT 1) AS renta_actual
         FROM equipos e ${w} ORDER BY e.numero_economico`, params));
}));

router.get('/equipos/:id', puede('equipos'), ruta(async (req, res) => {
    const id = req.params.id;
    const equipo = await uno(pool, 'SELECT * FROM equipos WHERE id = $1', [id]);
    if (!equipo) throw new ErrorNegocio(404, 'Equipo no encontrado');
    const [traspasos, rentas, servicios] = await Promise.all([
        todos(pool, `SELECT t.*, u.nombre AS usuario FROM traspasos t LEFT JOIN usuarios u ON u.id = t.usuario_id WHERE equipo_id = $1 ORDER BY fecha DESC`, [id]),
        todos(pool, `SELECT r.*, c.razon_social FROM rentas r JOIN clientes c ON c.id = r.cliente_id WHERE equipo_id = $1 ORDER BY r.id DESC`, [id]),
        todos(pool, `SELECT id, folio, tipo, estado, descripcion, fecha_programada FROM ordenes_trabajo WHERE equipo_id = $1 ORDER BY id DESC`, [id]),
    ]);
    res.json({ ...equipo, traspasos, rentas, servicios });
}));

router.post('/equipos', puede('inventario'), ruta(async (req, res) => {
    if (!req.body.numero_economico || !req.body.marca) throw new ErrorNegocio(400, 'Número económico y marca son obligatorios');
    res.status(201).json(await insertar(pool, 'equipos', CAMPOS_EQUIPO, req.body));
}));

router.put('/equipos/:id', puede('inventario'), ruta(async (req, res) => {
    res.json(await actualizar(pool, 'equipos', req.params.id, CAMPOS_EQUIPO, req.body));
}));

// =====================================================================
//  ALMACÉN · INVENTARIO (refacciones)
// =====================================================================
const CAMPOS_PRODUCTO = ['sku', 'nombre', 'categoria', 'unidad', 'minimo', 'maximo', 'costo', 'precio', 'proveedor_id', 'ubicacion', 'activo'];

router.get('/productos', puede('inventario', 'maxmin'), ruta(async (req, res) => {
    res.json(await todos(pool,
        `SELECT p.*, pr.nombre AS proveedor FROM productos p LEFT JOIN proveedores pr ON pr.id = p.proveedor_id ORDER BY p.sku`));
}));

router.post('/productos', puede('inventario'), ruta(async (req, res) => {
    if (!req.body.sku || !req.body.nombre) throw new ErrorNegocio(400, 'SKU y nombre son obligatorios');
    const stockInicial = Number(req.body.stock || 0);
    const p = await tx(async (c) => {
        const nuevo = await insertar(c, 'productos', CAMPOS_PRODUCTO, req.body);
        if (stockInicial > 0) await N.moverInventario(c, nuevo.id, 'entrada', stockInicial, { motivo: 'Stock inicial', uid: req.usuario.id });
        return nuevo;
    });
    res.status(201).json(p);
}));

router.put('/productos/:id', puede('inventario'), ruta(async (req, res) => {
    res.json(await actualizar(pool, 'productos', req.params.id, CAMPOS_PRODUCTO, req.body));
}));

// Entrada / salida / ajuste manual
router.post('/productos/:id/movimiento', puede('inventario'), ruta(async (req, res) => {
    const { tipo, cantidad, motivo } = req.body || {};
    if (!motivo) throw new ErrorNegocio(400, 'Indica el motivo del movimiento');
    res.json(await tx((c) => N.moverInventario(c, req.params.id, tipo, cantidad, { motivo, referencia: 'MANUAL', uid: req.usuario.id })));
}));

router.get('/movimientos', puede('movimientos'), ruta(async (req, res) => {
    const params = [];
    let w = '';
    if (req.query.producto_id) { params.push(req.query.producto_id); w = 'WHERE m.producto_id = $1'; }
    res.json(await todos(pool,
        `SELECT m.*, p.sku, p.nombre, u.nombre AS usuario FROM movimientos_inventario m
         JOIN productos p ON p.id = m.producto_id LEFT JOIN usuarios u ON u.id = m.usuario_id
         ${w} ORDER BY m.fecha DESC, m.id DESC LIMIT 300`, params));
}));

// =====================================================================
//  ALMACÉN · MÁXIMOS Y MÍNIMOS
// =====================================================================
router.get('/maxmin', puede('maxmin'), ruta(async (req, res) => {
    const filas = await todos(pool,
        `SELECT p.id, p.sku, p.nombre, p.unidad, p.stock, p.minimo, p.maximo, p.costo, pr.nombre AS proveedor,
                pr.tiempo_entrega_dias,
                CASE WHEN p.stock = 0 THEN 'agotado'
                     WHEN p.stock <= p.minimo THEN 'bajo_minimo'
                     WHEN p.maximo > 0 AND p.stock > p.maximo THEN 'sobre_maximo'
                     ELSE 'ok' END AS situacion,
                CASE WHEN p.stock <= p.minimo AND p.maximo > 0 THEN p.maximo - p.stock ELSE 0 END AS sugerido,
                EXISTS (SELECT 1 FROM orden_compra_items i JOIN ordenes_compra o ON o.id = i.orden_id
                        WHERE i.producto_id = p.id AND o.estado IN ('borrador','enviada')) AS en_orden
         FROM productos p LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
         WHERE p.activo
         ORDER BY CASE WHEN p.stock = 0 THEN 0 WHEN p.stock <= p.minimo THEN 1 WHEN p.maximo > 0 AND p.stock > p.maximo THEN 2 ELSE 3 END, p.sku`);
    const resumen = {
        agotado: filas.filter((f) => f.situacion === 'agotado').length,
        bajo_minimo: filas.filter((f) => f.situacion === 'bajo_minimo').length,
        sobre_maximo: filas.filter((f) => f.situacion === 'sobre_maximo').length,
        ok: filas.filter((f) => f.situacion === 'ok').length,
        valor_inventario: filas.reduce((s, f) => s + f.stock * f.costo, 0),
    };
    res.json({ resumen, filas });
}));

router.post('/maxmin/generar-oc', puede('compras'), ruta(async (req, res) => {
    const creadas = await tx((c) => N.generarOCsPorMinimos(c, { productoIds: req.body && req.body.producto_ids, uid: req.usuario.id }));
    res.json({ creadas });
}));

// =====================================================================
//  ALMACÉN · REQUISICIONES (refacciones pedidas por Producción)
// =====================================================================
router.get('/requisiciones', puede('requisiciones'), ruta(async (req, res) => {
    const params = [];
    let w = '';
    if (req.query.estado) { params.push(req.query.estado); w = 'WHERE rq.estado = $1'; }
    res.json(await todos(pool,
        `SELECT rq.*, ot.folio AS ot_folio, ot.tipo AS ot_tipo, ot.descripcion AS ot_descripcion,
                (SELECT COUNT(*)::int FROM requisicion_items i WHERE i.requisicion_id = rq.id) AS partidas
         FROM requisiciones rq JOIN ordenes_trabajo ot ON ot.id = rq.ot_id
         ${w} ORDER BY (rq.estado = 'pendiente') DESC, rq.id DESC LIMIT 300`, params));
}));

router.get('/requisiciones/:id', puede('requisiciones'), ruta(async (req, res) => {
    const rq = await uno(pool,
        `SELECT rq.*, ot.folio AS ot_folio, ot.tipo AS ot_tipo, ot.descripcion AS ot_descripcion
         FROM requisiciones rq JOIN ordenes_trabajo ot ON ot.id = rq.ot_id WHERE rq.id = $1`, [req.params.id]);
    if (!rq) throw new ErrorNegocio(404, 'Requisición no encontrada');
    rq.items = await todos(pool,
        `SELECT i.*, p.sku, p.nombre, p.unidad, p.stock FROM requisicion_items i JOIN productos p ON p.id = i.producto_id
         WHERE i.requisicion_id = $1 ORDER BY i.id`, [req.params.id]);
    res.json(rq);
}));

router.post('/requisiciones/:id/surtir', puede('requisiciones'), ruta(async (req, res) => {
    res.json(await tx((c) => N.surtirRequisicion(c, req.params.id, { uid: req.usuario.id })));
}));

module.exports = router;
