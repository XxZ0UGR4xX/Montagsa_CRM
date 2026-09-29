// Administración · Compras: órdenes de compra a proveedores.
// Flujo: borrador → enviada → recibida (sube inventario) → pagada.
let ordenes = [];

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Compras', 'Órdenes de compra de refacciones y consumibles. Al recibir una orden, el inventario sube y se registra la cuenta por pagar.',
        `${puedeVer('maxmin') ? '<a class="btn" href="/almacen/maximos-minimos.html">Revisar máximos y mínimos</a>' : ''}
         <button class="btn btn-primario" type="button" id="btn-nueva">Nueva orden</button>`) + '<div id="kpis"></div><div class="panel" id="tabla"></div>';
    document.getElementById('btn-nueva').onclick = nueva;
    document.getElementById('tabla').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-id]');
        if (!b) return;
        const oc = ordenes.find((o) => String(o.id) === b.dataset.id);
        if (b.dataset.acc === 'ver') return detalle(oc);
        if (b.dataset.acc === 'pagar') return pagar(oc);
        await cambiarEstado(oc, b.dataset.acc);
    });
    await cargar();
};

async function cargar() {
    ordenes = await api('/compras');
    const abiertas = ordenes.filter((o) => ['borrador', 'enviada'].includes(o.estado));
    const porPagar = ordenes.filter((o) => o.estado === 'recibida' && !o.pagada);
    document.getElementById('kpis').innerHTML = `<div class="kpis" style="margin-bottom:18px">
        ${kpi('Órdenes abiertas', abiertas.length, pesos(abiertas.reduce((s, o) => s + o.total, 0)))}
        ${kpi('Por pagar a proveedores', pesos(porPagar.reduce((s, o) => s + o.total, 0)), `${porPagar.length} órdenes recibidas`, porPagar.length ? 'aviso' : '')}
    </div>`;
    const acciones = (o) => {
        const b = (acc, txt, cls = '') => `<button class="btn btn-chico ${cls}" type="button" data-acc="${acc}" data-id="${o.id}">${txt}</button>`;
        return [b('ver', 'Ver'),
            o.estado === 'borrador' ? b('enviada', 'Marcar enviada') : '',
            o.estado === 'enviada' ? b('recibida', 'Recibir') : '',
            ['borrador', 'enviada'].includes(o.estado) ? b('cancelada', 'Cancelar', 'btn-peligro') : '',
            o.estado === 'recibida' && !o.pagada && puedeVer('contabilidad') ? b('pagar', 'Pagar') : ''].join(' ');
    };
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay órdenes de compra',
        columnas: [
            { t: 'Folio', r: (o) => `<strong>${esc(o.folio)}</strong><div class="sub">${fecha(o.fecha)}</div>` },
            { t: 'Proveedor', r: (o) => `${esc(o.proveedor)}<div class="sub">entrega en ${o.tiempo_entrega_dias} días</div>` },
            { t: 'Partidas', num: true, k: 'partidas' },
            { t: 'Total', num: true, r: (o) => dinero(o.total) },
            { t: 'Estado', r: (o) => `${tag(o.estado)}${o.estado === 'recibida' ? `<div class="sub">${o.pagada ? `Pagada ${fecha(o.fecha_pago)}` : 'Por pagar'}</div>` : ''}` },
            { t: 'Notas', r: (o) => `<span class="tenue">${esc(o.notas || '')}</span>` },
            { t: '', clase: 'acciones', r: acciones },
        ],
        filas: ordenes,
    });
}

async function detalle(oc) {
    const o = await api(`/compras/${oc.id}`);
    modal({
        titulo: `Orden de compra ${o.folio}`, ancho: 760,
        cuerpo: `<dl class="datos" style="margin-bottom:14px">
                <dt>Proveedor</dt><dd>${esc(o.proveedor)} ${o.proveedor_email ? `<span class="tenue">${esc(o.proveedor_email)}</span>` : ''}</dd>
                <dt>Estado</dt><dd>${tag(o.estado)}</dd>
                <dt>Fecha</dt><dd>${fecha(o.fecha)}${o.fecha_recepcion ? ` · recibida ${fecha(o.fecha_recepcion)}` : ''}</dd>
            </dl>
            ${tabla({ filas: o.items, columnas: [
                { t: 'SKU', k: 'sku' }, { t: 'Refacción', k: 'nombre' }, { t: 'Cantidad', num: true, r: (i) => `${i.cantidad} ${esc(i.unidad)}` },
                { t: 'Costo', num: true, r: (i) => dinero(i.costo_unitario) }, { t: 'Importe', num: true, r: (i) => dinero(i.cantidad * i.costo_unitario) }],
                pie: `<td colspan="4" class="derecha">Total</td><td class="num">${dinero(o.total)}</td>` })}`,
    });
}

async function cambiarEstado(oc, estado) {
    const msg = { enviada: `¿Marcar ${oc.folio} como enviada al proveedor?`, recibida: `¿Recibir ${oc.folio}? El inventario sube con las cantidades de la orden.`, cancelada: `¿Cancelar ${oc.folio}?` }[estado];
    if (!(await confirmar(msg, 'Confirmar'))) return;
    try { await api(`/compras/${oc.id}/estado`, { method: 'POST', body: { estado } }); aviso(`${oc.folio}: ${etiqueta(estado)}`, 'ok'); await cargar(); } catch (e) { avisoError(e); }
}

async function pagar(oc) {
    if (!(await confirmar(`Registrar el pago de ${oc.folio} a ${oc.proveedor} por ${dinero(oc.total)} desde Bancos.`, 'Pagar'))) return;
    try { await api(`/compras/${oc.id}/pagar`, { method: 'POST' }); aviso('Pago a proveedor registrado', 'ok'); await cargar(); } catch (e) { avisoError(e); }
}

async function nueva() {
    const cat = await catalogos(true);
    const m = modal({
        titulo: 'Nueva orden de compra', ancho: 820,
        cuerpo: `${formulario([{ k: 'proveedor_id', etiqueta: 'Proveedor', tipo: 'select', requerido: true, ancho: true, opciones: opciones(cat.proveedores, 'id', 'nombre') }])}
            <h4 style="margin:16px 0 8px">Partidas</h4><div id="partidas"></div>
            <button class="btn btn-chico" type="button" id="mas" style="margin-top:8px">Agregar partida</button>
            <div class="aviso-caja" id="tot" style="margin-top:14px"></div>
            <div class="campo" style="margin-top:14px"><label for="notas">Notas</label><textarea id="notas"></textarea></div>`,
        acciones: [{ texto: 'Cancelar' }, { texto: 'Crear orden', clase: 'btn-primario', onClick: async (el) => {
            const proveedor_id = el.querySelector('[name=proveedor_id]').value;
            if (!proveedor_id) throw new Error('Elige el proveedor');
            const items = [...el.querySelectorAll('.partida')].map((r) => ({
                producto_id: r.querySelector('.p-prod').value, cantidad: Number(r.querySelector('.p-cant').value), costo: Number(r.querySelector('.p-costo').value),
            })).filter((i) => i.producto_id);
            if (!items.length) throw new Error('Agrega al menos una partida');
            const o = await api('/compras', { method: 'POST', body: { proveedor_id, items, notas: el.querySelector('#notas').value } });
            aviso(`Orden ${o.folio} creada en borrador`, 'ok');
            await cargar();
        } }],
    });
    const cont = m.el.querySelector('#partidas');
    const total = () => {
        const t = [...cont.querySelectorAll('.partida')].reduce((s, r) => s + Number(r.querySelector('.p-cant').value) * Number(r.querySelector('.p-costo').value), 0);
        m.el.querySelector('#tot').innerHTML = `Total de la orden: <strong>${dinero(t)}</strong>`;
    };
    const fila = () => {
        const d = document.createElement('div');
        d.className = 'partida form';
        d.style.cssText = 'grid-template-columns: 3fr 1fr 1.2fr auto; margin-bottom:8px; align-items:end';
        d.innerHTML = `<div class="campo"><label>Refacción</label><select class="p-prod"><option value="">— Selecciona —</option>${cat.productos.map((p) => `<option value="${p.id}" data-costo="${p.costo}">${esc(p.sku)} · ${esc(p.nombre)} (hay ${p.stock})</option>`).join('')}</select></div>
            <div class="campo"><label>Cantidad</label><input class="p-cant" type="number" min="1" value="1"></div>
            <div class="campo"><label>Costo unitario</label><input class="p-costo" type="number" min="0" step="0.01" value="0"></div>
            <button class="btn btn-chico btn-peligro" type="button">Quitar</button>`;
        d.querySelector('.p-prod').addEventListener('change', (e) => { d.querySelector('.p-costo').value = e.target.selectedOptions[0].dataset.costo || 0; total(); });
        d.querySelector('button').onclick = () => { d.remove(); total(); };
        d.addEventListener('input', total);
        cont.appendChild(d);
        total();
    };
    m.el.querySelector('#mas').onclick = fila;
    fila();
}
