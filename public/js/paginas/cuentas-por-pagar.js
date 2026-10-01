// Contabilidad · Cuentas por pagar: órdenes de compra recibidas sin pagar, por antigüedad.
let datos = null;

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Cuentas por pagar', 'Órdenes de compra recibidas y sin pagar, por proveedor y antigüedad (vencimiento = recepción + días de crédito del proveedor).',
        '<button class="btn" type="button" id="btn-csv">Exportar CSV</button>') + '<div id="kpis"></div><div class="panel" id="panel"></div>';
    document.getElementById('btn-csv').onclick = () => exportarCSV('cuentas-por-pagar', [
        { t: 'Folio', k: 'folio' }, { t: 'Proveedor', k: 'proveedor' }, { t: 'Recepción', k: 'fecha_recepcion' },
        { t: 'Vencimiento', k: 'fecha_vencimiento' }, { t: 'Días vencida', k: 'dias_vencida' }, { t: 'Total', k: 'total' }], datos.ordenes);
    document.getElementById('panel').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) pagar(datos.ordenes.find((o) => String(o.id) === b.dataset.id));
    });
    await cargar();
};

async function cargar() {
    datos = await api('/cuentas-por-pagar');
    const a = datos.antiguedad;
    document.getElementById('kpis').innerHTML = `<div class="kpis">
        ${kpi('Por pagar total', pesos(datos.total))}
        ${kpi('Por vencer', pesos(a.por_vencer), '', 'bien')}
        ${kpi('1 a 30 días', pesos(a.d1_30), '', a.d1_30 ? 'aviso' : '')}
        ${kpi('31 a 60 días', pesos(a.d31_60), '', a.d31_60 ? 'aviso' : '')}
        ${kpi('61 a 90 días', pesos(a.d61_90), '', a.d61_90 ? 'alerta' : '')}
        ${kpi('Más de 90 días', pesos(a.d90_mas), '', a.d90_mas ? 'alerta' : '')}
    </div>`;
    pintar();
}

function pintar() {
    document.getElementById('panel').innerHTML = tabla({
        vacio: 'No hay órdenes por pagar. Todo pagado.',
        filas: datos.ordenes,
        columnas: [
            { t: 'Orden', r: (o) => `<strong>${esc(o.folio)}</strong><div class="sub">${fecha(o.fecha)}</div>` },
            { t: 'Proveedor', r: (o) => `${esc(o.proveedor)}<div class="sub">${esc(o.contacto || '')} ${esc(o.telefono || '')}</div>` },
            { t: 'Recepción', r: (o) => fecha(o.fecha_recepcion) },
            { t: 'Vence', r: (o) => `${fecha(o.fecha_vencimiento)}<div class="sub" style="color:${o.dias_vencida > 0 ? 'var(--rojo)' : 'inherit'}">${o.dias_vencida > 0 ? `${o.dias_vencida} días vencida` : o.dias_vencida === 0 ? 'Vence hoy' : `Faltan ${-o.dias_vencida} días`}</div>` },
            { t: 'Total', num: true, r: (o) => `<strong>${dinero(o.total)}</strong>` },
            { t: '', clase: 'acciones', r: (o) => `<button class="btn btn-chico btn-primario" type="button" data-id="${o.id}">Pagar</button>` },
        ],
    });
}

async function pagar(oc) {
    const cat = await catalogos();
    const cuentas = cat.cuentas_bancarias || [];
    const campos = cuentas.length ? [{ k: 'cuenta_bancaria_id', etiqueta: 'Cuenta bancaria', tipo: 'select', vacio: 'Bancos (general)', opciones: opciones(cuentas, 'id', (c) => `${c.banco} ${c.numero_enmascarado}`) }] : [];
    modal({
        titulo: `Pagar ${oc.folio}`,
        cuerpo: `<p style="margin-bottom:14px">${esc(oc.proveedor)} · total <strong>${dinero(oc.total)}</strong></p>${formulario(campos)}`,
        acciones: [{ texto: 'Cancelar' }, { texto: 'Pagar', clase: 'btn-primario', onClick: async (m) => {
            await api(`/compras/${oc.id}/pagar`, { method: 'POST', body: leerFormulario(m, campos) });
            aviso('Pago a proveedor registrado', 'ok');
            await cargar();
        } }],
    });
}
