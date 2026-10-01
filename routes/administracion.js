// routes/administracion.js — Compras, Proveedores, Cobranza, Créditos, RRHH,
// Contabilidad (catálogo, pólizas, reportes, cierre), Bancos, Cuentas por pagar y Dashboard
const express = require('express');
const { pool, tx, uno, todos, ruta, ErrorNegocio, redondear } = require('../lib/db');
const { puede } = require('../lib/auth');
const N = require('../lib/negocio');
const { insertar, actualizar } = require('./comun');

const router = express.Router();

// =====================================================================
//  PROVEEDORES
// =====================================================================
const CAMPOS_PROV = ['nombre', 'rfc', 'contacto', 'telefono', 'email', 'tiempo_entrega_dias', 'dias_credito', 'activo'];

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
router.post('/compras/:id/pagar', puede('contabilidad', 'cuentas_por_pagar'), ruta(async (req, res) => {
    res.json(await tx((c) => N.pagarOrdenCompra(c, req.params.id, { uid: req.usuario.id, cuentaBancariaId: req.body && req.body.cuenta_bancaria_id })));
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
        `SELECT e.*, (SELECT COUNT(*)::int FROM ordenes_trabajo ot WHERE ot.tecnico_id = e.id
                      AND ot.estado NOT IN ('cerrada','facturada','cancelada','rechazada')) AS ordenes_abiertas
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
    res.status(201).json(await tx((c) => N.generarNomina(c, {
        periodo: req.body.periodo, cuentaBancariaId: req.body.cuenta_bancaria_id, uid: req.usuario.id })));
}));

// =====================================================================
//  CONTABILIDAD
// =====================================================================
const CAMPOS_CUENTA = ['codigo', 'nombre', 'tipo', 'naturaleza', 'padre_id', 'nivel', 'codigo_agrupador_sat', 'activa'];

// Administración conserva "contabilidad" solo para lectura de reportes y captura de pólizas
// manuales; el resto (catálogo, cancelar pólizas, depreciación) es exclusivo de Contabilidad/admin.
function soloContabilidad(req) {
    if (!['admin', 'contabilidad'].includes(req.usuario.rol)) {
        throw new ErrorNegocio(403, 'Solo Contabilidad puede realizar esta acción');
    }
}

router.get('/contabilidad/cuentas', puede('contabilidad'), ruta(async (req, res) => {
    res.json(await todos(pool,
        `SELECT c.*, p.codigo AS padre_codigo, p.nombre AS padre_nombre,
                EXISTS (SELECT 1 FROM poliza_movimientos m WHERE m.cuenta_id = c.id) AS con_movimientos
         FROM cuentas_contables c LEFT JOIN cuentas_contables p ON p.id = c.padre_id ORDER BY c.codigo`));
}));

router.post('/contabilidad/cuentas', puede('contabilidad'), ruta(async (req, res) => {
    soloContabilidad(req);
    const b = req.body || {};
    if (!b.codigo || !b.nombre || !b.tipo || !b.naturaleza) throw new ErrorNegocio(400, 'Código, nombre, tipo y naturaleza son obligatorios');
    res.status(201).json(await insertar(pool, 'cuentas_contables', CAMPOS_CUENTA, b));
}));

router.put('/contabilidad/cuentas/:id', puede('contabilidad'), ruta(async (req, res) => {
    soloContabilidad(req);
    res.json(await actualizar(pool, 'cuentas_contables', req.params.id, CAMPOS_CUENTA, req.body));
}));

// Solo se borra si nunca tuvo movimientos; si ya tiene historial, solo se desactiva (activa = false).
router.delete('/contabilidad/cuentas/:id', puede('contabilidad'), ruta(async (req, res) => {
    soloContabilidad(req);
    const con = await uno(pool, 'SELECT 1 FROM poliza_movimientos WHERE cuenta_id = $1 LIMIT 1', [req.params.id]);
    if (con) throw new ErrorNegocio(409, 'Esta cuenta ya tiene movimientos; no se puede borrar. Desactívala en su lugar.');
    const r = await pool.query('DELETE FROM cuentas_contables WHERE id = $1', [req.params.id]);
    if (!r.rowCount) throw new ErrorNegocio(404, 'Cuenta no encontrada');
    res.json({ ok: true });
}));

router.get('/contabilidad/polizas', puede('contabilidad'), ruta(async (req, res) => {
    const { desde, hasta, tipo, referencia, cuenta } = req.query;
    const polizas = await todos(pool,
        `SELECT p.*, u.nombre AS usuario, SUM(m.cargo) AS total FROM polizas p
         LEFT JOIN poliza_movimientos m ON m.poliza_id = p.id LEFT JOIN usuarios u ON u.id = p.usuario_id
         WHERE ($1::date IS NULL OR p.fecha >= $1) AND ($2::date IS NULL OR p.fecha <= $2)
           AND ($3::text IS NULL OR p.tipo = $3) AND ($4::text IS NULL OR p.referencia ILIKE '%' || $4 || '%')
           AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM poliza_movimientos m2 JOIN cuentas_contables c2 ON c2.id = m2.cuenta_id
                                             WHERE m2.poliza_id = p.id AND c2.codigo = $5))
         GROUP BY p.id, u.nombre ORDER BY p.fecha DESC, p.id DESC LIMIT 300`,
        [desde || null, hasta || null, tipo || null, referencia || null, cuenta || null]);
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

// Cancelación de póliza manual: nunca se borra, se genera una póliza de reversa.
router.post('/contabilidad/polizas/:id/cancelar', puede('contabilidad'), ruta(async (req, res) => {
    soloContabilidad(req);
    res.json(await tx((c) => N.cancelarPoliza(c, req.params.id, { motivo: req.body && req.body.motivo, uid: req.usuario.id })));
}));

// Balanza de comprobación
router.get('/contabilidad/balanza', puede('contabilidad'), ruta(async (req, res) => {
    const { desde, hasta } = req.query;
    const filas = await todos(pool,
        `SELECT c.codigo, c.nombre, c.tipo, c.naturaleza,
                COALESCE(SUM(m.cargo), 0) AS cargos, COALESCE(SUM(m.abono), 0) AS abonos
         FROM cuentas_contables c
         LEFT JOIN (poliza_movimientos m JOIN polizas p ON p.id = m.poliza_id
                    AND ($1::date IS NULL OR p.fecha >= $1) AND ($2::date IS NULL OR p.fecha <= $2))
                ON m.cuenta_id = c.id
         GROUP BY c.id ORDER BY c.codigo`, [desde || null, hasta || null]);
    filas.forEach((f) => { f.saldo = redondear(f.naturaleza === 'deudora' ? f.cargos - f.abonos : f.abonos - f.cargos); });
    const totales = {
        cargos: redondear(filas.reduce((s, f) => s + f.cargos, 0)),
        abonos: redondear(filas.reduce((s, f) => s + f.abonos, 0)),
    };
    res.json({ filas, totales, cuadra: Math.abs(totales.cargos - totales.abonos) < 0.01 });
}));

// Libro mayor / auxiliar por cuenta: saldo inicial, movimientos y saldo final del periodo.
router.get('/contabilidad/mayor', puede('contabilidad'), ruta(async (req, res) => {
    const { cuenta, desde, hasta } = req.query;
    if (!cuenta) throw new ErrorNegocio(400, 'Indica la cuenta');
    const cta = await uno(pool, 'SELECT * FROM cuentas_contables WHERE codigo = $1', [cuenta]);
    if (!cta) throw new ErrorNegocio(404, 'Cuenta no encontrada');
    const signo = cta.naturaleza === 'deudora' ? 1 : -1;
    const previo = await uno(pool,
        `SELECT COALESCE(SUM(m.cargo),0) AS cargos, COALESCE(SUM(m.abono),0) AS abonos FROM poliza_movimientos m
         JOIN polizas p ON p.id = m.poliza_id WHERE m.cuenta_id = $1 AND ($2::date IS NULL OR p.fecha < $2)`,
        [cta.id, desde || null]);
    const saldoInicial = redondear(signo * (previo.cargos - previo.abonos));
    const movimientos = await todos(pool,
        `SELECT p.id AS poliza_id, p.folio, p.fecha, p.concepto, p.referencia, m.cargo, m.abono, m.conciliado FROM poliza_movimientos m
         JOIN polizas p ON p.id = m.poliza_id
         WHERE m.cuenta_id = $1 AND ($2::date IS NULL OR p.fecha >= $2) AND ($3::date IS NULL OR p.fecha <= $3)
         ORDER BY p.fecha, p.id`, [cta.id, desde || null, hasta || null]);
    let saldo = saldoInicial;
    movimientos.forEach((m) => { saldo = redondear(saldo + signo * (m.cargo - m.abono)); m.saldo = saldo; });
    res.json({ cuenta: cta, saldo_inicial: saldoInicial, movimientos, saldo_final: saldo });
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

// Balance general: Activo = Pasivo + Capital + Resultado del ejercicio (utilidad acumulada a la fecha)
router.get('/contabilidad/balance', puede('contabilidad'), ruta(async (req, res) => {
    const hasta = req.query.hasta || null;
    const filas = await todos(pool,
        `SELECT c.codigo, c.nombre, c.tipo, c.naturaleza, COALESCE(SUM(m.cargo),0) AS cargos, COALESCE(SUM(m.abono),0) AS abonos
         FROM cuentas_contables c LEFT JOIN poliza_movimientos m ON m.cuenta_id = c.id
         LEFT JOIN polizas p ON p.id = m.poliza_id AND ($1::date IS NULL OR p.fecha <= $1)
         WHERE c.tipo IN ('activo','pasivo','capital') GROUP BY c.id ORDER BY c.codigo`, [hasta]);
    // Firma por sección (no por naturaleza de la cuenta): así una contra-cuenta como la
    // depreciación acumulada (tipo 'activo', naturaleza 'acreedora') se resta del Activo
    // en vez de sumarse, como corresponde en un balance general.
    filas.forEach((f) => { f.saldo = redondear(f.tipo === 'activo' ? f.cargos - f.abonos : f.abonos - f.cargos); });
    const resultadosAcum = await todos(pool,
        `SELECT c.tipo, COALESCE(SUM(m.abono - m.cargo),0) AS neto FROM cuentas_contables c
         JOIN poliza_movimientos m ON m.cuenta_id = c.id JOIN polizas p ON p.id = m.poliza_id
         WHERE c.tipo IN ('ingreso','costo','gasto') AND ($1::date IS NULL OR p.fecha <= $1) GROUP BY c.tipo`, [hasta]);
    const suma = (tipo, signo) => redondear((resultadosAcum.find((r) => r.tipo === tipo)?.neto || 0) * signo);
    const resultadoEjercicio = redondear(suma('ingreso', 1) - suma('costo', -1) - suma('gasto', -1));
    const activo = redondear(filas.filter((f) => f.tipo === 'activo').reduce((s, f) => s + f.saldo, 0));
    const pasivo = redondear(filas.filter((f) => f.tipo === 'pasivo').reduce((s, f) => s + f.saldo, 0));
    const capital = redondear(filas.filter((f) => f.tipo === 'capital').reduce((s, f) => s + f.saldo, 0));
    res.json({
        detalle: filas, activo, pasivo, capital, resultado_ejercicio: resultadoEjercicio,
        pasivo_mas_capital: redondear(pasivo + capital + resultadoEjercicio),
        cuadra: Math.abs(activo - redondear(pasivo + capital + resultadoEjercicio)) < 0.01,
    });
}));

// IVA del mes: IVA trasladado cobrado (2105) − IVA acreditable (1151) = a pagar o a favor
router.get('/contabilidad/iva-mes', puede('contabilidad'), ruta(async (req, res) => {
    const periodo = req.query.periodo || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(periodo)) throw new ErrorNegocio(400, 'Periodo inválido (usa AAAA-MM)');
    const porCodigo = async (codigo) => uno(pool,
        `SELECT COALESCE(SUM(m.cargo),0) AS cargos, COALESCE(SUM(m.abono),0) AS abonos FROM poliza_movimientos m
         JOIN cuentas_contables c ON c.id = m.cuenta_id JOIN polizas p ON p.id = m.poliza_id
         WHERE c.codigo = $1 AND to_char(p.fecha, 'YYYY-MM') = $2`, [codigo, periodo]);
    const [cobrado, acreditable] = await Promise.all([porCodigo('2105'), porCodigo('1151')]);
    const ivaTrasladadoCobrado = redondear(cobrado.abonos - cobrado.cargos);
    const ivaAcreditable = redondear(acreditable.cargos - acreditable.abonos);
    res.json({
        periodo, iva_trasladado_cobrado: ivaTrasladadoCobrado, iva_acreditable: ivaAcreditable,
        resultado: redondear(ivaTrasladadoCobrado - ivaAcreditable),
    });
}));

// =====================================================================
//  BANCOS
// =====================================================================
router.get('/bancos', puede('bancos'), ruta(async (req, res) => {
    const cuentas = await todos(pool,
        `SELECT cb.*, cc.codigo AS cuenta_codigo, cc.nombre AS cuenta_nombre,
                cb.saldo_inicial + COALESCE((SELECT SUM(m.cargo - m.abono) FROM poliza_movimientos m WHERE m.cuenta_id = cb.cuenta_contable_id), 0) AS saldo
         FROM cuentas_bancarias cb JOIN cuentas_contables cc ON cc.id = cb.cuenta_contable_id ORDER BY cb.banco`);
    res.json(cuentas);
}));

router.post('/bancos', puede('bancos'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.crearCuentaBancaria(c, {
        banco: b.banco, numeroEnmascarado: b.numero_enmascarado, saldoInicial: b.saldo_inicial, uid: req.usuario.id })));
}));

router.put('/bancos/:id', puede('bancos'), ruta(async (req, res) => {
    res.json(await actualizar(pool, 'cuentas_bancarias', req.params.id, ['banco', 'numero_enmascarado', 'activa'], req.body));
}));

router.get('/bancos/:id/movimientos', puede('bancos'), ruta(async (req, res) => {
    const cb = await uno(pool, 'SELECT * FROM cuentas_bancarias WHERE id = $1', [req.params.id]);
    if (!cb) throw new ErrorNegocio(404, 'Cuenta bancaria no encontrada');
    const movs = await todos(pool,
        `SELECT m.id, p.fecha, p.folio, p.concepto, p.referencia, m.cargo, m.abono, m.conciliado FROM poliza_movimientos m
         JOIN polizas p ON p.id = m.poliza_id WHERE m.cuenta_id = $1 ORDER BY p.fecha DESC, p.id DESC LIMIT 300`,
        [cb.cuenta_contable_id]);
    res.json(movs);
}));

router.put('/bancos/movimientos/:id/conciliar', puede('bancos'), ruta(async (req, res) => {
    const r = await pool.query('UPDATE poliza_movimientos SET conciliado = $2 WHERE id = $1',
        [req.params.id, req.body ? req.body.conciliado !== false : true]);
    if (!r.rowCount) throw new ErrorNegocio(404, 'Movimiento no encontrado');
    res.json({ ok: true });
}));

// Compara el estado de cuenta importado (CSV ya convertido a filas en el front) contra los
// movimientos sin conciliar de la cuenta: casa por importe exacto (cargo o abono).
router.post('/bancos/:id/comparar', puede('bancos'), ruta(async (req, res) => {
    const cb = await uno(pool, 'SELECT * FROM cuentas_bancarias WHERE id = $1', [req.params.id]);
    if (!cb) throw new ErrorNegocio(404, 'Cuenta bancaria no encontrada');
    const filas = Array.isArray(req.body && req.body.movimientos) ? req.body.movimientos : [];
    const pendientes = await todos(pool,
        `SELECT m.id, p.fecha, p.concepto, m.cargo, m.abono FROM poliza_movimientos m JOIN polizas p ON p.id = m.poliza_id
         WHERE m.cuenta_id = $1 AND NOT m.conciliado`, [cb.cuenta_contable_id]);
    const usados = new Set();
    const resultado = filas.map((f) => {
        const cargo = Number(f.cargo) || 0;
        const abono = Number(f.abono) || 0;
        const match = pendientes.find((p) => !usados.has(p.id) &&
            Math.abs(p.cargo - abono) < 0.01 && Math.abs(p.abono - cargo) < 0.01 && (p.cargo > 0 || p.abono > 0));
        if (match) usados.add(match.id);
        return { ...f, coincide: !!match, poliza_movimiento_id: match ? match.id : null };
    });
    res.json({ comparadas: resultado, sin_coincidencia_en_libro: pendientes.filter((p) => !usados.has(p.id)) });
}));

// =====================================================================
//  CUENTAS POR PAGAR
// =====================================================================
router.get('/cuentas-por-pagar', puede('cuentas_por_pagar'), ruta(async (req, res) => {
    const ordenes = await todos(pool,
        `SELECT o.id, o.folio, o.fecha, o.fecha_recepcion, o.total,
                (o.fecha_recepcion + pr.dias_credito) AS fecha_vencimiento,
                (CURRENT_DATE - (o.fecha_recepcion + pr.dias_credito)) AS dias_vencida,
                pr.id AS proveedor_id, pr.nombre AS proveedor, pr.contacto, pr.telefono
         FROM ordenes_compra o JOIN proveedores pr ON pr.id = o.proveedor_id
         WHERE o.estado = 'recibida' AND NOT o.pagada ORDER BY fecha_vencimiento`);
    const antig = { por_vencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_mas: 0 };
    ordenes.forEach((o) => {
        const d = o.dias_vencida;
        const k = d <= 0 ? 'por_vencer' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90_mas';
        antig[k] = redondear(antig[k] + Number(o.total));
    });
    res.json({ ordenes, antiguedad: antig, total: redondear(ordenes.reduce((s, o) => s + Number(o.total), 0)) });
}));

// =====================================================================
//  CIERRE DE PERIODO
// =====================================================================
router.get('/cierre', puede('cierre'), ruta(async (req, res) => {
    res.json(await todos(pool, 'SELECT p.*, u.nombre AS cerrado_por_nombre FROM periodos_contables p LEFT JOIN usuarios u ON u.id = p.cerrado_por ORDER BY p.anio DESC, p.mes DESC'));
}));

router.post('/cierre', puede('cierre'), ruta(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await tx((c) => N.cerrarPeriodo(c, { anio: b.anio, mes: b.mes, uid: req.usuario.id })));
}));

// Solo admin puede reabrir un mes cerrado.
router.post('/cierre/reabrir', puede('cierre'), ruta(async (req, res) => {
    if (req.usuario.rol !== 'admin') throw new ErrorNegocio(403, 'Solo un administrador puede reabrir un periodo cerrado');
    const b = req.body || {};
    res.json(await tx((c) => N.reabrirPeriodo(c, { anio: b.anio, mes: b.mes })));
}));

// Depreciación mensual de la flota (una sola póliza, referencia DEP-AAAA-MM)
router.post('/contabilidad/depreciacion', puede('contabilidad'), ruta(async (req, res) => {
    soloContabilidad(req);
    res.status(201).json(await tx((c) => N.calcularDepreciacionMes(c, { periodo: req.body.periodo, uid: req.usuario.id })));
}));

// =====================================================================
//  DASHBOARD GENERAL — cada rol ve solo los KPIs de su área
// =====================================================================
router.get('/dashboard', puede('dashboard'), ruta(async (req, res) => {
    const rol = req.usuario.rol;
    const ver = (...roles) => rol === 'admin' || roles.includes(rol);
    const datos = { rol };

    if (ver('almacen')) {
        const [flota, minimos] = await Promise.all([
            todos(pool, `SELECT estado, COUNT(*)::int AS n FROM equipos GROUP BY estado`),
            todos(pool,
                `SELECT id, sku, nombre, stock, minimo, maximo FROM productos
                 WHERE activo AND stock <= minimo ORDER BY (stock::float / NULLIF(minimo,0)) NULLS FIRST LIMIT 8`),
        ]);
        const porEstado = Object.fromEntries(flota.map((f) => [f.estado, f.n]));
        const operativos = ['disponible', 'renta', 'reparacion', 'venta'].reduce((s, k) => s + (porEstado[k] || 0), 0);
        datos.flota = porEstado;
        datos.utilizacion = operativos ? Math.round(((porEstado.renta || 0) / operativos) * 100) : 0;
        datos.bajo_minimo = minimos;
        datos.requisiciones_pendientes = (await uno(pool, `SELECT COUNT(*)::int AS n FROM requisiciones WHERE estado = 'pendiente'`)).n;
    }

    if (ver('comercial')) {
        const [rentas, vencen, cartera, mes, tops, cotPend] = await Promise.all([
            uno(pool, `SELECT COUNT(*)::int AS activas, COALESCE(SUM(importe),0) AS importe FROM rentas WHERE estado = 'activa'`),
            todos(pool,
                `SELECT r.id, r.folio, r.fecha_fin, (r.fecha_fin - CURRENT_DATE) AS dias, c.razon_social, e.numero_economico
                 FROM rentas r JOIN clientes c ON c.id = r.cliente_id JOIN equipos e ON e.id = r.equipo_id
                 WHERE r.estado = 'activa' AND r.fecha_fin <= CURRENT_DATE + 7 ORDER BY r.fecha_fin`),
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
            uno(pool, `SELECT COUNT(*)::int AS n FROM ordenes_trabajo WHERE tipo = 'servicio' AND estado = 'cotizacion_comercial'`),
        ]);
        datos.rentas = rentas;
        datos.rentas_por_vencer = vencen;
        datos.cartera = cartera;
        datos.mes = mes;
        datos.top_clientes = tops;
        datos.cotizaciones_pendientes = cotPend.n;
    }

    if (ver('produccion')) {
        const [ot, preventivos, rondasPend, maniobras] = await Promise.all([
            todos(pool, `SELECT tipo, estado, COUNT(*)::int AS n FROM ordenes_trabajo
                         WHERE tipo IN ('servicio','maniobra','refaccion') AND estado NOT IN ('cerrada','facturada','cancelada','rechazada')
                         GROUP BY tipo, estado`),
            uno(pool,
                `SELECT COUNT(*) FILTER (WHERE (COALESCE(ep.horometro_ultimo_servicio,0) + cfg.intervalo_horas - e.horometro) <= 0)::int AS vencidos,
                        COUNT(*) FILTER (WHERE (COALESCE(ep.horometro_ultimo_servicio,0) + cfg.intervalo_horas - e.horometro) BETWEEN 0.01 AND 25)::int AS proximos
                 FROM equipos e LEFT JOIN equipo_preventivo ep ON ep.equipo_id = e.id
                 CROSS JOIN (SELECT intervalo_horas FROM config_preventivo ORDER BY id LIMIT 1) cfg
                 WHERE e.estado NOT IN ('vendido','baja')`),
            uno(pool,
                `SELECT COUNT(*)::int AS n FROM equipos e WHERE e.estado = 'renta'
                 AND (
                    (SELECT MAX(l.fecha) FROM lecturas_horometro l WHERE l.equipo_id = e.id) IS NULL
                    OR (CURRENT_DATE - (SELECT MAX(l.fecha) FROM lecturas_horometro l WHERE l.equipo_id = e.id)) > 7
                 )`),
            uno(pool, `SELECT COUNT(*)::int AS n FROM ordenes_trabajo WHERE tipo = 'maniobra' AND estado IN ('programada','en_ruta')`),
        ]);
        datos.ot_abiertas = ot;
        datos.preventivos = { vencidos: preventivos.vencidos, proximos: preventivos.proximos };
        datos.rondas_pendientes = rondasPend.n;
        datos.maniobras_pendientes = maniobras.n;
    }

    if (ver('administracion')) {
        const [comprasPend, porPagar, nomina, balanza] = await Promise.all([
            uno(pool, `SELECT COUNT(*)::int AS n FROM ordenes_compra WHERE estado IN ('borrador','enviada')`),
            uno(pool, `SELECT COALESCE(SUM(total),0) AS total FROM ordenes_compra WHERE estado = 'recibida' AND NOT pagada`),
            uno(pool, `SELECT p.fecha, p.referencia FROM polizas p WHERE p.referencia LIKE 'NOM-%' ORDER BY p.fecha DESC LIMIT 1`),
            uno(pool,
                `SELECT COALESCE(SUM(m.cargo),0) AS cargos, COALESCE(SUM(m.abono),0) AS abonos FROM poliza_movimientos m`),
        ]);
        datos.compras_pendientes = comprasPend.n;
        datos.por_pagar_proveedores = porPagar.total;
        datos.ultima_nomina = nomina;
        datos.balanza_cuadra = Math.abs(balanza.cargos - balanza.abonos) < 0.01;
    }

    if (ver('contabilidad')) {
        const periodo = new Date().toISOString().slice(0, 7);
        const [porPagar, porCobrar, balanza, ivaCobrado, ivaAcreditable, mesAbierto] = await Promise.all([
            uno(pool, `SELECT COALESCE(SUM(total),0) AS total FROM ordenes_compra WHERE estado = 'recibida' AND NOT pagada`),
            uno(pool, `SELECT COALESCE(SUM(total - pagado),0) AS total FROM facturas WHERE estado IN ('pendiente','parcial')`),
            uno(pool, `SELECT COALESCE(SUM(m.cargo),0) AS cargos, COALESCE(SUM(m.abono),0) AS abonos FROM poliza_movimientos m`),
            uno(pool, `SELECT COALESCE(SUM(m.abono - m.cargo),0) AS n FROM poliza_movimientos m JOIN cuentas_contables c ON c.id = m.cuenta_id
                       JOIN polizas p ON p.id = m.poliza_id WHERE c.codigo = '2105' AND to_char(p.fecha,'YYYY-MM') = $1`, [periodo]),
            uno(pool, `SELECT COALESCE(SUM(m.cargo - m.abono),0) AS n FROM poliza_movimientos m JOIN cuentas_contables c ON c.id = m.cuenta_id
                       JOIN polizas p ON p.id = m.poliza_id WHERE c.codigo = '1151' AND to_char(p.fecha,'YYYY-MM') = $1`, [periodo]),
            uno(pool, `SELECT cerrado FROM periodos_contables WHERE anio = EXTRACT(YEAR FROM CURRENT_DATE)::int AND mes = EXTRACT(MONTH FROM CURRENT_DATE)::int`),
        ]);
        datos.por_pagar_proveedores = porPagar.total;
        datos.por_cobrar_clientes = porCobrar.total;
        datos.balanza_cuadra = Math.abs(balanza.cargos - balanza.abonos) < 0.01;
        datos.iva_mes = redondear(ivaCobrado.n - ivaAcreditable.n);
        datos.mes_actual_cerrado = !!(mesAbierto && mesAbierto.cerrado);
    }

    res.json(datos);
}));

module.exports = router;
