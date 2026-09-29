// Administración · Proveedores.
window.iniciar = (cont) => crudPagina(cont, {
    titulo: 'Proveedores', subtitulo: 'A quién se compra cada refacción y cuánto tarda en llegar.',
    ruta: '/proveedores', nombre: 'proveedor', csv: 'proveedores',
    columnas: [
        { t: 'Proveedor', k: 'nombre', r: (p) => `<strong>${esc(p.nombre)}</strong><div class="sub">${esc(p.rfc || '')}</div>` },
        { t: 'Contacto', k: 'contacto', r: (p) => `${esc(p.contacto || '—')}<div class="sub">${esc(p.telefono || '')} ${esc(p.email || '')}</div>` },
        { t: 'Entrega', k: 'tiempo_entrega_dias', num: true, r: (p) => `${p.tiempo_entrega_dias} días` },
        { t: 'Refacciones', k: 'productos', num: true },
        { t: 'Por pagar', k: 'por_pagar', num: true, r: (p) => (p.por_pagar > 0 ? dinero(p.por_pagar) : '—') },
        { t: 'Estado', k: 'activo', r: (p) => (p.activo ? tag('activo') : tag('inactivo')) },
    ],
    campos: [
        { k: 'nombre', etiqueta: 'Nombre', requerido: true, ancho: true },
        { k: 'rfc', etiqueta: 'RFC' },
        { k: 'contacto', etiqueta: 'Contacto' },
        { k: 'telefono', etiqueta: 'Teléfono' },
        { k: 'email', etiqueta: 'Correo', tipo: 'email' },
        { k: 'tiempo_entrega_dias', etiqueta: 'Tiempo de entrega (días)', tipo: 'number', defecto: 7 },
        { k: 'activo', etiqueta: 'Activo', tipo: 'checkbox', defecto: true },
    ],
});
