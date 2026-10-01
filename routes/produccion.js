// routes/produccion.js — Producción: órdenes de trabajo (rondas, preventivos,
// servicios, maniobras y refacciones). Comercial usa /cotizaciones y las
// acciones de cotización comercial/autorización de aquí mismo.
const express = require('express');
const { pool, tx, uno, todos, ruta, ErrorNegocio, redondear } = require('../lib/db');
const { puede } = require('../lib/auth');
const N = require('../lib/negocio');
const { actualizar, forzar, auditarForzado } = require('./comun');

const router = express.Router();

// =====================================================================
//  ÓRDENES DE TRABAJO (vista general, con pestañas por tipo y estado)
// =====================================================================
router.get('/ot', puede('ordenes_trabajo'), ruta(async (req, res) => {
    const { tipo, estado } = req.query;
    const params = [];
    const w = [];
    if (tipo) { params.push(tipo); w.push(`ot.tipo = $${params.length}`); }
    if (estado) { params.push(estado); w.push(`ot.estado = $${params.length}`); }
    res.json(await todos(pool,
        `SELECT ot.*, c.razon_social, e.numero_economico, emp.nombre AS tecnico,
                f.folio AS factura_folio, f.estado AS factura_estado,
                (SELECT COUNT(*)::int FROM ot_refacciones r WHERE r.ot_id = ot.id) AS num_refacciones
         FROM ordenes_trabajo ot LEFT JOIN clientes c ON c.id = ot.cliente_id LEFT JOIN equipos e ON e.id = ot.equipo_id
         LEFT JOIN empleados emp ON emp.id = ot.tecnico_id LEFT JOIN facturas f ON f.id = ot.factura_id
         ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ot.id DESC LIMIT 300`, params));
}));

// Comercial (permiso "facturacion") necesita ver qué OT ya cerradas faltan por facturar,
// sin tener acceso al resto del flujo de Producción.
router.get('/ot/pendientes-facturar', puede('facturacion'), ruta(async (req, res) => {
    res.json(await todos(pool,
        `SELECT ot.id, ot.folio, ot.tipo, ot.descripcion, ot.precio_cliente, ot.origen_maniobra, ot.destino_maniobra,
                c.razon_social, e.numero_economico
         FROM ordenes_trabajo ot LEFT JOIN clientes c ON c.id = ot.cliente_id LEFT JOIN equipos e ON e.id = ot.equipo_id
         WHERE ot.tipo IN ('servicio','maniobra','refaccion') AND ot.estado = 'cerrada'
           AND ot.factura_id IS NULL AND ot.cliente_id IS NOT NULL
         ORDER BY ot.id`));
}));

router.get('/ot/:id', puede('ordenes_trabajo', 'cotizaciones'), ruta(async (req, res) => {
    const ot = await uno(pool,
        `SELECT ot.*, c.razon_social, e.numero_economico, emp.nombre AS tecnico FROM ordenes_trabajo ot
         LEFT JOIN clientes c ON c.id = ot.cliente_id LEFT JOIN equipos e ON e.id = ot.equipo_id
         LEFT JOIN empleados emp ON emp.id = ot.tecnico_id WHERE ot.id = $1`, [req.params.id]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (req.usuario.rol === 'comercial' && ot.tipo !== 'servicio') throw new ErrorNegocio(403, 'Tu rol no tiene acceso a esta orden');
    ot.refacciones = await todos(pool,
        `SELECT r.*, p.sku, p.nombre, p.unidad FROM ot_refacciones r JOIN productos p ON p.id = r.producto_id WHERE r.ot_id = $1 ORDER BY r.id`,
        [req.params.id]);
    ot.requisicion = await uno(pool, `SELECT * FROM requisiciones WHERE ot_id = $1 ORDER BY id DESC LIMIT 1`, [req.params.id]);
    res.json(ot);
}));

// =====================================================================
//  SERVICIOS (evaluación -> cotización interna -> cotización comercial
//  -> autorización -> ejecución -> cierre -> facturación)
// =====================================================================
router.post('/servicios', puede('ordenes_trabajo'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.crearOTServicio(c, {
        clienteId: b.cliente_id, equipoId: b.equipo_id, equipoCliente: b.equipo_cliente,
        descripcion: b.descripcion, tecnicoId: b.tecnico_id, uid: req.usuario.id })));
}));

router.post('/servicios/:id/evaluacion', puede('ordenes_trabajo'), ruta(async (req, res) => {
    res.json(await tx((c) => N.guardarEvaluacion(c, req.params.id, { diagnostico: req.body.diagnostico, uid: req.usuario.id })));
}));

router.post('/servicios/:id/cotizacion-interna', puede('ordenes_trabajo'), ruta(async (req, res) => {
    const b = req.body || {};
    res.json(await tx((c) => N.guardarCotizacionInterna(c, req.params.id, { horas: b.horas, costoHora: b.costo_hora, uid: req.usuario.id })));
}));

router.post('/servicios/:id/refacciones', puede('ordenes_trabajo'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.agregarRefaccionCotizacion(c, req.params.id, {
        productoId: b.producto_id, cantidad: b.cantidad, uid: req.usuario.id })));
}));

router.post('/servicios/:id/enviar-cotizacion', puede('ordenes_trabajo'), ruta(async (req, res) => {
    res.json(await tx((c) => N.enviarCotizacionComercial(c, req.params.id, { uid: req.usuario.id })));
}));

// --- Comercial: bandeja de cotizaciones ---------------------------------
router.get('/cotizaciones', puede('cotizaciones'), ruta(async (req, res) => {
    res.json(await todos(pool,
        `SELECT ot.*, c.razon_social, e.numero_economico FROM ordenes_trabajo ot
         LEFT JOIN clientes c ON c.id = ot.cliente_id LEFT JOIN equipos e ON e.id = ot.equipo_id
         WHERE ot.tipo = 'servicio' AND ot.estado IN ('cotizacion_comercial','autorizada','rechazada')
         ORDER BY (ot.estado = 'cotizacion_comercial') DESC, ot.id DESC LIMIT 200`));
}));

router.post('/servicios/:id/cotizacion-comercial', puede('cotizaciones'), ruta(async (req, res) => {
    const b = req.body || {};
    res.json(await tx((c) => N.capturarCotizacionComercial(c, req.params.id, { margen: b.margen, precioCliente: b.precio_cliente, uid: req.usuario.id })));
}));

router.post('/servicios/:id/autorizar', puede('cotizaciones'), ruta(async (req, res) => {
    const b = req.body || {};
    res.json(await tx((c) => N.autorizarOT(c, req.params.id, { autorizadoPor: b.autorizado_por, fecha: b.fecha, uid: req.usuario.id })));
}));

router.post('/servicios/:id/rechazar', puede('cotizaciones'), ruta(async (req, res) => {
    res.json(await tx((c) => N.rechazarOT(c, req.params.id, { motivo: req.body.motivo, uid: req.usuario.id })));
}));

router.post('/servicios/:id/iniciar-ejecucion', puede('ordenes_trabajo'), ruta(async (req, res) => {
    res.json(await tx((c) => N.iniciarEjecucionOT(c, req.params.id, { uid: req.usuario.id })));
}));

// --- Acciones genéricas (servicios, maniobras y refacciones) ------------
router.post('/ot/:id/cerrar', puede('ordenes_trabajo'), ruta(async (req, res) => {
    res.json(await tx((c) => N.cerrarOT(c, req.params.id, { uid: req.usuario.id })));
}));

router.post('/ot/:id/cancelar', puede('ordenes_trabajo', 'cotizaciones'), ruta(async (req, res) => {
    res.json(await tx((c) => N.cancelarOT(c, req.params.id, { motivo: req.body.motivo, uid: req.usuario.id })));
}));

router.post('/ot/:id/facturar', puede('facturacion'), ruta(async (req, res) => {
    res.status(201).json(await tx(async (c) => {
        const f = await N.facturarOT(c, req.params.id, { uid: req.usuario.id, forzar: forzar(req) });
        await N.auditar(c, { uid: req.usuario.id, ip: req.ip, accion: 'crear', entidad: 'factura', entidadId: f.id, despues: f });
        await auditarForzado(c, req, 'factura', f.id);
        return f;
    }));
}));

// =====================================================================
//  RONDAS (equipos en renta)
// =====================================================================
router.get('/rondas', puede('rondas'), ruta(async (req, res) => {
    res.json(await todos(pool,
        `SELECT e.id AS equipo_id, e.numero_economico, e.tipo, e.marca, e.modelo, e.horometro,
                r.folio AS renta_folio, cl.razon_social,
                (SELECT MAX(l.fecha) FROM lecturas_horometro l WHERE l.equipo_id = e.id) AS ultima_visita,
                (CURRENT_DATE - (SELECT MAX(l.fecha) FROM lecturas_horometro l WHERE l.equipo_id = e.id)) AS dias_sin_visita
         FROM equipos e JOIN rentas r ON r.equipo_id = e.id AND r.estado = 'activa'
         JOIN clientes cl ON cl.id = r.cliente_id
         WHERE e.estado = 'renta' ORDER BY dias_sin_visita DESC NULLS FIRST, e.numero_economico`));
}));

router.post('/rondas', puede('rondas'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.registrarLecturaHorometro(c, b.equipo_id, { lectura: b.lectura, uid: req.usuario.id })));
}));

// =====================================================================
//  PREVENTIVOS (cada X horas, secuencia configurable)
// =====================================================================
router.get('/preventivos', puede('preventivos'), ruta(async (req, res) => {
    const cfg = await uno(pool, 'SELECT * FROM config_preventivo ORDER BY id LIMIT 1');
    const secuencia = await todos(pool, 'SELECT * FROM secuencia_preventivo ORDER BY orden');
    const filas = await todos(pool,
        `SELECT e.id AS equipo_id, e.numero_economico, e.tipo, e.marca, e.modelo, e.horometro, e.estado,
                COALESCE(ep.paso_actual, 1) AS paso_actual, COALESCE(ep.horometro_ultimo_servicio, 0) AS horometro_ultimo_servicio,
                ep.fecha_ultimo_servicio,
                (SELECT id FROM ordenes_trabajo WHERE equipo_id = e.id AND tipo = 'preventivo' AND estado = 'abierta') AS ot_abierta_id
         FROM equipos e LEFT JOIN equipo_preventivo ep ON ep.equipo_id = e.id
         WHERE e.estado NOT IN ('vendido','baja') ORDER BY e.numero_economico`);
    const intervalo = Number(cfg ? cfg.intervalo_horas : 250);
    filas.forEach((f) => {
        const restantes = redondear(Number(f.horometro_ultimo_servicio) + intervalo - Number(f.horometro));
        f.horas_restantes = restantes;
        f.estado_preventivo = restantes <= 0 ? 'vencido' : restantes < 25 ? 'proximo' : 'en_rango';
        const paso = secuencia.find((s) => s.orden === f.paso_actual);
        f.siguiente_servicio = paso ? paso.nombre_servicio : null;
    });
    res.json({ intervalo_horas: intervalo, secuencia, filas });
}));

router.post('/preventivos/:equipoId/generar', puede('preventivos'), ruta(async (req, res) => {
    res.status(201).json(await tx((c) => N.generarOTPreventiva(c, req.params.equipoId, { tecnicoId: req.body.tecnico_id, uid: req.usuario.id })));
}));

router.post('/preventivos/:id/cerrar', puede('preventivos'), ruta(async (req, res) => {
    res.json(await tx((c) => N.cerrarOTPreventiva(c, req.params.id, { horometro: req.body.horometro, uid: req.usuario.id })));
}));

router.get('/config/preventivo', puede('preventivos'), ruta(async (req, res) => {
    res.json(await uno(pool, 'SELECT * FROM config_preventivo ORDER BY id LIMIT 1'));
}));

router.put('/config/preventivo', puede('preventivos'), ruta(async (req, res) => {
    const intervalo = Number(req.body.intervalo_horas);
    if (!(intervalo > 0)) throw new ErrorNegocio(400, 'Intervalo inválido');
    const cfg = await uno(pool, 'SELECT id FROM config_preventivo ORDER BY id LIMIT 1');
    res.json(await uno(pool, 'UPDATE config_preventivo SET intervalo_horas = $1 WHERE id = $2 RETURNING *', [intervalo, cfg.id]));
}));

router.get('/config/secuencia-preventivo', puede('preventivos'), ruta(async (req, res) => {
    res.json(await todos(pool, 'SELECT * FROM secuencia_preventivo ORDER BY orden'));
}));

router.put('/config/secuencia-preventivo/:id', puede('preventivos'), ruta(async (req, res) => {
    res.json(await actualizar(pool, 'secuencia_preventivo', req.params.id, ['nombre_servicio', 'descripcion'], req.body));
}));

// =====================================================================
//  MANIOBRAS
// =====================================================================
router.get('/maniobras', puede('maniobras'), ruta(async (req, res) => {
    const params = ['maniobra'];
    let w = 'ot.tipo = $1';
    if (req.query.estado) { params.push(req.query.estado); w += ` AND ot.estado = $${params.length}`; }
    res.json(await todos(pool,
        `SELECT ot.*, c.razon_social, e.numero_economico, emp.nombre AS operador, f.folio AS factura_folio
         FROM ordenes_trabajo ot LEFT JOIN clientes c ON c.id = ot.cliente_id LEFT JOIN equipos e ON e.id = ot.equipo_id
         LEFT JOIN empleados emp ON emp.id = ot.tecnico_id LEFT JOIN facturas f ON f.id = ot.factura_id
         WHERE ${w}
         ORDER BY CASE ot.estado WHEN 'programada' THEN 0 WHEN 'en_ruta' THEN 1 WHEN 'entregada' THEN 2 ELSE 3 END, ot.fecha_programada`, params));
}));

router.post('/maniobras', puede('maniobras'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.crearManiobra(c, {
        clienteId: b.cliente_id, equipoId: b.equipo_id, equipoCliente: b.equipo_cliente, origen: b.origen, destino: b.destino,
        fechaProgramada: b.fecha_programada, operadorId: b.operador_id, unidadTransporte: b.unidad_transporte,
        costoInterno: b.costo_interno, precioCliente: b.precio_cliente, uid: req.usuario.id })));
}));

router.post('/maniobras/:id/estado', puede('maniobras'), ruta(async (req, res) => {
    res.json(await tx((c) => N.cambiarEstadoManiobra(c, req.params.id, req.body.estado, { uid: req.usuario.id })));
}));

// =====================================================================
//  REFACCIONES (venta/surtido de refacciones a un cliente)
// =====================================================================
router.get('/refacciones-ot', puede('refacciones_ot'), ruta(async (req, res) => {
    res.json(await todos(pool,
        `SELECT ot.*, c.razon_social, f.folio AS factura_folio,
                (SELECT COUNT(*)::int FROM ot_refacciones r WHERE r.ot_id = ot.id) AS partidas
         FROM ordenes_trabajo ot LEFT JOIN clientes c ON c.id = ot.cliente_id LEFT JOIN facturas f ON f.id = ot.factura_id
         WHERE ot.tipo = 'refaccion' ORDER BY ot.id DESC LIMIT 300`));
}));

router.get('/refacciones-ot/:id', puede('refacciones_ot'), ruta(async (req, res) => {
    const ot = await uno(pool,
        `SELECT ot.*, c.razon_social FROM ordenes_trabajo ot LEFT JOIN clientes c ON c.id = ot.cliente_id
         WHERE ot.id = $1 AND ot.tipo = 'refaccion'`, [req.params.id]);
    if (!ot) throw new ErrorNegocio(404, 'Orden no encontrada');
    ot.refacciones = await todos(pool,
        `SELECT r.*, p.sku, p.nombre, p.unidad FROM ot_refacciones r JOIN productos p ON p.id = r.producto_id WHERE r.ot_id = $1`, [req.params.id]);
    ot.requisicion = await uno(pool, `SELECT * FROM requisiciones WHERE ot_id = $1 ORDER BY id DESC LIMIT 1`, [req.params.id]);
    res.json(ot);
}));

router.post('/refacciones-ot', puede('refacciones_ot'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.crearOTRefaccion(c, { clienteId: b.cliente_id, items: b.items, uid: req.usuario.id })));
}));

module.exports = router;
