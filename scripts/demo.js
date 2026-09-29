// scripts/demo.js — Carga movimientos de ejemplo usando las mismas reglas de negocio
// que la aplicación (así las pólizas, traspasos e inventario quedan consistentes).
//   npm run demo
// Ejecútalo justo después de cargar db/database.sql.
const { pool, tx, uno } = require('../lib/db');
const N = require('../lib/negocio');

const dias = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
};

async function main() {
    const ya = await uno(pool, 'SELECT COUNT(*)::int AS n FROM rentas');
    if (ya.n > 0) {
        console.log('Ya hay movimientos cargados. Para reiniciar: vuelve a ejecutar db/database.sql y luego npm run demo');
        return;
    }
    const uid = (await uno(pool, `SELECT id FROM usuarios WHERE rol = 'admin' LIMIT 1`)).id;
    const cli = async (rfc) => (await uno(pool, 'SELECT id FROM clientes WHERE rfc = $1', [rfc])).id;
    const eq = async (num) => (await uno(pool, 'SELECT id FROM equipos WHERE numero_economico = $1', [num])).id;
    const prod = async (sku) => (await uno(pool, 'SELECT id FROM productos WHERE sku = $1', [sku])).id;
    const tec = async (nombre) => (await uno(pool, 'SELECT id FROM empleados WHERE nombre = $1', [nombre])).id;
    const prov = async (nombre) => (await uno(pool, 'SELECT id FROM proveedores WHERE nombre = $1', [nombre])).id;

    await tx(async (c) => {
        // --- Rentas ---------------------------------------------------------
        // Logística del Bajío: renta mensual facturada y pagada, luego renovada
        const r1 = await N.crearRenta(c, { clienteId: await cli('LBA150312AB1'), equipoId: await eq('MG-001'), periodo: 'mensual', fechaInicio: dias(-40), uid });
        const f1 = await N.facturarRenta(c, r1.id, { uid, fecha: dias(-40) });
        await N.registrarPago(c, f1.id, { monto: f1.total, metodo: 'transferencia', referencia: 'SPEI 88120', fecha: dias(-12), uid });
        await N.finalizarRenta(c, r1.id, { horometroRegreso: 8295.0, fecha: dias(-10), uid });
        const r1b = await N.crearRenta(c, { clienteId: await cli('LBA150312AB1'), equipoId: await eq('MG-001'), periodo: 'mensual', fechaInicio: dias(-10), uid });
        await N.facturarRenta(c, r1b.id, { uid, fecha: dias(-10) });

        // Segundo equipo con Logística del Bajío, con abono parcial
        const r2 = await N.crearRenta(c, { clienteId: await cli('LBA150312AB1'), equipoId: await eq('MG-012'), periodo: 'mensual', fechaInicio: dias(-25), uid });
        const f2 = await N.facturarRenta(c, r2.id, { uid, fecha: dias(-25) });
        await N.registrarPago(c, f2.id, { monto: 15000, metodo: 'transferencia', referencia: 'SPEI 88301 (abono)', fecha: dias(-5), uid });

        // Autopartes: renta semanal que vence pronto; factura vencida sin pago
        const r3 = await N.crearRenta(c, { clienteId: await cli('AHI090807CD2'), equipoId: await eq('MG-004'), periodo: 'semanal', cantidadPeriodos: 3, fechaInicio: dias(-18), uid });
        await N.facturarRenta(c, r3.id, { uid, fecha: dias(-50) });

        // La Perla: renta diaria sin facturar todavía
        await N.crearRenta(c, { clienteId: await cli('DLP120110EF3'), equipoId: await eq('MG-007'), periodo: 'diaria', cantidadPeriodos: 5, fechaInicio: dias(-2), uid });

        // Renta que regresó con falla -> reparación + orden de servicio interna automática
        const r4 = await N.crearRenta(c, { clienteId: await cli('AHI090807CD2'), equipoId: await eq('MG-006'), periodo: 'semanal', fechaInicio: dias(-9), uid });
        const f4 = await N.facturarRenta(c, r4.id, { uid, fecha: dias(-9) });
        await N.registrarPago(c, f4.id, { monto: f4.total, metodo: 'cheque', referencia: 'CH 004512', fecha: dias(-3), uid });
        const fin = await N.finalizarRenta(c, r4.id, { horometroRegreso: 12931.4, destino: 'reparacion', notas: 'Fuga en cilindro de inclinación', fecha: dias(-2), uid });
        await c.query('UPDATE servicios SET tecnico_id = $1 WHERE id = $2', [await tec('Héctor Villalobos'), fin.servicio.id]);
        await N.cambiarEstadoServicio(c, fin.servicio.id, 'en_proceso', { uid });
        await N.agregarRefaccion(c, fin.servicio.id, { productoId: await prod('CON-ACE-012'), cantidad: 1, uid });

        // --- Servicios a clientes ------------------------------------------
        const s1 = await N.crearServicio(c, {
            clienteId: await cli('FCE110304IJ5'), equipoCliente: 'Montacargas eléctrico Crown RC5500 (propiedad del cliente)',
            tipo: 'preventivo', descripcion: 'Mantenimiento preventivo de 500 horas', tecnicoId: await tec('Iván Esparza'), manoObra: 2800, uid });
        await N.cambiarEstadoServicio(c, s1.id, 'en_proceso', { uid });
        await N.agregarRefaccion(c, s1.id, { productoId: await prod('REF-FIL-HI03'), cantidad: 1, uid });
        await N.agregarRefaccion(c, s1.id, { productoId: await prod('CON-GRA-014'), cantidad: 2, uid });
        await N.cambiarEstadoServicio(c, s1.id, 'terminada', { uid });
        // Frigoríficos tiene el crédito suspendido: el admin autoriza la factura
        await N.facturarServicio(c, s1.id, { uid, forzar: true, fecha: dias(-35) });

        await N.crearServicio(c, {
            clienteId: await cli('TSM180522GH4'), equipoCliente: 'Patín hidráulico Uline (cliente)', tipo: 'diagnostico',
            descripcion: 'No levanta carga; revisar bomba', tecnicoId: await tec('Héctor Villalobos'), manoObra: 650, fechaProgramada: dias(1), uid });

        // Preventivo a flota propia (MG-003 pasa a reparación mientras dura)
        await N.crearServicio(c, { equipoId: await eq('MG-003'), tipo: 'preventivo', descripcion: 'Preventivo 10,500 h: cambio de aceite y filtros',
            tecnicoId: await tec('Iván Esparza'), uid });

        // --- Traspasos y venta ---------------------------------------------
        await N.traspasar(c, await eq('MG-009'), 'venta', { motivo: 'Se pone a la venta por renovación de patines', referencia: 'MANUAL', uid });
        const fv = await N.venderEquipo(c, await eq('MG-011'), { clienteId: await cli('CAL160918KL6'), precio: 240000, uid, forzar: true });
        await N.registrarPago(c, fv.id, { monto: 140000, metodo: 'transferencia', referencia: 'Anticipo venta MG-011', uid });

        // --- Compras -------------------------------------------------------
        const oc = await N.crearOrdenCompra(c, { proveedorId: await prov('Lubricantes del Bajío'), items: [
            { productoId: await prod('CON-ACE-013'), cantidad: 12 }, { productoId: await prod('CON-GAS-015'), cantidad: 8 }], uid });
        await N.cambiarEstadoOC(c, oc.id, 'enviada', { uid });
        await N.cambiarEstadoOC(c, oc.id, 'recibida', { uid });
        await N.pagarOrdenCompra(c, oc.id, { uid });
        await N.generarOCsPorMinimos(c, { uid });

        // --- RRHH: nómina del mes pasado -----------------------------------
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - 1);
        await N.generarNomina(c, { periodo: d.toISOString().slice(0, 7), uid });

        // --- Gasto manual --------------------------------------------------
        await N.crearPoliza(c, { tipo: 'egreso', concepto: 'Pago de luz y agua de la nave', referencia: 'CFE-0925', automatica: false, uid,
            movimientos: [{ codigo: '6102', cargo: 8450 }, { codigo: '1102', abono: 8450 }] });

        // --- CRM -----------------------------------------------------------
        const inter = [
            ['TSM180522GH4', 'visita', 'Visita a planta: necesitan 2 montacargas para temporada alta (nov-dic).'],
            ['TSM180522GH4', 'cotizacion', 'Se envió cotización de renta mensual de 2 equipos gas LP de 2.5 t.'],
            ['LBA150312AB1', 'llamada', 'Confirmó renovación de MG-001 por otro mes.'],
            ['FCE110304IJ5', 'correo', 'Se les recordó el saldo vencido; prometen pago la próxima semana.'],
            ['CAL160918KL6', 'whatsapp', 'Interesados en comprar un segundo equipo usado.'],
        ];
        for (const [rfc, tipo, desc] of inter) {
            await c.query('INSERT INTO interacciones (cliente_id, usuario_id, tipo, descripcion) VALUES ($1,$2,$3,$4)',
                [await cli(rfc), uid, tipo, desc]);
        }
    });
    console.log('Movimientos de ejemplo cargados: rentas, servicios, facturas, pagos, compras, nómina e interacciones.');
}

main()
    .catch((e) => { console.error('Error al cargar la demo:', e.message); process.exitCode = 1; })
    .finally(() => pool.end());
