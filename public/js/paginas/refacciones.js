// Producción · Refacciones: venta o surtido de refacciones a un cliente.
let ordenes = [];

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Refacciones', 'Venta de refacciones a un cliente. Se genera una requisición para que Almacén la surta; al cerrar, Comercial factura.',
        '<button class="btn btn-primario" type="button" id="btn-nueva">Nueva venta de refacciones</button>') +
        '<div class="panel" id="tabla"></div>';
    document.getElementById('btn-nueva').onclick = nueva;
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) detalle(b.dataset.id);
    });
    await cargar();
};

async function cargar() { ordenes = await api('/refacciones-ot'); pintar(); }

function pintar() {
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay órdenes de refacciones',
        columnas: [
            { t: 'Folio', r: (o) => `<strong>${esc(o.folio)}</strong>` },
            { t: 'Cliente', k: 'razon_social' },
            { t: 'Partidas', num: true, k: 'partidas' },
            { t: 'Precio', num: true, r: (o) => dinero(o.precio_cliente) },
            { t: 'Estado', r: (o) => `${tag(o.estado)}${o.factura_folio ? `<div class="sub">${esc(o.factura_folio)}</div>` : ''}` },
            { t: '', clase: 'acciones', r: (o) => `<button class="btn btn-chico" type="button" data-id="${o.id}">Abrir</button>` },
        ],
        filas: ordenes,
    });
}

async function nueva() {
    const cat = await catalogos(true);
    const m = modal({
        titulo: 'Nueva venta de refacciones', ancho: 760,
        cuerpo: `${formulario([{ k: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', requerido: true, ancho: true, opciones: opciones(cat.clientes, 'id', 'razon_social') }])}
            <h4 style="margin:16px 0 8px">Partidas</h4>
            <div id="partidas"></div>
            <button class="btn btn-chico" type="button" id="mas" style="margin-top:8px">Agregar partida</button>`,
        acciones: [{ texto: 'Cancelar' }, { texto: 'Crear orden', clase: 'btn-primario', onClick: async (el) => {
            const cliente_id = el.querySelector('[name=cliente_id]').value;
            if (!cliente_id) throw new Error('Elige el cliente');
            const items = [...el.querySelectorAll('.partida')]
                .map((r) => ({ producto_id: r.querySelector('.p-prod').value, cantidad: Number(r.querySelector('.p-cant').value) }))
                .filter((it) => it.producto_id);
            if (!items.length) throw new Error('Agrega al menos una partida');
            const o = await api('/refacciones-ot', { method: 'POST', body: { cliente_id, items } });
            aviso(`Orden ${o.folio} creada`, 'ok');
            await cargar();
        } }],
    });
    const cont = m.el.querySelector('#partidas');
    const fila = () => {
        const d = document.createElement('div');
        d.className = 'partida form';
        d.style.cssText = 'grid-template-columns: 3fr 1fr auto; margin-bottom:8px; align-items:end';
        d.innerHTML = `<div class="campo"><label>Refacción</label><select class="p-prod"><option value="">— Refacción —</option>${cat.productos.map((p) => `<option value="${p.id}">${esc(p.sku)} · ${esc(p.nombre)} (hay ${p.stock})</option>`).join('')}</select></div>
            <div class="campo"><label>Cantidad</label><input class="p-cant" type="number" min="1" value="1"></div>
            <button class="btn btn-chico btn-peligro" type="button" aria-label="Quitar partida">Quitar</button>`;
        d.querySelector('button').onclick = () => d.remove();
        cont.appendChild(d);
    };
    m.el.querySelector('#mas').onclick = fila;
    fila();
}

async function detalle(id) {
    const o = await api(`/refacciones-ot/${id}`);
    const activa = !['cerrada', 'facturada', 'cancelada'].includes(o.estado);
    modal({
        titulo: `Orden ${o.folio}`, ancho: 780,
        cuerpo: `
            <dl class="datos" style="margin-bottom:16px">
                <dt>Estado</dt><dd>${tag(o.estado)}</dd>
                <dt>Cliente</dt><dd>${esc(o.razon_social)}</dd>
                <dt>Precio total</dt><dd>${dinero(o.precio_cliente)}</dd>
            </dl>
            ${tabla({ filas: o.refacciones, columnas: [
                { t: 'SKU', k: 'sku' }, { t: 'Refacción', k: 'nombre' }, { t: 'Cant.', num: true, k: 'cantidad' },
                { t: 'Precio', num: true, r: (r) => dinero(r.precio_unitario) }, { t: 'Importe', num: true, r: (r) => dinero(r.cantidad * r.precio_unitario) }] })}
            ${o.requisicion ? `<div class="aviso-caja" style="margin-top:14px">Requisición <strong>${esc(o.requisicion.folio)}</strong>: ${tag(o.requisicion.estado)}
                ${o.requisicion.estado === 'pendiente' ? ' · Almacén debe surtirla antes de cerrar la orden' : ''}</div>` : ''}`,
        acciones: [
            { texto: 'Cerrar' },
            ...(activa ? [{ texto: 'Cancelar orden', clase: 'btn-peligro', onClick: async () => {
                const motivo = prompt(`Motivo de cancelación de ${o.folio}:`);
                if (motivo === null) return false;
                await api(`/ot/${o.id}/cancelar`, { method: 'POST', body: { motivo } });
                aviso('Orden cancelada', 'ok'); await cargar();
            } }] : []),
            ...(o.estado === 'abierta' ? [{ texto: 'Cerrar orden', clase: 'btn-primario', onClick: async () => {
                await api(`/ot/${o.id}/cerrar`, { method: 'POST' });
                aviso(`Orden ${o.folio} cerrada`, 'ok'); await cargar();
            } }] : []),
            ...(o.estado === 'cerrada' && puedeVer('facturacion') ? [{ texto: 'Facturar', clase: 'btn-primario', onClick: async () => {
                const f = await conAutorizacion((body) => api(`/ot/${o.id}/facturar`, { method: 'POST', body }), {});
                if (!f) return false;
                aviso(`Factura ${f.folio} generada`, 'ok'); await cargar();
            } }] : []),
        ],
    });
}
