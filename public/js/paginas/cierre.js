// Contabilidad · Cierre de periodo: ningún mes cerrado admite pólizas nuevas.
// Solo un administrador puede reabrir un mes ya cerrado.
window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Cierre de periodo', 'Ningún mes cerrado admite pólizas nuevas (automáticas o manuales). Solo un administrador puede reabrirlo.',
        '<button class="btn btn-primario" type="button" id="btn-cerrar">Cerrar un periodo</button>') + '<div class="panel" id="tabla"></div>';
    document.getElementById('btn-cerrar').onclick = cerrar;
    document.getElementById('tabla').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-reabrir]');
        if (!b) return;
        if (!(await confirmar('¿Reabrir este periodo? Se podrán volver a capturar pólizas en él.', 'Reabrir'))) return;
        try {
            const [anio, mes] = b.dataset.reabrir.split('-');
            await api('/cierre/reabrir', { method: 'POST', body: { anio, mes } });
            aviso('Periodo reabierto', 'ok');
            await cargar();
        } catch (err) { avisoError(err); }
    });
    await cargar();
};

async function cargar() {
    const periodos = await api('/cierre');
    const esAdmin = window.USUARIO.rol === 'admin';
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'Sin periodos cerrados todavía', filas: periodos,
        columnas: [
            { t: 'Periodo', r: (p) => `${String(p.mes).padStart(2, '0')}/${p.anio}` },
            { t: 'Estado', r: (p) => (p.cerrado ? tag('pendiente', 'Cerrado') : tag('activo', 'Abierto')) },
            { t: 'Cerrado por', r: (p) => esc(p.cerrado_por_nombre || '—') },
            { t: 'Fecha de cierre', r: (p) => (p.fecha_cierre ? fecha(p.fecha_cierre) : '—') },
            { t: '', clase: 'acciones', r: (p) => (p.cerrado && esAdmin ? `<button class="btn btn-chico btn-peligro" type="button" data-reabrir="${p.anio}-${p.mes}">Reabrir</button>` : '') },
        ],
    });
}

function cerrar() {
    const d = new Date();
    const campos = [
        { k: 'anio', etiqueta: 'Año', tipo: 'number', requerido: true, defecto: d.getFullYear() },
        { k: 'mes', etiqueta: 'Mes (1-12)', tipo: 'number', requerido: true, defecto: d.getMonth() + 1 },
    ];
    modal({
        titulo: 'Cerrar periodo', cuerpo: formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Cerrar periodo', clase: 'btn-primario', onClick: async (m) => {
            const datos = leerFormulario(m, campos);
            await api('/cierre', { method: 'POST', body: datos });
            aviso(`Periodo ${String(datos.mes).padStart(2, '0')}/${datos.anio} cerrado`, 'ok');
            await cargar();
        } }],
    });
}
