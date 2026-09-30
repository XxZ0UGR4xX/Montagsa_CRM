// Producción · Preventivos: mantenimiento cada X horas según una secuencia configurable.
let datos = null;

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Preventivos', 'Mantenimiento preventivo cada cierto número de horas de uso, según una secuencia de servicios configurable.',
        '<button class="btn" type="button" id="btn-config">Configurar intervalo y secuencia</button>') +
        '<div id="kpis"></div><div class="panel" id="tabla"></div>';
    document.getElementById('btn-config').onclick = configurar;
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (!b) return;
        const eq = datos.filas.find((f) => String(f.equipo_id) === b.dataset.id);
        if (b.dataset.acc === 'generar') generar(eq); else cerrarPreventivo(eq);
    });
    await cargar();
};

async function cargar() {
    datos = await api('/preventivos');
    const f = datos.filas;
    document.getElementById('kpis').innerHTML = `<div class="kpis">
        ${kpi('Vencidos', f.filter((x) => x.estado_preventivo === 'vencido').length, '', 'alerta')}
        ${kpi('Próximos (< 25 h)', f.filter((x) => x.estado_preventivo === 'proximo').length, '', 'aviso')}
        ${kpi('En rango', f.filter((x) => x.estado_preventivo === 'en_rango').length, '', 'bien')}
        ${kpi('Intervalo configurado', `${numero(datos.intervalo_horas, 0)} h`)}
    </div>`;
    pintar();
}

function pintar() {
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'No hay equipos',
        columnas: [
            { t: 'Equipo', r: (e) => `<strong>${esc(e.numero_economico)}</strong><div class="sub">${esc(e.marca)} ${esc(e.modelo || '')}</div>` },
            { t: 'Horómetro actual', num: true, r: (e) => numero(e.horometro, 1) },
            { t: 'Último preventivo', num: true, r: (e) => numero(e.horometro_ultimo_servicio, 1) },
            { t: 'Horas restantes', num: true, r: (e) => (e.horas_restantes <= 0 ? `<strong style="color:var(--rojo)">${numero(e.horas_restantes, 0)}</strong>` : numero(e.horas_restantes, 0)) },
            { t: 'Siguiente servicio', r: (e) => esc(e.siguiente_servicio || '—') },
            { t: 'Estado', r: (e) => tag(e.estado_preventivo) },
            { t: '', clase: 'acciones', r: (e) => (e.ot_abierta_id
                ? `<button class="btn btn-chico btn-primario" type="button" data-acc="cerrar" data-id="${e.equipo_id}">Cerrar preventivo</button>`
                : `<button class="btn btn-chico" type="button" data-acc="generar" data-id="${e.equipo_id}">Generar OT preventiva</button>`) },
        ],
        filas: datos.filas,
    });
}

async function generar(e) {
    const cat = await catalogos(true);
    const campos = [{ k: 'tecnico_id', etiqueta: 'Técnico', tipo: 'select', opciones: opciones(cat.tecnicos, 'id', 'nombre') }];
    modal({
        titulo: `Generar OT preventiva · ${e.numero_economico}`,
        cuerpo: `<p style="margin-bottom:14px">Siguiente servicio: <strong>${esc(e.siguiente_servicio || '—')}</strong></p>` + formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Generar', clase: 'btn-primario', onClick: async (m) => {
            const o = await api(`/preventivos/${e.equipo_id}/generar`, { method: 'POST', body: leerFormulario(m, campos) });
            aviso(`Orden ${o.folio} generada`, 'ok');
            await cargar();
        } }],
    });
}

function cerrarPreventivo(e) {
    const campos = [{ k: 'horometro', etiqueta: 'Horómetro del servicio', tipo: 'number', paso: '0.1', defecto: e.horometro, ayuda: `Actual: ${numero(e.horometro, 1)} h` }];
    modal({
        titulo: `Cerrar preventivo · ${e.numero_economico}`, cuerpo: formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Cerrar preventivo', clase: 'btn-primario', onClick: async (m) => {
            await api(`/preventivos/${e.ot_abierta_id}/cerrar`, { method: 'POST', body: leerFormulario(m, campos) });
            aviso('Preventivo cerrado. El equipo avanza al siguiente paso de la secuencia.', 'ok');
            await cargar();
        } }],
    });
}

async function configurar() {
    const [cfg, secuencia] = await Promise.all([api('/config/preventivo'), api('/config/secuencia-preventivo')]);
    const m = modal({
        titulo: 'Configuración de preventivos', ancho: 640,
        cuerpo: `
            <div class="form">
                <div class="campo"><label for="cfg-intervalo">Intervalo (horas)</label><input id="cfg-intervalo" type="number" min="1" step="0.1" value="${cfg.intervalo_horas}"></div>
                <div class="campo ancho" style="align-items:flex-start"><button class="btn" type="button" id="cfg-guardar">Guardar intervalo</button></div>
            </div>
            <h4 style="margin:16px 0 8px">Secuencia de servicios</h4>
            <p class="tenue" style="margin-bottom:10px">Editable; el significado exacto de "4C" y "1" está por confirmar con el taller.</p>
            <div id="secuencia">${secuencia.map((s) => `
                <div class="form" style="margin-bottom:8px" data-id="${s.id}">
                    <div class="campo"><label>Paso ${s.orden}: nombre</label><input class="sec-nombre" value="${esc(s.nombre_servicio)}"></div>
                    <div class="campo ancho"><label>Descripción</label><input class="sec-desc" value="${esc(s.descripcion || '')}"></div>
                </div>`).join('')}</div>
            <div class="campo ancho" style="align-items:flex-start;margin-top:8px"><button class="btn" type="button" id="cfg-secuencia">Guardar secuencia</button></div>`,
        acciones: [{ texto: 'Cerrar' }],
    });
    m.el.querySelector('#cfg-guardar').onclick = async () => {
        try {
            await api('/config/preventivo', { method: 'PUT', body: { intervalo_horas: Number(m.el.querySelector('#cfg-intervalo').value) } });
            aviso('Intervalo actualizado', 'ok'); await cargar();
        } catch (e) { avisoError(e); }
    };
    m.el.querySelector('#cfg-secuencia').onclick = async () => {
        try {
            for (const fila of m.el.querySelectorAll('#secuencia > div')) {
                await api(`/config/secuencia-preventivo/${fila.dataset.id}`, { method: 'PUT', body: {
                    nombre_servicio: fila.querySelector('.sec-nombre').value.trim(),
                    descripcion: fila.querySelector('.sec-desc').value.trim(),
                } });
            }
            aviso('Secuencia actualizada', 'ok'); await cargar();
        } catch (e) { avisoError(e); }
    };
}
