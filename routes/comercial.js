// routes/comercial.js — Rentas, Servicios, Facturación y Traspasos
const express = require('express');
const { pool, tx, uno, todos, ruta, ErrorNegocio } = require('../lib/db');
const { puede } = require('../lib/auth');
const N = require('../lib/negocio');
const { actualizar, forzar } = require('./comun');

const router = express.Router();

// =====================================================================
//  RENTAS
// =====================================================================
router.get('/rentas', puede('rentas'), ruta(async (req, res) => {
    const params = [];
    let w = '';
    if (req.query.estado) { params.push(req.query.estado); w = 'WHERE r.estado = $1'; }
    res.json(await todos(pool,
        `SELECT r.*, c.razon_social, e.numero_economico, e.marca, e.modelo, e.tipo AS equipo_tipo,
                f.folio AS factura_folio, f.estado AS factura_estado,
                (r.fecha_fin - CURRENT_DATE) AS dias_restantes
         FROM rentas r JOIN clientes c ON c.id = r.cliente_id JOIN equipos e ON e.id = r.equipo_id
         LEFT JOIN facturas f ON f.id = r.factura_id
         ${w} ORDER BY (r.estado = 'activa') DESC, r.fecha_fin, r.id DESC`, params));
}));

router.post('/rentas', puede('rentas'), ruta(async (req, res) => {
    const b = req.body || {};
    const r = await tx((c) => N.crearRenta(c, {
        clienteId: b.cliente_id, equipoId: b.equipo_id, periodo: b.periodo, cantidadPeriodos: b.cantidad_periodos,
        tarifa: b.tarifa, deposito: b.deposito, fechaInicio: b.fecha_inicio, notas: b.notas,
        uid: req.usuario.id, forzar: forzar(req),
    }));
    res.status(201).json(r);
}));

router.post('/rentas/:id/finalizar', puede('rentas'), ruta(async (req, res) => {
    const b = req.body || {};
    res.json(await tx((c) => N.finalizarRenta(c, req.params.id, {
        horometroRegreso: b.horometro_regreso, destino: b.destino, fecha: b.fecha, notas: b.notas, uid: req.usuario.id })));
}));

router.post('/rentas/:id/cancelar', puede('rentas'), ruta(async (req, res) => {
    res.json(await tx((c) => N.cancelarRenta(c, req.params.id, { uid: req.usuario.id })));
}));

router.post('/rentas/:id/facturar', puede('rentas'), ruta(async (req, res) => {
    res.status(201).json(await tx((c) => N.facturarRenta(c, req.params.id, { uid: req.usuario.id, forzar: forzar(req) })));
}));

// =====================================================================
//  SERVICIOS
// =====================================================================
router.get('/servicios', puede('servicios'), ruta(async (req, res) => {
    const params = [];
    let w = '';
    if (req.query.estado) { params.push(req.query.estado); w = 'WHERE s.estado = $1'; }
    res.json(await todos(pool,
        `SELECT s.*, c.razon_social, e.numero_economico, emp.nombre AS tecnico, f.folio AS factura_folio,
                COALESCE((SELECT SUM(cantidad * precio_unitario) FROM servicio_refacciones WHERE servicio_id = s.id), 0) AS refacciones_importe
         FROM servicios s LEFT JOIN clientes c ON c.id = s.cliente_id LEFT JOIN equipos e ON e.id = s.equipo_id
         LEFT JOIN empleados emp ON emp.id = s.tecnico_id LEFT JOIN facturas f ON f.id = s.factura_id
         ${w} ORDER BY CASE s.estado WHEN 'en_proceso' THEN 0 WHEN 'abierta' THEN 1 WHEN 'terminada' THEN 2 ELSE 3 END, s.id DESC`, params));
}));

router.get('/servicios/:id', puede('servicios'), ruta(async (req, res) => {
    const s = await uno(pool,
        `SELECT s.*, c.razon_social, e.numero_economico, emp.nombre AS tecnico FROM servicios s
         LEFT JOIN clientes c ON c.id = s.cliente_id LEFT JOIN equipos e ON e.id = s.equipo_id
         LEFT JOIN empleados emp ON emp.id = s.tecnico_id WHERE s.id = $1`, [req.params.id]);
    if (!s) throw new ErrorNegocio(404, 'Servicio no encontrado');
    s.refacciones = await todos(pool,
        `SELECT sr.*, p.sku, p.nombre, p.unidad FROM servicio_refacciones sr JOIN productos p ON p.id = sr.producto_id
         WHERE sr.servicio_id = $1 ORDER BY sr.id`, [req.params.id]);
    res.json(s);
}));

router.post('/servicios', puede('servicios'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.crearServicio(c, {
        clienteId: b.cliente_id, equipoId: b.equipo_id, equipoCliente: b.equipo_cliente, tipo: b.tipo,
        descripcion: b.descripcion, tecnicoId: b.tecnico_id, manoObra: b.mano_obra, fechaProgramada: b.fecha_programada,
        uid: req.usuario.id,
    })));
}));

router.put('/servicios/:id', puede('servicios'), ruta(async (req, res) => {
    const s = await uno(pool, 'SELECT estado FROM servicios WHERE id = $1', [req.params.id]);
    if (!s) throw new ErrorNegocio(404, 'Servicio no encontrado');
    if (!['abierta', 'en_proceso', 'terminada'].includes(s.estado)) throw new ErrorNegocio(409, 'La orden ya está cerrada');
    res.json(await actualizar(pool, 'servicios', req.params.id, ['descripcion', 'tecnico_id', 'mano_obra', 'fecha_programada', 'cliente_id'], req.body));
}));

router.post('/servicios/:id/refacciones', puede('servicios'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.agregarRefaccion(c, req.params.id, {
        productoId: b.producto_id, cantidad: b.cantidad, uid: req.usuario.id })));
}));

router.post('/servicios/:id/estado', puede('servicios'), ruta(async (req, res) => {
    res.json(await tx((c) => N.cambiarEstadoServicio(c, req.params.id, req.body.estado, { uid: req.usuario.id })));
}));

router.post('/servicios/:id/facturar', puede('facturacion'), ruta(async (req, res) => {
    res.status(201).json(await tx((c) => N.facturarServicio(c, req.params.id, { uid: req.usuario.id, forzar: forzar(req) })));
}));

// =====================================================================
//  FACTURACIÓN
// =====================================================================
router.get('/facturas', puede('facturacion', 'cobranza'), ruta(async (req, res) => {
    const params = [];
    const w = [];
    if (req.query.estado) { params.push(req.query.estado); w.push(`f.estado = $${params.length}`); }
    if (req.query.origen) { params.push(req.query.origen); w.push(`f.origen = $${params.length}`); }
    if (req.query.cliente_id) { params.push(req.query.cliente_id); w.push(`f.cliente_id = $${params.length}`); }
    res.json(await todos(pool,
        `SELECT f.*, c.razon_social, (f.total - f.pagado) AS saldo,
                GREATEST(CURRENT_DATE - f.fecha_vencimiento, 0) AS dias_vencida
         FROM facturas f JOIN clientes c ON c.id = f.cliente_id
         ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY f.id DESC LIMIT 300`, params));
}));

router.get('/facturas/:id', puede('facturacion', 'cobranza'), ruta(async (req, res) => {
    const f = await uno(pool,
        `SELECT f.*, c.razon_social, c.rfc, c.direccion, c.email, u.nombre AS usuario
         FROM facturas f JOIN clientes c ON c.id = f.cliente_id LEFT JOIN usuarios u ON u.id = f.usuario_id WHERE f.id = $1`,
        [req.params.id]);
    if (!f) throw new ErrorNegocio(404, 'Factura no encontrada');
    f.conceptos = await todos(pool, 'SELECT * FROM factura_conceptos WHERE factura_id = $1 ORDER BY id', [req.params.id]);
    f.pagos = await todos(pool,
        'SELECT p.*, u.nombre AS usuario FROM pagos p LEFT JOIN usuarios u ON u.id = p.usuario_id WHERE factura_id = $1 ORDER BY p.fecha, p.id',
        [req.params.id]);
    res.json(f);
}));

// Factura manual (conceptos libres)
router.post('/facturas', puede('facturacion'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.crearFactura(c, {
        clienteId: b.cliente_id, origen: 'otro', conceptos: b.conceptos, notas: b.notas, uid: req.usuario.id, forzar: forzar(req) })));
}));

router.post('/facturas/:id/cancelar', puede('facturacion'), ruta(async (req, res) => {
    res.json(await tx((c) => N.cancelarFactura(c, req.params.id, { motivo: req.body.motivo, uid: req.usuario.id })));
}));

// =====================================================================
//  TRASPASOS (disponible · renta · venta · reparacion)
// =====================================================================
router.get('/traspasos', puede('traspasos'), ruta(async (req, res) => {
    const [historial, tablero] = await Promise.all([
        todos(pool,
            `SELECT t.*, e.numero_economico, e.marca, e.modelo, u.nombre AS usuario FROM traspasos t
             JOIN equipos e ON e.id = t.equipo_id LEFT JOIN usuarios u ON u.id = t.usuario_id
             ORDER BY t.fecha DESC, t.id DESC LIMIT 300`),
        todos(pool,
            `SELECT e.id, e.numero_economico, e.tipo, e.marca, e.modelo, e.estado, e.ubicacion,
                    (SELECT r.folio || ' · ' || c.razon_social || ' · vence ' || to_char(r.fecha_fin, 'DD/MM/YYYY') FROM rentas r JOIN clientes c ON c.id = r.cliente_id
                      WHERE r.equipo_id = e.id AND r.estado = 'activa' LIMIT 1) AS detalle_renta,
                    (SELECT s.folio FROM servicios s WHERE s.equipo_id = e.id AND s.estado IN ('abierta','en_proceso') ORDER BY s.id DESC LIMIT 1) AS orden_servicio
             FROM equipos e WHERE e.estado NOT IN ('vendido','baja') ORDER BY e.numero_economico`),
    ]);
    res.json({ historial, tablero, transiciones: N.TRANSICIONES });
}));

// Traspaso manual. A "renta" solo se entra creando una renta; a "vendido", vendiendo.
router.post('/traspasos', puede('traspasos'), ruta(async (req, res) => {
    const { equipo_id, destino, motivo } = req.body || {};
    if (destino === 'renta') throw new ErrorNegocio(409, 'Para pasar un equipo a renta crea la renta en Comercial › Rentas');
    if (destino === 'vendido') throw new ErrorNegocio(409, 'Para vender un equipo usa "Vender" (genera la factura)');
    const eq = await uno(pool, 'SELECT estado FROM equipos WHERE id = $1', [equipo_id]);
    if (eq && eq.estado === 'renta') throw new ErrorNegocio(409, 'El equipo está rentado: finaliza la renta para moverlo');
    if (!motivo) throw new ErrorNegocio(400, 'Indica el motivo del traspaso');
    res.status(201).json(await tx((c) => N.traspasar(c, equipo_id, destino, { motivo, referencia: 'MANUAL', uid: req.usuario.id })));
}));

router.post('/equipos/:id/vender', puede('facturacion'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.venderEquipo(c, req.params.id, {
        clienteId: b.cliente_id, precio: b.precio, uid: req.usuario.id, forzar: forzar(req) })));
}));

module.exports = router;
