// Almacén · Equipos (flota con número económico). El estado cambia solo por traspasos.
const TIPOS_EQ = [['montacargas', 'Montacargas'], ['patin', 'Patín'], ['apilador', 'Apilador'], ['plataforma', 'Plataforma'], ['otro', 'Otro']];
const COMBUSTIBLES = [['gas LP', 'Gas LP'], ['electrico', 'Eléctrico'], ['diesel', 'Diésel'], ['gasolina', 'Gasolina'], ['manual', 'Manual']];
const CAMPOS_EQ = [
    { k: 'numero_economico', etiqueta: 'Número económico', requerido: true },
    { k: 'tipo', etiqueta: 'Tipo', tipo: 'select', opciones: TIPOS_EQ, vacio: false },
    { k: 'marca', etiqueta: 'Marca', requerido: true },
    { k: 'modelo', etiqueta: 'Modelo' },
    { k: 'serie', etiqueta: 'Número de serie' },
    { k: 'anio', etiqueta: 'Año', tipo: 'number' },
    { k: 'capacidad_kg', etiqueta: 'Capacidad (kg)', tipo: 'number' },
    { k: 'combustible', etiqueta: 'Combustible', tipo: 'select', opciones: COMBUSTIBLES },
    { k: 'horometro', etiqueta: 'Horómetro (h)', tipo: 'number', paso: '0.1' },
    { k: 'ubicacion', etiqueta: 'Ubicación' },
    { k: 'tarifa_diaria', etiqueta: 'Tarifa diaria', tipo: 'number', paso: '0.01' },
    { k: 'tarifa_semanal', etiqueta: 'Tarifa semanal', tipo: 'number', paso: '0.01' },
    { k: 'tarifa_mensual', etiqueta: 'Tarifa mensual', tipo: 'number', paso: '0.01' },
    { k: 'precio_venta', etiqueta: 'Precio de venta', tipo: 'number', paso: '0.01' },
    { k: 'costo_adquisicion', etiqueta: 'Costo de adquisición', tipo: 'number', paso: '0.01', ancho: true },
    { k: 'notas', etiqueta: 'Notas', tipo: 'textarea', ancho: true },
];
const PESTANAS = [['', 'Todos'], ['disponible', 'Disponibles'], ['renta', 'En renta'], ['venta', 'En venta'], ['reparacion', 'Reparación'], ['vendido', 'Vendidos']];
let equipos = [];
let filtro = '';

window.iniciar = async (cont) => {
    const editable = puedeVer('inventario');
    cont.innerHTML = encabezado('Equipos', 'Flota de Montagsa. Para cambiar el estado de un equipo usa Traspasos, Rentas o Servicios.',
        editable ? '<button class="btn btn-primario" type="button" id="btn-nuevo">Nuevo equipo</button>' : '') + `
        <div class="pestanas" role="tablist">${PESTANAS.map(([v, t]) => `<button type="button" data-f="${v}" class="${v === '' ? 'activa' : ''}">${t}</button>`).join('')}</div>
        <div class="panel" id="tabla"></div>`;
    if (editable) document.getElementById('btn-nuevo').onclick = () => editar(null);
    cont.querySelectorAll('.pestanas button').forEach((b) => {
        b.onclick = () => { filtro = b.dataset.f; cont.querySelectorAll('.pestanas button').forEach((x) => x.classList.toggle('activa', x === b)); pintar(); };
    });
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b && b.dataset.ver) ver(b.dataset.ver);
        if (b && b.dataset.editar) editar(equipos.find((x) => String(x.id) === b.dataset.editar));
    });
    await cargar();
};

async function cargar() { equipos = await api('/equipos'); pintar(); }

function pintar() {
    const editable = puedeVer('inventario');
    const filas = filtro ? equipos.filter((e) => e.estado === filtro) : equipos;
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay equipos en este estado',
        columnas: [
            { t: 'Equipo', r: (e) => `<strong>${esc(e.numero_economico)}</strong><div class="sub">${esc(e.marca)} ${esc(e.modelo || '')} · ${e.anio || ''}</div>` },
            { t: 'Tipo', r: (e) => `${esc(TIPOS_EQ.find(([v]) => v === e.tipo)?.[1] || e.tipo)}<div class="sub">${e.capacidad_kg ? numero(e.capacidad_kg) + ' kg' : ''} ${esc(e.combustible || '')}</div>` },
            { t: 'Horómetro', num: true, r: (e) => numero(e.horometro, 1) },
            { t: 'Estado', r: (e) => `${tag(e.estado)}${e.renta_actual ? `<div class="sub">${esc(e.renta_actual)}</div>` : ''}` },
            { t: 'Ubicación', r: (e) => esc(e.ubicacion || '—') },
            { t: 'Renta mensual', num: true, r: (e) => dinero(e.tarifa_mensual) },
            { t: 'Precio venta', num: true, r: (e) => dinero(e.precio_venta) },
            { t: '', clase: 'acciones', r: (e) => `<button class="btn btn-chico" type="button" data-ver="${e.id}">Historial</button>${editable ? ` <button class="btn btn-chico" type="button" data-editar="${e.id}">Editar</button>` : ''}` },
        ],
        filas,
    });
}

function editar(eq) {
    modal({
        titulo: eq ? `Editar ${eq.numero_economico}` : 'Nuevo equipo', ancho: 720,
        cuerpo: formulario(CAMPOS_EQ, eq || { tipo: 'montacargas', ubicacion: 'Patio principal' }) +
            (eq ? '' : '<p class="tenue" style="margin-top:12px">El equipo nuevo entra como Disponible.</p>'),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', clase: 'btn-primario', onClick: async (m) => {
            await api(eq ? `/equipos/${eq.id}` : '/equipos', { method: eq ? 'PUT' : 'POST', body: leerFormulario(m, CAMPOS_EQ) });
            aviso('Equipo guardado', 'ok');
            await cargar();
        } }],
    });
}

async function ver(id) {
    const e = await api(`/equipos/${id}`);
    modal({
        titulo: `${e.numero_economico} · ${e.marca} ${e.modelo || ''}`, ancho: 860,
        cuerpo: `
            <dl class="datos" style="margin-bottom:16px">
                <dt>Estado</dt><dd>${tag(e.estado)}</dd>
                <dt>Serie</dt><dd>${esc(e.serie || '—')}</dd>
                <dt>Horómetro</dt><dd>${numero(e.horometro, 1)} h</dd>
                <dt>Tarifas</dt><dd>${dinero(e.tarifa_diaria)} día · ${dinero(e.tarifa_semanal)} semana · ${dinero(e.tarifa_mensual)} mes</dd>
            </dl>
            <h4 style="margin:8px 0">Traspasos</h4>
            ${tabla({ vacio: 'Sin traspasos', filas: e.traspasos, columnas: [
                { t: 'Fecha', r: (t) => fecha(t.fecha) }, { t: 'De', r: (t) => tag(t.estado_origen) }, { t: 'A', r: (t) => tag(t.estado_destino) },
                { t: 'Referencia', k: 'referencia' }, { t: 'Motivo', k: 'motivo' }, { t: 'Usuario', k: 'usuario' }] })}
            <h4 style="margin:18px 0 8px">Rentas</h4>
            ${tabla({ vacio: 'Nunca se ha rentado', filas: e.rentas, columnas: [
                { t: 'Folio', k: 'folio' }, { t: 'Cliente', k: 'razon_social' }, { t: 'Del', r: (r) => fecha(r.fecha_inicio) }, { t: 'Al', r: (r) => fecha(r.fecha_fin) },
                { t: 'Importe', num: true, r: (r) => dinero(r.importe) }, { t: 'Estado', r: (r) => tag(r.estado) }] })}
            <h4 style="margin:18px 0 8px">Órdenes de trabajo</h4>
            ${tabla({ vacio: 'Sin órdenes de trabajo', filas: e.servicios, columnas: [
                { t: 'Folio', k: 'folio' }, { t: 'Tipo', k: 'tipo' }, { t: 'Descripción', k: 'descripcion' }, { t: 'Estado', r: (s) => tag(s.estado) }] })}`,
    });
}
