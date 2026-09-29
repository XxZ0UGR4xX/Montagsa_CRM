// CRM · Clientes: alta, edición, ficha con historial e interacciones.
const ETAPAS = [['prospecto', 'Prospecto'], ['activo', 'Activo'], ['frecuente', 'Frecuente'], ['inactivo', 'Inactivo']];
const CAMPOS_CLIENTE = [
    { k: 'razon_social', etiqueta: 'Razón social', requerido: true, ancho: true },
    { k: 'rfc', etiqueta: 'RFC' },
    { k: 'etapa', etiqueta: 'Etapa CRM', tipo: 'select', opciones: ETAPAS, vacio: false, defecto: 'prospecto' },
    { k: 'contacto', etiqueta: 'Contacto' },
    { k: 'telefono', etiqueta: 'Teléfono' },
    { k: 'email', etiqueta: 'Correo', tipo: 'email', ancho: true },
    { k: 'direccion', etiqueta: 'Dirección', ancho: true },
    { k: 'notas', etiqueta: 'Notas', tipo: 'textarea', ancho: true },
];
const TIPOS_INTERACCION = [['llamada', 'Llamada'], ['correo', 'Correo'], ['visita', 'Visita'], ['whatsapp', 'WhatsApp'], ['cotizacion', 'Cotización'], ['soporte', 'Soporte']];

let clientes = [];

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Clientes', 'Cartera de clientes, su etapa comercial y su situación de crédito.',
        `<button class="btn" type="button" id="btn-csv">Exportar CSV</button>
         <button class="btn btn-primario" type="button" id="btn-nuevo">Nuevo cliente</button>`) + `
        <div class="filtros" style="margin-bottom:14px">
            <input type="search" id="q" placeholder="Buscar por nombre, RFC o contacto" aria-label="Buscar">
            <select id="f-etapa" aria-label="Etapa"><option value="">Todas las etapas</option>${ETAPAS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
        </div>
        <div class="panel" id="tabla"></div>`;

    document.getElementById('btn-nuevo').onclick = () => editar(null);
    document.getElementById('q').addEventListener('input', () => cargar());
    document.getElementById('f-etapa').addEventListener('change', () => cargar());
    document.getElementById('btn-csv').onclick = () => exportarCSV('clientes', [
        { t: 'Razón social', k: 'razon_social' }, { t: 'RFC', k: 'rfc' }, { t: 'Contacto', k: 'contacto' }, { t: 'Teléfono', k: 'telefono' },
        { t: 'Correo', k: 'email' }, { t: 'Etapa', k: 'etapa' }, { t: 'Crédito', k: 'credito_estado' }, { t: 'Saldo', k: 'saldo' }], clientes);
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.ver) ficha(b.dataset.ver);
        if (b.dataset.editar) editar(clientes.find((c) => String(c.id) === b.dataset.editar));
    });
    await cargar();
};

async function cargar() {
    const q = document.getElementById('q').value.trim();
    const etapa = document.getElementById('f-etapa').value;
    clientes = await api(`/clientes?q=${encodeURIComponent(q)}&etapa=${etapa}`);
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay clientes con ese filtro',
        columnas: [
            { t: 'Cliente', r: (c) => `<strong>${esc(c.razon_social)}</strong><div class="sub">${esc(c.rfc || 'Sin RFC')}</div>` },
            { t: 'Contacto', r: (c) => `${esc(c.contacto || '—')}<div class="sub">${esc(c.telefono || '')}</div>` },
            { t: 'Etapa', r: (c) => tag(c.etapa) },
            { t: 'Crédito', r: (c) => tag(c.credito_estado) },
            { t: 'Saldo', num: true, r: (c) => (c.saldo > 0 ? dinero(c.saldo) : '<span class="tenue">—</span>') },
            { t: 'Rentas activas', num: true, k: 'rentas_activas' },
            { t: 'Último contacto', r: (c) => (c.ultima_interaccion ? fecha(c.ultima_interaccion) : '<span class="tenue">Nunca</span>') },
            { t: '', clase: 'acciones', r: (c) => `<button class="btn btn-chico" type="button" data-ver="${c.id}">Ficha</button> <button class="btn btn-chico" type="button" data-editar="${c.id}">Editar</button>` },
        ],
        filas: clientes,
    });
}

function editar(c) {
    modal({
        titulo: c ? 'Editar cliente' : 'Nuevo cliente',
        cuerpo: formulario(CAMPOS_CLIENTE, c || {}) + (c ? '' : '<p class="tenue" style="margin-top:12px">El límite y los días de crédito los asigna Administración en Créditos.</p>'),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', clase: 'btn-primario', onClick: async (m) => {
            const datos = leerFormulario(m, CAMPOS_CLIENTE);
            await api(c ? `/clientes/${c.id}` : '/clientes', { method: c ? 'PUT' : 'POST', body: datos });
            aviso('Cliente guardado', 'ok');
            await cargar();
        } }],
    });
}

async function ficha(id) {
    const c = await api(`/clientes/${id}`);
    const puedeInteractuar = puedeVer('interacciones');
    const m = modal({
        titulo: c.razon_social, ancho: 880,
        cuerpo: `
            <div class="rejilla">
                <dl class="datos">
                    <dt>RFC</dt><dd>${esc(c.rfc || '—')}</dd>
                    <dt>Contacto</dt><dd>${esc(c.contacto || '—')}</dd>
                    <dt>Teléfono</dt><dd>${esc(c.telefono || '—')}</dd>
                    <dt>Correo</dt><dd>${esc(c.email || '—')}</dd>
                    <dt>Dirección</dt><dd>${esc(c.direccion || '—')}</dd>
                </dl>
                <dl class="datos">
                    <dt>Etapa</dt><dd>${tag(c.etapa)}</dd>
                    <dt>Crédito</dt><dd>${tag(c.credito_estado)} ${c.credito_estado !== 'sin_credito' ? `${dinero(c.limite_credito)} a ${c.dias_credito} días` : ''}</dd>
                    <dt>Saldo por cobrar</dt><dd><strong>${dinero(c.saldo)}</strong></dd>
                </dl>
            </div>
            <div class="pestanas" style="margin-top:18px" role="tablist">
                <button type="button" class="activa" data-p="interacciones">Interacciones (${c.interacciones.length})</button>
                <button type="button" data-p="rentas">Rentas (${c.rentas.length})</button>
                <button type="button" data-p="facturas">Facturas (${c.facturas.length})</button>
                <button type="button" data-p="servicios">Servicios (${c.servicios.length})</button>
            </div>
            <div data-panel="interacciones">
                ${puedeInteractuar ? `<div class="form" style="margin-bottom:14px">
                    <div class="campo"><label for="i-tipo">Tipo</label><select id="i-tipo">${TIPOS_INTERACCION.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
                    <div class="campo" style="justify-content:flex-end"><button class="btn btn-primario" type="button" id="i-guardar">Registrar interacción</button></div>
                    <div class="campo ancho"><label for="i-desc">Descripción</label><textarea id="i-desc" placeholder="¿Qué se habló, qué se acordó?"></textarea></div>
                </div>` : ''}
                <ul class="linea-tiempo">${c.interacciones.map((i) => `<li><strong>${esc(TIPOS_INTERACCION.find(([v]) => v === i.tipo)?.[1] || i.tipo)}</strong> · ${fecha(i.fecha)} <span class="tenue">${esc(i.usuario || '')}</span><div>${esc(i.descripcion)}</div></li>`).join('') || '<li class="tenue">Sin interacciones registradas</li>'}</ul>
            </div>
            <div data-panel="rentas" class="oculto">${tabla({ vacio: 'Sin rentas', filas: c.rentas, columnas: [
                { t: 'Folio', k: 'folio' }, { t: 'Equipo', k: 'numero_economico' }, { t: 'Periodo', r: (r) => `${fecha(r.fecha_inicio)} a ${fecha(r.fecha_fin)}` },
                { t: 'Importe', num: true, r: (r) => dinero(r.importe) }, { t: 'Estado', r: (r) => tag(r.estado) }] })}</div>
            <div data-panel="facturas" class="oculto">${tabla({ vacio: 'Sin facturas', filas: c.facturas, columnas: [
                { t: 'Folio', k: 'folio' }, { t: 'Origen', k: 'origen' }, { t: 'Vence', r: (f) => fecha(f.fecha_vencimiento) },
                { t: 'Total', num: true, r: (f) => dinero(f.total) }, { t: 'Saldo', num: true, r: (f) => dinero(f.total - f.pagado) }, { t: 'Estado', r: (f) => tag(f.estado) }] })}</div>
            <div data-panel="servicios" class="oculto">${tabla({ vacio: 'Sin servicios', filas: c.servicios, columnas: [
                { t: 'Folio', k: 'folio' }, { t: 'Tipo', k: 'tipo' }, { t: 'Programado', r: (s) => fecha(s.fecha_programada) }, { t: 'Estado', r: (s) => tag(s.estado) }] })}</div>`,
    });
    m.el.querySelectorAll('.pestanas button').forEach((b) => {
        b.onclick = () => {
            m.el.querySelectorAll('.pestanas button').forEach((x) => x.classList.toggle('activa', x === b));
            m.el.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('oculto', p.dataset.panel !== b.dataset.p));
        };
    });
    const g = m.el.querySelector('#i-guardar');
    if (g) g.onclick = async () => {
        const descripcion = m.el.querySelector('#i-desc').value.trim();
        if (!descripcion) return aviso('Escribe la descripción', 'error');
        try {
            await api('/interacciones', { method: 'POST', body: { cliente_id: c.id, tipo: m.el.querySelector('#i-tipo').value, descripcion } });
            aviso('Interacción registrada', 'ok');
            m.cerrar();
            await ficha(c.id);
            await cargar();
        } catch (e) { avisoError(e); }
    };
}
