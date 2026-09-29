// routes/administracion.js — Compras, Proveedores, Cobranza, Créditos, RRHH, Contabilidad y Dashboard
const express = require('express');
const { pool, tx, uno, todos, ruta, ErrorNegocio, redondear } = require('../lib/db');
const { puede } = require('../lib/auth');
const N = require('../lib/negocio');
const { insertar, actualizar } = require('./comun');

const router = express.Router();

// =====================================================================
//  PROVEEDORES
// =====================================================================
const CAMPOS_PROV = ['nombre', 'rfc', 'contacto', 'telefono', 'email', 'tiempo_entrega_dias', 'activo'];

router.get('/proveedores', puede('proveedores'), ruta(async (req, res) => {
    res.json(await todos(pool,
        `SELECT pr.*, (SELECT COUNT(*)::int FROM productos p WHERE p.proveedor_id = pr.id) AS productos,
                COALESCE((SELECT SUM(total) FROM ordenes_compra o WHERE o.proveedor_id = pr.id AND o.estado = 'recibida' AND NOT o.pagada), 0) AS por_pagar
         FROM proveedores pr ORDER BY pr.nombre`));
}));
router.post('/proveedores', puede('proveedores'), ruta(async (req, res) => {
    if (!req.body.nombre) throw new ErrorNegocio(400, 'El nombre es obligatorio');
    res.status(201).json(await insertar(pool, 'proveedores', CAMPOS_PROV, req.body));
}));
router.put('/proveedores/:id', puede('proveedores'), ruta(async (req, res) => {
    res.json(await actualizar(pool, 'proveedores', req.params.id, CAMPOS_PROV, req.body));
}));

// =====================================================================
//  COMPRAS (órdenes de compra)
// =====================================================================
router.get('/compras', puede('compras'), ruta(async (req, res) => {
    res.json(await todos(pool,
        `SELECT o.*, pr.nombre AS proveedor, pr.tiempo_entrega_dias,
                (SELECT COUNT(*)::int FROM orden_compra_items i WHERE i.orden_id = o.id) AS partidas
         FROM ordenes_compra o JOIN proveedores pr ON pr.id = o.proveedor_id
         ORDER BY CASE o.estado WHEN 'borrador' THEN 0 WHEN 'enviada' THEN 1 ELSE 2 END, o.id DESC`));
}));
router.get('/compras/:id', puede('compras'), ruta(async (req, res) => {
    const o = await uno(pool,
        `SELECT o.*, pr.nombre AS proveedor, pr.email AS proveedor_email FROM ordenes_compra o
         JOIN proveedores pr ON pr.id = o.proveedor_id WHERE o.id = $1`, [req.params.id]);
    if (!o) throw new ErrorNegocio(404, 'Orden no encontrada');
    o.items = await todos(pool,
        `SELECT i.*, p.sku, p.nombre, p.unidad FROM orden_compra_items i JOIN productos p ON p.id = i.producto_id
         WHERE i.orden_id = $1 ORDER BY i.id`, [req.params.id]);
    res.json(o);
}));
router.post('/compras', puede('compras'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.crearOrdenCompra(c, {
        proveedorId: b.proveedor_id, items: b.items, notas: b.notas, uid: req.usuario.id })));
}));
router.post('/compras/:id/estado', puede('compras'), ruta(async (req, res) => {
    res.json(await tx((c) => N.cambiarEstadoOC(c, req.params.id, req.body.estado, { uid: req.usuario.id })));
}));
router.post('/compras/:id/pagar', puede('contabilidad'), ruta(async (req, res) => {
    res.json(await tx((c) => N.pagarOrdenCompra(c, req.params.id, { uid: req.usuario.id })));
}));

// =====================================================================
//  COBRANZA
// =====================================================================
router.get('/cobranza', puede('cobranza'), ruta(async (req, res) => {
    const facturas = await todos(pool,
        `SELECT f.id, f.folio, f.fecha, f.fecha_vencimiento, f.total, f.pagado, (f.total - f.pagado) AS saldo, f.estado,
                c.id AS cliente_id, c.razon_social, c.telefono, c.contacto,
                (CURRENT_DATE - f.fecha_vencimiento) AS dias_vencida
         FROM facturas f JOIN clientes c ON c.id = f.cliente_id
         WHERE f.estado IN ('pendiente','parcial') ORDER BY f.fecha_vencimiento`);
    const antig = { por_vencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_mas: 0 };
    facturas.forEach((f) => {
        const d = f.dias_vencida;
        const k = d <= 0 ? 'por_vencer' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90_mas';
        antig[k] = redondear(antig[k] + f.saldo);
    });
    const cobradoMes = await uno(pool,
        `SELECT COALESCE(SUM(monto),0) AS total FROM pagos WHERE date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)`);
    res.json({ facturas, antiguedad: antig, total: redondear(facturas.reduce((s, f) => s + f.saldo, 0)), cobrado_mes: cobradoMes.total });
}));

router.get('/pagos', puede('cobranza'), ruta(async (req, res) => {
    res.json(await todos(pool,
        `SELECT p.*, f.folio, c.razon_social, u.nombre AS usuario FROM pagos p
         JOIN facturas f ON f.id = p.factura_id JOIN clientes c ON c.id = f.cliente_id
         LEFT JOIN usuarios u ON u.id = p.usuario_id ORDER BY p.fecha DESC, p.id DESC LIMIT 200`));
}));

router.post('/pagos', puede('cobranza'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.registrarPago(c, b.factura_id, {
        monto: b.monto, metodo: b.metodo, referencia: b.referencia, fecha: b.fecha, uid: req.usuario.id })));
}));

// =====================================================================
//  CRÉDITOS
// =====================================================================
router.get('/creditos', puede('creditos'), ruta(async (req, res) => {
    const filas = await todos(pool,
        `SELECT c.id, c.razon_social, c.rfc, c.limite_credito, c.dias_credito, c.credito_estado, c.etapa,
                COALESCE(SUM(f.total - f.pagado) FILTER (WHERE f.estado IN ('pendiente','parcial')), 0) AS saldo,
                COALESCE(SUM(f.total - f.pagado) FILTER (WHERE f.estado IN ('pendiente','parcial') AND f.fecha_vencimiento < CURRENT_DATE), 0) AS vencido
         FROM clientes c LEFT JOIN facturas f ON f.cliente_id = c.id
         GROUP BY c.id ORDER BY c.razon_social`);
    filas.forEach((f) => {
        f.disponible = f.credito_estado === 'activo' ? redondear(f.limite_credito - f.saldo) : 0;
        f.uso = f.limite_credito > 0 ? Math.round((f.saldo / f.limite_credito) * 100) : 0;
    });
    res.json(filas);
}));

router.put('/creditos/:id', puede('creditos'), ruta(async (req, res) => {
    const b = req.body || {};
    if (b.limite_credito != null && Number(b.limite_credito) < 0) throw new ErrorNegocio(400, 'Límite inválido');
    res.json(await actualizar(pool, 'clientes', req.params.id, ['limite_credito', 'dias_credito', 'credito_estado'], b));
}));

// =====================================================================
//  RRHH
// =====================================================================
const CAMPOS_EMP = ['nombre', 'puesto', 'area', 'telefono', 'email', 'fecha_ingreso', 'salario_mensual', 'estado'];

router.get('/empleados', puede('rrhh'), ruta(async (req, res) => {
    const empleados = await todos(pool,
        `SELECT e.*, (SELECT COUNT(*)::int FROM servicios s WHERE s.tecnico_id = e.id AND s.estado IN ('abierta','en_proceso')) AS ordenes_abiertas
         FROM empleados e ORDER BY e.estado, e.area, e.nombre`);
    const nominas = await todos(pool,
        `SELECT p.folio, p.fecha, p.referencia, p.concepto, SUM(m.cargo) AS total FROM polizas p
         JOIN poliza_movimientos m ON m.poliza_id = p.id WHERE p.referencia LIKE 'NOM-%'
         GROUP BY p.id ORDER BY p.fecha DESC LIMIT 12`);
    res.json({ empleados, nominas });
}));
router.post('/empleados', puede('rrhh'), ruta(async (req, res) => {
    if (!req.body.nombre || !req.body.puesto || !req.body.area) throw new ErrorNegocio(400, 'Nombre, puesto y área son obligatorios');
    res.status(201).json(await insertar(pool, 'empleados', CAMPOS_EMP, req.body));
}));
router.put('/empleados/:id', puede('rrhh'), ruta(async (req, res) => {
    res.json(await actualizar(pool, 'empleados', req.params.id, CAMPOS_EMP, req.body));
}));
router.post('/nomina', puede('rrhh'), ruta(async (req, res) => {
    res.status(201).json(await tx((c) => N.generarNomina(c, { periodo: req.body.periodo, uid: req.usuario.id })));
}));

// =====================================================================
//  CONTABILIDAD
// =====================================================================
router.get('/contabilidad/cuentas', puede('contabilidad'), ruta(async (req, res) => {
    res.json(await todos(pool, 'SELECT * FROM cuentas_contables ORDER BY codigo'));
}));

router.get('/contabilidad/polizas', puede('contabilidad'), ruta(async (req, res) => {
    const { desde, hasta } = req.query;
    const polizas = await todos(pool,
        `SELECT p.*, u.nombre AS usuario, SUM(m.cargo) AS total FROM polizas p
         LEFT JOIN poliza_movimientos m ON m.poliza_id = p.id LEFT JOIN usuarios u ON u.id = p.usuario_id
         WHERE ($1::date IS NULL OR p.fecha >= $1) AND ($2::date IS NULL OR p.fecha <= $2)
         GROUP BY p.id, u.nombre ORDER BY p.fecha DESC, p.id DESC LIMIT 300`, [desde || null, hasta || null]);
    const movs = polizas.length ? await todos(pool,
        `SELECT m.*, c.codigo, c.nombre FROM poliza_movimientos m JOIN cuentas_contables c ON c.id = m.cuenta_id
         WHERE m.poliza_id = ANY($1) ORDER BY m.id`, [polizas.map((p) => p.id)]) : [];
    polizas.forEach((p) => { p.movimientos = movs.filter((m) => m.poliza_id === p.id); });
    res.json(polizas);
}));

// Póliza manual (gastos, ajustes). Las cuentas se mandan por código.
router.post('/contabilidad/polizas', puede('contabilidad'), ruta(async (req, res) => {
    const b = req.body || {};
    if (!b.concepto) throw new ErrorNegocio(400, 'El concepto es obligatorio');
    res.status(201).json(await tx((c) => N.crearPoliza(c, {
        fecha: b.fecha, tipo: b.tipo || 'diario', concepto: b.concepto, referencia: b.referencia || 'MANUAL',
        automatica: false, uid: req.usuario.id,
        movimientos: (b.movimientos || []).map((m) => ({ codigo: m.codigo, cargo: Number(m.cargo) || 0, abono: Number(m.abono) || 0 })),
    })));
}));

// Balanza de comprobación
router.get('/contabilidad/balanza', puede('contabilidad'), ruta(async (req, res) => {
    const { desde, hasta } = req.query;
    const filas = await todos(pool,
        `SELECT c.codigo, c.nombre, c.tipo,
                COALESCE(SUM(m.cargo), 0) AS cargos, COALESCE(SUM(m.abono), 0) AS abonos
         FROM cuentas_contables c
         LEFT JOIN (poliza_movimientos m JOIN polizas p ON p.id = m.poliza_id
                    AND ($1::date IS NULL OR p.fecha >= $1) AND ($2::date IS NULL OR p.fecha <= $2))
                ON m.cuenta_id = c.id
         GROUP BY c.id ORDER BY c.codigo`, [desde || null, hasta || null]);
    const deudora = ['activo', 'costo', 'gasto'];
    filas.forEach((f) => { f.saldo = redondear(deudora.includes(f.tipo) ? f.cargos - f.abonos : f.abonos - f.cargos); });
    const totales = {
        cargos: redondear(filas.reduce((s, f) => s + f.cargos, 0)),
        abonos: redondear(filas.reduce((s, f) => s + f.abonos, 0)),
    };
    res.json({ filas, totales, cuadra: Math.abs(totales.cargos - totales.abonos) < 0.01 });
}));

// Estado de resultados
router.get('/contabilidad/resultados', puede('contabilidad'), ruta(async (req, res) => {
    const desde = req.query.desde || null;
    const hasta = req.query.hasta || null;
    const filas = await todos(pool,
        `SELECT c.codigo, c.nombre, c.tipo, COALESCE(SUM(m.abono - m.cargo), 0) AS neto
         FROM cuentas_contables c JOIN poliza_movimientos m ON m.cuenta_id = c.id JOIN polizas p ON p.id = m.poliza_id
         WHERE c.tipo IN ('ingreso','costo','gasto')
           AND ($1::date IS NULL OR p.fecha >= $1) AND ($2::date IS NULL OR p.fecha <= $2)
         GROUP BY c.id ORDER BY c.codigo`, [desde, hasta]);
    const suma = (tipo, signo) => redondear(filas.filter((f) => f.tipo === tipo).reduce((s, f) => s + signo * f.neto, 0));
    const ingresos = suma('ingreso', 1);
    const costos = suma('costo', -1);
    const gastos = suma('gasto', -1);
    res.json({
        detalle: filas.map((f) => ({ ...f, importe: f.tipo === 'ingreso' ? f.neto : -f.neto })),
        ingresos, costos, utilidad_bruta: redondear(ingresos - costos), gastos, utilidad_neta: redondear(ingresos - costos - gastos),
    });
}));

// =====================================================================
//  DASHBOARD GENERAL
// =====================================================================
router.get('/dashboard', puede('dashboard'), ruta(async (req, res) => {
    const [flota, rentas, vencen, servicios, minimos, cartera, mes, tops] = await Promise.all([
        todos(pool, `SELECT estado, COUNT(*)::int AS n FROM equipos GROUP BY estado`),
        uno(pool, `SELECT COUNT(*)::int AS activas, COALESCE(SUM(importe),0) AS importe FROM rentas WHERE estado = 'activa'`),
        todos(pool,
            `SELECT r.id, r.folio, r.fecha_fin, (r.fecha_fin - CURRENT_DATE) AS dias, c.razon_social, e.numero_economico
             FROM rentas r JOIN clientes c ON c.id = r.cliente_id JOIN equipos e ON e.id = r.equipo_id
             WHERE r.estado = 'activa' AND r.fecha_fin <= CURRENT_DATE + 7 ORDER BY r.fecha_fin`),
        todos(pool, `SELECT estado, COUNT(*)::int AS n FROM servicios WHERE estado IN ('abierta','en_proceso','terminada') GROUP BY estado`),
        todos(pool,
            `SELECT id, sku, nombre, stock, minimo, maximo FROM productos
             WHERE activo AND stock <= minimo ORDER BY (stock::float / NULLIF(minimo,0)) NULLS FIRST LIMIT 8`),
        uno(pool,
            `SELECT COALESCE(SUM(total - pagado),0) AS total,
                    COALESCE(SUM(total - pagado) FILTER (WHERE fecha_vencimiento < CURRENT_DATE),0) AS vencida
             FROM facturas WHERE estado IN ('pendiente','parcial')`),
        uno(pool,
            `SELECT COALESCE((SELECT SUM(total) FROM facturas WHERE estado <> 'cancelada' AND date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)),0) AS facturado,
                    COALESCE((SELECT SUM(monto) FROM pagos WHERE date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)),0) AS cobrado`),
        todos(pool,
            `SELECT c.razon_social, SUM(f.total) AS total FROM facturas f JOIN clientes c ON c.id = f.cliente_id
             WHERE f.estado <> 'cancelada' GROUP BY c.id ORDER BY total DESC LIMIT 5`),
    ]);
    const porEstado = Object.fromEntries(flota.map((f) => [f.estado, f.n]));
    const operativos = ['disponible', 'renta', 'reparacion', 'venta'].reduce((s, k) => s + (porEstado[k] || 0), 0);
    res.json({
        flota: porEstado,
        utilizacion: operativos ? Math.round(((porEstado.renta || 0) / operativos) * 100) : 0,
        rentas, rentas_por_vencer: vencen,
        servicios: Object.fromEntries(servicios.map((s) => [s.estado, s.n])),
        bajo_minimo: minimos, cartera, mes, top_clientes: tops,
    });
}));

module.exports = router;
