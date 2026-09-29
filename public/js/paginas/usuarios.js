// Configuración · Usuarios y roles (solo administrador).
const ROLES_OPC = [['admin', 'Administrador (todo)'], ['almacen', 'Almacén'], ['comercial', 'Comercial'], ['administracion', 'Administración']];

window.iniciar = (cont) => crudPagina(cont, {
    titulo: 'Usuarios y roles',
    subtitulo: 'Almacén ve flota e inventario; Comercial ve rentas, servicios y facturación; Administración ve compras, cobranza, créditos, RRHH y contabilidad.',
    ruta: '/usuarios', nombre: 'usuario',
    columnas: [
        { t: 'Nombre', k: 'nombre', r: (u) => `<strong>${esc(u.nombre)}</strong>` },
        { t: 'Correo', k: 'email' },
        { t: 'Rol', k: 'rol', r: (u) => esc(ROLES_OPC.find(([v]) => v === u.rol)?.[1] || u.rol) },
        { t: 'Estado', k: 'activo', r: (u) => (u.activo ? tag('activo') : tag('inactivo')) },
        { t: 'Alta', r: (u) => fecha(u.creado) },
    ],
    campos: [
        { k: 'nombre', etiqueta: 'Nombre', requerido: true, ancho: true },
        { k: 'email', etiqueta: 'Correo', tipo: 'email', requerido: true, ancho: true },
        { k: 'rol', etiqueta: 'Rol', tipo: 'select', opciones: ROLES_OPC, vacio: false, defecto: 'comercial' },
        { k: 'password', etiqueta: 'Contraseña (mín. 8)', tipo: 'password', requerido: true },
    ],
    camposEdicion: [
        { k: 'nombre', etiqueta: 'Nombre', requerido: true, ancho: true },
        { k: 'email', etiqueta: 'Correo', tipo: 'email', requerido: true, ancho: true },
        { k: 'rol', etiqueta: 'Rol', tipo: 'select', opciones: ROLES_OPC, vacio: false },
        { k: 'password', etiqueta: 'Nueva contraseña', tipo: 'password', ayuda: 'Déjala vacía para no cambiarla' },
        { k: 'activo', etiqueta: 'Usuario activo', tipo: 'checkbox', ancho: true },
    ],
    antesDeGuardar: (d) => { if (!d.password) delete d.password; return d; },
});
