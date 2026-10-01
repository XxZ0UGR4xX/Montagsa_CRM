// public/js/core.js — API, sesión, formato, modales, avisos y formularios.
// Sin frameworks: todas las páginas cargan este archivo primero.

/* ------------------------------------------------------------------ Tema */
(function () {
    try { const t = localStorage.getItem('mg_tema'); if (t) document.documentElement.dataset.tema = t; } catch (e) { /* sin storage */ }
})();

/* ------------------------------------------------------------------ Sesión */
const Sesion = {
    token() { try { return localStorage.getItem('mg_token'); } catch (e) { return null; } },
    guardar(datos) {
        localStorage.setItem('mg_token', datos.token);
        localStorage.setItem('mg_usuario', JSON.stringify(datos.usuario));
    },
    usuario() { try { return JSON.parse(localStorage.getItem('mg_usuario')); } catch (e) { return null; } },
    salir() {
        localStorage.removeItem('mg_token');
        localStorage.removeItem('mg_usuario');
        location.href = '/login.html';
    },
};

/* ------------------------------------------------------------------ API */
async function api(ruta, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const t = Sesion.token();
    if (t) headers.Authorization = `Bearer ${t}`;
    let res;
    try {
        res = await fetch(`/api${ruta}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
        throw new Error('No hay conexión con el servidor');
    }
    let datos = null;
    try { datos = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (res.status === 401 && !ruta.startsWith('/auth/login')) {
        Sesion.salir();
        throw new Error('Sesión expirada');
    }
    if (!res.ok) {
        const err = new Error((datos && datos.error) || `Error ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return datos;
}

/**
 * Ejecuta una operación que puede toparse con el límite de crédito.
 * Si el backend responde 409 pidiendo autorización y el usuario es admin,
 * ofrece reintentar con { forzar: true }. El motivo es obligatorio: queda
 * en auditoría junto con quién autorizó.
 */
async function conAutorizacion(fn, body) {
    try {
        return await fn(body);
    } catch (e) {
        const u = Sesion.usuario();
        if (e.status === 409 && /administrador puede autorizarlo/i.test(e.message) && u && u.rol === 'admin') {
            const motivo = await pedirMotivo(e.message);
            if (motivo) return fn({ ...body, forzar: true, motivo_autorizacion: motivo });
            return null;
        }
        throw e;
    }
}

/** Diálogo de motivo obligatorio (autorizaciones de crédito, anulaciones, pérdidas). */
function pedirMotivo(mensaje, { titulo = 'Autorizar', textoOk = 'Autorizar', etiqueta = 'Motivo' } = {}) {
    return new Promise((ok) => {
        let resuelto = false;
        const m = modal({
            titulo,
            cuerpo: `<p style="white-space:pre-line;margin-bottom:14px">${esc(mensaje)}</p>
                <div class="form"><div class="campo ancho">
                    <label for="m-motivo">${esc(etiqueta)} *</label>
                    <textarea id="m-motivo" placeholder="Queda registrado en la auditoría"></textarea>
                </div></div>`,
            acciones: [
                { texto: 'Cancelar', onClick: () => { resuelto = true; ok(null); } },
                { texto: textoOk, clase: 'btn-primario', onClick: (el) => {
                    const v = el.querySelector('#m-motivo').value.trim();
                    if (!v) { aviso('Escribe el motivo', 'error'); return false; }
                    resuelto = true;
                    ok(v);
                } },
            ],
        });
        m.el.querySelector('.modal-cab button').addEventListener('click', () => { if (!resuelto) ok(null); });
    });
}

/* ------------------------------------------------------------------ Formato */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = (n) => (Number(n) || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const pesos = (n) => (Number(n) || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const numero = (n, d = 0) => (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
function fecha(v) {
    if (!v) return '—';
    const s = String(v).slice(0, 10);
    const [a, m, d] = s.split('-');
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${Number(d)} ${meses[Number(m) - 1]} ${a}`;
}
const hoy = () => new Date().toISOString().slice(0, 10);
function fechaHora(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d)) return fecha(v);
    return `${fecha(d.toISOString())} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const peso = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

const ESTADOS = {
    // equipos
    disponible: ['Disponible', 'verde'], renta: ['En renta', 'azul'], venta: ['En venta', 'violeta'],
    reparacion: ['Reparación', 'naranja'], vendido: ['Vendido', 'gris'], baja: ['Baja', 'gris'],
    // rentas
    activa: ['Activa', 'azul'], finalizada: ['Finalizada', 'gris'], cancelada: ['Cancelada', 'rojo'],
    // servicios
    abierta: ['Abierta', 'azul'], en_proceso: ['En proceso', 'naranja'], terminada: ['Terminada', 'verde'], facturada: ['Facturada', 'gris'],
    // facturas
    pendiente: ['Pendiente', 'naranja'], parcial: ['Pago parcial', 'azul'], pagada: ['Pagada', 'verde'],
    // compras
    borrador: ['Borrador', 'gris'], enviada: ['Enviada', 'azul'], recibida: ['Recibida', 'verde'],
    // CRM
    prospecto: ['Prospecto', 'gris'], activo: ['Activo', 'verde'], frecuente: ['Frecuente', 'violeta'], inactivo: ['Inactivo', 'rojo'],
    // créditos
    sin_credito: ['Contado', 'gris'], suspendido: ['Suspendido', 'rojo'],
    // máximos/mínimos
    agotado: ['Agotado', 'rojo'], bajo_minimo: ['Bajo mínimo', 'naranja'], sobre_maximo: ['Sobre máximo', 'violeta'], ok: ['En rango', 'verde'],
    // empleados
    alta: ['Activo', 'verde'],
    // órdenes de trabajo (Producción)
    evaluacion: ['Evaluación', 'azul'], requiere_cotizacion: ['Requiere cotización', 'naranja'],
    cotizacion_interna: ['Cotización interna', 'naranja'], cotizacion_comercial: ['Cotización comercial', 'violeta'],
    autorizada: ['Autorizada', 'verde'], rechazada: ['Rechazada', 'rojo'], en_ejecucion: ['En ejecución', 'azul'],
    cerrada: ['Cerrada', 'gris'],
    programada: ['Programada', 'azul'], en_ruta: ['En ruta', 'naranja'], entregada: ['Entregada', 'verde'],
    // preventivos
    vencido: ['Vencido', 'rojo'], proximo: ['Próximo', 'naranja'], en_rango: ['En rango', 'verde'],
    // requisiciones
    surtida: ['Surtida', 'verde'],
    // embudo de oportunidades
    nuevo: ['Nuevo', 'gris'], calificado: ['Calificado', 'azul'], cotizado: ['Cotizado', 'naranja'],
    negociacion: ['Negociación', 'violeta'], ganado: ['Ganado', 'verde'], perdido: ['Perdido', 'rojo'],
};

/* ------------------------------------------------------------------ Entidades con bitácora */
const ENTIDADES_UI = {
    cliente:      { etiqueta: 'Cliente', url: '/crm/clientes.html' },
    renta:        { etiqueta: 'Renta', url: '/comercial/rentas.html' },
    ot:           { etiqueta: 'Orden de trabajo', url: '/produccion/ordenes-trabajo.html' },
    factura:      { etiqueta: 'Factura', url: '/comercial/facturacion.html' },
    orden_compra: { etiqueta: 'Orden de compra', url: '/administracion/compras.html' },
    equipo:       { etiqueta: 'Equipo', url: '/almacen/equipos.html' },
};
const TIPOS_ACTIVIDAD = [['llamada', 'Llamada'], ['visita', 'Visita'], ['correo', 'Correo'], ['tarea', 'Tarea'],
    ['recoger_equipo', 'Recoger equipo'], ['entregar_equipo', 'Entregar equipo']];
const tipoActividad = (t) => (TIPOS_ACTIVIDAD.find(([v]) => v === t) || [t, t])[1];
/** Enlace directo al registro (cada página abre el detalle si viene ?id=). */
const urlRegistro = (entidad, id) => `${(ENTIDADES_UI[entidad] || {}).url || '/dashboard.html'}?id=${id}`;
function tag(estado, texto) {
    const [t, c] = ESTADOS[estado] || [estado, 'gris'];
    return `<span class="tag" style="--c: var(--${c})">${esc(texto || t)}</span>`;
}
const etiqueta = (estado) => (ESTADOS[estado] || [estado])[0];

/* ------------------------------------------------------------------ Avisos */
function aviso(mensaje, tipo = '') {
    let caja = document.querySelector('.avisos');
    if (!caja) { caja = document.createElement('div'); caja.className = 'avisos'; document.body.appendChild(caja); }
    const el = document.createElement('div');
    el.className = `aviso ${tipo}`;
    el.setAttribute('role', 'status');
    el.textContent = mensaje;
    caja.appendChild(el);
    setTimeout(() => el.remove(), tipo === 'error' ? 6000 : 3500);
}
const avisoError = (e) => aviso(e.message || String(e), 'error');

/* ------------------------------------------------------------------ Modal */
function modal({ titulo, cuerpo, acciones = [], ancho }) {
    const velo = document.createElement('div');
    velo.className = 'velo';
    velo.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" style="${ancho ? `max-width:${ancho}px` : ''}">
            <div class="modal-cab"><h3>${esc(titulo)}</h3><button type="button" aria-label="Cerrar">×</button></div>
            <div class="modal-cuerpo">${cuerpo}</div>
            ${acciones.length ? '<div class="modal-pie"></div>' : ''}
        </div>`;
    const cerrar = () => { velo.remove(); document.removeEventListener('keydown', teclas); };
    const teclas = (e) => { if (e.key === 'Escape') cerrar(); };
    velo.querySelector('.modal-cab button').onclick = cerrar;
    velo.addEventListener('mousedown', (e) => { if (e.target === velo) cerrar(); });
    document.addEventListener('keydown', teclas);
    const pie = velo.querySelector('.modal-pie');
    acciones.forEach((a) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `btn ${a.clase || ''}`;
        b.textContent = a.texto;
        b.onclick = async () => {
            if (!a.onClick) return cerrar();
            b.disabled = true;
            try {
                const r = await a.onClick(velo);
                if (r !== false) cerrar();
            } catch (e) { avisoError(e); } finally { b.disabled = false; }
        };
        pie.appendChild(b);
    });
    document.body.appendChild(velo);
    const primero = velo.querySelector('input, select, textarea');
    if (primero) primero.focus();
    return { el: velo, cerrar };
}

function confirmar(mensaje, textoOk = 'Aceptar') {
    return new Promise((ok) => {
        const m = modal({
            titulo: 'Confirmar',
            cuerpo: `<p style="white-space:pre-line">${esc(mensaje)}</p>`,
            acciones: [
                { texto: 'Cancelar', onClick: () => { ok(false); } },
                { texto: textoOk, clase: 'btn-primario', onClick: () => { ok(true); } },
            ],
        });
        m.el.querySelector('.modal-cab button').addEventListener('click', () => ok(false));
    });
}

/* ------------------------------------------------------------------ Formularios
   campos: [{ k, etiqueta, tipo: text|number|date|email|select|textarea|checkbox,
              opciones: [[valor, texto]], requerido, ancho, paso, ayuda, soloLectura }] */
function formulario(campos, valores = {}) {
    return `<div class="form">${campos.map((c) => {
        const v = valores[c.k] ?? c.defecto ?? '';
        const id = `f-${c.k}`;
        const attrs = `id="${id}" name="${c.k}" ${c.requerido ? 'required' : ''} ${c.soloLectura ? 'disabled' : ''}`;
        let control;
        if (c.tipo === 'select') {
            control = `<select ${attrs}>${c.vacio !== false ? `<option value="">${esc(c.vacio || '— Selecciona —')}</option>` : ''}${(c.opciones || [])
                .map(([ov, ot]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ot)}</option>`).join('')}</select>`;
        } else if (c.tipo === 'textarea') {
            control = `<textarea ${attrs}>${esc(v)}</textarea>`;
        } else if (c.tipo === 'checkbox') {
            return `<div class="campo ${c.ancho ? 'ancho' : ''}"><label><input type="checkbox" ${attrs} ${v ? 'checked' : ''}/> ${esc(c.etiqueta)}</label></div>`;
        } else {
            control = `<input type="${c.tipo || 'text'}" ${attrs} value="${esc(v)}" ${c.paso ? `step="${c.paso}"` : ''} ${c.tipo === 'number' ? 'min="0"' : ''}/>`;
        }
        return `<div class="campo ${c.ancho ? 'ancho' : ''}"><label for="${id}">${esc(c.etiqueta)}${c.requerido ? ' *' : ''}</label>${control}${c.ayuda ? `<span class="ayuda">${esc(c.ayuda)}</span>` : ''}</div>`;
    }).join('')}</div>`;
}

function leerFormulario(raiz, campos) {
    const datos = {};
    for (const c of campos) {
        if (c.soloLectura) continue;
        const el = raiz.querySelector(`[name="${c.k}"]`);
        if (!el) continue;
        let v;
        if (c.tipo === 'checkbox') v = el.checked;
        else if (c.tipo === 'number') v = el.value === '' ? null : Number(el.value);
        else v = el.value.trim();
        if (c.requerido && (v === '' || v === null)) {
            el.focus();
            throw new Error(`"${c.etiqueta}" es obligatorio`);
        }
        datos[c.k] = v;
    }
    return datos;
}

/* ------------------------------------------------------------------ Piezas de UI */
function tabla({ columnas, filas, vacio = 'Sin registros', pie }) {
    if (!filas.length) return `<div class="vacio">${esc(vacio)}</div>`;
    return `<div class="tabla-caja"><table>
        <thead><tr>${columnas.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.t)}</th>`).join('')}</tr></thead>
        <tbody>${filas.map((f, i) => `<tr>${columnas.map((c) => `<td class="${c.num ? 'num' : ''} ${c.clase || ''}">${c.r ? c.r(f, i) : esc(f[c.k])}</td>`).join('')}</tr>`).join('')}</tbody>
        ${pie ? `<tfoot><tr>${pie}</tr></tfoot>` : ''}
    </table></div>`;
}

function kpi(etiquetaTxt, valor, sub = '', tono = '') {
    return `<div class="kpi ${tono ? `t-${tono}` : ''}"><div class="kpi-etiqueta">${esc(etiquetaTxt)}</div><div class="kpi-valor">${valor}</div>${sub ? `<div class="kpi-sub tenue">${sub}</div>` : ''}</div>`;
}

const opciones = (lista, valor, texto) => lista.map((x) => [x[valor], typeof texto === 'function' ? texto(x) : x[texto]]);

let _catalogos = null;
async function catalogos(recargar = false) {
    if (!_catalogos || recargar) _catalogos = await api('/catalogos');
    return _catalogos;
}

/** Descarga filas como CSV (abre bien en Excel). */
function exportarCSV(nombre, columnas, filas) {
    const limpiar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [columnas.map((c) => limpiar(c.t)).join(','),
        ...filas.map((f) => columnas.map((c) => limpiar(c.csv ? c.csv(f) : f[c.k])).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${nombre}-${hoy()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

/* ------------------------------------------------------------------ Bitácora del registro (estilo chatter)
   panelBitacora(contenedor, 'factura', 12): notas, adjuntos, actividades y
   cambios de estado en una sola línea de tiempo. El backend decide si el rol
   tiene derecho a verla (403 si la entidad no es de su área). */
async function panelBitacora(contenedor, entidad, id) {
    const el = typeof contenedor === 'string' ? document.querySelector(contenedor) : contenedor;
    if (!el) return;
    el.innerHTML = '<p class="tenue">Cargando bitácora…</p>';
    let datos;
    try {
        datos = await api(`/bitacora/${entidad}/${id}`);
    } catch (e) {
        el.innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
        return;
    }
    const recargar = () => panelBitacora(el, entidad, id);
    const pendientes = datos.actividades.filter((a) => !a.hecha);

    // Notas, adjuntos, eventos y actividades cerradas en una sola línea de tiempo.
    const linea = [
        ...datos.notas.map((n) => ({ fecha: n.fecha, usuario: n.usuario, clase: 'nota', html: esc(n.texto) })),
        ...datos.adjuntos.map((a) => ({ fecha: a.fecha, usuario: a.usuario, clase: 'adjunto',
            html: `Adjuntó <button class="btn-texto" type="button" data-adjunto="${a.id}" data-nombre="${esc(a.nombre)}">${esc(a.nombre)}</button> <span class="tenue">(${peso(a.tamano)})</span>` })),
        ...datos.eventos.map((v) => ({ fecha: v.fecha, usuario: v.usuario, clase: 'evento', html: esc(v.texto) })),
        ...datos.actividades.filter((a) => a.hecha).map((a) => ({ fecha: a.fecha_hecha, usuario: a.asignado_nombre, clase: 'evento',
            html: `Actividad completada: ${esc(tipoActividad(a.tipo))}${a.nota ? ' · ' + esc(a.nota) : ''}` })),
    ].filter((x) => x.fecha).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    el.innerHTML = `
        <div class="form" style="margin-bottom:6px">
            <div class="campo ancho">
                <label for="bit-texto">Nota</label>
                <textarea id="bit-texto" placeholder="Escribe una nota para el equipo…"></textarea>
            </div>
            <div class="campo ancho" style="flex-direction:row;gap:8px;align-items:center;flex-wrap:wrap">
                <input type="file" id="bit-archivo" aria-label="Adjuntar archivo" style="flex:1;min-width:200px">
                <button class="btn btn-primario" type="button" id="bit-guardar">Agregar a la bitácora</button>
                <button class="btn" type="button" id="bit-actividad">Programar actividad</button>
            </div>
        </div>
        ${pendientes.length ? `<h4 style="margin:14px 0 6px">Actividades pendientes (${pendientes.length})</h4>
            <ul class="linea-tiempo">${pendientes.map((a) => `<li>
                <strong>${esc(tipoActividad(a.tipo))}</strong> · vence ${fecha(a.fecha_limite)}
                <span class="tenue">· ${esc(a.asignado_nombre)}</span>
                ${a.dias < 0 ? ' <span class="tag" style="--c: var(--rojo)">Vencida</span>' : ''}
                <button class="btn btn-chico" type="button" data-hecha="${a.id}" style="margin-left:8px">Marcar hecha</button>
                ${a.nota ? `<div>${esc(a.nota)}</div>` : ''}
            </li>`).join('')}</ul>` : ''}
        <h4 style="margin:14px 0 6px">Historial</h4>
        <ul class="linea-tiempo">${linea.map((x) => `<li>
            <span class="tenue">${fechaHora(x.fecha)}${x.usuario ? ' · ' + esc(x.usuario) : ''}</span>
            <div>${x.html}</div>
        </li>`).join('') || '<li class="tenue">Todavía no hay movimientos en la bitácora</li>'}</ul>`;

    el.querySelector('#bit-guardar').onclick = async (e) => {
        const boton = e.currentTarget;
        const texto = el.querySelector('#bit-texto').value.trim();
        const archivo = el.querySelector('#bit-archivo').files[0];
        if (!texto && !archivo) return aviso('Escribe una nota o elige un archivo', 'error');
        boton.disabled = true;
        try {
            if (texto) await api('/notas', { method: 'POST', body: { entidad, entidad_id: id, texto } });
            if (archivo) {
                const contenido = await new Promise((ok, falla) => {
                    const fr = new FileReader();
                    fr.onload = () => ok(String(fr.result).split(',').pop());
                    fr.onerror = () => falla(new Error('No se pudo leer el archivo'));
                    fr.readAsDataURL(archivo);
                });
                await api('/adjuntos', { method: 'POST', body: { entidad, entidad_id: id, nombre: archivo.name, tipo: archivo.type, contenido } });
            }
            aviso('Bitácora actualizada', 'ok');
            await recargar();
        } catch (err) { avisoError(err); } finally { boton.disabled = false; }
    };

    el.querySelector('#bit-actividad').onclick = () => dialogoActividad(entidad, id, recargar);

    el.querySelectorAll('[data-hecha]').forEach((b) => {
        b.onclick = async () => {
            try {
                await api(`/actividades/${b.dataset.hecha}/hecha`, { method: 'POST', body: { hecha: true } });
                aviso('Actividad cerrada', 'ok');
                await recargar();
            } catch (err) { avisoError(err); }
        };
    });

    el.querySelectorAll('[data-adjunto]').forEach((b) => {
        b.onclick = () => descargarAdjunto(b.dataset.adjunto, b.dataset.nombre);
    });
}

/** Los adjuntos se bajan con el token de sesión, no con un <a href> directo. */
async function descargarAdjunto(id, nombre) {
    try {
        const res = await fetch(`/api/adjuntos/${id}`, { headers: { Authorization: `Bearer ${Sesion.token()}` } });
        if (!res.ok) throw new Error('No se pudo descargar el adjunto');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await res.blob());
        a.download = nombre || 'adjunto';
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (e) { avisoError(e); }
}

function dialogoActividad(entidad, entidadId, alTerminar) {
    catalogos().then((cat) => {
        const campos = [
            { k: 'tipo', etiqueta: 'Tipo', tipo: 'select', vacio: false, opciones: TIPOS_ACTIVIDAD, defecto: 'tarea' },
            { k: 'fecha_limite', etiqueta: 'Fecha límite', tipo: 'date', requerido: true, defecto: hoy() },
            { k: 'asignado_a', etiqueta: 'Asignada a', tipo: 'select', vacio: false, ancho: true,
                opciones: opciones(cat.usuarios || [], 'id', 'nombre'), defecto: (Sesion.usuario() || {}).id },
            { k: 'nota', etiqueta: 'Nota', tipo: 'textarea', ancho: true },
        ];
        modal({
            titulo: 'Programar actividad',
            cuerpo: formulario(campos),
            acciones: [{ texto: 'Cancelar' }, { texto: 'Programar', clase: 'btn-primario', onClick: async (m) => {
                await api('/actividades', { method: 'POST', body: { ...leerFormulario(m, campos), entidad, entidad_id: entidadId } });
                aviso('Actividad programada', 'ok');
                if (alTerminar) await alTerminar();
            } }],
        });
    }).catch(avisoError);
}

/** Abre el detalle del registro cuando se llega con ?id= desde Mis actividades. */
function idDeUrl() {
    const v = new URLSearchParams(location.search).get('id');
    return v && /^\d+$/.test(v) ? v : null;
}

/* ------------------------------------------------------------------ Diálogo de pago (Facturación y Cobranza) */
async function dialogoPago(f, alTerminar) {
    const saldo = Math.round((f.total - f.pagado) * 100) / 100;
    const cat = await catalogos();
    const campos = [
        { k: 'monto', etiqueta: 'Monto', tipo: 'number', paso: '0.01', requerido: true, defecto: saldo },
        { k: 'fecha', etiqueta: 'Fecha', tipo: 'date', defecto: hoy() },
        { k: 'metodo', etiqueta: 'Método', tipo: 'select', vacio: false, opciones: [['transferencia', 'Transferencia'], ['efectivo', 'Efectivo'], ['cheque', 'Cheque'], ['tarjeta', 'Tarjeta']] },
        { k: 'referencia', etiqueta: 'Referencia' },
        { k: 'cuenta_bancaria_id', etiqueta: 'Cuenta bancaria', tipo: 'select', ancho: true,
            vacio: 'Bancos (general)', opciones: opciones(cat.cuentas_bancarias || [], 'id', (b) => `${b.banco} ${b.numero_enmascarado}`),
            ayuda: 'En efectivo el cobro entra a Caja, no al banco' },
    ];
    modal({
        titulo: `Registrar pago · ${f.folio}`,
        cuerpo: `<p style="margin-bottom:14px">${esc(f.razon_social)} · saldo <strong>${dinero(saldo)}</strong></p>` + formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Registrar', clase: 'btn-primario', onClick: async (m) => {
            const r = await api('/pagos', { method: 'POST', body: { ...leerFormulario(m, campos), factura_id: f.id } });
            aviso(r.saldo > 0 ? `Pago registrado. Saldo: ${dinero(r.saldo)}` : 'Factura liquidada', 'ok');
            if (alTerminar) await alTerminar();
        } }],
    });
}

/** Anular un pago mal capturado (solo admin y administración). El motivo es obligatorio. */
async function anularPago(pago, alTerminar) {
    const motivo = await pedirMotivo(
        `Se va a anular el pago de ${dinero(pago.monto)} del ${fecha(pago.fecha)}.\nSe genera una póliza de reversa y la factura recupera su saldo.`,
        { titulo: 'Anular pago', textoOk: 'Anular pago', etiqueta: 'Motivo de la anulación' });
    if (!motivo) return false;
    const r = await api(`/pagos/${pago.id}/anular`, { method: 'POST', body: { motivo } });
    aviso(`Pago anulado (reversa ${r.poliza_reversa}). Saldo: ${dinero(r.saldo)}`, 'ok');
    if (alTerminar) await alTerminar();
}
