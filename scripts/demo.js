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
        // --- Bancos: dos cuentas bancarias (subcuentas de "Bancos") ---------
        const bbva = await N.crearCuentaBancaria(c, { banco: 'BBVA', numeroEnmascarado: '**** 4821', saldoInicial: 500000, uid });
        const santander = await N.crearCuentaBancaria(c, { banco: 'Santander', numeroEnmascarado: '**** 1190', saldoInicial: 350000, uid });

        // --- Rentas ---------------------------------------------------------
        // Logística del Bajío: renta mensual facturada y pagada, luego renovada
        const r1 = await N.crearRenta(c, { clienteId: await cli('LBA150312AB1'), equipoId: await eq('MG-001'), periodo: 'mensual', fechaInicio: dias(-40), uid });
        const f1 = await N.facturarRenta(c, r1.id, { uid, fecha: dias(-40) });
        await N.registrarPago(c, f1.id, { monto: f1.total, metodo: 'transferencia', referencia: 'SPEI 88120', fecha: dias(-12), uid, cuentaBancariaId: bbva.id });
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
        await c.query('UPDATE ordenes_trabajo SET tecnico_id = $1 WHERE id = $2', [await tec('Héctor Villalobos'), fin.ot.id]);
        await N.guardarEvaluacion(c, fin.ot.id, { diagnostico: 'Fuga confirmada en el cilindro de inclinación', uid });

        // --- Producción: rondas de horómetro (equipos en renta) ------------
        await N.registrarLecturaHorometro(c, await eq('MG-001'), { lectura: 8295.0, uid });
        await N.registrarLecturaHorometro(c, await eq('MG-012'), { lectura: 7040.0, uid });

        // --- Producción: preventivos ----------------------------------------
        // MG-005: se le hace un preventivo y luego avanza el horómetro -> queda "próximo"
        const otPrev = await N.generarOTPreventiva(c, await eq('MG-005'), { tecnicoId: await tec('Héctor Villalobos'), uid });
        await N.cerrarOTPreventiva(c, otPrev.id, { horometro: 2150.0, uid });
        await N.registrarLecturaHorometro(c, await eq('MG-005'), { lectura: 2385.0, uid });
        // MG-003 nunca ha tenido preventivo: con 10,450 h queda "vencido" tal cual

        // --- Producción: servicios en cada etapa del flujo ------------------
        // Evaluación
        await N.crearOTServicio(c, {
            clienteId: await cli('TSM180522GH4'), equipoCliente: 'Patín hidráulico Uline (cliente)',
            descripcion: 'No levanta carga; revisar bomba', tecnicoId: await tec('Héctor Villalobos'), uid });

        // Requiere cotización
        const otB = await N.crearOTServicio(c, {
            clienteId: await cli('DLP120110EF3'), equipoCliente: 'Montacargas Clark GPS25 (cliente)',
            descripcion: 'Fuga de aceite hidráulico en el mástil', tecnicoId: await tec('Iván Esparza'), uid });
        await N.guardarEvaluacion(c, otB.id, { diagnostico: 'Sello de mástil dañado; requiere refacción y mano de obra', uid });

        // Cotización interna
        const otC = await N.crearOTServicio(c, {
            clienteId: await cli('AHI090807CD2'), equipoCliente: 'Montacargas Nissan (cliente)',
            descripcion: 'Ruido en la transmisión', tecnicoId: await tec('Héctor Villalobos'), uid });
        await N.guardarEvaluacion(c, otC.id, { diagnostico: 'Rodamiento de transmisión desgastado', uid });
        await N.guardarCotizacionInterna(c, otC.id, { horas: 3, costoHora: 180, uid });
        await N.agregarRefaccionCotizacion(c, otC.id, { productoId: await prod('REF-RUL-011'), cantidad: 1, uid });

        // Cotización comercial (esperando el precio y la autorización de Comercial)
        const otD = await N.crearOTServicio(c, {
            clienteId: await cli('CAL160918KL6'), equipoCliente: 'Plataforma elevadora Genie GS-1930 (cliente)',
            descripcion: 'Falla en el sistema hidráulico de elevación', tecnicoId: await tec('Iván Esparza'), uid });
        await N.guardarEvaluacion(c, otD.id, { diagnostico: 'Bomba hidráulica requiere reemplazo de sellos', uid });
        await N.guardarCotizacionInterna(c, otD.id, { horas: 4, costoHora: 180, uid });
        await N.agregarRefaccionCotizacion(c, otD.id, { productoId: await prod('CON-ACE-012'), cantidad: 1, uid });
        await N.enviarCotizacionComercial(c, otD.id, { uid });

        // Autorizada (Frigoríficos tiene el crédito suspendido, pero autorizar no revisa crédito: eso es al facturar)
        const otE = await N.crearOTServicio(c, {
            clienteId: await cli('FCE110304IJ5'), equipoCliente: 'Montacargas eléctrico Crown RC5500 (cliente)',
            descripcion: 'Mantenimiento correctivo de frenos', tecnicoId: await tec('Iván Esparza'), uid });
        await N.guardarEvaluacion(c, otE.id, { diagnostico: 'Balatas y disco de freno desgastados', uid });
        await N.guardarCotizacionInterna(c, otE.id, { horas: 2, costoHora: 180, uid });
        await N.agregarRefaccionCotizacion(c, otE.id, { productoId: await prod('REF-FIL-HI03'), cantidad: 1, uid });
        await N.enviarCotizacionComercial(c, otE.id, { uid });
        await N.capturarCotizacionComercial(c, otE.id, { margen: 500, precioCliente: 1800, uid });
        await N.autorizarOT(c, otE.id, { autorizadoPor: 'Ing. Luis Medina', fecha: dias(-1), uid });

        // En ejecución (equipo propio MG-002 pasa a reparación; requisición pendiente de surtir)
        const otF = await N.crearOTServicio(c, {
            clienteId: await cli('LBA150312AB1'), equipoId: await eq('MG-002'),
            descripcion: 'Servicio correctivo: falla en el sistema de dirección', tecnicoId: await tec('Héctor Villalobos'), uid });
        await N.guardarEvaluacion(c, otF.id, { diagnostico: 'Bomba de dirección hidráulica dañada', uid });
        await N.guardarCotizacionInterna(c, otF.id, { horas: 3, costoHora: 180, uid });
        await N.agregarRefaccionCotizacion(c, otF.id, { productoId: await prod('CON-ACE-012'), cantidad: 1, uid });
        await N.enviarCotizacionComercial(c, otF.id, { uid });
        await N.capturarCotizacionComercial(c, otF.id, { margen: 600, precioCliente: 2200, uid });
        await N.autorizarOT(c, otF.id, { autorizadoPor: 'Ing. Marco Ruiz', fecha: dias(-1), uid });
        await N.iniciarEjecucionOT(c, otF.id, { uid });

        // Cerrada y facturada: ciclo completo de evaluación a facturada
        const otG = await N.crearOTServicio(c, {
            clienteId: await cli('DLP120110EF3'), equipoId: await eq('MG-005'),
            descripcion: 'Servicio correctivo: ruido en el motor', tecnicoId: await tec('Iván Esparza'), uid });
        await N.guardarEvaluacion(c, otG.id, { diagnostico: 'Banda de alternador floja', uid });
        await N.guardarCotizacionInterna(c, otG.id, { horas: 1, costoHora: 180, uid });
        await N.agregarRefaccionCotizacion(c, otG.id, { productoId: await prod('REF-BAN-005'), cantidad: 1, uid });
        await N.enviarCotizacionComercial(c, otG.id, { uid });
        await N.capturarCotizacionComercial(c, otG.id, { margen: 300, precioCliente: 900, uid });
        await N.autorizarOT(c, otG.id, { autorizadoPor: 'Sr. Tomás Gallegos', fecha: dias(-2), uid });
        await N.iniciarEjecucionOT(c, otG.id, { uid });
        const rqG = await uno(c, `SELECT id FROM requisiciones WHERE ot_id = $1`, [otG.id]);
        await N.surtirRequisicion(c, rqG.id, { uid });
        await N.cerrarOT(c, otG.id, { uid });
        await N.facturarOT(c, otG.id, { uid, fecha: dias(-1) });

        // --- Producción: maniobra (ciclo completo hasta facturada) ----------
        const otM = await N.crearManiobra(c, {
            clienteId: await cli('CAL160918KL6'), equipoCliente: 'Grúa telescópica (cliente)',
            origen: 'Patio Montagsa', destino: 'Obra Altavista, Blvd. Siglo XXI', fechaProgramada: dias(-3),
            operadorId: await tec('Miguel Ángel Lara'), unidadTransporte: 'Plataforma Kenworth T370', costoInterno: 1800, precioCliente: 3200, uid });
        await N.cambiarEstadoManiobra(c, otM.id, 'en_ruta', { uid });
        await N.cambiarEstadoManiobra(c, otM.id, 'entregada', { uid });
        await N.cambiarEstadoManiobra(c, otM.id, 'cerrada', { uid });
        await N.facturarOT(c, otM.id, { uid, fecha: dias(-2) });

        // --- Producción: venta de refacciones (ciclo completo) --------------
        const otR = await N.crearOTRefaccion(c, {
            clienteId: await cli('LBA150312AB1'),
            items: [{ productoId: await prod('REF-BUJ-004'), cantidad: 4 }, { productoId: await prod('CON-ACE-013'), cantidad: 2 }], uid });
        const rqR = await uno(c, `SELECT id FROM requisiciones WHERE ot_id = $1`, [otR.id]);
        await N.surtirRequisicion(c, rqR.id, { uid });
        await N.cerrarOT(c, otR.id, { uid });
        await N.facturarOT(c, otR.id, { uid, fecha: dias(-1) });

        // --- Traspasos y venta ---------------------------------------------
        await N.traspasar(c, await eq('MG-009'), 'venta', { motivo: 'Se pone a la venta por renovación de patines', referencia: 'MANUAL', uid });
        const fv = await N.venderEquipo(c, await eq('MG-011'), { clienteId: await cli('CAL160918KL6'), precio: 240000, uid, forzar: true });
        await N.registrarPago(c, fv.id, { monto: 140000, metodo: 'transferencia', referencia: 'Anticipo venta MG-011', uid });

        // --- Compras -------------------------------------------------------
        const oc = await N.crearOrdenCompra(c, { proveedorId: await prov('Lubricantes del Bajío'), items: [
            { productoId: await prod('CON-ACE-013'), cantidad: 12 }, { productoId: await prod('CON-GAS-015'), cantidad: 8 }], uid });
        await N.cambiarEstadoOC(c, oc.id, 'enviada', { uid });
        await N.cambiarEstadoOC(c, oc.id, 'recibida', { uid });
        await N.pagarOrdenCompra(c, oc.id, { uid, cuentaBancariaId: bbva.id });
        await N.generarOCsPorMinimos(c, { uid });

        // Dos OC recibidas y sin pagar, para que Cuentas por pagar tenga saldo en
        // cubos de antigüedad distintos (vencimiento = recepción + proveedores.dias_credito).
        const porPagar = [
            // Refacciones del Norte: 30 días de crédito, recibida hace 10 → aún por vencer.
            { proveedor: 'Refacciones Industriales del Norte', recibidaHace: 10, items: [['REF-FIL-AC01', 20], ['REF-FIL-AI02', 15]] },
            // Baterías: 15 días de crédito, recibida hace 50 → vencida (cubo 31-60 días).
            { proveedor: 'Baterías y Energía Tracción', recibidaHace: 50, items: [['REF-CAR-009', 2]] },
        ];
        for (const p of porPagar) {
            const items = [];
            for (const [sku, cantidad] of p.items) items.push({ productoId: await prod(sku), cantidad });
            const ocp = await N.crearOrdenCompra(c, { proveedorId: await prov(p.proveedor), items, uid });
            await N.cambiarEstadoOC(c, ocp.id, 'enviada', { uid });
            await N.cambiarEstadoOC(c, ocp.id, 'recibida', { uid });
            await c.query('UPDATE ordenes_compra SET fecha_recepcion = $1 WHERE id = $2', [dias(-p.recibidaHace), ocp.id]);
        }

        // --- RRHH: nómina del mes pasado ------------------------------------
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - 1);
        const periodoPasado = d.toISOString().slice(0, 7);
        await N.generarNomina(c, { periodo: periodoPasado, uid, cuentaBancariaId: santander.id });

        // --- Contabilidad: depreciación del mes pasado y cierre de ese mes --
        await N.calcularDepreciacionMes(c, { periodo: periodoPasado, uid });
        await N.cerrarPeriodo(c, { anio: d.getFullYear(), mes: d.getMonth() + 1, uid });

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
