// Almacén · Requisiciones de refacciones pedidas por Producción.
const PEST = [['pendiente', 'Pendientes'], ['surtida', 'Surtidas'], ['', 'Todas']];
const TIPO_OT_TXT = { servicio: 'Servicio', refaccion: 'Refacciones' };
let requisiciones = [];
let filtro = 'pendiente';

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Requisiciones', 'Refacciones pedidas por Producción para una orden de trabajo. Al surtir se descuenta el inventario y se genera la póliza de costo.') + `
        <div class="pestanas" role="tablist">${PEST.map(([v, t]) => `<button type="button" data-f="${v}" class="${v === filtro ? 'activa' : ''}">${t}</button>`).join('')}</div>
        <div class="panel" id="tabla"></div>`;
    cont.querySelectorAll('.pestanas button').forEach((b) => {
        b.onclick = () => { filtro = b.dataset.f; cont.querySelectorAll('.pestanas button').forEach((x) => x.classList.toggle('activa', x === b)); pintar(); };
    });
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) detalle(b.dataset.id);
    });
    await cargar();
};

async function cargar() { requisiciones = await api('/requisiciones'); pintar(); }

function pintar() {
    const filas = filtro ? requisiciones.filter((r) => r.estado === filtro) : requisiciones;
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay requisiciones en esta lista',
        columnas: [
            { t: 'Folio', r: (r) => `<strong>${esc(r.folio)}</strong><div class="sub">${fecha(r.fecha)}</div>` },
            { t: 'Orden de trabajo', r: (r) => `${esc(r.ot_folio)}<div class="sub">${esc(TIPO_OT_TXT[r.ot_tipo] || r.ot_tipo)}: ${esc(r.ot_descripcion || '')}</div>` },
            { t: 'Partidas', num: true, k: 'partidas' },
            { t: 'Estado', r: (r) => tag(r.estado) },
            { t: '', clase: 'acciones', r: (r) => `<button class="btn btn-chico" type="button" data-id="${r.id}">Abrir</button>` },
        ],
        filas,
    });
}

async function detalle(id) {
    const rq = await api(`/requisiciones/${id}`);
    modal({
        titulo: `Requisición ${rq.folio} · ${rq.ot_folio}`, ancho: 640,
        cuerpo: `
            <dl class="datos" style="margin-bottom:16px">
                <dt>Estado</dt><dd>${tag(rq.estado)}</dd>
                <dt>Orden</dt><dd>${esc(rq.ot_folio)} — ${esc(rq.ot_descripcion || TIPO_OT_TXT[rq.ot_tipo] || rq.ot_tipo)}</dd>
                <dt>Solicitada</dt><dd>${fecha(rq.fecha)}</dd>
                ${rq.fecha_surtido ? `<dt>Surtida</dt><dd>${fecha(rq.fecha_surtido)}</dd>` : ''}
            </dl>
            ${tabla({
                columnas: [
                    { t: 'SKU', k: 'sku' }, { t: 'Refacción', k: 'nombre' },
                    { t: 'Cantidad', num: true, k: 'cantidad' }, { t: 'Stock actual', num: true, k: 'stock' },
                ],
                filas: rq.items,
            })}`,
        acciones: [
            { texto: 'Cerrar' },
            ...(rq.estado === 'pendiente' ? [{ texto: 'Surtir (descuenta inventario)', clase: 'btn-primario', onClick: async () => {
                await api(`/requisiciones/${rq.id}/surtir`, { method: 'POST' });
                aviso(`Requisición ${rq.folio} surtida`, 'ok');
                await cargar();
            } }] : []),
        ],
    });
}
