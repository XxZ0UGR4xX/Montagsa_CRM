// Comercial · Cotizaciones: bandeja de órdenes de servicio de Producción por autorizar.
let cotizaciones = [];

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Cotizaciones', 'Órdenes de servicio de Producción listas para agregar margen, fijar el precio al cliente y autorizar.') +
        '<div class="panel" id="tabla"></div>';
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) detalle(b.dataset.id);
    });
    await cargar();
};

async function cargar() { cotizaciones = await api('/cotizaciones'); pintar(); }

function pintar() {
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay cotizaciones pendientes',
        columnas: [
            { t: 'Folio', r: (o) => `<strong>${esc(o.folio)}</strong>` },
            { t: 'Cliente', k: 'razon_social' },
            { t: 'Equipo', r: (o) => esc(o.numero_economico || o.equipo_cliente || '—') },
            { t: 'Costo interno', num: true, r: (o) => dinero(o.costo_interno) },
            { t: 'Precio cliente', num: true, r: (o) => (o.precio_cliente > 0 ? dinero(o.precio_cliente) : '—') },
            { t: 'Estado', r: (o) => tag(o.estado) },
            { t: '', clase: 'acciones', r: (o) => `<button class="btn btn-chico" type="button" data-id="${o.id}">Abrir</button>` },
        ],
        filas: cotizaciones,
    });
}

function redondear2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

async function detalle(id) {
    const o = await api(`/ot/${id}`);
    const pendiente = o.estado === 'cotizacion_comercial';
    const m = modal({
        titulo: `Cotización ${o.folio}`, ancho: 780,
        cuerpo: `
            <dl class="datos" style="margin-bottom:16px">
                <dt>Estado</dt><dd>${tag(o.estado)}</dd>
                <dt>Cliente</dt><dd>${esc(o.razon_social)}</dd>
                <dt>Equipo</dt><dd>${esc(o.numero_economico || o.equipo_cliente || '—')}</dd>
                <dt>Diagnóstico</dt><dd>${esc(o.diagnostico || '—')}</dd>
                <dt>Costo interno</dt><dd>${dinero(o.costo_interno)} (mano de obra ${dinero(o.costo_mano_obra)} + refacciones ${dinero(o.costo_refacciones)})</dd>
            </dl>
            <h4 style="margin-bottom:8px">Refacciones cotizadas</h4>
            ${tabla({ vacio: 'Sin refacciones', filas: o.refacciones, columnas: [
                { t: 'SKU', k: 'sku' }, { t: 'Refacción', k: 'nombre' }, { t: 'Cant.', num: true, k: 'cantidad' },
                { t: 'Costo', num: true, r: (r) => dinero(r.costo_unitario) } ] })}
            ${pendiente ? `
            <div class="form" style="margin-top:16px">
                <div class="campo"><label for="c-margen">Margen</label><input id="c-margen" type="number" step="0.01" min="0" value="${o.margen || redondear2(o.costo_interno * 0.3)}"></div>
                <div class="campo"><label for="c-precio">Precio al cliente</label><input id="c-precio" type="number" step="0.01" min="0" value="${o.precio_cliente || redondear2(o.costo_interno * 1.3)}"></div>
                <div class="campo ancho" style="align-items:flex-start"><button class="btn" type="button" id="c-guardar">Guardar margen y precio</button></div>
            </div>
            <p class="tenue" style="margin:14px 0 8px">Para autorizar, primero guarda el margen y precio.</p>
            <div class="form">
                <div class="campo ancho"><label for="c-autoriza">Quién autorizó (lado del cliente)</label><input id="c-autoriza" placeholder="Nombre de quien autoriza"></div>
                <div class="campo"><label for="c-fecha">Fecha</label><input id="c-fecha" type="date" value="${hoy()}"></div>
            </div>` : `
            <div class="aviso-caja" style="margin-top:16px">Margen: <strong>${dinero(o.margen)}</strong> · Precio al cliente: <strong>${dinero(o.precio_cliente)}</strong>
            ${o.autorizado_por ? ` · Autorizó: <strong>${esc(o.autorizado_por)}</strong> (${fecha(o.fecha_autorizacion)})` : ''}</div>`}`,
        acciones: [
            { texto: 'Cerrar' },
            ...(pendiente ? [
                { texto: 'Rechazar', clase: 'btn-peligro', onClick: async () => {
                    if (!(await confirmar(`¿Rechazar la cotización ${o.folio}?`, 'Rechazar'))) return false;
                    await api(`/servicios/${o.id}/rechazar`, { method: 'POST', body: { motivo: 'Rechazada por el cliente' } });
                    aviso('Cotización rechazada', 'ok'); await cargar();
                } },
                { texto: 'Autorizar', clase: 'btn-primario', onClick: async (el) => {
                    const autorizado_por = el.querySelector('#c-autoriza').value.trim();
                    if (!autorizado_por) throw new Error('Indica quién autorizó del lado del cliente');
                    await api(`/servicios/${o.id}/autorizar`, { method: 'POST', body: { autorizado_por, fecha: el.querySelector('#c-fecha').value } });
                    aviso(`Orden ${o.folio} autorizada`, 'ok'); await cargar();
                } },
            ] : []),
        ],
    });
    const g = m.el.querySelector('#c-guardar');
    if (g) g.onclick = async () => {
        try {
            await api(`/servicios/${o.id}/cotizacion-comercial`, { method: 'POST', body: {
                margen: Number(m.el.querySelector('#c-margen').value) || 0,
                precio_cliente: Number(m.el.querySelector('#c-precio').value) || 0,
            } });
            aviso('Margen y precio guardados', 'ok'); m.cerrar(); await cargar(); detalle(o.id);
        } catch (e) { avisoError(e); }
    };
}
