// Producción · Órdenes de trabajo. El flujo completo (evaluación -> cotización interna
// -> cotización comercial -> autorización -> ejecución -> cierre -> facturación) se
// gestiona aquí para 'servicio'; maniobras, refacciones, rondas y preventivos tienen
// su propia pantalla con las acciones específicas de cada una.
const TIPOS = [['servicio', 'Servicios'], ['maniobra', 'Maniobras'], ['refaccion', 'Refacciones'], ['ronda', 'Rondas'], ['preventivo', 'Preventivos']];
const ESTADOS_SERVICIO = [
    ['', 'Todos'], ['evaluacion', 'Evaluación'], ['requiere_cotizacion', 'Por cotizar'], ['cotizacion_interna', 'Cotización interna'],
    ['cotizacion_comercial', 'En Comercial'], ['autorizada', 'Autorizadas'], ['en_ejecucion', 'En ejecución'],
    ['cerrada', 'Cerradas'], ['facturada', 'Facturadas'], ['rechazada', 'Rechazadas'], ['cancelada', 'Canceladas'],
];
const TIPO_TXT = { servicio: 'Servicios', maniobra: 'Maniobras', refaccion: 'Refacciones', ronda: 'Rondas', preventivo: 'Preventivos' };
let ordenes = [];
let tipo = 'servicio';
let estado = '';

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Órdenes de trabajo', 'Servicios, maniobras, refacciones, rondas y preventivos: todas las órdenes de Producción.',
        '<button class="btn btn-primario" type="button" id="btn-nueva">Nuevo servicio</button>') + `
        <div class="pestanas" role="tablist" id="pest-tipo">${TIPOS.map(([v, t]) => `<button type="button" data-t="${v}" class="${v === tipo ? 'activa' : ''}">${t}</button>`).join('')}</div>
        <div class="pestanas" role="tablist" id="pest-estado"></div>
        <div class="panel" id="tabla"></div>`;
    document.getElementById('btn-nueva').onclick = nueva;
    cont.querySelector('#pest-tipo').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        tipo = b.dataset.t; estado = '';
        cont.querySelectorAll('#pest-tipo button').forEach((x) => x.classList.toggle('activa', x === b));
        document.getElementById('btn-nueva').style.display = tipo === 'servicio' ? '' : 'none';
        cargar();
    });
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) detalle(b.dataset.id);
    });
    await cargar();
    const id = idDeUrl();
    if (id) await detalle(id);
};

function pintarPestanasEstado() {
    const el = document.getElementById('pest-estado');
    if (tipo !== 'servicio') { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML = ESTADOS_SERVICIO.map(([v, t]) => `<button type="button" data-e="${v}" class="${v === estado ? 'activa' : ''}">${t}</button>`).join('');
    el.querySelectorAll('button').forEach((b) => {
        b.onclick = () => { estado = b.dataset.e; el.querySelectorAll('button').forEach((x) => x.classList.toggle('activa', x === b)); cargar(); };
    });
}

async function cargar() {
    pintarPestanasEstado();
    ordenes = await api(`/ot?tipo=${tipo}${estado ? `&estado=${estado}` : ''}`);
    pintar();
}

function pintar() {
    document.getElementById('tabla').innerHTML = (tipo !== 'servicio' ? `<p class="tenue" style="padding:14px 16px 0">Gestiona esta orden desde Producción › ${TIPO_TXT[tipo]}.</p>` : '')
        + tabla({
            vacio: 'No hay órdenes en esta lista',
            columnas: [
                { t: 'Folio', r: (o) => `<strong>${esc(o.folio)}</strong>` },
                { t: 'Cliente / Equipo', r: (o) => `${esc(o.razon_social || 'Interno (flota propia)')}<div class="sub">${esc(o.numero_economico || o.equipo_cliente || '—')}</div>` },
                { t: 'Técnico', r: (o) => esc(o.tecnico || '—') },
                { t: 'Precio cliente', num: true, r: (o) => (o.precio_cliente > 0 ? dinero(o.precio_cliente) : '—') },
                { t: 'Estado', r: (o) => `${tag(o.estado)}${o.factura_folio ? `<div class="sub">${esc(o.factura_folio)}</div>` : ''}` },
                { t: '', clase: 'acciones', r: (o) => (tipo === 'servicio' ? `<button class="btn btn-chico" type="button" data-id="${o.id}">Abrir</button>` : '') },
            ],
            filas: ordenes,
        });
}

async function nueva() {
    const cat = await catalogos(true);
    const propios = cat.equipos.filter((e) => !['vendido', 'baja'].includes(e.estado));
    const campos = [
        { k: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', ancho: true, vacio: 'Servicio interno (flota Montagsa)', opciones: opciones(cat.clientes, 'id', 'razon_social') },
        { k: 'equipo_id', etiqueta: 'Equipo de Montagsa', tipo: 'select', vacio: '— Es equipo del cliente —', opciones: opciones(propios, 'id', (e) => `${e.numero_economico} · ${e.marca} (${etiqueta(e.estado)})`) },
        { k: 'equipo_cliente', etiqueta: 'Equipo del cliente', ayuda: 'Marca, modelo y serie si no es de Montagsa' },
        { k: 'tecnico_id', etiqueta: 'Técnico', tipo: 'select', opciones: opciones(cat.tecnicos, 'id', 'nombre') },
        { k: 'descripcion', etiqueta: 'Falla reportada / trabajo a evaluar', tipo: 'textarea', requerido: true, ancho: true },
    ];
    modal({
        titulo: 'Nuevo servicio', ancho: 700, cuerpo: formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Crear orden', clase: 'btn-primario', onClick: async (m) => {
            const d = leerFormulario(m, campos);
            if (!d.equipo_id && !d.equipo_cliente) throw new Error('Elige un equipo de Montagsa o describe el del cliente');
            const o = await api('/servicios', { method: 'POST', body: d });
            aviso(`Orden ${o.folio} creada`, 'ok');
            await cargar();
        } }],
    });
}

async function detalle(id) {
    const [o, cat] = await Promise.all([api(`/ot/${id}`), catalogos(true)]);
    const activa = !['cerrada', 'facturada', 'rechazada', 'cancelada'].includes(o.estado);
    const acciones = [{ texto: 'Cerrar' }];
    if (activa) {
        acciones.push({ texto: 'Cancelar orden', clase: 'btn-peligro', onClick: async () => {
            const motivo = prompt(`Motivo de cancelación de ${o.folio}:`);
            if (motivo === null) return false;
            await api(`/ot/${o.id}/cancelar`, { method: 'POST', body: { motivo } });
            aviso('Orden cancelada', 'ok'); await cargar();
        } });
    }
    if (o.estado === 'autorizada') {
        acciones.push({ texto: 'Iniciar ejecución', clase: 'btn-primario', onClick: async () => {
            const r = await api(`/servicios/${o.id}/iniciar-ejecucion`, { method: 'POST' });
            aviso(r.requisicion ? `Ejecución iniciada. Se generó la requisición ${r.requisicion.folio}` : 'Ejecución iniciada', 'ok');
            await cargar();
        } });
    }
    if (o.estado === 'en_ejecucion') {
        acciones.push({ texto: 'Cerrar orden', clase: 'btn-primario', onClick: async () => {
            await api(`/ot/${o.id}/cerrar`, { method: 'POST' });
            aviso(`Orden ${o.folio} cerrada`, 'ok'); await cargar();
        } });
    }
    if (o.estado === 'cerrada' && o.cliente_id && puedeVer('facturacion')) {
        acciones.push({ texto: 'Facturar', clase: 'btn-primario', onClick: async () => {
            const f = await conAutorizacion((body) => api(`/ot/${o.id}/facturar`, { method: 'POST', body }), {});
            if (!f) return false;
            aviso(`Factura ${f.folio} generada`, 'ok'); await cargar();
        } });
    }

    const refImporte = o.refacciones.reduce((t, r) => t + r.cantidad * r.costo_unitario, 0);
    const m = modal({
        titulo: `Orden ${o.folio}`, ancho: 860,
        cuerpo: `
            <dl class="datos" style="margin-bottom:16px">
                <dt>Estado</dt><dd>${tag(o.estado)}</dd>
                <dt>Cliente</dt><dd>${esc(o.razon_social || 'Interno (flota propia)')}</dd>
                <dt>Equipo</dt><dd>${esc(o.numero_economico || o.equipo_cliente || '—')}</dd>
                <dt>Descripción</dt><dd>${esc(o.descripcion || '—')}</dd>
                ${o.diagnostico ? `<dt>Diagnóstico</dt><dd>${esc(o.diagnostico)}</dd>` : ''}
            </dl>

            ${o.estado === 'evaluacion' ? `
            <div class="form">
                <div class="campo ancho"><label for="ot-diag">Diagnóstico</label><textarea id="ot-diag"></textarea></div>
                <div class="campo ancho" style="align-items:flex-start"><button class="btn btn-primario" type="button" id="ot-evaluar">Guardar evaluación</button></div>
            </div>` : ''}

            ${['requiere_cotizacion', 'cotizacion_interna'].includes(o.estado) ? `
            <div class="form">
                <div class="campo"><label for="ot-horas">Horas de mano de obra</label><input id="ot-horas" type="number" step="0.1" min="0" value="${o.mano_obra_horas || 0}"></div>
                <div class="campo"><label for="ot-costohora">Costo por hora</label><input id="ot-costohora" type="number" step="0.01" min="0" value="${o.costo_hora || 0}"></div>
                <div class="campo ancho" style="align-items:flex-start"><button class="btn" type="button" id="ot-cotizar">Guardar cotización interna</button></div>
            </div>` : ''}

            <h4 style="margin:16px 0 8px">Refacciones cotizadas (al costo)</h4>
            ${tabla({ vacio: 'Sin refacciones', filas: o.refacciones, columnas: [
                { t: 'SKU', k: 'sku' }, { t: 'Refacción', k: 'nombre' }, { t: 'Cant.', num: true, k: 'cantidad' },
                { t: 'Costo', num: true, r: (r) => dinero(r.costo_unitario) }, { t: 'Importe', num: true, r: (r) => dinero(r.cantidad * r.costo_unitario) }] })}
            ${['requiere_cotizacion', 'cotizacion_interna'].includes(o.estado) ? `
            <div class="form" style="margin-top:12px">
                <div class="campo"><label for="ot-prod">Agregar refacción</label><select id="ot-prod"><option value="">— Refacción —</option>${cat.productos.map((p) => `<option value="${p.id}">${esc(p.sku)} · ${esc(p.nombre)} (hay ${p.stock})</option>`).join('')}</select></div>
                <div class="campo"><label for="ot-cant">Cantidad</label><input id="ot-cant" type="number" min="1" value="1"></div>
                <div class="campo ancho" style="align-items:flex-start"><button class="btn" type="button" id="ot-agregar">Agregar a la cotización</button></div>
            </div>
            <div class="aviso-caja" style="margin-top:14px">Mano de obra ${dinero(o.costo_mano_obra)} + refacciones ${dinero(refImporte)} = <strong>${dinero(o.costo_interno)}</strong> de costo interno
                ${o.estado === 'cotizacion_interna' && o.costo_interno > 0 ? '<div style="margin-top:10px"><button class="btn btn-primario" type="button" id="ot-enviar">Enviar cotización a Comercial</button></div>' : ''}</div>` : ''}

            ${o.estado === 'cotizacion_comercial' ? '<div class="aviso-caja">Esperando el precio y la autorización de Comercial.</div>' : ''}
            ${o.margen || o.precio_cliente ? `<div class="aviso-caja" style="margin-top:12px">Margen: <strong>${dinero(o.margen)}</strong> · Precio al cliente: <strong>${dinero(o.precio_cliente)}</strong>
                ${o.autorizado_por ? ` · Autorizó: <strong>${esc(o.autorizado_por)}</strong> (${fecha(o.fecha_autorizacion)})` : ''}</div>` : ''}
            ${o.requisicion ? `<div class="aviso-caja" style="margin-top:12px">Requisición <strong>${esc(o.requisicion.folio)}</strong>: ${tag(o.requisicion.estado)}
                ${o.requisicion.estado === 'pendiente' ? ' · Almacén debe surtirla antes de cerrar la orden' : ''}</div>` : ''}
            <h4 style="margin:18px 0 8px">Bitácora</h4>
            <div id="bitacora-ot"></div>`,
        acciones,
    });
    panelBitacora(m.el.querySelector('#bitacora-ot'), 'ot', o.id);

    const ev = m.el.querySelector('#ot-evaluar');
    if (ev) ev.onclick = async () => {
        try {
            const diagnostico = m.el.querySelector('#ot-diag').value.trim();
            if (!diagnostico) throw new Error('Captura el diagnóstico');
            await api(`/servicios/${o.id}/evaluacion`, { method: 'POST', body: { diagnostico } });
            aviso('Evaluación guardada', 'ok'); m.cerrar(); await cargar(); detalle(o.id);
        } catch (e) { avisoError(e); }
    };
    const cz = m.el.querySelector('#ot-cotizar');
    if (cz) cz.onclick = async () => {
        try {
            await api(`/servicios/${o.id}/cotizacion-interna`, { method: 'POST', body: {
                horas: Number(m.el.querySelector('#ot-horas').value) || 0,
                costo_hora: Number(m.el.querySelector('#ot-costohora').value) || 0,
            } });
            aviso('Cotización interna guardada', 'ok'); m.cerrar(); await cargar(); detalle(o.id);
        } catch (e) { avisoError(e); }
    };
    const ag = m.el.querySelector('#ot-agregar');
    if (ag) ag.onclick = async () => {
        const producto_id = m.el.querySelector('#ot-prod').value;
        if (!producto_id) return aviso('Elige la refacción', 'error');
        try {
            await api(`/servicios/${o.id}/refacciones`, { method: 'POST', body: { producto_id, cantidad: Number(m.el.querySelector('#ot-cant').value) } });
            aviso('Refacción agregada a la cotización', 'ok'); m.cerrar(); await cargar(); detalle(o.id);
        } catch (e) { avisoError(e); }
    };
    const en = m.el.querySelector('#ot-enviar');
    if (en) en.onclick = async () => {
        try {
            await api(`/servicios/${o.id}/enviar-cotizacion`, { method: 'POST' });
            aviso(`Orden ${o.folio} enviada a Comercial`, 'ok'); m.cerrar(); await cargar();
        } catch (e) { avisoError(e); }
    };
}
