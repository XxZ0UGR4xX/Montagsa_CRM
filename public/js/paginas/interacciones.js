// CRM · Interacciones con clientes.
const TIPOS = [['llamada', 'Llamada'], ['correo', 'Correo'], ['visita', 'Visita'], ['whatsapp', 'WhatsApp'], ['cotizacion', 'Cotización'], ['soporte', 'Soporte']];

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Interacciones', 'Llamadas, visitas, cotizaciones y demás contactos con clientes.',
        '<button class="btn btn-primario" type="button" id="btn-nueva">Registrar interacción</button>') +
        '<div class="panel" id="tabla"></div>';
    document.getElementById('btn-nueva').onclick = nueva;
    await cargar();
};

async function cargar() {
    const filas = await api('/interacciones');
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'Aún no hay interacciones',
        columnas: [
            { t: 'Fecha', r: (i) => fecha(i.fecha) },
            { t: 'Cliente', r: (i) => `<strong>${esc(i.razon_social)}</strong>` },
            { t: 'Tipo', r: (i) => esc(TIPOS.find(([v]) => v === i.tipo)?.[1] || i.tipo) },
            { t: 'Descripción', k: 'descripcion' },
            { t: 'Registró', r: (i) => `<span class="tenue">${esc(i.usuario || '—')}</span>` },
        ],
        filas,
    });
}

async function nueva() {
    const cat = await catalogos();
    const campos = [
        { k: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', requerido: true, ancho: true, opciones: opciones(cat.clientes, 'id', 'razon_social') },
        { k: 'tipo', etiqueta: 'Tipo', tipo: 'select', opciones: TIPOS, vacio: false, ancho: true },
        { k: 'descripcion', etiqueta: 'Descripción', tipo: 'textarea', requerido: true, ancho: true },
    ];
    modal({
        titulo: 'Registrar interacción', cuerpo: formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', clase: 'btn-primario', onClick: async (m) => {
            await api('/interacciones', { method: 'POST', body: leerFormulario(m, campos) });
            aviso('Interacción registrada', 'ok');
            await cargar();
        } }],
    });
}
