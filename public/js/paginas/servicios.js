// Comercial · Órdenes de servicio (taller y en sitio).
const TIPOS_OS = [['preventivo', 'Preventivo'], ['correctivo', 'Correctivo'], ['diagnostico', 'Diagnóstico'], ['instalacion', 'Instalación']];
const PEST = [['abiertas', 'Abiertas'], ['terminada', 'Por facturar'], ['cerradas', 'Cerradas'], ['', 'Todas']];
let servicios = [];
let filtro = 'abiertas';

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Servicios', 'Mantenimiento y reparación a equipos de clientes y a la flota propia. Las refacciones usadas se descuentan del inventario.',
        '<button class="btn btn-primario" type="button" id="btn-nueva">Nueva orden</button>') + `
        <div class="pestanas" role="tablist">${PEST.map(([v, t]) => `<button type="button" data-f="${v}" class="${v === filtro ? 'activa' : ''}">${t}</button>`).join('')}</div>
        <div class="panel" id="tabla"></div>`;
    document.getElementById('btn-nueva').onclick = nueva;
    cont.querySelectorAll('.pestanas button').forEach((b) => {
        b.onclick = () => { filtro = b.dataset.f; cont.querySelectorAll('.pestanas button').forEach((x) => x.classList.toggle('activa', x === b)); pintar(); };
    });
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) detalle(b.dataset.id);
    });
    await cargar();
};

async function cargar() { servicios = await api('/servicios'); pintar(); }

function pintar() {
    const f = {
        abiertas: (s) => ['abierta', 'en_proceso'].includes(s.estado),
        terminada: (s) => s.estado === 'terminada',
        cerradas: (s) => ['facturada', 'cancelada'].includes(s.estado),
    }[filtro] || (() => true);
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay órdenes en esta lista',
        columnas: [
            { t: 'Folio', r: (s) => `<strong>${esc(s.folio)}</strong><div class="sub">${fecha(s.fecha_programada)}</div>` },
            { t: 'Cliente', r: (s) => (s.razon_social ? esc(s.razon_social) : '<span class="tenue">Interno (flota)</span>') },
            { t: 'Equipo', r: (s) => esc(s.numero_economico || s.equipo_cliente) },
            { t: 'Tipo', r: (s) => esc(TIPOS_OS.find(([v]) => v === s.tipo)?.[1] || s.tipo) },
            { t: 'Técnico', r: (s) => esc(s.tecnico || '—') },
            { t: 'Importe', num: true, r: (s) => dinero(s.mano_obra + s.refacciones_importe) },
            { t: 'Estado', r: (s) => `${tag(s.estado)}${s.factura_folio ? `<div class="sub">${esc(s.factura_folio)}</div>` : ''}` },
            { t: '', clase: 'acciones', r: (s) => `<button class="btn btn-chico" type="button" data-id="${s.id}">Abrir</button>` },
        ],
        filas: servicios.filter(f),
    });
}

async function nueva() {
    const cat = await catalogos(true);
    const propios = cat.equipos.filter((e) => !['vendido', 'baja'].includes(e.estado));
    const campos = [
        { k: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', ancho: true, vacio: 'Servicio interno (flota Montagsa)', opciones: opciones(cat.clientes, 'id', 'razon_social') },
        { k: 'equipo_id', etiqueta: 'Equipo de Montagsa', tipo: 'select', vacio: '— Es equipo del cliente —', opciones: opciones(propios, 'id', (e) => `${e.numero_economico} · ${e.marca} (${etiqueta(e.estado)})`) },
        { k: 'equipo_cliente', etiqueta: 'Equipo del cliente', ayuda: 'Marca, modelo y serie si no es de Montagsa' },
        { k: 'tipo', etiqueta: 'Tipo de servicio', tipo: 'select', opciones: TIPOS_OS, vacio: false },
        { k: 'tecnico_id', etiqueta: 'Técnico', tipo: 'select', opciones: opciones(cat.tecnicos, 'id', 'nombre') },
        { k: 'mano_obra', etiqueta: 'Mano de obra', tipo: 'number', paso: '0.01', defecto: 0 },
        { k: 'fecha_programada', etiqueta: 'Fecha programada', tipo: 'date', defecto: hoy() },
        { k: 'descripcion', etiqueta: 'Trabajo a realizar / falla reportada', tipo: 'textarea', requerido: true, ancho: true },
    ];
    modal({
        titulo: 'Nueva orden de servicio', ancho: 720,
        cuerpo: formulario(campos) + '<p class="tenue" style="margin-top:12px">Si el equipo es de Montagsa y está en patio, pasa a Reparación mientras dura la orden.</p>',
        acciones: [{ texto: 'Cancelar' }, { texto: 'Crear orden', clase: 'btn-primario', onClick: async (m) => {
            const d = leerFormulario(m, campos);
            if (!d.equipo_id && !d.equipo_cliente) throw new Error('Elige un equipo de Montagsa o describe el del cliente');
            const s = await api('/servicios', { method: 'POST', body: d });
            aviso(`Orden ${s.folio} creada`, 'ok');
            await cargar();
        } }],
    });
}

async function detalle(id) {
    const [s, cat] = await Promise.all([api(`/servicios/${id}`), catalogos(true)]);
    const abierta = ['abierta', 'en_proceso'].includes(s.estado);
    const refImporte = s.refacciones.reduce((t, r) => t + r.cantidad * r.precio_unitario, 0);
    const siguientes = { abierta: [['en_proceso', 'Iniciar trabajo']], en_proceso: [['terminada', 'Marcar terminada']] }[s.estado] || [];
    const m = modal({
        titulo: `Orden ${s.folio}`, ancho: 860,
        cuerpo: `
            <dl class="datos" style="margin-bottom:16px">
                <dt>Estado</dt><dd>${tag(s.estado)}</dd>
                <dt>Cliente</dt><dd>${esc(s.razon_social || 'Interno (flota Montagsa)')}</dd>
                <dt>Equipo</dt><dd>${esc(s.numero_economico || s.equipo_cliente)}</dd>
                <dt>Tipo</dt><dd>${esc(s.tipo)}</dd>
                <dt>Técnico</dt><dd>${esc(s.tecnico || 'Sin asignar')}</dd>
                <dt>Trabajo</dt><dd>${esc(s.descripcion)}</dd>
            </dl>
            ${['abierta', 'en_proceso', 'terminada'].includes(s.estado) ? `
            <div class="form" style="margin-bottom:16px">
                <div class="campo"><label for="s-tecnico">Técnico</label><select id="s-tecnico"><option value="">Sin asignar</option>${cat.tecnicos.map((t) => `<option value="${t.id}" ${t.id === s.tecnico_id ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></div>
                <div class="campo"><label for="s-mo">Mano de obra</label><input id="s-mo" type="number" step="0.01" min="0" value="${s.mano_obra}"></div>
                <div class="campo ancho" style="align-items:flex-start"><button class="btn" type="button" id="s-guardar">Guardar técnico y mano de obra</button></div>
            </div>` : ''}
            <h4 style="margin-bottom:8px">Refacciones usadas</h4>
            ${tabla({ vacio: 'Sin refacciones', filas: s.refacciones, columnas: [
                { t: 'SKU', k: 'sku' }, { t: 'Refacción', k: 'nombre' }, { t: 'Cant.', num: true, k: 'cantidad' },
                { t: 'Precio', num: true, r: (r) => dinero(r.precio_unitario) }, { t: 'Importe', num: true, r: (r) => dinero(r.cantidad * r.precio_unitario) }] })}
            ${abierta ? `
            <div class="form" style="margin-top:12px">
                <div class="campo"><label for="s-prod">Agregar refacción</label><select id="s-prod"><option value="">— Refacción —</option>${cat.productos.filter((p) => p.stock > 0).map((p) => `<option value="${p.id}">${esc(p.sku)} · ${esc(p.nombre)} (hay ${p.stock})</option>`).join('')}</select></div>
                <div class="campo"><label for="s-cant">Cantidad</label><input id="s-cant" type="number" min="1" value="1"></div>
                <div class="campo ancho" style="align-items:flex-start"><button class="btn" type="button" id="s-agregar">Agregar y descontar del inventario</button></div>
            </div>` : ''}
            <div class="aviso-caja" style="margin-top:16px">Mano de obra ${dinero(s.mano_obra)} + refacciones ${dinero(refImporte)} = <strong>${dinero(s.mano_obra + refImporte)}</strong> antes de IVA</div>`,
        acciones: [
            { texto: 'Cerrar' },
            ...(abierta ? [{ texto: 'Cancelar orden', clase: 'btn-peligro', onClick: () => cambiar(s, 'cancelada') }] : []),
            ...siguientes.map(([est, txt]) => ({ texto: txt, clase: 'btn-primario', onClick: () => cambiar(s, est) })),
            ...(s.estado === 'terminada' && s.cliente_id && puedeVer('facturacion') ? [{ texto: 'Facturar', clase: 'btn-primario', onClick: () => facturar(s) }] : []),
        ],
    });
    const g = m.el.querySelector('#s-guardar');
    if (g) g.onclick = async () => {
        try {
            await api(`/servicios/${s.id}`, { method: 'PUT', body: { tecnico_id: m.el.querySelector('#s-tecnico').value, mano_obra: Number(m.el.querySelector('#s-mo').value) || 0 } });
            aviso('Orden actualizada', 'ok'); m.cerrar(); await cargar(); detalle(s.id);
        } catch (e) { avisoError(e); }
    };
    const a = m.el.querySelector('#s-agregar');
    if (a) a.onclick = async () => {
        const producto_id = m.el.querySelector('#s-prod').value;
        if (!producto_id) return aviso('Elige la refacción', 'error');
        try {
            await api(`/servicios/${s.id}/refacciones`, { method: 'POST', body: { producto_id, cantidad: Number(m.el.querySelector('#s-cant').value) } });
            aviso('Refacción agregada', 'ok'); m.cerrar(); await cargar(); detalle(s.id);
        } catch (e) { avisoError(e); }
    };
}

async function cambiar(s, estado) {
    if (estado === 'cancelada' && !(await confirmar(`¿Cancelar la orden ${s.folio}? Las refacciones ya usadas no regresan al inventario.`, 'Cancelar orden'))) return false;
    await api(`/servicios/${s.id}/estado`, { method: 'POST', body: { estado } });
    aviso(`Orden ${s.folio}: ${etiqueta(estado)}`, 'ok');
    await cargar();
}

async function facturar(s) {
    const f = await conAutorizacion((body) => api(`/servicios/${s.id}/facturar`, { method: 'POST', body }), {});
    if (!f) return false;
    aviso(`Factura ${f.folio} generada`, 'ok');
    await cargar();
}
