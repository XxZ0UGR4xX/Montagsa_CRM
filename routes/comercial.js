// routes/comercial.js — Rentas, Servicios, Facturación y Traspasos
const express = require('express');
const { pool, tx, uno, todos, ruta, ErrorNegocio } = require('../lib/db');
const { puede } = require('../lib/auth');
const N = require('../lib/negocio');
const { forzar, auditarForzado } = require('./comun');

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
    const r = await tx(async (c) => {
        const renta = await N.crearRenta(c, {
            clienteId: b.cliente_id, equipoId: b.equipo_id, periodo: b.periodo, cantidadPeriodos: b.cantidad_periodos,
            tarifa: b.tarifa, deposito: b.deposito, fechaInicio: b.fecha_inicio, notas: b.notas,
            uid: req.usuario.id, forzar: forzar(req),
        });
        await auditarForzado(c, req, 'renta', renta.id);
        return renta;
    });
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
    res.status(201).json(await tx(async (c) => {
        const f = await N.facturarRenta(c, req.params.id, { uid: req.usuario.id, forzar: forzar(req) });
        await N.auditar(c, { uid: req.usuario.id, ip: req.ip, accion: 'crear', entidad: 'factura', entidadId: f.id, despues: f });
        await auditarForzado(c, req, 'factura', f.id);
        return f;
    }));
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
    res.status(201).json(await tx(async (c) => {
        const f = await N.crearFactura(c, {
            clienteId: b.cliente_id, origen: 'otro', conceptos: b.conceptos, notas: b.notas, uid: req.usuario.id, forzar: forzar(req) });
        await N.auditar(c, { uid: req.usuario.id, ip: req.ip, accion: 'crear', entidad: 'factura', entidadId: f.id, despues: f });
        await auditarForzado(c, req, 'factura', f.id);
        return f;
    }));
}));

router.post('/facturas/:id/cancelar', puede('facturacion'), ruta(async (req, res) => {
    res.json(await tx(async (c) => {
        const antes = await uno(c, 'SELECT * FROM facturas WHERE id = $1', [req.params.id]);
        const f = await N.cancelarFactura(c, req.params.id, { motivo: req.body.motivo, uid: req.usuario.id });
        await N.auditar(c, {
            uid: req.usuario.id, ip: req.ip, accion: 'cancelar', entidad: 'factura', entidadId: Number(req.params.id),
            antes, despues: { ...f, motivo: req.body.motivo || null },
        });
        return f;
    }));
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
                    (SELECT ot.folio FROM ordenes_trabajo ot WHERE ot.equipo_id = e.id AND ot.tipo IN ('servicio','preventivo')
                      AND ot.estado NOT IN ('cerrada','facturada','cancelada','rechazada') ORDER BY ot.id DESC LIMIT 1) AS orden_servicio
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
    res.status(201).json(await tx(async (c) => {
        const f = await N.venderEquipo(c, req.params.id, {
            clienteId: b.cliente_id, precio: b.precio, uid: req.usuario.id, forzar: forzar(req) });
        await N.auditar(c, { uid: req.usuario.id, ip: req.ip, accion: 'crear', entidad: 'factura', entidadId: f.id, despues: f });
        await auditarForzado(c, req, 'factura', f.id);
        return f;
    }));
}));

module.exports = router;
