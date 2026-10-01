// Administración · Recursos humanos: plantilla y nómina mensual.
const AREAS = [['direccion', 'Dirección'], ['almacen', 'Almacén'], ['comercial', 'Comercial'], ['administracion', 'Administración'], ['taller', 'Taller']];
const CAMPOS_EMP = [
    { k: 'nombre', etiqueta: 'Nombre completo', requerido: true, ancho: true },
    { k: 'puesto', etiqueta: 'Puesto', requerido: true },
    { k: 'area', etiqueta: 'Área', tipo: 'select', opciones: AREAS, requerido: true },
    { k: 'telefono', etiqueta: 'Teléfono' },
    { k: 'email', etiqueta: 'Correo', tipo: 'email' },
    { k: 'fecha_ingreso', etiqueta: 'Fecha de ingreso', tipo: 'date', defecto: hoy() },
    { k: 'salario_mensual', etiqueta: 'Salario mensual', tipo: 'number', paso: '0.01' },
    { k: 'estado', etiqueta: 'Estado', tipo: 'select', vacio: false, opciones: [['activo', 'Activo'], ['baja', 'Baja']], defecto: 'activo' },
];
let empleados = [];

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Recursos humanos', 'Plantilla por área. Los técnicos del área Taller aparecen para asignarse a órdenes de servicio.',
        '<button class="btn btn-primario" type="button" id="btn-nuevo">Nuevo empleado</button>') + `
        <div id="kpis"></div>
        <div class="rejilla rejilla-2-1" style="margin-top:18px">
            <div class="panel" id="tabla"></div>
            <div class="panel">
                <div class="panel-cab"><h2>Nómina</h2></div>
                <div class="panel-cuerpo">
                    <p class="tenue" style="margin-bottom:12px">Registra la póliza de egreso por los sueldos del mes (cargo a Sueldos, abono a Bancos).</p>
                    <div class="filtros"><input type="month" id="periodo" aria-label="Periodo"><select id="cuenta" aria-label="Cuenta bancaria"></select><button class="btn btn-primario" type="button" id="btn-nomina">Registrar nómina</button></div>
                </div>
                <div id="nominas"></div>
            </div>
        </div>`;
    const d = new Date();
    document.getElementById('periodo').value = d.toISOString().slice(0, 7);
    const cat = await catalogos();
    document.getElementById('cuenta').innerHTML = `<option value="">Bancos (general)</option>${(cat.cuentas_bancarias || [])
        .map((b) => `<option value="${b.id}">${esc(b.banco)} ${esc(b.numero_enmascarado)}</option>`).join('')}`;
    document.getElementById('btn-nuevo').onclick = () => editar(null);
    document.getElementById('btn-nomina').onclick = nomina;
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) editar(empleados.find((x) => String(x.id) === b.dataset.id));
    });
    await cargar();
};

async function cargar() {
    const r = await api('/empleados');
    empleados = r.empleados;
    const activos = empleados.filter((e) => e.estado === 'activo');
    document.getElementById('kpis').innerHTML = `<div class="kpis">
        ${kpi('Empleados activos', activos.length)}
        ${kpi('Nómina mensual', pesos(activos.reduce((s, e) => s + e.salario_mensual, 0)))}
        ${kpi('Técnicos de taller', activos.filter((e) => e.area === 'taller').length)}
    </div>`;
    document.getElementById('tabla').innerHTML = tabla({
        filas: empleados,
        columnas: [
            { t: 'Empleado', r: (e) => `<strong>${esc(e.nombre)}</strong><div class="sub">${esc(e.numero)} · desde ${fecha(e.fecha_ingreso)}</div>` },
            { t: 'Puesto', r: (e) => `${esc(e.puesto)}<div class="sub">${esc(AREAS.find(([v]) => v === e.area)?.[1] || e.area)}</div>` },
            { t: 'Salario', num: true, r: (e) => dinero(e.salario_mensual) },
            { t: 'Órdenes', num: true, r: (e) => (e.area === 'taller' ? e.ordenes_abiertas : '') },
            { t: 'Estado', r: (e) => tag(e.estado === 'activo' ? 'alta' : 'baja') },
            { t: '', clase: 'acciones', r: (e) => `<button class="btn btn-chico" type="button" data-id="${e.id}">Editar</button>` },
        ],
    });
    document.getElementById('nominas').innerHTML = tabla({
        vacio: 'Sin nóminas registradas', filas: r.nominas,
        columnas: [{ t: 'Periodo', r: (n) => esc(n.referencia.replace('NOM-', '')) }, { t: 'Póliza', k: 'folio' }, { t: 'Total', num: true, r: (n) => dinero(n.total) }],
    });
}

function editar(emp) {
    modal({
        titulo: emp ? `Editar · ${emp.nombre}` : 'Nuevo empleado', ancho: 680,
        cuerpo: formulario(CAMPOS_EMP, emp || {}),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', clase: 'btn-primario', onClick: async (m) => {
            await api(emp ? `/empleados/${emp.id}` : '/empleados', { method: emp ? 'PUT' : 'POST', body: leerFormulario(m, CAMPOS_EMP) });
            aviso('Empleado guardado', 'ok');
            await cargar();
        } }],
    });
}

async function nomina() {
    const periodo = document.getElementById('periodo').value;
    if (!periodo) return aviso('Elige el periodo', 'error');
    const cuenta_bancaria_id = document.getElementById('cuenta').value || undefined;
    if (!(await confirmar(`¿Registrar la nómina de ${periodo}?`, 'Registrar'))) return;
    try {
        const r = await api('/nomina', { method: 'POST', body: { periodo, cuenta_bancaria_id } });
        aviso(`Nómina registrada: ${dinero(r.total)} (${r.empleados} empleados)`, 'ok');
        await cargar();
    } catch (e) { avisoError(e); }
}
