// Configuración · Auditoría (solo admin): rastro de las operaciones sensibles.
const ACCIONES = [['crear', 'Crear'], ['editar', 'Editar'], ['cancelar', 'Cancelar'], ['anular', 'Anular'],
    ['autorizar_credito', 'Autorizar crédito'], ['cambiar_permisos', 'Cambiar permisos']];
const ENTIDADES_AUD = [['factura', 'Factura'], ['pago', 'Pago'], ['poliza', 'Póliza'], ['credito', 'Crédito'],
    ['usuario', 'Usuario'], ['renta', 'Renta']];
let registros = [];

window.iniciar = async (cont) => {
    const cat = await catalogos();
    cont.innerHTML = encabezado('Auditoría', 'Quién hizo qué, cuándo y desde dónde en facturas, pagos, pólizas, créditos y usuarios.',
        '<button class="btn" type="button" id="btn-csv">Exportar CSV</button>') + `
        <div class="filtros" style="margin-bottom:14px">
            <select id="f-usuario" aria-label="Usuario"><option value="">Todos los usuarios</option>
                ${(cat.usuarios || []).map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')}</select>
            <select id="f-entidad" aria-label="Entidad"><option value="">Todas las entidades</option>
                ${ENTIDADES_AUD.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
            <select id="f-accion" aria-label="Acción"><option value="">Todas las acciones</option>
                ${ACCIONES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
            <input type="date" id="f-desde" aria-label="Desde">
            <input type="date" id="f-hasta" aria-label="Hasta">
        </div>
        <div class="panel" id="tabla"></div>`;

    ['f-usuario', 'f-entidad', 'f-accion', 'f-desde', 'f-hasta'].forEach((id) => {
        document.getElementById(id).onchange = cargar;
    });
    document.getElementById('btn-csv').onclick = () => exportarCSV('auditoria', [
        { t: 'Fecha', k: 'fecha' }, { t: 'Usuario', k: 'usuario' }, { t: 'Rol', k: 'rol' }, { t: 'Acción', k: 'accion' },
        { t: 'Entidad', k: 'entidad' }, { t: 'Registro', k: 'entidad_id' }, { t: 'IP', k: 'ip' },
        { t: 'Antes', csv: (r) => JSON.stringify(r.antes) }, { t: 'Después', csv: (r) => JSON.stringify(r.despues) }], registros);
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-ver]');
        if (b) detalle(registros.find((r) => String(r.id) === b.dataset.ver));
    });
    await cargar();
};

async function cargar() {
    const q = new URLSearchParams();
    const v = (id) => document.getElementById(id).value;
    if (v('f-usuario')) q.set('usuario_id', v('f-usuario'));
    if (v('f-entidad')) q.set('entidad', v('f-entidad'));
    if (v('f-accion')) q.set('accion', v('f-accion'));
    if (v('f-desde')) q.set('desde', v('f-desde'));
    if (v('f-hasta')) q.set('hasta', v('f-hasta'));
    registros = await api(`/auditoria?${q}`);
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay movimientos con ese filtro',
        filas: registros,
        columnas: [
            { t: 'Fecha', r: (r) => fechaHora(r.fecha) },
            { t: 'Usuario', r: (r) => `${esc(r.usuario || 'Sistema')}<div class="sub">${esc(r.rol || '')}</div>` },
            { t: 'Acción', r: (r) => `<strong>${esc((ACCIONES.find(([v2]) => v2 === r.accion) || [r.accion, r.accion])[1])}</strong>` },
            { t: 'Entidad', r: (r) => `${esc(r.entidad)}${r.entidad_id ? ` #${r.entidad_id}` : ''}` },
            { t: 'IP', r: (r) => `<span class="tenue">${esc(r.ip || '—')}</span>` },
            { t: '', clase: 'acciones', r: (r) => `<button class="btn btn-chico" type="button" data-ver="${r.id}">Ver cambio</button>` },
        ],
    });
}

function detalle(r) {
    if (!r) return;
    const bloque = (titulo, obj) => `<h4 style="margin:12px 0 6px">${titulo}</h4>
        <pre style="background:var(--panel-2);border:1px solid var(--linea);border-radius:var(--r-sm);padding:10px;overflow:auto;font-size:12.5px">${esc(obj ? JSON.stringify(obj, null, 2) : '—')}</pre>`;
    modal({
        titulo: `${r.accion} · ${r.entidad}${r.entidad_id ? ' #' + r.entidad_id : ''}`, ancho: 760,
        cuerpo: `<dl class="datos">
                <dt>Fecha</dt><dd>${fechaHora(r.fecha)}</dd>
                <dt>Usuario</dt><dd>${esc(r.usuario || 'Sistema')} (${esc(r.rol || '—')})</dd>
                <dt>IP</dt><dd>${esc(r.ip || '—')}</dd>
            </dl>
            ${bloque('Antes', r.antes)}
            ${bloque('Después', r.despues)}`,
    });
}
