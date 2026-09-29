// Almacén · Máximos y mínimos: qué reponer y cuánto.
let datos = null;

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Máximos y mínimos',
        'Cuando una refacción llega a su mínimo se sugiere comprar hasta su máximo. Las que ya están en una orden abierta no se vuelven a pedir.',
        puedeVer('compras') ? '<button class="btn btn-primario" type="button" id="btn-oc">Generar órdenes de compra</button>' : '') +
        '<div id="kpis"></div><div class="panel" id="tabla"></div>';
    if (puedeVer('compras')) document.getElementById('btn-oc').onclick = generar;
    await cargar();
};

async function cargar() {
    datos = await api('/maxmin');
    const r = datos.resumen;
    document.getElementById('kpis').innerHTML = `<div class="kpis">
        ${kpi('Agotados', r.agotado, '', r.agotado ? 'alerta' : '')}
        ${kpi('Bajo mínimo', r.bajo_minimo, '', r.bajo_minimo ? 'aviso' : '')}
        ${kpi('Sobre máximo', r.sobre_maximo, 'Dinero detenido en almacén')}
        ${kpi('En rango', r.ok, '', 'bien')}
        ${kpi('Valor del inventario', pesos(r.valor_inventario))}
    </div>`;
    const selec = puedeVer('compras');
    document.getElementById('tabla').innerHTML = tabla({
        columnas: [
            ...(selec ? [{ t: '', r: (f) => (f.sugerido > 0 && !f.en_orden && f.proveedor ? `<input type="checkbox" data-id="${f.id}" checked aria-label="Incluir ${esc(f.sku)}">` : '') }] : []),
            { t: 'Refacción', r: (f) => `<strong>${esc(f.nombre)}</strong><div class="sub">${esc(f.sku)}</div>` },
            { t: 'Situación', r: (f) => tag(f.situacion) },
            { t: 'Stock', num: true, r: (f) => `<strong>${f.stock}</strong>` },
            { t: 'Mínimo', num: true, k: 'minimo' },
            { t: 'Máximo', num: true, k: 'maximo' },
            { t: 'A pedir', num: true, r: (f) => (f.sugerido ? `<strong>${f.sugerido}</strong> <span class="tenue">${esc(f.unidad)}</span>` : '—') },
            { t: 'Costo estimado', num: true, r: (f) => (f.sugerido ? dinero(f.sugerido * f.costo) : '—') },
            { t: 'Proveedor', r: (f) => (f.proveedor ? `${esc(f.proveedor)}<div class="sub">entrega en ${f.tiempo_entrega_dias} días</div>` : '<span class="tenue">Sin proveedor</span>') },
            { t: '', r: (f) => (f.en_orden ? '<span class="tag" style="--c: var(--azul)">Ya en orden</span>' : '') },
        ],
        filas: datos.filas,
    });
}

async function generar() {
    const ids = [...document.querySelectorAll('#tabla input[type=checkbox]:checked')].map((c) => Number(c.dataset.id));
    if (!ids.length) return aviso('No hay refacciones seleccionadas para pedir', 'error');
    if (!(await confirmar(`Se crearán órdenes de compra en borrador para ${ids.length} refacciones, una por proveedor.`, 'Generar'))) return;
    try {
        const r = await api('/maxmin/generar-oc', { method: 'POST', body: { producto_ids: ids } });
        aviso(r.creadas.length ? `Órdenes creadas: ${r.creadas.map((o) => o.folio).join(', ')}` : 'No hubo nada que pedir', 'ok');
        await cargar();
    } catch (e) { avisoError(e); }
}
