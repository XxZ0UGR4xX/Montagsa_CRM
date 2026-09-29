// public/js/layout.js — Barra lateral por áreas de la empresa y arranque de cada página.
// Cada página define window.iniciar(contenedor, usuario) y pone data-seccion en <body>.

const MENU = [
    { grupo: null, items: [['dashboard', 'Tablero general', '/dashboard.html']] },
    { grupo: 'Almacén', items: [
        ['equipos', 'Equipos (flota)', '/almacen/equipos.html'],
        ['inventario', 'Inventario', '/almacen/inventario.html'],
        ['maxmin', 'Máximos y mínimos', '/almacen/maximos-minimos.html'],
        ['movimientos', 'Movimientos', '/almacen/movimientos.html'],
    ] },
    { grupo: 'Comercial', items: [
        ['rentas', 'Rentas', '/comercial/rentas.html'],
        ['servicios', 'Servicios', '/comercial/servicios.html'],
        ['facturacion', 'Facturación', '/comercial/facturacion.html'],
        ['traspasos', 'Traspasos', '/comercial/traspasos.html'],
    ] },
    { grupo: 'Administración', items: [
        ['compras', 'Compras', '/administracion/compras.html'],
        ['proveedores', 'Proveedores', '/administracion/proveedores.html'],
        ['cobranza', 'Cobranza', '/administracion/cobranza.html'],
        ['creditos', 'Créditos', '/administracion/creditos.html'],
        ['rrhh', 'Recursos humanos', '/administracion/rrhh.html'],
        ['contabilidad', 'Contabilidad', '/administracion/contabilidad.html'],
    ] },
    { grupo: 'CRM', items: [
        ['clientes', 'Clientes', '/crm/clientes.html'],
        ['interacciones', 'Interacciones', '/crm/interacciones.html'],
    ] },
    { grupo: 'Configuración', items: [['usuarios', 'Usuarios y roles', '/config/usuarios.html']] },
];

const ROLES = { admin: 'Administrador', almacen: 'Almacén', comercial: 'Comercial', administracion: 'Administración' };

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
                    <div class="usuario">${esc(yo.usuario.nombre)}</div>
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

    const cont = document.getElementById('contenido');
    if (typeof window.iniciar === 'function') {
        try { await window.iniciar(cont, yo.usuario); } catch (e) { avisoError(e); }
    }
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
