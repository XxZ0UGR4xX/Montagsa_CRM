// public/js/layout.js — Barra lateral por áreas de la empresa y arranque de cada página.
// Cada página define window.iniciar(contenedor, usuario) y pone data-seccion en <body>.

const MENU = [
    { grupo: null, items: [
        ['dashboard', 'Tablero general', '/dashboard.html'],
        ['actividades', 'Mis actividades', '/actividades.html'],
    ] },
    { grupo: 'Almacén', items: [
        ['equipos', 'Equipos (flota)', '/almacen/equipos.html'],
        ['inventario', 'Inventario', '/almacen/inventario.html'],
        ['maxmin', 'Máximos y mínimos', '/almacen/maximos-minimos.html'],
        ['movimientos', 'Movimientos', '/almacen/movimientos.html'],
        ['requisiciones', 'Requisiciones', '/almacen/requisiciones.html'],
    ] },
    { grupo: 'Comercial', items: [
        ['rentas', 'Rentas', '/comercial/rentas.html'],
        ['cotizaciones', 'Cotizaciones', '/comercial/cotizaciones.html'],
        ['facturacion', 'Facturación', '/comercial/facturacion.html'],
        ['traspasos', 'Traspasos', '/comercial/traspasos.html'],
    ] },
    { grupo: 'Producción', items: [
        ['ordenes_trabajo', 'Órdenes de trabajo', '/produccion/ordenes-trabajo.html'],
        ['rondas', 'Rondas', '/produccion/rondas.html'],
        ['preventivos', 'Preventivos', '/produccion/preventivos.html'],
        ['maniobras', 'Maniobras', '/produccion/maniobras.html'],
        ['refacciones_ot', 'Refacciones', '/produccion/refacciones.html'],
    ] },
    { grupo: 'Administración', items: [
        ['compras', 'Compras', '/administracion/compras.html'],
        ['proveedores', 'Proveedores', '/administracion/proveedores.html'],
        ['cobranza', 'Cobranza', '/administracion/cobranza.html'],
        ['creditos', 'Créditos', '/administracion/creditos.html'],
        ['rrhh', 'Recursos humanos', '/administracion/rrhh.html'],
        ['contabilidad', 'Contabilidad', '/administracion/contabilidad.html'],
        ['bancos', 'Bancos', '/administracion/bancos.html'],
        ['cuentas_por_pagar', 'Cuentas por pagar', '/administracion/cuentas-por-pagar.html'],
        ['cierre', 'Cierre de periodo', '/administracion/cierre.html'],
    ] },
    { grupo: 'CRM', items: [
        ['clientes', 'Clientes', '/crm/clientes.html'],
        ['embudo', 'Embudo de ventas', '/crm/embudo.html'],
        ['interacciones', 'Interacciones', '/crm/interacciones.html'],
    ] },
    { grupo: 'Configuración', items: [
        ['usuarios', 'Usuarios y roles', '/config/usuarios.html'],
        ['auditoria', 'Auditoría', '/config/auditoria.html'],
    ] },
];

const ROLES = { admin: 'Administrador', almacen: 'Almacén', comercial: 'Comercial', produccion: 'Producción', administracion: 'Administración', contabilidad: 'Contabilidad' };

function encabezado(titulo, subtitulo = '', acciones = '') {
    return `<div class="encabezado">
        <div><h1>${esc(titulo)}</h1>${subtitulo ? `<p>${esc(subtitulo)}</p>` : ''}</div>
        ${acciones ? `<div class="acciones">${acciones}</div>` : ''}
    </div>`;
}

function puedeVer(seccion) {
    return (window.SECCIONES || []).includes(seccion);
}

async function arrancar() {
    if (!Sesion.token()) { location.href = '/login.html'; return; }
    const seccion = document.body.dataset.seccion;
    let yo;
    try { yo = await api('/auth/me'); } catch (e) { return; }
    window.SECCIONES = yo.secciones;
    window.USUARIO = yo.usuario;

    if (seccion && !yo.secciones.includes(seccion)) { location.href = '/dashboard.html'; return; }

    const nav = MENU.map((g) => {
        const visibles = g.items.filter(([s]) => yo.secciones.includes(s));
        if (!visibles.length) return '';
        return `<div class="nav-grupo">${g.grupo ? `<div class="nav-grupo-titulo">${g.grupo}</div>` : ''}
            ${visibles.map(([s, t, url]) => `<a href="${url}" class="${s === seccion ? 'activo' : ''}" ${s === seccion ? 'aria-current="page"' : ''}>${t}</a>`).join('')}
        </div>`;
    }).join('');

    document.body.innerHTML = `
        <div class="app">
            <aside class="barra" id="barra">
                <div class="marca"><div class="marca-nombre">MONTAGSA</div><div class="marca-sub">Renta, venta y servicio de montacargas</div></div>
                <div class="franja" aria-hidden="true"></div>
                <nav class="nav" aria-label="Secciones">${nav}</nav>
                <div class="barra-pie">
                    <div class="usuario">${esc(yo.usuario.nombre)} <span id="contador-actividades"></span></div>
                    <div class="rol">${ROLES[yo.usuario.rol] || yo.usuario.rol}</div>
                    <div class="acciones">
                        <button type="button" id="btn-tema">Tema</button>
                        <button type="button" id="btn-clave">Contraseña</button>
                        <button type="button" id="btn-salir">Salir</button>
                    </div>
                </div>
            </aside>
            <main class="principal">
                <button class="btn menu-movil" type="button" id="btn-menu">Menú</button>
                <div id="contenido"></div>
            </main>
        </div>`;

    document.getElementById('btn-salir').onclick = () => Sesion.salir();
    document.getElementById('btn-menu').onclick = () => document.getElementById('barra').classList.toggle('abierta');
    document.getElementById('btn-tema').onclick = () => {
        const nuevo = document.documentElement.dataset.tema === 'oscuro' ? '' : 'oscuro';
        document.documentElement.dataset.tema = nuevo;
        try { localStorage.setItem('mg_tema', nuevo); } catch (e) { /* sin storage */ }
    };
    document.getElementById('btn-clave').onclick = cambiarClave;

    await contarActividades();

    const cont = document.getElementById('contenido');
    if (typeof window.iniciar === 'function') {
        try { await window.iniciar(cont, yo.usuario); } catch (e) { avisoError(e); }
    }
}

/** Actividades propias pendientes, junto al nombre del usuario en el menú. */
async function contarActividades() {
    const caja = document.getElementById('contador-actividades');
    if (!caja) return;
    try {
        const r = await api('/actividades/pendientes');
        caja.innerHTML = r.pendientes
            ? `<a href="/actividades.html" class="tag" style="--c: var(--${r.vencidas ? 'rojo' : 'naranja'})"
                  title="${r.vencidas ? r.vencidas + ' vencida(s)' : 'Actividades pendientes'}">${r.pendientes}</a>`
            : '';
    } catch (e) { /* el contador nunca debe romper el menú */ }
}

function cambiarClave() {
    const campos = [
        { k: 'actual', etiqueta: 'Contraseña actual', tipo: 'password', requerido: true, ancho: true },
        { k: 'nueva', etiqueta: 'Nueva contraseña (mín. 8)', tipo: 'password', requerido: true, ancho: true },
    ];
    modal({
        titulo: 'Cambiar contraseña', cuerpo: formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', clase: 'btn-primario', onClick: async (m) => {
            await api('/auth/password', { method: 'PUT', body: leerFormulario(m, campos) });
            aviso('Contraseña actualizada', 'ok');
        } }],
    });
}

document.addEventListener('DOMContentLoaded', arrancar);
