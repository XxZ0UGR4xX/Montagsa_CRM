// Producción · Maniobras: movimiento de equipo entre ubicaciones.
const PEST = [['', 'Todas'], ['programada', 'Programadas'], ['en_ruta', 'En ruta'], ['entregada', 'Entregadas'], ['cerrada', 'Cerradas'], ['facturada', 'Facturadas']];
let maniobras = [];
let filtro = '';

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Maniobras', 'Movimiento de equipos entre ubicaciones (carga, entrega, reubicación).',
        '<button class="btn btn-primario" type="button" id="btn-nueva">Nueva maniobra</button>') + `
        <div class="pestanas" role="tablist">${PEST.map(([v, t]) => `<button type="button" data-f="${v}" class="${v === filtro ? 'activa' : ''}">${t}</button>`).join('')}</div>
        <div class="panel" id="tabla"></div>`;
    document.getElementById('btn-nueva').onclick = nueva;
    cont.querySelectorAll('.pestanas button').forEach((b) => {
        b.onclick = () => { filtro = b.dataset.f; cont.querySelectorAll('.pestanas button').forEach((x) => x.classList.toggle('activa', x === b)); cargar(); };
    });
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) detalle(b.dataset.id);
    });
    await cargar();
};

async function cargar() { maniobras = await api(`/maniobras${filtro ? `?estado=${filtro}` : ''}`); pintar(); }

function pintar() {
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay maniobras en esta lista',
        columnas: [
            { t: 'Folio', r: (o) => `<strong>${esc(o.folio)}</strong><div class="sub">${fecha(o.fecha_programada)}</div>` },
            { t: 'Cliente', r: (o) => esc(o.razon_social || 'Interno') },
            { t: 'Equipo', r: (o) => esc(o.numero_economico || o.equipo_cliente || '—') },
            { t: 'Ruta', r: (o) => `${esc(o.origen_maniobra)} → ${esc(o.destino_maniobra)}` },
            { t: 'Operador', r: (o) => esc(o.operador || '—') },
            { t: 'Precio', num: true, r: (o) => dinero(o.precio_cliente) },
            { t: 'Estado', r: (o) => `${tag(o.estado)}${o.factura_folio ? `<div class="sub">${esc(o.factura_folio)}</div>` : ''}` },
            { t: '', clase: 'acciones', r: (o) => `<button class="btn btn-chico" type="button" data-id="${o.id}">Abrir</button>` },
        ],
        filas: maniobras,
    });
}

async function nueva() {
    const cat = await catalogos(true);
    const propios = cat.equipos.filter((e) => !['vendido', 'baja'].includes(e.estado));
    const campos = [
        { k: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', ancho: true, vacio: 'Interno (flota Montagsa)', opciones: opciones(cat.clientes, 'id', 'razon_social') },
        { k: 'equipo_id', etiqueta: 'Equipo de Montagsa', tipo: 'select', vacio: '— Es equipo del cliente —', opciones: opciones(propios, 'id', (e) => `${e.numero_economico} · ${e.marca}`) },
        { k: 'equipo_cliente', etiqueta: 'Equipo del cliente', ayuda: 'Si no es de Montagsa' },
        { k: 'origen', etiqueta: 'Origen', requerido: true },
        { k: 'destino', etiqueta: 'Destino', requerido: true },
        { k: 'fecha_programada', etiqueta: 'Fecha programada', tipo: 'date', defecto: hoy() },
        { k: 'operador_id', etiqueta: 'Operador', tipo: 'select', opciones: opciones(cat.tecnicos, 'id', 'nombre') },
        { k: 'unidad_transporte', etiqueta: 'Unidad de transporte' },
        { k: 'costo_interno', etiqueta: 'Costo interno', tipo: 'number', paso: '0.01', defecto: 0 },
        { k: 'precio_cliente', etiqueta: 'Precio al cliente', tipo: 'number', paso: '0.01', defecto: 0 },
    ];
    modal({
        titulo: 'Nueva maniobra', ancho: 760, cuerpo: formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Crear maniobra', clase: 'btn-primario', onClick: async (m) => {
            const d = leerFormulario(m, campos);
            if (!d.equipo_id && !d.equipo_cliente) throw new Error('Elige un equipo de Montagsa o describe el del cliente');
            const o = await api('/maniobras', { method: 'POST', body: d });
            aviso(`Maniobra ${o.folio} creada`, 'ok');
            await cargar();
        } }],
    });
}

const SIGUIENTE = { programada: ['en_ruta', 'En ruta'], en_ruta: ['entregada', 'Entregada'], entregada: ['cerrada', 'Cerrar maniobra'] };

async function detalle(id) {
    const o = await api(`/ot/${id}`);
    const siguiente = SIGUIENTE[o.estado];
    const activa = !['cerrada', 'facturada', 'cancelada'].includes(o.estado);
    modal({
        titulo: `Maniobra ${o.folio}`, ancho: 700,
        cuerpo: `<dl class="datos">
            <dt>Estado</dt><dd>${tag(o.estado)}</dd>
            <dt>Cliente</dt><dd>${esc(o.razon_social || 'Interno')}</dd>
            <dt>Equipo</dt><dd>${esc(o.numero_economico || o.equipo_cliente || '—')}</dd>
            <dt>Ruta</dt><dd>${esc(o.origen_maniobra)} → ${esc(o.destino_maniobra)}</dd>
            <dt>Fecha programada</dt><dd>${fecha(o.fecha_programada)}</dd>
            <dt>Operador</dt><dd>${esc(o.tecnico || '—')}</dd>
            <dt>Unidad</dt><dd>${esc(o.unidad_transporte || '—')}</dd>
            <dt>Costo interno</dt><dd>${dinero(o.costo_interno)}</dd>
            <dt>Precio cliente</dt><dd>${dinero(o.precio_cliente)}</dd>
        </dl>`,
        acciones: [
            { texto: 'Cerrar' },
            ...(activa ? [{ texto: 'Cancelar maniobra', clase: 'btn-peligro', onClick: async () => {
                const motivo = prompt(`Motivo de cancelación de ${o.folio}:`);
                if (motivo === null) return false;
                await api(`/ot/${o.id}/cancelar`, { method: 'POST', body: { motivo } });
                aviso('Maniobra cancelada', 'ok'); await cargar();
            } }] : []),
            ...(siguiente ? [{ texto: siguiente[1], clase: 'btn-primario', onClick: async () => {
                await api(`/maniobras/${o.id}/estado`, { method: 'POST', body: { estado: siguiente[0] } });
                aviso(`Maniobra ${o.folio}: ${etiqueta(siguiente[0])}`, 'ok'); await cargar();
            } }] : []),
            ...(o.estado === 'cerrada' && o.cliente_id && puedeVer('facturacion') ? [{ texto: 'Facturar', clase: 'btn-primario', onClick: async () => {
                const f = await conAutorizacion((body) => api(`/ot/${o.id}/facturar`, { method: 'POST', body }), {});
                if (!f) return false;
                aviso(`Factura ${f.folio} generada`, 'ok'); await cargar();
            } }] : []),
        ],
    });
}
