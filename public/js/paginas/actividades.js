// Mis actividades: recordatorios asignados al usuario, agrupados por urgencia.
// Las actividades se crean desde la bitácora de cualquier registro.
let verHechas = false;

window.iniciar = async (cont, usuario) => {
    cont.innerHTML = encabezado('Mis actividades',
        'Recordatorios asignados a ti desde la bitácora de clientes, rentas, órdenes, facturas, compras y equipos.',
        `<button class="btn" type="button" id="btn-hechas">Ver cerradas</button>`)
        + '<div id="kpis"></div><div id="listas"></div>'
        + (usuario.rol === 'admin' ? '<p class="tenue" style="margin-top:16px">Como admin solo ves aquí tus propias actividades.</p>' : '');

    document.getElementById('btn-hechas').onclick = (e) => {
        verHechas = !verHechas;
        e.currentTarget.textContent = verHechas ? 'Ocultar cerradas' : 'Ver cerradas';
        cargar();
    };
    await cargar();
};

async function cargar() {
    const d = await api(`/actividades?hechas=${verHechas ? 1 : 0}`);
    document.getElementById('kpis').innerHTML = `<div class="kpis" style="margin-bottom:18px">
        ${kpi('Vencidas', d.vencidas.length, '', d.vencidas.length ? 'rojo' : '')}
        ${kpi('Para hoy', d.hoy.length)}
        ${kpi('Próximas', d.proximas.length)}
    </div>`;
    document.getElementById('listas').innerHTML = [
        bloque('Vencidas', d.vencidas, 'No tienes actividades vencidas'),
        bloque('Para hoy', d.hoy, 'Nada programado para hoy'),
        bloque('Próximas', d.proximas, 'Sin actividades próximas'),
        ...(verHechas ? [bloque('Cerradas', d.hechas, 'Todavía no cierras ninguna')] : []),
    ].join('');

    document.querySelectorAll('[data-hecha]').forEach((b) => {
        b.onclick = async () => {
            try {
                await api(`/actividades/${b.dataset.hecha}/hecha`, { method: 'POST', body: { hecha: b.dataset.valor === '1' } });
                aviso('Actividad actualizada', 'ok');
                await cargar();
                await contarActividades();
            } catch (e) { avisoError(e); }
        };
    });
}

function bloque(titulo, filas, vacio) {
    return `<div class="panel" style="margin-bottom:18px">
        <div class="panel-cab"><h2>${esc(titulo)} (${filas.length})</h2></div>
        ${tabla({
            vacio,
            filas,
            columnas: [
                { t: 'Tipo', r: (a) => `<strong>${esc(tipoActividad(a.tipo))}</strong>` },
                { t: 'Registro', r: (a) => `<a href="${urlRegistro(a.entidad, a.entidad_id)}">${esc((ENTIDADES_UI[a.entidad] || {}).etiqueta || a.entidad)} #${a.entidad_id}</a>` },
                { t: 'Nota', r: (a) => esc(a.nota || '—') },
                { t: 'Vence', r: (a) => `${fecha(a.fecha_limite)}${!a.hecha && a.dias < 0 ? `<div class="sub" style="color:var(--rojo)">${Math.abs(a.dias)} d de retraso</div>` : ''}` },
                { t: 'Creó', r: (a) => esc(a.creado_por_nombre || '—') },
                { t: '', clase: 'acciones', r: (a) => (a.hecha
                    ? `<button class="btn btn-chico" type="button" data-hecha="${a.id}" data-valor="0">Reabrir</button>`
                    : `<button class="btn btn-chico btn-primario" type="button" data-hecha="${a.id}" data-valor="1">Marcar hecha</button>`) },
            ],
        })}
    </div>`;
}
