// Comercial · Facturación: facturas de rentas, servicios, venta de equipo y manuales.
// Nota: es una factura interna (no timbrada ante el SAT).
const ORIGENES = [['renta', 'Renta'], ['servicio', 'Servicio'], ['venta', 'Venta de equipo'], ['maniobra', 'Maniobra'], ['refaccion_ot', 'Venta de refacciones'], ['otro', 'Otro']];
let facturas = [];

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Facturación', 'Las facturas de rentas y servicios se generan desde su módulo; aquí también puedes vender equipo o emitir una factura manual.',
        `<button class="btn" type="button" id="btn-csv">Exportar CSV</button>
         <button class="btn" type="button" id="btn-vender">Vender equipo</button>
         <button class="btn btn-primario" type="button" id="btn-manual">Factura manual</button>`) + `
        <div class="filtros" style="margin-bottom:14px">
            <select id="f-estado" aria-label="Estado"><option value="">Todos los estados</option>
                ${['pendiente', 'parcial', 'pagada', 'cancelada'].map((e) => `<option value="${e}">${etiqueta(e)}</option>`).join('')}</select>
            <select id="f-origen" aria-label="Origen"><option value="">Todos los orígenes</option>${ORIGENES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
        </div>
        <div id="pendientes" style="margin-bottom:18px"></div>
        <div id="kpis"></div>
        <div class="panel" id="tabla"></div>`;
    document.getElementById('btn-manual').onclick = manual;
    document.getElementById('btn-vender').onclick = vender;
    document.getElementById('f-estado').onchange = cargar;
    document.getElementById('f-origen').onchange = cargar;
    document.getElementById('btn-csv').onclick = () => exportarCSV('facturas', [
        { t: 'Folio', k: 'folio' }, { t: 'Cliente', k: 'razon_social' }, { t: 'Origen', k: 'origen' }, { t: 'Fecha', k: 'fecha' },
        { t: 'Vencimiento', k: 'fecha_vencimiento' }, { t: 'Subtotal', k: 'subtotal' }, { t: 'IVA', k: 'iva' }, { t: 'Total', k: 'total' },
        { t: 'Pagado', k: 'pagado' }, { t: 'Estado', k: 'estado' }], facturas);
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) detalle(b.dataset.id);
    });
    await cargarPendientes();
    await cargar();
    const id = idDeUrl();
    if (id) await detalle(id);
};

const TIPO_OT_TXT = { servicio: 'Servicio', maniobra: 'Maniobra', refaccion: 'Refacciones' };

async function cargarPendientes() {
    const pend = await api('/ot/pendientes-facturar');
    const cont = document.getElementById('pendientes');
    if (!pend.length) { cont.innerHTML = ''; return; }
    cont.innerHTML = `<div class="panel">
        <div class="panel-cab"><h2>Por facturar (Producción)</h2></div>
        ${tabla({
            columnas: [
                { t: 'Folio', r: (o) => `<strong>${esc(o.folio)}</strong>` },
                { t: 'Cliente', k: 'razon_social' },
                { t: 'Tipo', r: (o) => esc(TIPO_OT_TXT[o.tipo] || o.tipo) },
                { t: 'Descripción', r: (o) => esc(o.descripcion || (o.origen_maniobra ? `${o.origen_maniobra} → ${o.destino_maniobra}` : o.numero_economico || '—')) },
                { t: 'Precio', num: true, r: (o) => dinero(o.precio_cliente) },
                { t: '', clase: 'acciones', r: (o) => `<button class="btn btn-chico btn-primario" type="button" data-fact="${o.id}">Facturar</button>` },
            ],
            filas: pend,
        })}
    </div>`;
    cont.querySelectorAll('[data-fact]').forEach((b) => {
        b.onclick = async () => {
            const f = await conAutorizacion((body) => api(`/ot/${b.dataset.fact}/facturar`, { method: 'POST', body }), {});
            if (f) { aviso(`Factura ${f.folio} generada`, 'ok'); await cargarPendientes(); await cargar(); }
        };
    });
}

async function cargar() {
    const q = `?estado=${document.getElementById('f-estado').value}&origen=${document.getElementById('f-origen').value}`;
    facturas = await api(`/facturas${q}`);
    const vigentes = facturas.filter((f) => f.estado !== 'cancelada');
    document.getElementById('kpis').innerHTML = `<div class="kpis" style="margin-bottom:18px">
        ${kpi('Facturas', vigentes.length)}
        ${kpi('Total facturado', pesos(vigentes.reduce((s, f) => s + f.total, 0)))}
        ${kpi('Por cobrar', pesos(vigentes.reduce((s, f) => s + f.saldo, 0)))}
    </div>`;
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay facturas con ese filtro',
        columnas: [
            { t: 'Folio', r: (f) => `<strong>${esc(f.folio)}</strong>` },
            { t: 'Cliente', k: 'razon_social' },
            { t: 'Origen', r: (f) => esc(ORIGENES.find(([v]) => v === f.origen)?.[1] || f.origen) },
            { t: 'Fecha', r: (f) => fecha(f.fecha) },
            { t: 'Vence', r: (f) => `${fecha(f.fecha_vencimiento)}${f.dias_vencida > 0 && ['pendiente', 'parcial'].includes(f.estado) ? `<div class="sub" style="color:var(--rojo)">${f.dias_vencida} d vencida</div>` : ''}` },
            { t: 'Total', num: true, r: (f) => dinero(f.total) },
            { t: 'Saldo', num: true, r: (f) => (f.estado === 'cancelada' ? '—' : dinero(f.saldo)) },
            { t: 'Estado', r: (f) => tag(f.estado) },
            { t: '', clase: 'acciones', r: (f) => `<button class="btn btn-chico" type="button" data-id="${f.id}">Ver</button>` },
        ],
        filas: facturas,
    });
}

async function detalle(id) {
    const f = await api(`/facturas/${id}`);
    const cobrable = ['pendiente', 'parcial'].includes(f.estado) && puedeVer('cobranza');
    const cancelable = f.estado !== 'cancelada' && f.pagado === 0 && puedeVer('facturacion');
    // Anular un pago mal capturado es exclusivo de Administración.
    const puedeAnular = ['admin', 'administracion'].includes((Sesion.usuario() || {}).rol) && f.pagos.some((p) => !p.cancelado);
    const m = modal({
        titulo: `Factura ${f.folio}`, ancho: 820,
        cuerpo: `<div id="impresion">
            <div class="rejilla" style="margin-bottom:16px">
                <dl class="datos">
                    <dt>Emisor</dt><dd><strong>Montagsa</strong></dd>
                    <dt>Cliente</dt><dd><strong>${esc(f.razon_social)}</strong></dd>
                    <dt>RFC</dt><dd>${esc(f.rfc || '—')}</dd>
                    <dt>Dirección</dt><dd>${esc(f.direccion || '—')}</dd>
                </dl>
                <dl class="datos">
                    <dt>Fecha</dt><dd>${fecha(f.fecha)}</dd>
                    <dt>Vencimiento</dt><dd>${fecha(f.fecha_vencimiento)}</dd>
                    <dt>Estado</dt><dd>${tag(f.estado)}</dd>
                    <dt>Elaboró</dt><dd>${esc(f.usuario || '—')}</dd>
                </dl>
            </div>
            ${tabla({ filas: f.conceptos, columnas: [
                { t: 'Concepto', k: 'descripcion' }, { t: 'Cant.', num: true, r: (c) => numero(c.cantidad, c.cantidad % 1 ? 2 : 0) },
                { t: 'Precio', num: true, r: (c) => dinero(c.precio_unitario) }, { t: 'Importe', num: true, r: (c) => dinero(c.importe) }],
                pie: `<td colspan="3" class="derecha">Subtotal<br>IVA 16%<br>Total</td><td class="num">${dinero(f.subtotal)}<br>${dinero(f.iva)}<br>${dinero(f.total)}</td>` })}
            ${f.notas ? `<p class="tenue" style="margin-top:10px">${esc(f.notas)}</p>` : ''}
            <h4 style="margin:18px 0 8px">Pagos</h4>
            ${tabla({ vacio: 'Sin pagos registrados', filas: f.pagos, columnas: [
                { t: 'Fecha', r: (p) => fecha(p.fecha) }, { t: 'Método', k: 'metodo' }, { t: 'Referencia', k: 'referencia' },
                { t: 'Monto', num: true, r: (p) => (p.cancelado ? `<s>${dinero(p.monto)}</s>` : dinero(p.monto)) },
                { t: 'Estado', r: (p) => (p.cancelado ? `${tag('cancelada', 'Anulado')}<div class="sub">${esc(p.motivo_cancelacion || '')}</div>` : tag('pagada', 'Aplicado')) },
                ...(puedeAnular ? [{ t: '', clase: 'acciones', r: (p) => (p.cancelado ? '' : `<button class="btn btn-chico btn-peligro" type="button" data-anular="${p.id}">Anular</button>`) }] : []),
            ] })}
            <p style="margin-top:10px">Saldo: <strong>${dinero(f.total - f.pagado)}</strong></p>
            <p class="tenue" style="margin-top:6px;font-size:13px">Documento interno sin validez fiscal (no timbrado).</p>
        </div>
        <h4 style="margin:18px 0 8px">Bitácora</h4>
        <div id="bitacora-factura"></div>`,
        acciones: [
            { texto: 'Cerrar' },
            { texto: 'Imprimir', onClick: () => { imprimir(f.folio, m.el.querySelector('#impresion').innerHTML); return false; } },
            ...(cancelable ? [{ texto: 'Cancelar factura', clase: 'btn-peligro', onClick: () => cancelarFactura(f) }] : []),
            ...(cobrable ? [{ texto: 'Registrar pago', clase: 'btn-primario', onClick: () => dialogoPago(f, cargar) }] : []),
        ],
    });
    panelBitacora(m.el.querySelector('#bitacora-factura'), 'factura', f.id);
    m.el.querySelectorAll('[data-anular]').forEach((b) => {
        b.onclick = async () => {
            try {
                const r = await anularPago(f.pagos.find((p) => String(p.id) === b.dataset.anular), cargar);
                if (r !== false) { m.cerrar(); await detalle(f.id); }
            } catch (e) { avisoError(e); }
        };
    });
}

function imprimir(titulo, html) {
    const w = window.open('', '_blank');
    if (!w) return aviso('Permite ventanas emergentes para imprimir', 'error');
    w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(titulo)}</title>
        <link rel="stylesheet" href="/css/app.css"><style>body{background:#fff;padding:32px}</style></head>
        <body><h1 style="font-family:var(--f-titulo)">MONTAGSA · ${esc(titulo)}</h1><div class="franja" style="margin:10px 0 20px"></div>${html}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
}

async function cancelarFactura(f) {
    const motivo = prompt(`Motivo de cancelación de ${f.folio}:`);
    if (motivo === null) return false;
    await api(`/facturas/${f.id}/cancelar`, { method: 'POST', body: { motivo } });
    aviso(`Factura ${f.folio} cancelada`, 'ok');
    await cargar();
}

async function manual() {
    const cat = await catalogos(true);
    const m = modal({
        titulo: 'Factura manual', ancho: 820,
        cuerpo: `${formulario([{ k: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', requerido: true, ancho: true, opciones: opciones(cat.clientes, 'id', 'razon_social') }])}
            <h4 style="margin:16px 0 8px">Conceptos</h4>
            <div id="conceptos"></div>
            <button class="btn btn-chico" type="button" id="mas" style="margin-top:8px">Agregar concepto</button>
            <div class="aviso-caja" id="tot" style="margin-top:14px"></div>
            <div class="campo" style="margin-top:14px"><label for="notas">Notas</label><textarea id="notas"></textarea></div>`,
        acciones: [{ texto: 'Cancelar' }, { texto: 'Emitir factura', clase: 'btn-primario', onClick: async (el) => {
            const cliente_id = el.querySelector('[name=cliente_id]').value;
            if (!cliente_id) throw new Error('Elige el cliente');
            const conceptos = [...el.querySelectorAll('.concepto')].map((r) => ({
                descripcion: r.querySelector('.c-desc').value.trim(), cantidad: Number(r.querySelector('.c-cant').value), precio_unitario: Number(r.querySelector('.c-precio').value),
            })).filter((c) => c.descripcion);
            if (!conceptos.length) throw new Error('Agrega al menos un concepto con descripción');
            const f = await conAutorizacion((body) => api('/facturas', { method: 'POST', body }), { cliente_id, conceptos, notas: el.querySelector('#notas').value });
            if (!f) return false;
            aviso(`Factura ${f.folio} emitida`, 'ok');
            await cargar();
        } }],
    });
    const cont = m.el.querySelector('#conceptos');
    const total = () => {
        const sub = [...cont.querySelectorAll('.concepto')].reduce((s, r) => s + Number(r.querySelector('.c-cant').value) * Number(r.querySelector('.c-precio').value), 0);
        m.el.querySelector('#tot').innerHTML = `Subtotal ${dinero(sub)} + IVA ${dinero(sub * 0.16)} = <strong>${dinero(sub * 1.16)}</strong>`;
    };
    const fila = () => {
        const d = document.createElement('div');
        d.className = 'concepto form';
        d.style.cssText = 'grid-template-columns: 3fr 1fr 1.3fr auto; margin-bottom:8px; align-items:end';
        d.innerHTML = `<div class="campo"><label>Descripción</label><input class="c-desc"></div>
            <div class="campo"><label>Cantidad</label><input class="c-cant" type="number" min="0" step="0.01" value="1"></div>
            <div class="campo"><label>Precio unitario</label><input class="c-precio" type="number" min="0" step="0.01" value="0"></div>
            <button class="btn btn-chico btn-peligro" type="button" aria-label="Quitar concepto">Quitar</button>`;
        d.querySelector('button').onclick = () => { d.remove(); total(); };
        d.addEventListener('input', total);
        cont.appendChild(d);
        total();
    };
    m.el.querySelector('#mas').onclick = fila;
    fila();
}

async function vender() {
    const cat = await catalogos(true);
    const enVenta = cat.equipos.filter((e) => e.estado === 'venta');
    if (!enVenta.length) return aviso('No hay equipos en estado "En venta". Primero traspásalos a venta en Traspasos.', 'error');
    const campos = [
        { k: 'equipo_id', etiqueta: 'Equipo en venta', tipo: 'select', requerido: true, ancho: true, opciones: opciones(enVenta, 'id', (e) => `${e.numero_economico} · ${e.marca} ${e.modelo || ''} · lista ${dinero(e.precio_venta)}`) },
        { k: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', requerido: true, ancho: true, opciones: opciones(cat.clientes, 'id', 'razon_social') },
        { k: 'precio', etiqueta: 'Precio de venta (sin IVA)', tipo: 'number', paso: '0.01', ancho: true, ayuda: 'Vacío = precio de lista' },
    ];
    modal({
        titulo: 'Vender equipo', cuerpo: formulario(campos) + '<p class="tenue" style="margin-top:12px">Se genera la factura, el equipo pasa a Vendido y se registra su costo de venta.</p>',
        acciones: [{ texto: 'Cancelar' }, { texto: 'Vender y facturar', clase: 'btn-primario', onClick: async (m) => {
            const d = leerFormulario(m, campos);
            const f = await conAutorizacion((body) => api(`/equipos/${d.equipo_id}/vender`, { method: 'POST', body }), { cliente_id: d.cliente_id, precio: d.precio });
            if (!f) return false;
            aviso(`Equipo vendido. Factura ${f.folio}`, 'ok');
            await cargar();
        } }],
    });
}
