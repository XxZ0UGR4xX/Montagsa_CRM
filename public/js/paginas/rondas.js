// Producción · Rondas: visitas a equipos en renta para leer el horómetro.
let equipos = [];

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Rondas', 'Equipos en renta con su última lectura de horómetro. Registrar una lectura cierra una OT de tipo ronda.') +
        '<div class="panel" id="tabla"></div>';
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) registrar(equipos.find((x) => String(x.equipo_id) === b.dataset.id));
    });
    await cargar();
};

async function cargar() { equipos = await api('/rondas'); pintar(); }

function diasTxt(e) {
    if (e.dias_sin_visita == null) return '<span class="tenue">Sin visitas registradas</span>';
    if (e.dias_sin_visita > 7) return `<span style="color:var(--rojo)">${e.dias_sin_visita} días</span>`;
    if (e.dias_sin_visita > 3) return `<span style="color:var(--naranja)">${e.dias_sin_visita} días</span>`;
    return `${e.dias_sin_visita} días`;
}

function pintar() {
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay equipos en renta',
        columnas: [
            { t: 'Equipo', r: (e) => `<strong>${esc(e.numero_economico)}</strong><div class="sub">${esc(e.marca)} ${esc(e.modelo || '')}</div>` },
            { t: 'Cliente', r: (e) => `${esc(e.razon_social)}<div class="sub">${esc(e.renta_folio)}</div>` },
            { t: 'Horómetro actual', num: true, r: (e) => numero(e.horometro, 1) },
            { t: 'Última visita', r: (e) => (e.ultima_visita ? fecha(e.ultima_visita) : '—') },
            { t: 'Días sin visita', r: diasTxt },
            { t: '', clase: 'acciones', r: (e) => `<button class="btn btn-chico" type="button" data-id="${e.equipo_id}">Registrar lectura</button>` },
        ],
        filas: equipos,
    });
}

function registrar(e) {
    const campos = [{ k: 'lectura', etiqueta: 'Lectura del horómetro', tipo: 'number', paso: '0.1', requerido: true, ayuda: `Última: ${numero(e.horometro, 1)} h` }];
    modal({
        titulo: `Registrar lectura · ${e.numero_economico}`, cuerpo: formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Registrar', clase: 'btn-primario', onClick: async (m) => {
            const d = leerFormulario(m, campos);
            await api('/rondas', { method: 'POST', body: { equipo_id: e.equipo_id, lectura: d.lectura } });
            aviso(`Lectura registrada para ${e.numero_economico}`, 'ok');
            await cargar();
        } }],
    });
}
