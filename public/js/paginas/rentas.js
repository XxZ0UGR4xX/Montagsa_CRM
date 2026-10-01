// Comercial · Rentas de equipo.
const PERIODOS = [['diaria', 'Diaria'], ['semanal', 'Semanal'], ['mensual', 'Mensual']];
const TXT_PERIODO = { diaria: ['día', 'días'], semanal: ['semana', 'semanas'], mensual: ['mes', 'meses'] };
const PEST = [['activa', 'Activas'], ['finalizada', 'Finalizadas'], ['cancelada', 'Canceladas'], ['', 'Todas']];
let rentas = [];
let filtro = 'activa';

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Rentas', 'Contratos de renta. Al crear una renta el equipo pasa a "En renta"; al finalizarla regresa a disponible o a reparación.',
        '<button class="btn btn-primario" type="button" id="btn-nueva">Nueva renta</button>') + `
        <div class="pestanas" role="tablist">${PEST.map(([v, t]) => `<button type="button" data-f="${v}" class="${v === filtro ? 'activa' : ''}">${t}</button>`).join('')}</div>
        <div class="panel" id="tabla"></div>`;
    document.getElementById('btn-nueva').onclick = nueva;
    cont.querySelectorAll('.pestanas button').forEach((b) => {
        b.onclick = () => { filtro = b.dataset.f; cont.querySelectorAll('.pestanas button').forEach((x) => x.classList.toggle('activa', x === b)); pintar(); };
    });
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const r = rentas.find((x) => String(x.id) === b.dataset.id);
        ({ facturar, finalizar, cancelar, detalle })[b.dataset.acc]?.(r);
    });
    await cargar();
    const id = idDeUrl();
    const r = id && rentas.find((x) => String(x.id) === id);
    if (r) detalle(r);
};

function detalle(r) {
    const [u, v] = TXT_PERIODO[r.periodo];
    const m = modal({
        titulo: `Renta ${r.folio}`, ancho: 820,
        cuerpo: `<dl class="datos" style="margin-bottom:16px">
                <dt>Cliente</dt><dd><strong>${esc(r.razon_social)}</strong></dd>
                <dt>Equipo</dt><dd>${esc(r.numero_economico)} · ${esc(r.marca)} ${esc(r.modelo || '')}</dd>
                <dt>Estado</dt><dd>${tag(r.estado)}</dd>
                <dt>Periodo</dt><dd>${r.cantidad_periodos} ${r.cantidad_periodos === 1 ? u : v} a ${dinero(r.tarifa)} c/u</dd>
                <dt>Vigencia</dt><dd>${fecha(r.fecha_inicio)} a ${fecha(r.fecha_fin)}</dd>
                <dt>Importe</dt><dd><strong>${dinero(r.importe)}</strong>${r.deposito > 0 ? ` · depósito ${dinero(r.deposito)}` : ''}</dd>
                <dt>Factura</dt><dd>${r.factura_folio ? esc(r.factura_folio) : '<span class="tenue">Sin facturar</span>'}</dd>
            </dl>
            <h4 style="margin:18px 0 8px">Bitácora</h4>
            <div id="bitacora-renta"></div>`,
    });
    panelBitacora(m.el.querySelector('#bitacora-renta'), 'renta', r.id);
}

async function cargar() { rentas = await api('/rentas'); pintar(); }

function venceTxt(r) {
    if (r.estado !== 'activa') return '';
    if (r.dias_restantes < 0) return `<div class="sub" style="color:var(--rojo)">Vencida hace ${-r.dias_restantes} d</div>`;
    if (r.dias_restantes <= 7) return `<div class="sub" style="color:var(--naranja)">Vence en ${r.dias_restantes} d</div>`;
    return `<div class="sub">Faltan ${r.dias_restantes} d</div>`;
}

function pintar() {
    const filas = filtro ? rentas.filter((r) => r.estado === filtro) : rentas;
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay rentas en esta lista',
        columnas: [
            { t: 'Folio', r: (r) => `<strong>${esc(r.folio)}</strong>` },
            { t: 'Cliente', k: 'razon_social' },
            { t: 'Equipo', r: (r) => `${esc(r.numero_economico)}<div class="sub">${esc(r.marca)} ${esc(r.modelo || '')}</div>` },
            { t: 'Periodo', r: (r) => { const [u, v] = TXT_PERIODO[r.periodo]; return `${r.cantidad_periodos} ${r.cantidad_periodos === 1 ? u : v}<div class="sub">${dinero(r.tarifa)} c/u</div>`; } },
            { t: 'Importe', num: true, r: (r) => dinero(r.importe) },
            { t: 'Vigencia', r: (r) => `${fecha(r.fecha_inicio)} a ${fecha(r.fecha_fin)}${venceTxt(r)}` },
            { t: 'Estado', r: (r) => tag(r.estado) },
            { t: 'Factura', r: (r) => (r.factura_folio ? `${esc(r.factura_folio)}<div class="sub">${etiqueta(r.factura_estado)}</div>` : '<span class="tenue">Sin facturar</span>') },
            { t: '', clase: 'acciones', r: (r) => [
                `<button class="btn btn-chico" type="button" data-acc="detalle" data-id="${r.id}">Ver</button>`,
                !r.factura_id && r.estado !== 'cancelada' ? `<button class="btn btn-chico" type="button" data-acc="facturar" data-id="${r.id}">Facturar</button>` : '',
                r.estado === 'activa' ? `<button class="btn btn-chico" type="button" data-acc="finalizar" data-id="${r.id}">Finalizar</button>` : '',
                r.estado === 'activa' && !r.factura_id ? `<button class="btn btn-chico btn-peligro" type="button" data-acc="cancelar" data-id="${r.id}">Cancelar</button>` : '',
            ].join(' ') },
        ],
        filas,
    });
}

async function nueva() {
    const cat = await catalogos(true);
    const disponibles = cat.equipos.filter((e) => e.estado === 'disponible');
    if (!disponibles.length) return aviso('No hay equipos disponibles para rentar', 'error');
    const campos = [
        { k: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', requerido: true, ancho: true, opciones: opciones(cat.clientes, 'id', (c) => `${c.razon_social}${c.credito_estado === 'suspendido' ? ' (crédito suspendido)' : ''}`) },
        { k: 'equipo_id', etiqueta: 'Equipo disponible', tipo: 'select', requerido: true, ancho: true, opciones: opciones(disponibles, 'id', (e) => `${e.numero_economico} · ${e.marca} ${e.modelo || ''} (${e.tipo})`) },
        { k: 'periodo', etiqueta: 'Periodo', tipo: 'select', opciones: PERIODOS, vacio: false, defecto: 'mensual' },
        { k: 'cantidad_periodos', etiqueta: 'Cantidad de periodos', tipo: 'number', defecto: 1, requerido: true },
        { k: 'tarifa', etiqueta: 'Tarifa por periodo', tipo: 'number', paso: '0.01', ayuda: 'Se llena con la tarifa del equipo; puedes negociarla' },
        { k: 'deposito', etiqueta: 'Depósito en garantía', tipo: 'number', paso: '0.01', defecto: 0 },
        { k: 'fecha_inicio', etiqueta: 'Fecha de inicio', tipo: 'date', defecto: hoy() },
        { k: 'notas', etiqueta: 'Notas (lugar de entrega, operador, etc.)', tipo: 'textarea', ancho: true },
    ];
    const m = modal({
        titulo: 'Nueva renta', ancho: 700,
        cuerpo: formulario(campos) + '<div class="aviso-caja" id="calc" style="margin-top:14px">Selecciona un equipo para calcular el importe.</div>',
        acciones: [{ texto: 'Cancelar' }, { texto: 'Crear renta', clase: 'btn-primario', onClick: async (el) => {
            const d = leerFormulario(el, campos);
            const r = await conAutorizacion((body) => api('/rentas', { method: 'POST', body }), d);
            if (!r) return false;
            aviso(`Renta ${r.folio} creada`, 'ok');
            await cargar();
        } }],
    });
    const $ = (k) => m.el.querySelector(`[name="${k}"]`);
    const recalcular = (ponerTarifa) => {
        const eq = disponibles.find((e) => String(e.id) === $('equipo_id').value);
        const periodo = $('periodo').value;
        if (eq && ponerTarifa) $('tarifa').value = eq[`tarifa_${periodo}`];
        const cant = Number($('cantidad_periodos').value) || 0;
        const tarifa = Number($('tarifa').value) || 0;
        const dias = { diaria: 1, semanal: 7, mensual: 30 }[periodo] * cant;
        const ini = new Date(`${$('fecha_inicio').value || hoy()}T12:00:00`);
        ini.setDate(ini.getDate() + dias);
        m.el.querySelector('#calc').innerHTML = eq
            ? `Importe: <strong>${dinero(tarifa * cant)}</strong> + IVA = <strong>${dinero(tarifa * cant * 1.16)}</strong> · termina el <strong>${fecha(ini.toISOString())}</strong>`
            : 'Selecciona un equipo para calcular el importe.';
    };
    $('equipo_id').addEventListener('change', () => recalcular(true));
    $('periodo').addEventListener('change', () => recalcular(true));
    ['cantidad_periodos', 'tarifa', 'fecha_inicio'].forEach((k) => $(k).addEventListener('input', () => recalcular(false)));
}

async function facturar(r) {
    if (!(await confirmar(`Se facturará la renta ${r.folio} por ${dinero(r.importe)} + IVA a ${r.razon_social}.`, 'Facturar'))) return;
    try {
        const f = await conAutorizacion((body) => api(`/rentas/${r.id}/facturar`, { method: 'POST', body }), {});
        if (f) { aviso(`Factura ${f.folio} generada`, 'ok'); await cargar(); }
    } catch (e) { avisoError(e); }
}

function finalizar(r) {
    const campos = [
        { k: 'fecha', etiqueta: 'Fecha de devolución', tipo: 'date', defecto: hoy() },
        { k: 'horometro_regreso', etiqueta: 'Horómetro al regreso', tipo: 'number', paso: '0.1', ayuda: `Salió con ${numero(r.horometro_salida, 1)} h` },
        { k: 'destino', etiqueta: '¿Cómo regresó el equipo?', tipo: 'select', vacio: false, ancho: true,
          opciones: [['disponible', 'Bien: pasa a Disponible'], ['reparacion', 'Con falla: pasa a Reparación y se abre una orden de servicio']] },
        { k: 'notas', etiqueta: 'Observaciones', tipo: 'textarea', ancho: true },
    ];
    modal({
        titulo: `Finalizar ${r.folio}`, cuerpo: formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Finalizar renta', clase: 'btn-primario', onClick: async (m) => {
            const res = await api(`/rentas/${r.id}/finalizar`, { method: 'POST', body: leerFormulario(m, campos) });
            aviso(res.ot ? `Renta finalizada. Se abrió la orden ${res.ot.folio} (evaluación en Producción)` : 'Renta finalizada', 'ok');
            await cargar();
        } }],
    });
}

async function cancelar(r) {
    if (!(await confirmar(`¿Cancelar la renta ${r.folio}? El equipo ${r.numero_economico} regresa a disponible.`, 'Cancelar renta'))) return;
    try { await api(`/rentas/${r.id}/cancelar`, { method: 'POST' }); aviso('Renta cancelada', 'ok'); await cargar(); } catch (e) { avisoError(e); }
}
