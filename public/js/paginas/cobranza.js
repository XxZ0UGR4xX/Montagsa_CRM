// Administración · Cobranza: cartera por antigüedad y registro de pagos.
let datos = null;

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Cobranza', 'Facturas con saldo, ordenadas por vencimiento, y pagos recibidos.',
        '<button class="btn" type="button" id="btn-csv">Exportar cartera</button>') + `
        <div id="kpis"></div>
        <div class="pestanas" style="margin-top:18px" role="tablist">
            <button type="button" class="activa" data-p="cartera">Cartera</button>
            <button type="button" data-p="pagos">Pagos recibidos</button>
        </div>
        <div class="panel" id="panel"></div>`;
    let pest = 'cartera';
    cont.querySelectorAll('.pestanas button').forEach((b) => {
        b.onclick = () => { pest = b.dataset.p; cont.querySelectorAll('.pestanas button').forEach((x) => x.classList.toggle('activa', x === b)); pintar(pest); };
    });
    document.getElementById('btn-csv').onclick = () => exportarCSV('cartera', [
        { t: 'Folio', k: 'folio' }, { t: 'Cliente', k: 'razon_social' }, { t: 'Contacto', k: 'contacto' }, { t: 'Teléfono', k: 'telefono' },
        { t: 'Vencimiento', k: 'fecha_vencimiento' }, { t: 'Días vencida', k: 'dias_vencida' }, { t: 'Total', k: 'total' }, { t: 'Saldo', k: 'saldo' }], datos.facturas);
    document.getElementById('panel').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) dialogoPago(datos.facturas.find((f) => String(f.id) === b.dataset.id), async () => { await cargar(); pintar(pest); }).catch(avisoError);
    });
    await cargar();
    pintar('cartera');
};

async function cargar() {
    datos = await api('/cobranza');
    const a = datos.antiguedad;
    document.getElementById('kpis').innerHTML = `<div class="kpis">
        ${kpi('Cartera total', pesos(datos.total))}
        ${kpi('Por vencer', pesos(a.por_vencer), '', 'bien')}
        ${kpi('1 a 30 días', pesos(a.d1_30), '', a.d1_30 ? 'aviso' : '')}
        ${kpi('31 a 60 días', pesos(a.d31_60), '', a.d31_60 ? 'aviso' : '')}
        ${kpi('61 a 90 días', pesos(a.d61_90), '', a.d61_90 ? 'alerta' : '')}
        ${kpi('Más de 90 días', pesos(a.d90_mas), '', a.d90_mas ? 'alerta' : '')}
        ${kpi('Cobrado este mes', pesos(datos.cobrado_mes))}
    </div>`;
}

async function pintar(pest) {
    const panel = document.getElementById('panel');
    if (pest === 'pagos') {
        const pagos = await api('/pagos');
        panel.innerHTML = tabla({
            vacio: 'Sin pagos', filas: pagos,
            columnas: [
                { t: 'Fecha', r: (p) => fecha(p.fecha) }, { t: 'Factura', r: (p) => `<strong>${esc(p.folio)}</strong>` }, { t: 'Cliente', k: 'razon_social' },
                { t: 'Método', k: 'metodo' }, { t: 'Referencia', k: 'referencia' }, { t: 'Monto', num: true, r: (p) => dinero(p.monto) },
                { t: 'Registró', r: (p) => `<span class="tenue">${esc(p.usuario || '—')}</span>` }],
        });
        return;
    }
    panel.innerHTML = tabla({
        vacio: 'No hay saldos pendientes. Todo cobrado.',
        filas: datos.facturas,
        columnas: [
            { t: 'Factura', r: (f) => `<strong>${esc(f.folio)}</strong><div class="sub">${fecha(f.fecha)}</div>` },
            { t: 'Cliente', r: (f) => `${esc(f.razon_social)}<div class="sub">${esc(f.contacto || '')} ${esc(f.telefono || '')}</div>` },
            { t: 'Vence', r: (f) => `${fecha(f.fecha_vencimiento)}<div class="sub" style="color:${f.dias_vencida > 0 ? 'var(--rojo)' : 'inherit'}">${f.dias_vencida > 0 ? `${f.dias_vencida} días vencida` : f.dias_vencida === 0 ? 'Vence hoy' : `Faltan ${-f.dias_vencida} días`}</div>` },
            { t: 'Total', num: true, r: (f) => dinero(f.total) },
            { t: 'Pagado', num: true, r: (f) => dinero(f.pagado) },
            { t: 'Saldo', num: true, r: (f) => `<strong>${dinero(f.saldo)}</strong>` },
            { t: 'Estado', r: (f) => tag(f.estado) },
            { t: '', clase: 'acciones', r: (f) => `<button class="btn btn-chico btn-primario" type="button" data-id="${f.id}">Registrar pago</button>` },
        ],
    });
}
