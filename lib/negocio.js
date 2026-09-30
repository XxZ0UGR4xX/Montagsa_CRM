// lib/negocio.js — Reglas de negocio de Montagsa.
// Todas las funciones reciben un cliente de transacción (c) para que
// cada operación (p. ej. facturar + póliza + traspaso) sea atómica.
const { uno, todos, ErrorNegocio, redondear } = require('./db');

const IVA = 0.16;

// ---------------------------------------------------------------------
// Contabilidad
// ---------------------------------------------------------------------
const CUENTA_INGRESO = { renta: '4101', servicio: '4102', venta: '4103', otro: '4104', maniobra: '4105', refaccion_ot: '4106' };

async function idCuenta(c, codigo) {
    const r = await uno(c, 'SELECT id FROM cuentas_contables WHERE codigo = $1', [codigo]);
    if (!r) throw new ErrorNegocio(500, `No existe la cuenta contable ${codigo}`);
    return r.id;
}

/**
 * Registra una póliza de partida doble.
 * movimientos: [{ codigo: '1105', cargo: 100, abono: 0 }, ...]
 */
async function crearPoliza(c, { fecha, tipo, concepto, referencia, automatica = true, uid, movimientos }) {
    const lineas = movimientos
        .map((m) => ({ ...m, cargo: redondear(m.cargo || 0), abono: redondear(m.abono || 0) }))
        .filter((m) => m.cargo > 0 || m.abono > 0);
    const cargos = redondear(lineas.reduce((s, m) => s + m.cargo, 0));
    const abonos = redondear(lineas.reduce((s, m) => s + m.abono, 0));
    if (!lineas.length) throw new ErrorNegocio(400, 'La póliza no tiene movimientos');
    if (Math.abs(cargos - abonos) > 0.009) {
        throw new ErrorNegocio(400, `La póliza no cuadra: cargos ${cargos} ≠ abonos ${abonos}`);
    }
    const p = await uno(c,
        `INSERT INTO polizas (fecha, tipo, concepto, referencia, automatica, usuario_id)
         VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6) RETURNING *`,
        [fecha || null, tipo, concepto, referencia || null, automatica, uid || null]);
    for (const m of lineas) {
        const cuentaId = m.cuenta_id || await idCuenta(c, m.codigo);
        await c.query('INSERT INTO poliza_movimientos (poliza_id, cuenta_id, cargo, abono) VALUES ($1,$2,$3,$4)',
            [p.id, cuentaId, m.cargo, m.abono]);
    }
    return p;
}

// ---------------------------------------------------------------------
// Traspasos de equipo (disponible · renta · venta · reparacion)
// ---------------------------------------------------------------------
const TRANSICIONES = {
    disponible: ['renta', 'venta', 'reparacion', 'baja'],
    renta:      ['disponible', 'reparacion'],
    venta:      ['disponible', 'reparacion', 'vendido'],
    reparacion: ['disponible', 'venta', 'baja'],
    vendido:    [],
    baja:       [],
};

async function traspasar(c, equipoId, destino, { motivo, referencia, uid } = {}) {
    const eq = await uno(c, 'SELECT * FROM equipos WHERE id = $1 FOR UPDATE', [equipoId]);
    if (!eq) throw new ErrorNegocio(404, 'Equipo no encontrado');
    if (eq.estado === destino) throw new ErrorNegocio(409, `El equipo ${eq.numero_economico} ya está en ${destino}`);
    if (!(TRANSICIONES[eq.estado] || []).includes(destino)) {
        throw new ErrorNegocio(409, `No se puede pasar ${eq.numero_economico} de "${eq.estado}" a "${destino}"`);
    }
    await c.query('UPDATE equipos SET estado = $1 WHERE id = $2', [destino, equipoId]);
    await c.query(
        `INSERT INTO traspasos (equipo_id, estado_origen, estado_destino, motivo, referencia, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [equipoId, eq.estado, destino, motivo || null, referencia || null, uid || null]);
    return { ...eq, estado: destino, estado_anterior: eq.estado };
}

// ---------------------------------------------------------------------
// Inventario (refacciones)
// ---------------------------------------------------------------------
/**
 * tipo 'entrada' suma, 'salida' resta, 'ajuste' deja el stock en `cantidad`.
 */
async function moverInventario(c, productoId, tipo, cantidad, { motivo, referencia, uid } = {}) {
    const p = await uno(c, 'SELECT * FROM productos WHERE id = $1 FOR UPDATE', [productoId]);
    if (!p) throw new ErrorNegocio(404, 'Producto no encontrado');
    cantidad = Number(cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 0 || (tipo !== 'ajuste' && cantidad === 0)) {
        throw new ErrorNegocio(400, 'Cantidad inválida');
    }
    let nuevo;
    let registrada = cantidad;
    if (tipo === 'entrada') nuevo = p.stock + cantidad;
    else if (tipo === 'salida') {
        if (cantidad > p.stock) throw new ErrorNegocio(409, `Stock insuficiente de ${p.sku}: hay ${p.stock}, se piden ${cantidad}`);
        nuevo = p.stock - cantidad;
    } else if (tipo === 'ajuste') {
        nuevo = cantidad;
        registrada = cantidad - p.stock;
    } else throw new ErrorNegocio(400, 'Tipo de movimiento inválido');

    await c.query('UPDATE productos SET stock = $1 WHERE id = $2', [nuevo, productoId]);
    await c.query(
        `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, stock_resultante, motivo, referencia, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [productoId, tipo, registrada, nuevo, motivo || null, referencia || null, uid || null]);
    return { ...p, stock: nuevo, diferencia: nuevo - p.stock };
}

// ---------------------------------------------------------------------
// Créditos
// ---------------------------------------------------------------------
async function saldoCliente(c, clienteId) {
    const r = await uno(c,
        `SELECT COALESCE(SUM(total - pagado), 0) AS saldo FROM facturas
         WHERE cliente_id = $1 AND estado IN ('pendiente','parcial')`, [clienteId]);
    return Number(r.saldo);
}

/** Lanza 409 si el cliente no puede operar a crédito por `monto`. `forzar` lo omite (solo admin). */
async function validarCredito(c, cliente, monto, forzar) {
    if (forzar) return;
    if (cliente.credito_estado === 'suspendido') {
        throw new ErrorNegocio(409, `El crédito de ${cliente.razon_social} está suspendido. Un administrador puede autorizarlo.`);
    }
    if (cliente.credito_estado === 'activo' && Number(cliente.limite_credito) > 0) {
        const saldo = await saldoCliente(c, cliente.id);
        if (saldo + monto > Number(cliente.limite_credito) + 0.009) {
            const disp = redondear(Number(cliente.limite_credito) - saldo);
            throw new ErrorNegocio(409,
                `Excede el límite de crédito de ${cliente.razon_social}: disponible $${disp.toLocaleString('es-MX')}. Un administrador puede autorizarlo.`);
        }
    }
}

// ---------------------------------------------------------------------
// Facturación
// ---------------------------------------------------------------------
async function crearFactura(c, { clienteId, origen = 'otro', origenId = null, conceptos, notas, uid, forzar, fecha }) {
    const cli = await uno(c, 'SELECT * FROM clientes WHERE id = $1 FOR UPDATE', [clienteId]);
    if (!cli) throw new ErrorNegocio(404, 'Cliente no encontrado');
    if (!Array.isArray(conceptos) || !conceptos.length) throw new ErrorNegocio(400, 'La factura necesita al menos un concepto');

    const lineas = conceptos.map((k) => {
        const cantidad = Number(k.cantidad || 1);
        const precio = Number(k.precio_unitario);
        if (!k.descripcion || !(cantidad > 0) || !(precio >= 0)) throw new ErrorNegocio(400, 'Concepto inválido');
        return { descripcion: k.descripcion, cantidad, precio, importe: redondear(cantidad * precio) };
    });
    const subtotal = redondear(lineas.reduce((s, l) => s + l.importe, 0));
    const iva = redondear(subtotal * IVA);
    const total = redondear(subtotal + iva);

    await validarCredito(c, cli, total, forzar);

    const f = await uno(c,
        `INSERT INTO facturas (cliente_id, origen, origen_id, fecha, fecha_vencimiento, subtotal, iva, total, notas, usuario_id)
         VALUES ($1,$2,$3, COALESCE($4::date, CURRENT_DATE), COALESCE($4::date, CURRENT_DATE) + $5::int, $6,$7,$8,$9,$10)
         RETURNING *`,
        [clienteId, origen, origenId, fecha || null, cli.dias_credito, subtotal, iva, total, notas || null, uid || null]);
    for (const l of lineas) {
        await c.query(
            'INSERT INTO factura_conceptos (factura_id, descripcion, cantidad, precio_unitario, importe) VALUES ($1,$2,$3,$4,$5)',
            [f.id, l.descripcion, l.cantidad, l.precio, l.importe]);
    }

    await crearPoliza(c, {
        fecha: f.fecha, tipo: 'diario', concepto: `Factura ${f.folio} · ${cli.razon_social}`, referencia: f.folio, uid,
        movimientos: [
            { codigo: '1105', cargo: total },
            { codigo: CUENTA_INGRESO[origen], abono: subtotal },
            { codigo: '2105', abono: iva },
        ],
    });

    // CRM: quien factura deja de ser prospecto; 5+ facturas = frecuente
    const n = await uno(c, `SELECT COUNT(*)::int AS n FROM facturas WHERE cliente_id = $1 AND estado <> 'cancelada'`, [clienteId]);
    const etapa = n.n >= 5 ? 'frecuente' : (['prospecto', 'inactivo'].includes(cli.etapa) ? 'activo' : cli.etapa);
    if (etapa !== cli.etapa) await c.query('UPDATE clientes SET etapa = $1 WHERE id = $2', [etapa, clienteId]);

    return f;
}

async function registrarPago(c, facturaId, { monto, metodo = 'transferencia', referencia, fecha, uid }) {
    const f = await uno(c, 'SELECT * FROM facturas WHERE id = $1 FOR UPDATE', [facturaId]);
    if (!f) throw new ErrorNegocio(404, 'Factura no encontrada');
    if (f.estado === 'cancelada') throw new ErrorNegocio(409, 'La factura está cancelada');
    const saldo = redondear(f.total - f.pagado);
    monto = redondear(monto);
    if (!(monto > 0)) throw new ErrorNegocio(400, 'Monto inválido');
    if (monto > saldo + 0.009) throw new ErrorNegocio(409, `El pago excede el saldo de la factura ($${saldo})`);

    const pago = await uno(c,
        `INSERT INTO pagos (factura_id, fecha, monto, metodo, referencia, usuario_id)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6) RETURNING *`,
        [facturaId, fecha || null, monto, metodo, referencia || null, uid || null]);
    const pagado = redondear(f.pagado + monto);
    const estado = pagado >= f.total - 0.009 ? 'pagada' : 'parcial';
    await c.query('UPDATE facturas SET pagado = $1, estado = $2 WHERE id = $3', [pagado, estado, facturaId]);

    await crearPoliza(c, {
        fecha: pago.fecha, tipo: 'ingreso', concepto: `Cobro de ${f.folio}`, referencia: f.folio, uid,
        movimientos: [
            { codigo: metodo === 'efectivo' ? '1101' : '1102', cargo: monto },
            { codigo: '1105', abono: monto },
        ],
    });
    return { ...pago, estado_factura: estado, saldo: redondear(f.total - pagado) };
}

async function cancelarFactura(c, facturaId, { motivo, uid } = {}) {
    const f = await uno(c, 'SELECT * FROM facturas WHERE id = $1 FOR UPDATE', [facturaId]);
    if (!f) throw new ErrorNegocio(404, 'Factura no encontrada');
    if (f.estado === 'cancelada') throw new ErrorNegocio(409, 'La factura ya está cancelada');
    if (f.pagado > 0) throw new ErrorNegocio(409, 'No se puede cancelar una factura con pagos registrados');

    await c.query(`UPDATE facturas SET estado = 'cancelada', notas = COALESCE(notas || ' · ', '') || $2 WHERE id = $1`,
        [facturaId, `Cancelada: ${motivo || 'sin motivo'}`]);
    await crearPoliza(c, {
        tipo: 'diario', concepto: `Cancelación de ${f.folio}`, referencia: f.folio, uid,
        movimientos: [
            { codigo: CUENTA_INGRESO[f.origen], cargo: f.subtotal },
            { codigo: '2105', cargo: f.iva },
            { codigo: '1105', abono: f.total },
        ],
    });
    // Libera el documento de origen para poder volver a facturarlo
    await c.query('UPDATE rentas SET factura_id = NULL WHERE factura_id = $1', [facturaId]);
    await c.query(`UPDATE ordenes_trabajo SET factura_id = NULL, estado = 'cerrada' WHERE factura_id = $1`, [facturaId]);
    return { ...f, estado: 'cancelada' };
}

// ---------------------------------------------------------------------
// Rentas
// ---------------------------------------------------------------------
const DIAS_PERIODO = { diaria: 1, semanal: 7, mensual: 30 };
const TARIFA_CAMPO = { diaria: 'tarifa_diaria', semanal: 'tarifa_semanal', mensual: 'tarifa_mensual' };
const PERIODO_TXT = { diaria: ['día', 'días'], semanal: ['semana', 'semanas'], mensual: ['mes', 'meses'] };

async function crearRenta(c, { clienteId, equipoId, periodo, cantidadPeriodos = 1, tarifa, deposito = 0, fechaInicio, notas, uid, forzar }) {
    if (!DIAS_PERIODO[periodo]) throw new ErrorNegocio(400, 'Periodo inválido');
    const cant = Number(cantidadPeriodos);
    if (!Number.isInteger(cant) || cant < 1) throw new ErrorNegocio(400, 'Cantidad de periodos inválida');
    const cli = await uno(c, 'SELECT * FROM clientes WHERE id = $1', [clienteId]);
    if (!cli) throw new ErrorNegocio(404, 'Cliente no encontrado');
    const eq = await uno(c, 'SELECT * FROM equipos WHERE id = $1 FOR UPDATE', [equipoId]);
    if (!eq) throw new ErrorNegocio(404, 'Equipo no encontrado');
    if (eq.estado !== 'disponible') throw new ErrorNegocio(409, `${eq.numero_economico} no está disponible (estado: ${eq.estado})`);

    const t = tarifa != null && tarifa !== '' ? Number(tarifa) : Number(eq[TARIFA_CAMPO[periodo]]);
    if (!(t > 0)) throw new ErrorNegocio(400, 'El equipo no tiene tarifa para ese periodo');
    const importe = redondear(t * cant);
    await validarCredito(c, cli, redondear(importe * (1 + IVA)), forzar);

    const r = await uno(c,
        `INSERT INTO rentas (cliente_id, equipo_id, periodo, cantidad_periodos, tarifa, importe, deposito,
                             fecha_inicio, fecha_fin, horometro_salida, notas, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::date, CURRENT_DATE),
                 COALESCE($8::date, CURRENT_DATE) + $9::int, $10, $11, $12)
         RETURNING *`,
        [clienteId, equipoId, periodo, cant, t, importe, Number(deposito) || 0, fechaInicio || null,
         DIAS_PERIODO[periodo] * cant, eq.horometro, notas || null, uid || null]);
    await traspasar(c, equipoId, 'renta', { motivo: `Renta a ${cli.razon_social}`, referencia: r.folio, uid });
    if (cli.etapa === 'prospecto') await c.query(`UPDATE clientes SET etapa = 'activo' WHERE id = $1`, [clienteId]);
    return r;
}

async function finalizarRenta(c, rentaId, { horometroRegreso, destino = 'disponible', fecha, notas, uid }) {
    const r = await uno(c, 'SELECT * FROM rentas WHERE id = $1 FOR UPDATE', [rentaId]);
    if (!r) throw new ErrorNegocio(404, 'Renta no encontrada');
    if (r.estado !== 'activa') throw new ErrorNegocio(409, `La renta ${r.folio} no está activa`);
    if (!['disponible', 'reparacion'].includes(destino)) throw new ErrorNegocio(400, 'Destino inválido');
    const hr = horometroRegreso != null && horometroRegreso !== '' ? Number(horometroRegreso) : null;
    if (hr != null && r.horometro_salida != null && hr < r.horometro_salida) {
        throw new ErrorNegocio(400, `El horómetro de regreso (${hr}) es menor al de salida (${r.horometro_salida})`);
    }
    await c.query(
        `UPDATE rentas SET estado = 'finalizada', fecha_devolucion = COALESCE($2::date, CURRENT_DATE),
                horometro_regreso = $3, notas = COALESCE($4, notas) WHERE id = $1`,
        [rentaId, fecha || null, hr, notas || null]);
    if (hr != null) await c.query('UPDATE equipos SET horometro = GREATEST(horometro, $1) WHERE id = $2', [hr, r.equipo_id]);
    await traspasar(c, r.equipo_id, destino, {
        motivo: destino === 'reparacion' ? 'Regresó de renta con falla' : 'Regresó de renta', referencia: r.folio, uid });

    let ot = null;
    if (destino === 'reparacion') {
        ot = await crearOTServicio(c, {
            equipoId: r.equipo_id,
            descripcion: `Revisión al regreso de la renta ${r.folio}${notas ? ': ' + notas : ''}`,
            uid,
        });
    }
    return { ...r, estado: 'finalizada', ot };
}

async function cancelarRenta(c, rentaId, { uid } = {}) {
    const r = await uno(c, 'SELECT * FROM rentas WHERE id = $1 FOR UPDATE', [rentaId]);
    if (!r) throw new ErrorNegocio(404, 'Renta no encontrada');
    if (r.estado !== 'activa') throw new ErrorNegocio(409, 'Solo se cancelan rentas activas');
    if (r.factura_id) throw new ErrorNegocio(409, 'La renta ya está facturada; cancela primero la factura');
    await c.query(`UPDATE rentas SET estado = 'cancelada' WHERE id = $1`, [rentaId]);
    await traspasar(c, r.equipo_id, 'disponible', { motivo: 'Renta cancelada', referencia: r.folio, uid });
    return { ...r, estado: 'cancelada' };
}

async function facturarRenta(c, rentaId, { uid, forzar, fecha } = {}) {
    const r = await uno(c,
        `SELECT r.*, e.numero_economico, e.tipo AS equipo_tipo, e.marca, e.modelo
         FROM rentas r JOIN equipos e ON e.id = r.equipo_id WHERE r.id = $1 FOR UPDATE OF r`, [rentaId]);
    if (!r) throw new ErrorNegocio(404, 'Renta no encontrada');
    if (r.estado === 'cancelada') throw new ErrorNegocio(409, 'La renta está cancelada');
    if (r.factura_id) throw new ErrorNegocio(409, `La renta ${r.folio} ya tiene factura`);
    const [uno_, varios] = PERIODO_TXT[r.periodo];
    const f = await crearFactura(c, {
        clienteId: r.cliente_id, origen: 'renta', origenId: r.id, uid, forzar, fecha,
        conceptos: [{
            descripcion: `Renta de ${r.equipo_tipo} ${r.marca} ${r.modelo || ''} (${r.numero_economico}) · ${r.folio} · del ${r.fecha_inicio} al ${r.fecha_fin}`,
            cantidad: r.cantidad_periodos, precio_unitario: r.tarifa,
        }],
        notas: `Periodo: ${r.cantidad_periodos} ${r.cantidad_periodos === 1 ? uno_ : varios}`,
    });
    await c.query('UPDATE rentas SET factura_id = $1 WHERE id = $2', [f.id, rentaId]);
    return f;
}

// ---------------------------------------------------------------------
// Producción · Órdenes de trabajo (OT): rondas, preventivos, servicios,
// maniobras y refacciones. Una sola tabla (ordenes_trabajo); el flujo
// de estados válido por tipo se controla aquí.
// ---------------------------------------------------------------------
const FLUJO_OT_SERVICIO = {
    evaluacion: ['requiere_cotizacion', 'cancelada'],
    requiere_cotizacion: ['cotizacion_interna', 'cancelada'],
    cotizacion_interna: ['cotizacion_comercial', 'cancelada'],
    cotizacion_comercial: ['autorizada', 'rechazada'],
    autorizada: ['en_ejecucion', 'cancelada'],
    en_ejecucion: ['cerrada', 'cancelada'],
    cerrada: ['facturada'],
    facturada: [], rechazada: [], cancelada: [],
};
const FLUJO_OT_MANIOBRA = {
    programada: ['en_ruta', 'cancelada'],
    en_ruta: ['entregada', 'cancelada'],
    entregada: ['cerrada'],
    cerrada: ['facturada'],
    facturada: [], cancelada: [],
};
const FLUJO_OT_REFACCION = {
    abierta: ['cerrada', 'cancelada'],
    cerrada: ['facturada'],
    facturada: [], cancelada: [],
};
const ORIGEN_OT = { servicio: 'servicio', maniobra: 'maniobra', refaccion: 'refaccion_ot' };

function validarTransicionOT(flujo, actual, destino, folio) {
    if (!(flujo[actual] || []).includes(destino)) {
        throw new ErrorNegocio(409, `No se puede pasar la orden ${folio} de "${actual}" a "${destino}"`);
    }
}

// --- Rondas (equipos en renta) -----------------------------------------
async function registrarLecturaHorometro(c, equipoId, { lectura, uid }) {
    const eq = await uno(c, 'SELECT * FROM equipos WHERE id = $1 FOR UPDATE', [equipoId]);
    if (!eq) throw new ErrorNegocio(404, 'Equipo no encontrado');
    const l = Number(lectura);
    if (!(l >= 0)) throw new ErrorNegocio(400, 'Lectura inválida');
    if (l < Number(eq.horometro)) {
        throw new ErrorNegocio(409, `La lectura (${l}) no puede ser menor a la anterior (${eq.horometro}) de ${eq.numero_economico}`);
    }
    const ot = await uno(c,
        `INSERT INTO ordenes_trabajo (tipo, equipo_id, estado, horometro, descripcion, fecha_cierre, usuario_id)
         VALUES ('ronda', $1, 'cerrada', $2, 'Ronda: registro de horómetro', CURRENT_DATE, $3) RETURNING *`,
        [equipoId, l, uid || null]);
    await c.query('INSERT INTO lecturas_horometro (equipo_id, ot_id, lectura, usuario_id) VALUES ($1,$2,$3,$4)',
        [equipoId, ot.id, l, uid || null]);
    await c.query('UPDATE equipos SET horometro = $1 WHERE id = $2', [l, equipoId]);
    return ot;
}

// --- Preventivos (cada X horas, según secuencia configurable) ---------
async function generarOTPreventiva(c, equipoId, { tecnicoId, uid }) {
    const eq = await uno(c, 'SELECT * FROM equipos WHERE id = $1 FOR UPDATE', [equipoId]);
    if (!eq) throw new ErrorNegocio(404, 'Equipo no encontrado');
    const abierta = await uno(c, `SELECT id FROM ordenes_trabajo WHERE equipo_id = $1 AND tipo = 'preventivo' AND estado = 'abierta'`, [equipoId]);
    if (abierta) throw new ErrorNegocio(409, `${eq.numero_economico} ya tiene una OT preventiva abierta`);
    let ep = await uno(c, 'SELECT * FROM equipo_preventivo WHERE equipo_id = $1', [equipoId]);
    if (!ep) ep = await uno(c, 'INSERT INTO equipo_preventivo (equipo_id) VALUES ($1) RETURNING *', [equipoId]);
    const paso = await uno(c, 'SELECT * FROM secuencia_preventivo WHERE orden = $1', [ep.paso_actual]);
    return uno(c,
        `INSERT INTO ordenes_trabajo (tipo, equipo_id, tecnico_id, estado, descripcion, usuario_id)
         VALUES ('preventivo', $1, $2, 'abierta', $3, $4) RETURNING *`,
        [equipoId, tecnicoId || null, `Preventivo · paso ${ep.paso_actual}: ${paso ? paso.nombre_servicio : '—'}`, uid || null]);
}

async function cerrarOTPreventiva(c, otId, { horometro, uid }) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (ot.tipo !== 'preventivo') throw new ErrorNegocio(409, 'La orden no es un preventivo');
    if (ot.estado !== 'abierta') throw new ErrorNegocio(409, `La orden ${ot.folio} no está abierta`);
    const eq = await uno(c, 'SELECT * FROM equipos WHERE id = $1 FOR UPDATE', [ot.equipo_id]);
    const h = horometro != null && horometro !== '' ? Number(horometro) : Number(eq.horometro);
    if (h < Number(eq.horometro)) throw new ErrorNegocio(400, `El horómetro (${h}) no puede ser menor al actual (${eq.horometro})`);
    await c.query(`UPDATE ordenes_trabajo SET estado = 'cerrada', horometro = $2, fecha_cierre = CURRENT_DATE WHERE id = $1`, [otId, h]);
    await c.query('UPDATE equipos SET horometro = $1 WHERE id = $2', [h, ot.equipo_id]);

    const total = await uno(c, 'SELECT COUNT(*)::int AS n FROM secuencia_preventivo');
    const ep = await uno(c, 'SELECT * FROM equipo_preventivo WHERE equipo_id = $1', [ot.equipo_id]);
    const siguiente = ((ep ? ep.paso_actual : 0) % (total.n || 1)) + 1;
    await c.query(
        `INSERT INTO equipo_preventivo (equipo_id, paso_actual, horometro_ultimo_servicio, fecha_ultimo_servicio)
         VALUES ($1,$2,$3,CURRENT_DATE)
         ON CONFLICT (equipo_id) DO UPDATE SET paso_actual = $2, horometro_ultimo_servicio = $3, fecha_ultimo_servicio = CURRENT_DATE`,
        [ot.equipo_id, siguiente, h]);
    return { ...ot, estado: 'cerrada', horometro: h };
}

// --- Servicios (flujo con estados) -------------------------------------
async function crearOTServicio(c, { clienteId, equipoId, equipoCliente, descripcion, tecnicoId, uid }) {
    if (!equipoId && !equipoCliente) throw new ErrorNegocio(400, 'Indica el equipo de Montagsa o describe el equipo del cliente');
    if (!descripcion) throw new ErrorNegocio(400, 'Describe la falla o el trabajo a evaluar');
    return uno(c,
        `INSERT INTO ordenes_trabajo (tipo, cliente_id, equipo_id, equipo_cliente, tecnico_id, descripcion, estado, usuario_id)
         VALUES ('servicio', $1,$2,$3,$4,$5, 'evaluacion', $6) RETURNING *`,
        [clienteId || null, equipoId || null, equipoId ? null : equipoCliente, tecnicoId || null, descripcion, uid || null]);
}

async function guardarEvaluacion(c, otId, { diagnostico, uid }) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (ot.tipo !== 'servicio') throw new ErrorNegocio(409, 'La orden no es un servicio');
    if (!diagnostico) throw new ErrorNegocio(400, 'Captura el diagnóstico');
    validarTransicionOT(FLUJO_OT_SERVICIO, ot.estado, 'requiere_cotizacion', ot.folio);
    await c.query(`UPDATE ordenes_trabajo SET diagnostico = $2, estado = 'requiere_cotizacion' WHERE id = $1`, [otId, diagnostico]);
    return { ...ot, diagnostico, estado: 'requiere_cotizacion' };
}

/** Horas de mano de obra al costo por hora. Puede editarse mientras dura la cotización interna. */
async function guardarCotizacionInterna(c, otId, { horas, costoHora, uid }) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (ot.tipo !== 'servicio') throw new ErrorNegocio(409, 'La orden no es un servicio');
    if (!['requiere_cotizacion', 'cotizacion_interna'].includes(ot.estado)) {
        throw new ErrorNegocio(409, `La orden ${ot.folio} no está en cotización interna`);
    }
    const h = Number(horas) || 0;
    const ch = Number(costoHora) || 0;
    if (h < 0 || ch < 0) throw new ErrorNegocio(400, 'Horas y costo por hora deben ser positivos');
    const manoObra = redondear(h * ch);
    const interno = redondear(manoObra + Number(ot.costo_refacciones));
    const estado = ot.estado === 'requiere_cotizacion' ? 'cotizacion_interna' : ot.estado;
    await c.query(
        `UPDATE ordenes_trabajo SET mano_obra_horas = $2, costo_hora = $3, costo_mano_obra = $4, costo_interno = $5, estado = $6 WHERE id = $1`,
        [otId, h, ch, manoObra, interno, estado]);
    return { ...ot, mano_obra_horas: h, costo_hora: ch, costo_mano_obra: manoObra, costo_interno: interno, estado };
}

/**
 * Agrega una refacción a la cotización (servicios) o a la partida de venta (refacciones).
 * No mueve inventario todavía: eso ocurre al surtir la requisición.
 */
async function agregarRefaccionCotizacion(c, otId, { productoId, cantidad, uid }) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (!['servicio', 'refaccion'].includes(ot.tipo)) throw new ErrorNegocio(409, 'La orden no admite refacciones');
    if (ot.tipo === 'servicio' && !['requiere_cotizacion', 'cotizacion_interna'].includes(ot.estado)) {
        throw new ErrorNegocio(409, `La orden ${ot.folio} no está en cotización interna`);
    }
    if (ot.tipo === 'refaccion' && ot.estado !== 'abierta') throw new ErrorNegocio(409, `La orden ${ot.folio} ya no admite partidas`);
    const cant = Number(cantidad);
    if (!Number.isInteger(cant) || cant < 1) throw new ErrorNegocio(400, 'Cantidad inválida');
    const p = await uno(c, 'SELECT * FROM productos WHERE id = $1', [productoId]);
    if (!p) throw new ErrorNegocio(404, 'Producto no encontrado');
    const item = await uno(c,
        `INSERT INTO ot_refacciones (ot_id, producto_id, cantidad, costo_unitario, precio_unitario)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`, [otId, productoId, cant, p.costo, p.precio]);
    const costoRef = redondear(Number(ot.costo_refacciones) + p.costo * cant);
    if (ot.tipo === 'servicio') {
        const estado = ot.estado === 'requiere_cotizacion' ? 'cotizacion_interna' : ot.estado;
        const interno = redondear(costoRef + Number(ot.costo_mano_obra));
        await c.query(`UPDATE ordenes_trabajo SET costo_refacciones = $2, costo_interno = $3, estado = $4 WHERE id = $1`,
            [otId, costoRef, interno, estado]);
    } else {
        const precioTotal = redondear(Number(ot.precio_cliente) + p.precio * cant);
        await c.query(`UPDATE ordenes_trabajo SET costo_refacciones = $2, precio_cliente = $3 WHERE id = $1`, [otId, costoRef, precioTotal]);
    }
    return item;
}

async function enviarCotizacionComercial(c, otId, { uid }) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (ot.tipo !== 'servicio') throw new ErrorNegocio(409, 'La orden no es un servicio');
    validarTransicionOT(FLUJO_OT_SERVICIO, ot.estado, 'cotizacion_comercial', ot.folio);
    if (!(Number(ot.costo_interno) > 0)) throw new ErrorNegocio(409, 'Captura refacciones u horas de mano de obra antes de enviarla a Comercial');
    await c.query(`UPDATE ordenes_trabajo SET estado = 'cotizacion_comercial' WHERE id = $1`, [otId]);
    return { ...ot, estado: 'cotizacion_comercial' };
}

/** Comercial: agrega el margen y el precio al cliente. */
async function capturarCotizacionComercial(c, otId, { margen, precioCliente, uid }) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (ot.tipo !== 'servicio') throw new ErrorNegocio(409, 'La orden no es un servicio');
    if (ot.estado !== 'cotizacion_comercial') throw new ErrorNegocio(409, `La orden ${ot.folio} no está pendiente de cotización comercial`);
    const precio = Number(precioCliente);
    if (!(precio > 0)) throw new ErrorNegocio(400, 'El precio al cliente debe ser mayor a cero');
    const m = margen != null && margen !== '' ? Number(margen) : redondear(precio - Number(ot.costo_interno));
    await c.query(`UPDATE ordenes_trabajo SET margen = $2, precio_cliente = $3 WHERE id = $1`, [otId, m, precio]);
    return { ...ot, margen: m, precio_cliente: precio };
}

/** Comercial: autoriza (con fecha y quién autorizó del lado del cliente) o rechaza. */
async function autorizarOT(c, otId, { autorizadoPor, fecha, uid }) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (ot.tipo !== 'servicio') throw new ErrorNegocio(409, 'La orden no es un servicio');
    if (!(Number(ot.precio_cliente) > 0)) throw new ErrorNegocio(409, 'Captura el precio al cliente antes de autorizar');
    if (!autorizadoPor) throw new ErrorNegocio(400, 'Indica quién autorizó del lado del cliente');
    validarTransicionOT(FLUJO_OT_SERVICIO, ot.estado, 'autorizada', ot.folio);
    await c.query(
        `UPDATE ordenes_trabajo SET estado = 'autorizada', autorizado_por = $2, fecha_autorizacion = COALESCE($3::date, CURRENT_DATE) WHERE id = $1`,
        [otId, autorizadoPor, fecha || null]);
    return { ...ot, estado: 'autorizada', autorizado_por: autorizadoPor };
}

async function rechazarOT(c, otId, { motivo, uid }) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (ot.tipo !== 'servicio') throw new ErrorNegocio(409, 'La orden no es un servicio');
    validarTransicionOT(FLUJO_OT_SERVICIO, ot.estado, 'rechazada', ot.folio);
    await c.query(`UPDATE ordenes_trabajo SET estado = 'rechazada', notas = COALESCE(notas || ' · ', '') || $2 WHERE id = $1`,
        [otId, `Rechazada: ${motivo || 'sin motivo'}`]);
    return { ...ot, estado: 'rechazada' };
}

/** Producción inicia la ejecución: el equipo propio pasa a reparación y se genera la requisición. */
async function iniciarEjecucionOT(c, otId, { uid }) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (ot.tipo !== 'servicio') throw new ErrorNegocio(409, 'La orden no es un servicio');
    validarTransicionOT(FLUJO_OT_SERVICIO, ot.estado, 'en_ejecucion', ot.folio);
    await c.query(`UPDATE ordenes_trabajo SET estado = 'en_ejecucion' WHERE id = $1`, [otId]);
    if (ot.equipo_id) {
        const eq = await uno(c, 'SELECT estado FROM equipos WHERE id = $1', [ot.equipo_id]);
        if (eq && ['disponible', 'venta'].includes(eq.estado)) {
            await traspasar(c, ot.equipo_id, 'reparacion', { motivo: `Servicio ${ot.folio}`, referencia: ot.folio, uid });
        }
    }
    const items = await todos(c, 'SELECT id FROM ot_refacciones WHERE ot_id = $1', [otId]);
    const requisicion = items.length ? await generarRequisicionOT(c, otId, { uid }) : null;
    return { ...ot, estado: 'en_ejecucion', requisicion };
}

/** Genera la requisición de refacciones (servicios en ejecución, o refacciones al crearse). Almacén la surte. */
async function generarRequisicionOT(c, otId, { uid } = {}) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (!['servicio', 'refaccion'].includes(ot.tipo)) throw new ErrorNegocio(409, 'La orden no admite requisición');
    if (ot.tipo === 'servicio' && ot.estado !== 'en_ejecucion') throw new ErrorNegocio(409, `La orden ${ot.folio} no está en ejecución`);
    if (ot.tipo === 'refaccion' && ot.estado !== 'abierta') throw new ErrorNegocio(409, `La orden ${ot.folio} ya no admite requisición`);
    const existente = await uno(c, `SELECT id FROM requisiciones WHERE ot_id = $1 AND estado <> 'cancelada'`, [otId]);
    if (existente) throw new ErrorNegocio(409, `La orden ${ot.folio} ya tiene una requisición`);
    const items = await todos(c, 'SELECT * FROM ot_refacciones WHERE ot_id = $1', [otId]);
    if (!items.length) throw new ErrorNegocio(409, 'La orden no tiene refacciones para requisitar');
    const rq = await uno(c, 'INSERT INTO requisiciones (ot_id, usuario_id) VALUES ($1,$2) RETURNING *', [otId, uid || null]);
    for (const it of items) {
        await c.query('INSERT INTO requisicion_items (requisicion_id, producto_id, cantidad) VALUES ($1,$2,$3)', [rq.id, it.producto_id, it.cantidad]);
    }
    return rq;
}

/** Almacén surte la requisición: descuenta inventario y genera la póliza de costo (como agregarRefaccion antes). */
async function surtirRequisicion(c, requisicionId, { uid }) {
    const rq = await uno(c, 'SELECT * FROM requisiciones WHERE id = $1 FOR UPDATE', [requisicionId]);
    if (!rq) throw new ErrorNegocio(404, 'Requisición no encontrada');
    if (rq.estado !== 'pendiente') throw new ErrorNegocio(409, `La requisición ${rq.folio} ya fue procesada`);
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1', [rq.ot_id]);
    const items = await todos(c, 'SELECT * FROM requisicion_items WHERE requisicion_id = $1', [requisicionId]);
    let costoTotal = 0;
    for (const it of items) {
        const p = await moverInventario(c, it.producto_id, 'salida', it.cantidad, { motivo: 'Surtido de requisición', referencia: ot.folio, uid });
        costoTotal += p.costo * it.cantidad;
    }
    costoTotal = redondear(costoTotal);
    if (costoTotal > 0) {
        await crearPoliza(c, {
            tipo: 'diario', concepto: `Refacciones surtidas · ${ot.folio}`, referencia: ot.folio, uid,
            movimientos: [{ codigo: '5101', cargo: costoTotal }, { codigo: '1150', abono: costoTotal }],
        });
    }
    return uno(c, `UPDATE requisiciones SET estado = 'surtida', fecha_surtido = CURRENT_DATE, surtido_por = $2 WHERE id = $1 RETURNING *`,
        [requisicionId, uid || null]);
}

/** Cierra servicios, refacciones o maniobras. Libera el equipo propio si ya no tiene otra OT abierta. */
async function cerrarOT(c, otId, { uid } = {}) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (!['servicio', 'refaccion', 'maniobra'].includes(ot.tipo)) throw new ErrorNegocio(409, 'La orden no se cierra de forma manual');
    const flujo = { servicio: FLUJO_OT_SERVICIO, refaccion: FLUJO_OT_REFACCION, maniobra: FLUJO_OT_MANIOBRA }[ot.tipo];
    validarTransicionOT(flujo, ot.estado, 'cerrada', ot.folio);
    const rq = await uno(c, `SELECT * FROM requisiciones WHERE ot_id = $1 AND estado <> 'cancelada' ORDER BY id DESC LIMIT 1`, [otId]);
    if (rq && rq.estado !== 'surtida') throw new ErrorNegocio(409, `La requisición ${rq.folio} todavía no ha sido surtida por Almacén`);
    await c.query(`UPDATE ordenes_trabajo SET estado = 'cerrada', fecha_cierre = CURRENT_DATE WHERE id = $1`, [otId]);
    if (ot.tipo === 'servicio' && ot.equipo_id) {
        const eq = await uno(c, 'SELECT estado FROM equipos WHERE id = $1', [ot.equipo_id]);
        const otras = await uno(c,
            `SELECT COUNT(*)::int AS n FROM ordenes_trabajo WHERE equipo_id = $1 AND id <> $2 AND tipo IN ('servicio','preventivo')
             AND estado NOT IN ('cerrada','facturada','cancelada','rechazada')`, [ot.equipo_id, otId]);
        if (eq && eq.estado === 'reparacion' && otras.n === 0) {
            await traspasar(c, ot.equipo_id, 'disponible', { motivo: `Servicio ${ot.folio} cerrado`, referencia: ot.folio, uid });
        }
    }
    return { ...ot, estado: 'cerrada' };
}

async function cancelarOT(c, otId, { motivo, uid } = {}) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (['cerrada', 'facturada', 'cancelada', 'rechazada'].includes(ot.estado)) {
        throw new ErrorNegocio(409, `La orden ${ot.folio} ya no se puede cancelar`);
    }
    await c.query(`UPDATE ordenes_trabajo SET estado = 'cancelada', notas = COALESCE(notas || ' · ', '') || $2 WHERE id = $1`,
        [otId, `Cancelada: ${motivo || 'sin motivo'}`]);
    await c.query(`UPDATE requisiciones SET estado = 'cancelada' WHERE ot_id = $1 AND estado = 'pendiente'`, [otId]);
    if (ot.tipo === 'servicio' && ot.equipo_id) {
        const eq = await uno(c, 'SELECT estado FROM equipos WHERE id = $1', [ot.equipo_id]);
        if (eq && eq.estado === 'reparacion') {
            const otras = await uno(c,
                `SELECT COUNT(*)::int AS n FROM ordenes_trabajo WHERE equipo_id = $1 AND id <> $2 AND tipo IN ('servicio','preventivo')
                 AND estado NOT IN ('cerrada','facturada','cancelada','rechazada')`, [ot.equipo_id, otId]);
            if (otras.n === 0) await traspasar(c, ot.equipo_id, 'disponible', { motivo: `Servicio ${ot.folio} cancelado`, referencia: ot.folio, uid });
        }
    }
    return { ...ot, estado: 'cancelada' };
}

/** Comercial factura servicios, maniobras o venta de refacciones ya cerrados. */
async function facturarOT(c, otId, { uid, forzar, fecha } = {}) {
    const ot = await uno(c,
        `SELECT ot.*, e.numero_economico FROM ordenes_trabajo ot LEFT JOIN equipos e ON e.id = ot.equipo_id
         WHERE ot.id = $1 FOR UPDATE OF ot`, [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (!['servicio', 'maniobra', 'refaccion'].includes(ot.tipo)) throw new ErrorNegocio(409, 'La orden no se factura');
    if (ot.estado !== 'cerrada') throw new ErrorNegocio(409, `Solo se facturan órdenes cerradas (${ot.folio})`);
    if (!ot.cliente_id) throw new ErrorNegocio(409, 'Es una orden interna (sin cliente): no se factura');
    if (!(Number(ot.precio_cliente) > 0)) throw new ErrorNegocio(409, 'La orden no tiene precio al cliente capturado');
    const DESC = {
        servicio: `Servicio ${ot.folio}${ot.numero_economico ? ' · ' + ot.numero_economico : ot.equipo_cliente ? ' · ' + ot.equipo_cliente : ''}: ${ot.descripcion || ''}`,
        maniobra: `Maniobra ${ot.folio}: ${ot.origen_maniobra || ''} → ${ot.destino_maniobra || ''}`,
        refaccion: `Venta de refacciones ${ot.folio}`,
    };
    const f = await crearFactura(c, {
        clienteId: ot.cliente_id, origen: ORIGEN_OT[ot.tipo], origenId: ot.id, uid, forzar, fecha,
        conceptos: [{ descripcion: DESC[ot.tipo], cantidad: 1, precio_unitario: ot.precio_cliente }],
    });
    await c.query(`UPDATE ordenes_trabajo SET estado = 'facturada', factura_id = $1 WHERE id = $2`, [f.id, otId]);
    return f;
}

// --- Maniobras -----------------------------------------------------------
async function crearManiobra(c, { clienteId, equipoId, equipoCliente, origen, destino, fechaProgramada, operadorId, unidadTransporte, costoInterno, precioCliente, uid }) {
    if (!origen || !destino) throw new ErrorNegocio(400, 'Indica origen y destino');
    if (!equipoId && !equipoCliente) throw new ErrorNegocio(400, 'Indica el equipo de Montagsa o describe el equipo del cliente');
    return uno(c,
        `INSERT INTO ordenes_trabajo (tipo, cliente_id, equipo_id, equipo_cliente, tecnico_id, estado,
                origen_maniobra, destino_maniobra, unidad_transporte, fecha_programada, costo_interno, precio_cliente, usuario_id)
         VALUES ('maniobra',$1,$2,$3,$4,'programada',$5,$6,$7,COALESCE($8::date, CURRENT_DATE),$9,$10,$11) RETURNING *`,
        [clienteId || null, equipoId || null, equipoId ? null : equipoCliente, operadorId || null,
         origen, destino, unidadTransporte || null, fechaProgramada || null, Number(costoInterno) || 0, Number(precioCliente) || 0, uid || null]);
}

async function cambiarEstadoManiobra(c, otId, estado, { uid } = {}) {
    const ot = await uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1 FOR UPDATE', [otId]);
    if (!ot) throw new ErrorNegocio(404, 'Orden de trabajo no encontrada');
    if (ot.tipo !== 'maniobra') throw new ErrorNegocio(409, 'La orden no es una maniobra');
    if (estado === 'cerrada') return cerrarOT(c, otId, { uid });
    validarTransicionOT(FLUJO_OT_MANIOBRA, ot.estado, estado, ot.folio);
    await c.query(`UPDATE ordenes_trabajo SET estado = $2 WHERE id = $1`, [otId, estado]);
    return { ...ot, estado };
}

// --- Refacciones (venta/surtido a cliente) -------------------------------
async function crearOTRefaccion(c, { clienteId, items, uid }) {
    if (!clienteId) throw new ErrorNegocio(400, 'Indica el cliente');
    if (!Array.isArray(items) || !items.length) throw new ErrorNegocio(400, 'Agrega al menos una refacción');
    const ot = await uno(c, `INSERT INTO ordenes_trabajo (tipo, cliente_id, estado, usuario_id) VALUES ('refaccion',$1,'abierta',$2) RETURNING *`,
        [clienteId, uid || null]);
    for (const it of items) {
        await agregarRefaccionCotizacion(c, ot.id, { productoId: it.productoId || it.producto_id, cantidad: it.cantidad, uid });
    }
    await generarRequisicionOT(c, ot.id, { uid });
    return uno(c, 'SELECT * FROM ordenes_trabajo WHERE id = $1', [ot.id]);
}

// ---------------------------------------------------------------------
// Venta de equipo
// ---------------------------------------------------------------------
async function venderEquipo(c, equipoId, { clienteId, precio, uid, forzar }) {
    const eq = await uno(c, 'SELECT * FROM equipos WHERE id = $1', [equipoId]);
    if (!eq) throw new ErrorNegocio(404, 'Equipo no encontrado');
    if (eq.estado !== 'venta') throw new ErrorNegocio(409, `Primero traspasa ${eq.numero_economico} a "venta"`);
    const p = precio != null && precio !== '' ? Number(precio) : Number(eq.precio_venta);
    if (!(p > 0)) throw new ErrorNegocio(400, 'Precio de venta inválido');
    const f = await crearFactura(c, {
        clienteId, origen: 'venta', origenId: eq.id, uid, forzar,
        conceptos: [{
            descripcion: `Venta de ${eq.tipo} ${eq.marca} ${eq.modelo || ''} serie ${eq.serie || 's/n'} (${eq.numero_economico}), año ${eq.anio || '—'}`,
            cantidad: 1, precio_unitario: p,
        }],
    });
    await traspasar(c, equipoId, 'vendido', { motivo: 'Venta de equipo', referencia: f.folio, uid });
    await crearPoliza(c, {
        tipo: 'diario', concepto: `Costo de venta ${eq.numero_economico}`, referencia: f.folio, uid,
        movimientos: [
            { codigo: '5102', cargo: eq.costo_adquisicion },
            { codigo: '1201', abono: eq.costo_adquisicion },
        ],
    });
    return f;
}

// ---------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------
async function crearOrdenCompra(c, { proveedorId, items, notas, uid }) {
    if (!Array.isArray(items) || !items.length) throw new ErrorNegocio(400, 'La orden necesita al menos una partida');
    const prov = await uno(c, 'SELECT * FROM proveedores WHERE id = $1', [proveedorId]);
    if (!prov) throw new ErrorNegocio(404, 'Proveedor no encontrado');
    const oc = await uno(c, 'INSERT INTO ordenes_compra (proveedor_id, notas, usuario_id) VALUES ($1,$2,$3) RETURNING *',
        [proveedorId, notas || null, uid || null]);
    let total = 0;
    for (const it of items) {
        const p = await uno(c, 'SELECT * FROM productos WHERE id = $1', [it.productoId || it.producto_id]);
        if (!p) throw new ErrorNegocio(404, 'Producto no encontrado en la orden');
        const cant = Number(it.cantidad);
        if (!Number.isInteger(cant) || cant < 1) throw new ErrorNegocio(400, `Cantidad inválida para ${p.sku}`);
        const costo = it.costo != null && it.costo !== '' ? Number(it.costo) : Number(p.costo);
        total += cant * costo;
        await c.query('INSERT INTO orden_compra_items (orden_id, producto_id, cantidad, costo_unitario) VALUES ($1,$2,$3,$4)',
            [oc.id, p.id, cant, costo]);
    }
    total = redondear(total);
    await c.query('UPDATE ordenes_compra SET total = $1 WHERE id = $2', [total, oc.id]);
    return { ...oc, total };
}

const FLUJO_OC = { borrador: ['enviada', 'cancelada'], enviada: ['recibida', 'cancelada'], recibida: [], cancelada: [] };

async function cambiarEstadoOC(c, ocId, estado, { uid } = {}) {
    const oc = await uno(c, 'SELECT * FROM ordenes_compra WHERE id = $1 FOR UPDATE', [ocId]);
    if (!oc) throw new ErrorNegocio(404, 'Orden de compra no encontrada');
    if (!FLUJO_OC[oc.estado].includes(estado)) throw new ErrorNegocio(409, `No se puede pasar de "${oc.estado}" a "${estado}"`);
    if (estado === 'recibida') {
        const items = await todos(c, 'SELECT * FROM orden_compra_items WHERE orden_id = $1', [ocId]);
        for (const it of items) {
            await moverInventario(c, it.producto_id, 'entrada', it.cantidad, { motivo: 'Recepción de compra', referencia: oc.folio, uid });
            await c.query('UPDATE productos SET costo = $1 WHERE id = $2', [it.costo_unitario, it.producto_id]); // último costo
        }
        const prov = await uno(c, 'SELECT nombre FROM proveedores WHERE id = $1', [oc.proveedor_id]);
        await crearPoliza(c, {
            tipo: 'diario', concepto: `Recepción ${oc.folio} · ${prov.nombre}`, referencia: oc.folio, uid,
            movimientos: [{ codigo: '1150', cargo: oc.total }, { codigo: '2101', abono: oc.total }],
        });
        await c.query('UPDATE ordenes_compra SET estado = $1, fecha_recepcion = CURRENT_DATE WHERE id = $2', [estado, ocId]);
    } else {
        await c.query('UPDATE ordenes_compra SET estado = $1 WHERE id = $2', [estado, ocId]);
    }
    return { ...oc, estado };
}

async function pagarOrdenCompra(c, ocId, { uid } = {}) {
    const oc = await uno(c, 'SELECT * FROM ordenes_compra WHERE id = $1 FOR UPDATE', [ocId]);
    if (!oc) throw new ErrorNegocio(404, 'Orden de compra no encontrada');
    if (oc.estado !== 'recibida') throw new ErrorNegocio(409, 'Solo se pagan órdenes recibidas');
    if (oc.pagada) throw new ErrorNegocio(409, 'La orden ya está pagada');
    await c.query('UPDATE ordenes_compra SET pagada = TRUE, fecha_pago = CURRENT_DATE WHERE id = $1', [ocId]);
    await crearPoliza(c, {
        tipo: 'egreso', concepto: `Pago a proveedor ${oc.folio}`, referencia: oc.folio, uid,
        movimientos: [{ codigo: '2101', cargo: oc.total }, { codigo: '1102', abono: oc.total }],
    });
    return { ...oc, pagada: true };
}

/**
 * Máximos y mínimos: para cada producto en o bajo su mínimo, pide hasta el máximo.
 * Agrupa por proveedor (una OC en borrador por proveedor) y omite los que ya
 * están en una orden abierta.
 */
async function generarOCsPorMinimos(c, { productoIds, uid } = {}) {
    const params = [];
    let filtro = '';
    if (Array.isArray(productoIds) && productoIds.length) {
        params.push(productoIds.map(Number));
        filtro = 'AND p.id = ANY($1)';
    }
    const candidatos = await todos(c,
        `SELECT p.* FROM productos p
         WHERE p.activo AND p.proveedor_id IS NOT NULL AND p.maximo > 0 AND p.stock <= p.minimo ${filtro}
           AND NOT EXISTS (SELECT 1 FROM orden_compra_items i JOIN ordenes_compra o ON o.id = i.orden_id
                           WHERE i.producto_id = p.id AND o.estado IN ('borrador','enviada'))
         ORDER BY p.proveedor_id, p.sku`, params);
    const porProv = {};
    candidatos.forEach((p) => { (porProv[p.proveedor_id] = porProv[p.proveedor_id] || []).push(p); });
    const creadas = [];
    for (const provId of Object.keys(porProv)) {
        const items = porProv[provId].map((p) => ({ productoId: p.id, cantidad: p.maximo - p.stock, costo: p.costo }));
        creadas.push(await crearOrdenCompra(c, { proveedorId: Number(provId), items, notas: 'Generada automáticamente por máximos y mínimos', uid }));
    }
    return creadas;
}

// ---------------------------------------------------------------------
// RRHH · Nómina (póliza de egreso)
// ---------------------------------------------------------------------
async function generarNomina(c, { periodo, uid }) {
    if (!/^\d{4}-\d{2}$/.test(periodo || '')) throw new ErrorNegocio(400, 'Periodo inválido (usa AAAA-MM)');
    const ref = `NOM-${periodo}`;
    const ya = await uno(c, 'SELECT id FROM polizas WHERE referencia = $1', [ref]);
    if (ya) throw new ErrorNegocio(409, `La nómina de ${periodo} ya fue registrada`);
    const r = await uno(c, `SELECT COALESCE(SUM(salario_mensual),0) AS total, COUNT(*)::int AS n FROM empleados WHERE estado = 'activo'`);
    if (!(r.total > 0)) throw new ErrorNegocio(409, 'No hay empleados activos con salario');
    const p = await crearPoliza(c, {
        fecha: `${periodo}-28`, tipo: 'egreso', concepto: `Nómina ${periodo} (${r.n} empleados)`, referencia: ref, uid,
        movimientos: [{ codigo: '6101', cargo: r.total }, { codigo: '1102', abono: r.total }],
    });
    return { poliza: p, total: r.total, empleados: r.n };
}

module.exports = {
    IVA, TRANSICIONES, DIAS_PERIODO,
    crearPoliza, traspasar, moverInventario, saldoCliente, validarCredito,
    crearFactura, registrarPago, cancelarFactura,
    crearRenta, finalizarRenta, cancelarRenta, facturarRenta,
    venderEquipo, crearOrdenCompra, cambiarEstadoOC, pagarOrdenCompra, generarOCsPorMinimos,
    generarNomina,
    // Producción · órdenes de trabajo
    registrarLecturaHorometro,
    generarOTPreventiva, cerrarOTPreventiva,
    crearOTServicio, guardarEvaluacion, guardarCotizacionInterna, agregarRefaccionCotizacion,
    enviarCotizacionComercial, capturarCotizacionComercial, autorizarOT, rechazarOT,
    iniciarEjecucionOT, generarRequisicionOT, surtirRequisicion, cerrarOT, cancelarOT, facturarOT,
    crearManiobra, cambiarEstadoManiobra,
    crearOTRefaccion,
};
