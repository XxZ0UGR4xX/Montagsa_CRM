// Comercial · Traspasos: tablero de la flota por estado (disponible · renta · venta · reparación).
const TIPO_TXT = { montacargas: 'montacargas', patin: 'patín', apilador: 'apilador', plataforma: 'plataforma', otro: 'otro' };
const COLUMNAS = [['disponible', 'verde'], ['renta', 'azul'], ['venta', 'violeta'], ['reparacion', 'naranja']];
let datos = null;

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Traspasos', 'Mueve equipos entre disponible, venta y reparación. La entrada a renta se hace creando una renta y la salida a vendido, vendiéndolo.',
        '<button class="btn btn-primario" type="button" id="btn-nuevo">Nuevo traspaso</button>') + `
        <div id="tablero" class="tablero"></div>
        <div class="panel" style="margin-top:18px"><div class="panel-cab"><h2>Historial de traspasos</h2></div><div id="historial"></div></div>`;
    document.getElementById('btn-nuevo').onclick = () => traspasar(null);
    cont.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-eq]');
        if (!b) return;
        const eq = datos.tablero.find((x) => String(x.id) === b.dataset.eq);
        if (b.dataset.acc === 'vender') location.href = '/comercial/facturacion.html';
        else traspasar(eq);
    });
    await cargar();
};

async function cargar() {
    datos = await api('/traspasos');
    document.getElementById('tablero').innerHTML = COLUMNAS.map(([estado, color]) => {
        const eqs = datos.tablero.filter((e) => e.estado === estado);
        return `<section class="columna" style="--c: var(--${color})" aria-label="${etiqueta(estado)}">
            <div class="columna-cab"><h3>${etiqueta(estado)}</h3><strong>${eqs.length}</strong></div>
            ${eqs.map((e) => `<div class="ficha">
                <strong>${esc(e.numero_economico)}</strong> <span class="tenue">${esc(TIPO_TXT[e.tipo] || e.tipo)}</span>
                <div>${esc(e.marca)} ${esc(e.modelo || '')}</div>
                ${e.detalle_renta ? `<div class="tenue">${esc(e.detalle_renta)}</div>` : `<div class="tenue">${esc(e.ubicacion || '')}</div>`}
                ${e.orden_servicio ? `<div class="tenue">Orden ${esc(e.orden_servicio)}</div>` : ''}
                ${estado === 'renta' ? '' : `<button class="btn btn-chico" type="button" data-eq="${e.id}">Traspasar</button>`}
                ${estado === 'venta' && puedeVer('facturacion') ? ` <button class="btn btn-chico" type="button" data-eq="${e.id}" data-acc="vender">Vender</button>` : ''}
            </div>`).join('') || '<div class="vacio">Sin equipos</div>'}
        </section>`;
    }).join('');
    document.getElementById('historial').innerHTML = tabla({
        vacio: 'Sin traspasos',
        columnas: [
            { t: 'Fecha', r: (t) => fecha(t.fecha) },
            { t: 'Equipo', r: (t) => `<strong>${esc(t.numero_economico)}</strong><div class="sub">${esc(t.marca)} ${esc(t.modelo || '')}</div>` },
            { t: 'De', r: (t) => tag(t.estado_origen) },
            { t: 'A', r: (t) => tag(t.estado_destino) },
            { t: 'Referencia', r: (t) => `<strong>${esc(t.referencia || '—')}</strong>` },
            { t: 'Motivo', k: 'motivo' },
            { t: 'Usuario', r: (t) => `<span class="tenue">${esc(t.usuario || '—')}</span>` },
        ],
        filas: datos.historial,
    });
}

function traspasar(eq) {
    const movibles = datos.tablero.filter((e) => e.estado !== 'renta');
    const destinosDe = (estado) => (datos.transiciones[estado] || []).filter((d) => !['renta', 'vendido'].includes(d));
    const campos = [
        { k: 'equipo_id', etiqueta: 'Equipo', tipo: 'select', requerido: true, ancho: true, opciones: opciones(movibles, 'id', (e) => `${e.numero_economico} · ${e.marca} (${etiqueta(e.estado)})`) },
        { k: 'destino', etiqueta: 'Pasar a', tipo: 'select', requerido: true, ancho: true, opciones: [] },
        { k: 'motivo', etiqueta: 'Motivo', tipo: 'textarea', requerido: true, ancho: true },
    ];
    const m = modal({
        titulo: eq ? `Traspasar ${eq.numero_economico}` : 'Nuevo traspaso',
        cuerpo: formulario(campos, eq ? { equipo_id: eq.id } : {}),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Traspasar', clase: 'btn-primario', onClick: async (el) => {
            const d = leerFormulario(el, campos);
            await api('/traspasos', { method: 'POST', body: d });
            aviso('Traspaso registrado', 'ok');
            await cargar();
        } }],
    });
    const selEq = m.el.querySelector('[name=equipo_id]');
    const selDes = m.el.querySelector('[name=destino]');
    const llenar = () => {
        const e = movibles.find((x) => String(x.id) === selEq.value);
        const ds = e ? destinosDe(e.estado) : [];
        selDes.innerHTML = `<option value="">${e ? (ds.length ? '— Selecciona —' : 'Sin traspasos posibles') : '— Elige un equipo —'}</option>` +
            ds.map((d) => `<option value="${d}">${etiqueta(d)}</option>`).join('');
    };
    selEq.addEventListener('change', llenar);
    llenar();
}
