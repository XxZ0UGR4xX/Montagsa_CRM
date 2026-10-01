// CRM · Embudo: oportunidades en columnas por etapa, arrastrables (HTML5 drag and drop).
const COLOR_ETAPA = { nuevo: 'gris', calificado: 'azul', cotizado: 'naranja', negociacion: 'violeta', ganado: 'verde', perdido: 'rojo' };
const CAMPOS_OP = (cat) => [
    { k: 'titulo', etiqueta: 'Título', requerido: true, ancho: true, ayuda: 'Qué se le va a vender' },
    { k: 'cliente_id', etiqueta: 'Cliente', tipo: 'select', ancho: true, opciones: opciones(cat.clientes || [], 'id', 'razon_social'),
        vacio: '— Prospecto nuevo (no es cliente todavía) —' },
    { k: 'prospecto', etiqueta: 'Nombre del prospecto', ancho: true, ayuda: 'Solo si no elegiste un cliente de la lista' },
    { k: 'valor_estimado', etiqueta: 'Valor estimado', tipo: 'number', paso: '0.01' },
    { k: 'probabilidad', etiqueta: 'Probabilidad (%)', tipo: 'number', defecto: 50 },
    { k: 'responsable_id', etiqueta: 'Responsable', tipo: 'select', opciones: opciones(cat.usuarios || [], 'id', 'nombre'), vacio: false },
    { k: 'fecha_cierre_estimada', etiqueta: 'Cierre estimado', tipo: 'date' },
    { k: 'notas', etiqueta: 'Notas', tipo: 'textarea', ancho: true },
];

let datos = null;

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Embudo de ventas', 'Arrastra una oportunidad a otra columna para moverla de etapa.',
        '<button class="btn btn-primario" type="button" id="btn-nueva">Nueva oportunidad</button>')
        + '<div id="kpis"></div><div class="tablero" id="tablero" style="grid-template-columns: repeat(6, minmax(210px, 1fr))"></div>';
    document.getElementById('btn-nueva').onclick = () => editar(null);
    await cargar();
};

async function cargar() {
    datos = await api('/oportunidades');
    const abiertas = datos.etapas.filter((e) => !['ganado', 'perdido'].includes(e))
        .reduce((s, e) => s + datos.por_etapa[e].total, 0);
    document.getElementById('kpis').innerHTML = `<div class="kpis" style="margin-bottom:18px">
        ${kpi('En el embudo', pesos(abiertas), 'Etapas abiertas')}
        ${kpi('Ganado', pesos(datos.por_etapa.ganado.total), `${datos.por_etapa.ganado.oportunidades.length} oportunidades`, 'verde')}
        ${kpi('Perdido', pesos(datos.por_etapa.perdido.total), `${datos.por_etapa.perdido.oportunidades.length} oportunidades`)}
    </div>`;

    document.getElementById('tablero').innerHTML = datos.etapas.map((e) => {
        const col = datos.por_etapa[e];
        return `<div class="columna" data-etapa="${e}">
            <div class="columna-cab" style="--c: var(--${COLOR_ETAPA[e]})">
                <h3>${esc(etiqueta(e))}</h3>
                <span class="tenue">${col.oportunidades.length} · ${pesos(col.total)}</span>
            </div>
            ${col.oportunidades.map((o) => `<div class="ficha" draggable="true" data-id="${o.id}">
                <strong>${esc(o.titulo)}</strong>
                <div class="tenue">${esc(o.razon_social || o.prospecto || 'Sin cliente')}</div>
                <div>${dinero(o.valor_estimado)} · ${o.probabilidad}%</div>
                <div class="tenue">${o.fecha_cierre_estimada ? 'Cierra ' + fecha(o.fecha_cierre_estimada) : 'Sin fecha'} · ${esc(o.responsable || '—')}</div>
                ${o.motivo_perdida ? `<div class="tenue">Perdida: ${esc(o.motivo_perdida)}</div>` : ''}
                <button class="btn btn-chico" type="button" data-editar="${o.id}">Editar</button>
            </div>`).join('') || '<div class="vacio">Vacío</div>'}
        </div>`;
    }).join('');

    arrastrar();
    document.querySelectorAll('[data-editar]').forEach((b) => {
        b.onclick = (e) => {
            e.stopPropagation();
            editar(todas().find((o) => String(o.id) === b.dataset.editar));
        };
    });
}

const todas = () => datos.etapas.flatMap((e) => datos.por_etapa[e].oportunidades);

/** Arrastrar y soltar nativo: la tarjeta lleva el id, la columna recibe la etapa. */
function arrastrar() {
    document.querySelectorAll('.ficha[draggable]').forEach((f) => {
        f.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', f.dataset.id);
            e.dataTransfer.effectAllowed = 'move';
            f.style.opacity = '.5';
        });
        f.addEventListener('dragend', () => { f.style.opacity = ''; });
    });
    document.querySelectorAll('.columna[data-etapa]').forEach((col) => {
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.style.outline = '2px dashed var(--amarillo)'; });
        col.addEventListener('dragleave', () => { col.style.outline = ''; });
        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            col.style.outline = '';
            const id = e.dataTransfer.getData('text/plain');
            const op = todas().find((o) => String(o.id) === id);
            if (!op || op.etapa === col.dataset.etapa) return;
            await mover(op, col.dataset.etapa);
        });
    });
}

async function mover(op, etapa) {
    try {
        if (etapa === 'perdido') {
            const motivo = await pedirMotivo(`¿Por qué se perdió "${op.titulo}"?`,
                { titulo: 'Oportunidad perdida', textoOk: 'Marcar como perdida', etiqueta: 'Motivo de la pérdida' });
            if (!motivo) return;
            await api(`/oportunidades/${op.id}/etapa`, { method: 'POST', body: { etapa, motivo_perdida: motivo } });
            aviso('Oportunidad marcada como perdida', 'ok');
        } else {
            await api(`/oportunidades/${op.id}/etapa`, { method: 'POST', body: { etapa } });
            aviso(`Movida a ${etiqueta(etapa)}`, 'ok');
        }
        await cargar();
        if (etapa === 'ganado') ofrecerCierre(op);
    } catch (e) { avisoError(e); }
}

/** Al ganar se ofrece aterrizarla: renta (Comercial) o cotización de servicio (Producción). */
function ofrecerCierre(op) {
    const puedeRenta = puedeVer('rentas');
    const puedeCotizar = puedeVer('cotizaciones') || puedeVer('ordenes_trabajo');
    if (!puedeRenta && !puedeCotizar) return;
    modal({
        titulo: `¡Ganada! · ${op.titulo}`,
        cuerpo: `<p>La oportunidad de <strong>${esc(op.razon_social || op.prospecto)}</strong> por ${dinero(op.valor_estimado)} quedó en Ganado.</p>
            <p class="tenue" style="margin-top:10px">¿La aterrizamos ahora?${op.cliente_id ? '' : ' Primero hay que dar de alta al prospecto como cliente en CRM › Clientes.'}</p>`,
        acciones: [
            { texto: 'Después' },
            ...(puedeRenta && op.cliente_id ? [{ texto: 'Crear renta', clase: 'btn-primario', onClick: () => { location.href = '/comercial/rentas.html'; } }] : []),
            ...(puedeCotizar && op.cliente_id ? [{ texto: 'Crear cotización', onClick: () => { location.href = '/produccion/ordenes-trabajo.html'; } }] : []),
        ],
    });
}

async function editar(op) {
    const cat = await catalogos();
    const campos = CAMPOS_OP(cat);
    modal({
        titulo: op ? `Editar ${op.folio}` : 'Nueva oportunidad', ancho: 720,
        cuerpo: formulario(campos, op || { responsable_id: (Sesion.usuario() || {}).id }),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', clase: 'btn-primario', onClick: async (m) => {
            const d = leerFormulario(m, campos);
            if (!d.cliente_id && !d.prospecto) throw new Error('Elige un cliente o escribe el nombre del prospecto');
            await api(op ? `/oportunidades/${op.id}` : '/oportunidades', { method: op ? 'PUT' : 'POST', body: d });
            aviso('Oportunidad guardada', 'ok');
            await cargar();
        } }],
    });
}
