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
 * ofrece reintentar con { forzar: true }.
 */
async function conAutorizacion(fn, body) {
    try {
        return await fn(body);
    } catch (e) {
        const u = Sesion.usuario();
        if (e.status === 409 && /administrador puede autorizarlo/i.test(e.message) && u && u.rol === 'admin') {
            const ok = await confirmar(`${e.message}\n\n¿Autorizar la operación de todos modos?`, 'Autorizar');
            if (ok) return fn({ ...body, forzar: true });
            return null;
        }
        throw e;
    }
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
};
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

/* ------------------------------------------------------------------ Diálogo de pago (Facturación y Cobranza) */
function dialogoPago(f, alTerminar) {
    const saldo = Math.round((f.total - f.pagado) * 100) / 100;
    const campos = [
        { k: 'monto', etiqueta: 'Monto', tipo: 'number', paso: '0.01', requerido: true, defecto: saldo },
        { k: 'fecha', etiqueta: 'Fecha', tipo: 'date', defecto: hoy() },
        { k: 'metodo', etiqueta: 'Método', tipo: 'select', vacio: false, opciones: [['transferencia', 'Transferencia'], ['efectivo', 'Efectivo'], ['cheque', 'Cheque'], ['tarjeta', 'Tarjeta']] },
        { k: 'referencia', etiqueta: 'Referencia' },
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
