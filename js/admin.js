// js/admin.js - 管理后台（交通耗时：基准+偏移方案，编辑器仅显示分值≥30的POI）
import {
    getPois, getPoi, insertPoi, updatePoi, deletePoi as apiDeletePoi,
    getRoutes, getRoute, insertRoute, updateRoute, deleteRoute as apiDeleteRoute,
    getRouteNodes, insertRouteNodes, deleteRouteNodes,
    getTransportTimes, setTransportTime, deleteTransportTime,
    deleteTransportTimesForPoi, applyBaseWithOffset, clearBaseRelation, getDependents,
    getMerchantsByPoi, getMerchant, updateMerchant, createMerchantRecord,
    getReservations, updateReservation,
    getFeedbacks, updateFeedback, deleteFeedback as apiDeleteFeedback,
    uploadFile
} from './api.js';
import { MAX_POI_DURATION } from './config.js';

let allPois = [], allRoutes = [], allTransportTimes = [], allMerchants = [], allFeedbacks = [];
let currentEditingPoiId = null;
let currentEditingPoiObj = null;
let categoryManuallySet = false;

let routeNodesData = [];
let editingNodeIndex = -1;
let poiPickerSelectedId = null;
let poiPickerCurrentSearch = '';
let currentTransportPoiList = [];

const STORAGE_BUCKET = '0frontend-assets';

// ============================================================
// 通用工具
// ============================================================
function isValidId(val) {
    if (val === null || val === undefined || val === '') return false;
    const s = String(val).trim();
    if (/^\d+$/.test(s)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
    return false;
}
function toSafeId(val) {
    if (!isValidId(val)) return null;
    const s = String(val).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    return s;
}
function getMainCategory(cat) {
    return (cat || '').split(',')[0].trim();
}

function cleanupBackdrop() {
    document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
}
function closeModal(modalId) {
    return new Promise((resolve) => {
        const el = document.getElementById(modalId);
        if (!el) { resolve(); return; }
        const instance = bootstrap.Modal.getInstance(el);
        if (instance) {
            let resolved = false;
            const done = () => {
                if (resolved) return;
                resolved = true;
                el.removeEventListener('hidden.bs.modal', done);
                cleanupBackdrop();
                resolve();
            };
            el.addEventListener('hidden.bs.modal', done);
            instance.hide();
            setTimeout(done, 400);
        } else {
            cleanupBackdrop();
            resolve();
        }
    });
}

const LEVEL_LABELS = { L1: '🏞️ L1 景区', L2: '📍 L2 普通景点', L3: '⭐ L3 连续景点', L4: '🏛️ L4 服务/设施' };
const LEVEL_CLASSES = { L1: 'quality-L1', L2: 'quality-L2', L3: 'quality-L3', L4: 'quality-L4' };
const FACILITY_SUBTYPE_LABELS = {
    restaurant: '🍽️ 餐厅', hotel: '🏨 住宿', shopping: '🛍️ 购物', service: '🚻 服务设施'
};
const FACILITY_SUBTYPE_CLASSES = {
    restaurant: 'type-badge-restaurant', hotel: 'type-badge-hotel',
    shopping: 'type-badge-shopping', service: 'type-badge-service'
};
const CATEGORY_ICONS = {
    '自然景区': '🏔️', '红色景区': '🔴', '文博场馆': '🏛️',
    '餐饮住宿': '🍽️', '交通枢纽': '🚌', '游玩娱乐': '🎢',
    '购物消费': '🛍️', '公共服务': '🏛️'
};
const ROUTE_TYPE_LABELS = {
    scenic_internal: '🏞️ 景区内部', city_day: '🏙️ 城市一日游',
    area_multi: '🗺️ 区域联合', custom: '✨ 自定义'
};
const DAY_CATEGORY_LABELS = { half_day: '🌤️ 半日游', one_day: '☀️ 一日游', multi_day: '📅 多日游' };
const NODE_TYPE_LABELS = {
    entrance: '🚪 入口', parking: '🅿️ 停车场', rest: '☕ 休息区',
    core_view: '⭐ 核心景点', spot: '📍 景点参观', entertainment: '🎢 游玩项目',
    wc: '🚻 卫生间', exit: '🚪 出口', other: '📌 其他'
};
const PRIORITY_LABELS = { 1: '⭐ 一级', 2: '⭐⭐ 二级', 3: '⭐⭐⭐ 三级' };

function getLevelBadge(level) {
    const cls = LEVEL_CLASSES[level] || 'quality-L4';
    const label = LEVEL_LABELS[level] || level;
    return `<span class="data-quality-badge ${cls}">${label}</span>`;
}
function getCoreNodeBadge() {
    return `<span class="data-quality-badge" style="background:#b0bec5;color:#fff;">🗺️ 核心节点</span>`;
}
function getScoreBadge(score) {
    if (!score || score <= 0) return '';
    return `<span class="score-badge">⭐ ${score}</span>`;
}
function getFacilitySubtypeBadge(subtypes) {
    if (!subtypes) return '';
    const arr = Array.isArray(subtypes) ? subtypes : [subtypes];
    return arr.map(s => {
        const cls = FACILITY_SUBTYPE_CLASSES[s] || 'type-badge-facility';
        const label = FACILITY_SUBTYPE_LABELS[s] || s;
        return `<span class="type-badge ${cls}">${label}</span>`;
    }).join('');
}
function subtypesToText(subtypes) {
    if (!Array.isArray(subtypes) || subtypes.length === 0) return '';
    return subtypes.map(s => (FACILITY_SUBTYPE_LABELS[s] || s).replace(/^[^\s]+\s/, '')).join('/');
}

function buildTimeOptions() {
    const opts = [];
    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 30) {
            const val = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
            opts.push(val);
        }
    }
    return opts;
}
function populateTimeSelects() {
    const openSel = document.getElementById('edit-poi-open');
    const closeSel = document.getElementById('edit-poi-close');
    if (!openSel || !closeSel) return;
    const opts = buildTimeOptions();
    openSel.innerHTML = opts.map(v => `<option value="${v}">${v}</option>`).join('');
    closeSel.innerHTML = opts.map(v => `<option value="${v}">${v}</option>`).join('') +
                        `<option value="23:59">23:59</option>`;
}
function normalizeTimeStr(t) {
    if (t === null || t === undefined || t === '') return '';
    const s = String(t).trim();
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return '';
    const h = String(parseInt(m[1], 10)).padStart(2, '0');
    return `${h}:${m[2]}`;
}
function setSelectValueSafe(sel, val) {
    if (!sel) return;
    if (!val) { sel.selectedIndex = -1; return; }
    if (sel.options.length === 0) populateTimeSelects();
    let found = false;
    for (let opt of sel.options) { if (opt.value === val) { found = true; break; } }
    if (!found) {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = val;
        sel.appendChild(opt);
    }
    sel.value = val;
}

// ============================================================
// 初始化
// ============================================================
export async function initAdminUI() {
    try {
        populateTimeSelects();
        const [pois, routes, times, merchants, feedbacks] = await Promise.all([
            getPois(), getRoutes(), getTransportTimes(),
            getMerchantsByPoi(null), getFeedbacks(null)
        ]);
        allPois = pois;
        allRoutes = routes;
        allTransportTimes = times;
        allMerchants = merchants;
        allFeedbacks = feedbacks;
        renderPoiList(allPois);
        renderRouteList(allRoutes);
        renderTransportEditor(allTransportTimes);
        renderMerchantList(allMerchants);
        renderFeedbackList(allFeedbacks);
        console.log('[管理后台] 初始化完成，交通记录:', allTransportTimes.length);
    } catch (e) {
        console.error('[管理后台] 初始化失败:', e);
        alert('初始化失败：' + e.message);
    }
}

// ============================================================
// POI 列表
// ============================================================
const CATEGORY_ORDER = [
    '自然景区', '红色景区', '文博场馆', '餐饮住宿',
    '交通枢纽', '游玩娱乐', '购物消费', '公共服务'
];

export function renderPoiList(pois) {
    const container = document.getElementById('poi-list');
    if (!container) return;
    const l1List = pois.filter(p => p.data_level === 'L1');
    const l4List = pois.filter(p =>
        p.data_level === 'L4' && !p.parent_id
        && (p.scenic_id === null || p.scenic_id === undefined)
    );
    const topL2L3 = pois.filter(p =>
        (p.data_level === 'L2' || p.data_level === 'L3') && !p.parent_id
    );
    let html = '';
    CATEGORY_ORDER.forEach(cat => {
        const catL1 = l1List.filter(p => getMainCategory(p.category) === cat);
        const catOrphans = topL2L3.filter(p => {
            if (p.scenic_id !== null && p.scenic_id !== undefined) return false;
            return getMainCategory(p.category) === cat;
        });
        if (catL1.length === 0 && catOrphans.length === 0) return;
        const catIcon = CATEGORY_ICONS[cat] || '📍';
        html += `<div class="poi-category-section">`;
        html += `<div class="poi-category-header">${catIcon} ${cat}</div>`;
        catL1.forEach(l1 => { html += renderL1Card(l1, pois); });
        if (catOrphans.length > 0) {
            html += `<div class="poi-orphan-list">`;
            html += `<div class="poi-orphan-list-title">📌 无归属${cat}（独立景点）</div>`;
            catOrphans.sort((a, b) => {
                const order = { L2: 0, L3: 1 };
                return (order[a.data_level] ?? 9) - (order[b.data_level] ?? 9);
            });
            catOrphans.forEach(p => { html += renderOrphanCard(p, pois); });
            html += `</div>`;
        }
        html += `</div>`;
    });
    if (l4List.length > 0) {
        html += `<div class="poi-category-section">`;
        html += `<div class="poi-category-header">🏛️ 服务场所（L4）</div>`;
        l4List.forEach(l4 => { html += renderL4Card(l4, pois); });
        html += `</div>`;
    }
    container.innerHTML = html || '<p class="text-secondary">暂无POI</p>';
}

function renderL1Card(l1, pois) {
    const l1Badge = getLevelBadge('L1');
    const mainCat = getMainCategory(l1.category);
    const catIcon = CATEGORY_ICONS[mainCat] || '';
    const catBadge = l1.category ? `<span class="category-badge">${catIcon} ${l1.category}</span>` : '';
    const voiceBadge = l1.voice_mp3 ? `<span class="voice-badge">🔊 语音</span>` : '';
    const scoreBadge = getScoreBadge(l1.recommend_score);
    const hoursText = l1.hours_type === '24h'
        ? '<span class="badge bg-info text-dark">24H</span>'
        : (l1.open_time && l1.close_time
            ? `<span class="text-secondary small">${normalizeTimeStr(l1.open_time)}-${normalizeTimeStr(l1.close_time)}</span>`
            : '');
    const children = pois.filter(p =>
        String(p.scenic_id) === String(l1.id)
        && (p.data_level === 'L2' || p.data_level === 'L3' || p.data_level === 'L4')
        && !p.parent_id
    ).sort((a, b) => {
        const order = { L2: 0, L3: 1, L4: 2 };
        return (order[a.data_level] ?? 9) - (order[b.data_level] ?? 9);
    });
    let html = `<div class="poi-l1-card">`;
    html += `<div class="poi-l1-header">`;
    html += `<span class="poi-name-group">${l1Badge} <b>${l1.name}</b> ${catBadge}${voiceBadge}${scoreBadge} ${hoursText}</span>`;
    html += `<div>`;
    html += `<button class="btn btn-sm btn-secondary" onclick="window.showEditPoiModal('${l1.id}')"><i class="fas fa-edit"></i> 编辑</button>`;
    html += `<button class="btn btn-sm btn-danger ms-1" onclick="window.deletePoi('${l1.id}')"><i class="fas fa-trash"></i> 删除</button>`;
    html += `</div></div>`;
    if (children.length > 0) {
        html += `<div class="poi-l1-children">`;
        children.forEach(child => { html += renderChildCard(child, pois, 0); });
        html += `</div>`;
    } else {
        html += `<div class="poi-empty-hint">（该景区下暂无景点，请点击"编辑"添加子项）</div>`;
    }
    html += `</div>`;
    return html;
}

function renderChildCard(p, pois, depth) {
    const isCoreNode = p.is_core_node && p.parent_id;
    const badge = isCoreNode ? getCoreNodeBadge() : getLevelBadge(p.data_level || 'L2');
    const mainCat = getMainCategory(p.category);
    const catIcon = CATEGORY_ICONS[mainCat] || '';
    const catBadge = p.category ? `<span class="category-badge">${catIcon} ${p.category}</span>` : '';
    const voiceBadge = p.voice_mp3 ? `<span class="voice-badge">🔊 语音</span>` : '';
    const scoreBadge = getScoreBadge(p.recommend_score);
    const durationInfo = (p.visit_duration)
        ? `<span class="text-secondary small">${p.visit_duration}分钟</span>` : '';
    const hoursText = p.hours_type === '24h'
        ? '<span class="badge bg-info text-dark">24H</span>'
        : (p.open_time && p.close_time
            ? `<span class="text-secondary small">${normalizeTimeStr(p.open_time)}-${normalizeTimeStr(p.close_time)}</span>`
            : '');
    const facilityTag = p.type === 'facility' ? ' ' + getFacilitySubtypeBadge(p.facility_subtype) : '';
    let html = `<div class="poi-child-card">`;
    html += `<div class="poi-child-header">`;
    html += `<span class="poi-name-group">${badge} <b>${p.name}</b>${facilityTag} ${catBadge}${voiceBadge}${scoreBadge} ${durationInfo} ${hoursText}</span>`;
    html += `<div>`;
    html += `<button class="btn btn-sm btn-secondary" onclick="window.showEditPoiModal('${p.id}')"><i class="fas fa-edit"></i> 编辑</button>`;
    html += `<button class="btn btn-sm btn-danger ms-1" onclick="window.deletePoi('${p.id}')"><i class="fas fa-trash"></i> 删除</button>`;
    html += `</div></div>`;
    if (p.data_level === 'L3' && !isCoreNode) {
        const innerNodes = pois.filter(x => String(x.parent_id) === String(p.id));
        if (innerNodes.length > 0) {
            html += `<div class="poi-l3-children">`;
            innerNodes.forEach(n => { html += renderChildCard(n, pois, depth + 1); });
            html += `</div>`;
        }
    }
    html += `</div>`;
    return html;
}

function renderOrphanCard(p, pois) {
    const badge = getLevelBadge(p.data_level || 'L2');
    const mainCat = getMainCategory(p.category);
    const catIcon = CATEGORY_ICONS[mainCat] || '';
    const catBadge = p.category ? `<span class="category-badge">${catIcon} ${p.category}</span>` : '';
    const voiceBadge = p.voice_mp3 ? `<span class="voice-badge">🔊 语音</span>` : '';
    const scoreBadge = getScoreBadge(p.recommend_score);
    const durationInfo = (p.visit_duration)
        ? `<span class="text-secondary small">${p.visit_duration}分钟</span>` : '';
    const hoursText = p.hours_type === '24h'
        ? '<span class="badge bg-info text-dark">24H</span>'
        : (p.open_time && p.close_time
            ? `<span class="text-secondary small">${normalizeTimeStr(p.open_time)}-${normalizeTimeStr(p.close_time)}</span>`
            : '');
    let html = `<div class="poi-orphan-card">`;
    html += `<div class="poi-child-header">`;
    html += `<span class="poi-name-group">${badge} <b>${p.name}</b> ${catBadge}${voiceBadge}${scoreBadge} ${durationInfo} ${hoursText}</span>`;
    html += `<div>`;
    html += `<button class="btn btn-sm btn-secondary" onclick="window.showEditPoiModal('${p.id}')"><i class="fas fa-edit"></i> 编辑</button>`;
    html += `<button class="btn btn-sm btn-danger ms-1" onclick="window.deletePoi('${p.id}')"><i class="fas fa-trash"></i> 删除</button>`;
    html += `</div></div>`;
    if (p.data_level === 'L3') {
        const innerNodes = pois.filter(x => String(x.parent_id) === String(p.id));
        if (innerNodes.length > 0) {
            html += `<div class="poi-l3-children">`;
            innerNodes.forEach(n => { html += renderChildCard(n, pois, 1); });
            html += `</div>`;
        }
    }
    html += `</div>`;
    return html;
}

function renderL4Card(l4, pois) {
    const badge = getLevelBadge('L4');
    const mainCat = getMainCategory(l4.category);
    const catIcon = CATEGORY_ICONS[mainCat] || '';
    const catBadge = l4.category ? `<span class="category-badge">${catIcon} ${l4.category}</span>` : '';
    const facilityTag = l4.type === 'facility' ? ' ' + getFacilitySubtypeBadge(l4.facility_subtype) : '';
    const voiceBadge = l4.voice_mp3 ? `<span class="voice-badge">🔊 语音</span>` : '';
    const scoreBadge = getScoreBadge(l4.recommend_score);
    const durationInfo = (l4.visit_duration)
        ? `<span class="text-secondary small">${l4.visit_duration}分钟</span>` : '';
    const hoursText = l4.hours_type === '24h'
        ? '<span class="badge bg-info text-dark">24H</span>'
        : (l4.open_time && l4.close_time
            ? `<span class="text-secondary small">${normalizeTimeStr(l4.open_time)}-${normalizeTimeStr(l4.close_time)}</span>`
            : '');
    let html = `<div class="poi-orphan-card">`;
    html += `<div class="poi-child-header">`;
    html += `<span class="poi-name-group">${badge} <b>${l4.name}</b>${facilityTag} ${catBadge}${voiceBadge}${scoreBadge} ${durationInfo} ${hoursText}</span>`;
    html += `<div>`;
    html += `<button class="btn btn-sm btn-secondary" onclick="window.showEditPoiModal('${l4.id}')"><i class="fas fa-edit"></i> 编辑</button>`;
    html += `<button class="btn btn-sm btn-danger ms-1" onclick="window.deletePoi('${l4.id}')"><i class="fas fa-trash"></i> 删除</button>`;
    html += `</div></div></div>`;
    return html;
}

// ============================================================
// 新增 / 编辑 POI
// ============================================================
export function showAddPoiModal() {
    currentEditingPoiId = null;
    currentEditingPoiObj = null;
    categoryManuallySet = false;
    populateTimeSelects();

    document.getElementById('edit-poi-id').value = '';
    document.getElementById('edit-poi-name').value = '';
    document.getElementById('edit-poi-level').value = 'L2';
    document.getElementById('edit-poi-score').value = '0';
    document.getElementById('edit-poi-category').value = '自然景区';
    document.getElementById('edit-poi-lat').value = '';
    document.getElementById('edit-poi-lng').value = '';
    document.getElementById('edit-poi-hours-type').value = 'custom';
    setSelectValueSafe(document.getElementById('edit-poi-open'), '08:00');
    setSelectValueSafe(document.getElementById('edit-poi-close'), '18:00');
    document.getElementById('edit-poi-visit').value = '';
    document.getElementById('edit-poi-desc').value = '';
    document.getElementById('edit-poi-core-node').checked = false;
    document.getElementById('edit-poi-core-node').disabled = false;
    document.getElementById('edit-poi-voice-file').value = '';
    document.getElementById('edit-poi-voice-mp3').value = '';
    document.getElementById('edit-poi-voice-status').textContent = '';
    document.getElementById('edit-poi-voice-preview').innerHTML = '';
    setFacilitySubtypeCheckboxes([]);

    refreshScenicSelect(null);

    document.getElementById('poiModalTitle').textContent = '新增POI';
    togglePoiLevelUI();
    toggleHoursTypeUI();
    renderSubPoiList();

    new bootstrap.Modal(document.getElementById('poiModal')).show();
}

export async function showEditPoiModal(poiId) {
    const poi = allPois.find(p => String(p.id) === String(poiId));
    if (!poi) return;
    currentEditingPoiId = poiId;
    currentEditingPoiObj = poi;
    categoryManuallySet = true;
    populateTimeSelects();

    document.getElementById('edit-poi-id').value = poiId;
    document.getElementById('edit-poi-name').value = poi.name || '';
    document.getElementById('edit-poi-level').value = poi.data_level || 'L2';
    document.getElementById('edit-poi-score').value = poi.recommend_score ?? 0;
    document.getElementById('edit-poi-category').value = poi.category || '自然景区';
    document.getElementById('edit-poi-lat').value = poi.lat || '';
    document.getElementById('edit-poi-lng').value = poi.lng || '';
    document.getElementById('edit-poi-hours-type').value = poi.hours_type || 'custom';

    setSelectValueSafe(document.getElementById('edit-poi-open'), normalizeTimeStr(poi.open_time) || '08:00');
    setSelectValueSafe(document.getElementById('edit-poi-close'), normalizeTimeStr(poi.close_time) || '18:00');

    document.getElementById('edit-poi-visit').value = poi.visit_duration || '';
    document.getElementById('edit-poi-desc').value = poi.description || '';

    const coreCb = document.getElementById('edit-poi-core-node');
    coreCb.checked = !!poi.is_core_node;
    coreCb.disabled = !!poi.parent_id;

    document.getElementById('edit-poi-voice-file').value = '';
    document.getElementById('edit-poi-voice-mp3').value = poi.voice_mp3 || '';
    document.getElementById('edit-poi-voice-status').textContent = poi.voice_mp3 ? '已有语音' : '';
    if (poi.voice_mp3) {
        document.getElementById('edit-poi-voice-preview').innerHTML =
            `<audio controls src="${poi.voice_mp3}" style="width:100%;max-width:400px;"></audio>`;
    } else {
        document.getElementById('edit-poi-voice-preview').innerHTML = '';
    }

    let subtypes = [];
    if (Array.isArray(poi.facility_subtype)) subtypes = poi.facility_subtype;
    else if (poi.facility_subtype) subtypes = [poi.facility_subtype];
    setFacilitySubtypeCheckboxes(subtypes);

    refreshScenicSelect(poiId);

    document.getElementById('poiModalTitle').textContent = `编辑POI - ${poi.name}`;
    togglePoiLevelUI();
    toggleHoursTypeUI();
    renderSubPoiList();

    new bootstrap.Modal(document.getElementById('poiModal')).show();
}

function refreshScenicSelect(currentId) {
    const scenicSel = document.getElementById('edit-poi-scenic');
    if (!scenicSel) return;
    scenicSel.innerHTML = '<option value="">-- 无归属（独立景点）--</option>';
    const currentPoi = currentId ? allPois.find(x => String(x.id) === String(currentId)) : null;
    allPois.filter(p =>
        p.data_level === 'L1' && isValidId(p.id) && String(p.id) !== String(currentId)
    ).forEach(p => {
        const hasValidScenic = currentPoi && currentPoi.scenic_id !== null && currentPoi.scenic_id !== undefined;
        const selected = hasValidScenic && String(p.id) === String(currentPoi.scenic_id) ? 'selected' : '';
        scenicSel.innerHTML += `<option value="${p.id}" ${selected}>🏞️ ${p.name}</option>`;
    });
}

window.onPoiVoiceSelected = async function(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) { alert('请选择音频文件（MP3）'); event.target.value = ''; return; }
    if (file.size > 10 * 1024 * 1024) { alert('音频文件不得超过 10MB'); event.target.value = ''; return; }
    const statusEl = document.getElementById('edit-poi-voice-status');
    statusEl.textContent = '上传中...';
    statusEl.className = 'text-warning small';
    try {
        const poiId = document.getElementById('edit-poi-id').value || 'new_' + Date.now();
        const ext = file.name.split('.').pop() || 'mp3';
        const path = `poi-voices/${poiId}_${Date.now()}.${ext}`;
        const publicUrl = await uploadFile(STORAGE_BUCKET, path, file);
        document.getElementById('edit-poi-voice-mp3').value = publicUrl;
        statusEl.textContent = '✓ 上传成功';
        statusEl.className = 'text-success small';
        document.getElementById('edit-poi-voice-preview').innerHTML =
            `<audio controls src="${publicUrl}" style="width:100%;max-width:400px;"></audio>`;
    } catch (e) {
        statusEl.textContent = '上传失败：' + e.message;
        statusEl.className = 'text-danger small';
        console.error(e);
    }
};

window.toggleHoursTypeUI = function() {
    const type = document.getElementById('edit-poi-hours-type').value;
    const openSel = document.getElementById('edit-poi-open');
    const closeSel = document.getElementById('edit-poi-close');
    if (type === '24h') {
        setSelectValueSafe(openSel, '00:00');
        setSelectValueSafe(closeSel, '23:59');
        openSel.disabled = true;
        closeSel.disabled = true;
    } else {
        openSel.disabled = false;
        closeSel.disabled = false;
        if (openSel.value === '00:00' && closeSel.value === '23:59') {
            setSelectValueSafe(openSel, '08:00');
            setSelectValueSafe(closeSel, '18:00');
        }
    }
};

function getFacilitySubtypeCheckboxes() {
    const ids = ['subtype-restaurant', 'subtype-hotel', 'subtype-shopping', 'subtype-service'];
    const values = [];
    ids.forEach(id => {
        const cb = document.getElementById(id);
        if (cb && cb.checked) values.push(cb.value);
    });
    return values;
}
function setFacilitySubtypeCheckboxes(values) {
    const arr = Array.isArray(values) ? values : (values ? [values] : []);
    const ids = ['subtype-restaurant', 'subtype-hotel', 'subtype-shopping', 'subtype-service'];
    ids.forEach(id => {
        const cb = document.getElementById(id);
        if (cb) cb.checked = arr.includes(cb.value);
    });
}

window.onCategoryChange = function() { categoryManuallySet = true; };

export function togglePoiLevelUI() {
    const level = document.getElementById('edit-poi-level').value;
    const fieldFacilitySubtype = document.getElementById('field-facility-subtype');
    const fieldDuration = document.getElementById('field-duration');
    const fieldCoreNode = document.getElementById('field-core-node');
    const fieldScenic = document.getElementById('field-scenic');
    const subSection = document.getElementById('sub-poi-section');
    const visitInput = document.getElementById('edit-poi-visit');
    const subTitle = document.getElementById('sub-poi-title');
    const subHint = document.getElementById('sub-poi-hint');

    fieldFacilitySubtype.classList.add('hidden');
    fieldDuration.classList.add('hidden');
    fieldCoreNode.classList.add('hidden');
    if (fieldScenic) fieldScenic.classList.add('hidden');
    subSection.classList.add('hidden');
    visitInput.readOnly = false;

    if (level === 'L1') {
    } else if (level === 'L2') {
        fieldDuration.classList.remove('hidden');
        fieldCoreNode.classList.remove('hidden');
        if (fieldScenic) fieldScenic.classList.remove('hidden');
    } else if (level === 'L3') {
        fieldDuration.classList.remove('hidden');
        fieldCoreNode.classList.remove('hidden');
        if (fieldScenic) fieldScenic.classList.remove('hidden');
        subSection.classList.remove('hidden');
        if (subTitle) subTitle.textContent = '核心节点管理';
        if (subHint) subHint.textContent = '添加 L2 或 L4 景点作为核心节点。可用 ↑↓ 调整游览顺序。';
    } else if (level === 'L4') {
        fieldDuration.classList.remove('hidden');
        fieldCoreNode.classList.remove('hidden');
        fieldFacilitySubtype.classList.remove('hidden');
        if (fieldScenic) fieldScenic.classList.remove('hidden');
    }
}

// ============================================================
// L3 子项管理
// ============================================================
function renderSubPoiList() {
    const container = document.getElementById('sub-poi-list');
    if (!container) return;
    if (!currentEditingPoiId) {
        container.innerHTML = '<p class="text-secondary small mb-0">请先保存POI，再次编辑时即可管理子项。</p>';
        return;
    }
    const currentPoi = allPois.find(p => String(p.id) === String(currentEditingPoiId));
    if (!currentPoi) { container.innerHTML = ''; return; }
    const subPois = allPois.filter(p => String(p.parent_id) === String(currentEditingPoiId));
    if (subPois.length === 0) {
        container.innerHTML = '<p class="text-secondary small mb-0">暂无核心节点。</p>';
        return;
    }
    let sorted = subPois;
    const tr = Array.isArray(currentPoi.tour_route) ? currentPoi.tour_route : [];
    if (tr.length > 0) {
        const idxMap = {};
        tr.forEach((id, i) => { idxMap[String(id)] = i; });
        sorted = [...subPois].sort((a, b) => {
            const ia = idxMap[String(a.id)] ?? 999;
            const ib = idxMap[String(b.id)] ?? 999;
            return ia - ib;
        });
    }
    let html = `<p class="text-secondary small mb-2">当前顺序即游客端的游览顺序，可用 ↑↓ 调整。</p>`;
    sorted.forEach((sub, idx) => {
        const catIcon = CATEGORY_ICONS[getMainCategory(sub.category)] || '';
        const catBadge = sub.category ? ` <span class="category-badge">${catIcon} ${sub.category}</span>` : '';
        const facilityTag = sub.type === 'facility' ? ' ' + getFacilitySubtypeBadge(sub.facility_subtype) : '';
        html += `<div class="sub-poi-item" style="background:#eceff1;">
            <span><span class="badge bg-secondary me-2">${idx + 1}</span>⭐ ${sub.name}${facilityTag}${catBadge} <span class="text-secondary small">(${sub.visit_duration || 0}分钟)</span></span>
            <div>
                <button class="btn btn-sm btn-outline-primary" onclick="window.moveL3SubItem(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} title="上移">↑</button>
                <button class="btn btn-sm btn-outline-primary" onclick="window.moveL3SubItem(${idx}, 1)" ${idx === sorted.length - 1 ? 'disabled' : ''} title="下移">↓</button>
                <button class="btn btn-sm btn-outline-secondary ms-2 me-1" onclick="window.showEditPoiModal('${sub.id}')"><i class="fas fa-edit"></i> 编辑</button>
                <button class="btn btn-sm btn-danger" onclick="window.removeSubPoi('${sub.id}')"><i class="fas fa-unlink"></i> 移出</button>
            </div>
        </div>`;
    });
    container.innerHTML = html;
}

window.moveL3SubItem = async function(idx, dir) {
    if (!currentEditingPoiId) return;
    const currentPoi = allPois.find(p => String(p.id) === String(currentEditingPoiId));
    if (!currentPoi) return;
    const subPois = allPois.filter(p => String(p.parent_id) === String(currentEditingPoiId));
    let sorted = subPois;
    const tr = Array.isArray(currentPoi.tour_route) ? currentPoi.tour_route : [];
    if (tr.length > 0) {
        const idxMap = {};
        tr.forEach((id, i) => { idxMap[String(id)] = i; });
        sorted = [...subPois].sort((a, b) => {
            const ia = idxMap[String(a.id)] ?? 999;
            const ib = idxMap[String(b.id)] ?? 999;
            return ia - ib;
        });
    }
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= sorted.length) return;
    [sorted[idx], sorted[newIdx]] = [sorted[newIdx], sorted[idx]];
    const ids = sorted.map(x => x.id);
    try {
        await updatePoi(toSafeId(currentEditingPoiId), { tour_route: ids });
        const fresh = allPois.find(x => String(x.id) === String(currentEditingPoiId));
        if (fresh) fresh.tour_route = ids;
        renderSubPoiList();
    } catch (e) { alert('调整失败：' + e.message); }
};

export function showSelectSubPoiModal() {
    if (!currentEditingPoiId) { alert('请先保存POI'); return; }
    const currentPoi = allPois.find(p => String(p.id) === String(currentEditingPoiId));
    if (!currentPoi) return;
    if (currentPoi.data_level !== 'L3') { alert('仅 L3 连续景点可添加核心节点'); return; }
    const candidates = allPois.filter(p => {
        if (!isValidId(p.id)) return false;
        if (String(p.id) === String(currentPoi.id)) return false;
        if (p.data_level !== 'L2' && p.data_level !== 'L4') return false;
        if (p.parent_id && !isValidId(p.parent_id)) return false;
        if (p.parent_id && String(p.parent_id) !== String(currentPoi.id)) return false;
        return true;
    });
    const list = document.getElementById('sub-poi-select-list');
    if (!list) return;
    if (candidates.length === 0) {
        list.innerHTML = '<p class="text-secondary">没有可添加的 L2/L4 景点（或它们已属于其他 L3）</p>';
        return;
    }
    let html = `<p class="text-secondary small mb-2">勾选后将自动标记为核心节点，不再出现在游客端规划列表。</p>`;
    candidates.forEach(p => {
        const facilityTag = p.type === 'facility' && p.facility_subtype
            ? ` [${subtypesToText(p.facility_subtype)}]` : '';
        const alreadyIn = String(p.parent_id) === String(currentPoi.id) ? ' <span class="text-success small">(已在)</span>' : '';
        html += `<label style="display:flex;align-items:center;padding:6px 8px;border-bottom:1px solid #f0f0f0;cursor:pointer;">
            <input type="checkbox" value="${p.id}" ${String(p.parent_id) === String(currentPoi.id) ? 'checked disabled' : ''} style="margin-right:8px;">
            <span>${p.name}${facilityTag}</span>${alreadyIn}
            <span style="color:#888;font-size:12px;margin-left:8px;">${p.visit_duration || 0}分钟</span>
        </label>`;
    });
    list.innerHTML = html;
    new bootstrap.Modal(document.getElementById('selectSubPoiModal')).show();
}

export async function confirmSubPoiSelection() {
    const list = document.getElementById('sub-poi-select-list');
    if (!list) return;
    const checkboxes = list.querySelectorAll('input[type="checkbox"]:not([disabled])');
    const selectedIds = [];
    checkboxes.forEach(cb => { if (cb.checked) selectedIds.push(cb.value); });
    if (selectedIds.length === 0) {
        await closeModal('selectSubPoiModal');
        return;
    }
    if (!isValidId(currentEditingPoiId)) { alert('当前 L3 的 ID 不合法'); return; }
    try {
        const parentIdVal = toSafeId(currentEditingPoiId);
        await Promise.all(selectedIds.filter(id => isValidId(id)).map(id => {
            const idVal = toSafeId(id);
            return updatePoi(idVal, { parent_id: parentIdVal, is_core_node: true });
        }));
        const currentPoi = allPois.find(p => String(p.id) === String(currentEditingPoiId));
        if (currentPoi) {
            const existing = Array.isArray(currentPoi.tour_route) ? [...currentPoi.tour_route] : [];
            const existingSet = new Set(existing.map(x => String(x)));
            selectedIds.forEach(id => {
                if (!existingSet.has(String(id))) existing.push(toSafeId(id));
            });
            await updatePoi(parentIdVal, { tour_route: existing });
            currentPoi.tour_route = existing;
        }
        await closeModal('selectSubPoiModal');
        await initAdminUI();
        renderSubPoiList();
        alert(`已添加 ${selectedIds.length} 个核心节点`);
    } catch (e) { alert('添加失败：' + e.message); }
}

export async function removeSubPoi(subPoiId) {
    if (!confirm('确认将该核心节点移出？')) return;
    try {
        const idVal = toSafeId(subPoiId);
        await updatePoi(idVal, { parent_id: null, is_core_node: false });
        if (currentEditingPoiId) {
            const currentPoi = allPois.find(p => String(p.id) === String(currentEditingPoiId));
            if (currentPoi && Array.isArray(currentPoi.tour_route)) {
                const newTr = currentPoi.tour_route.filter(x => String(x) !== String(subPoiId));
                await updatePoi(toSafeId(currentEditingPoiId), { tour_route: newTr });
                currentPoi.tour_route = newTr;
            }
        }
        renderSubPoiList();
        await initAdminUI();
    } catch (e) { alert('移出失败：' + e.message); }
}

// ============================================================
// 保存 POI
// ============================================================
export async function savePoiEdit() {
    const poiId = document.getElementById('edit-poi-id').value;
    const isNew = !poiId;
    const level = document.getElementById('edit-poi-level').value;
    const existingPoi = !isNew ? allPois.find(p => String(p.id) === String(poiId)) : null;

    const hoursType = document.getElementById('edit-poi-hours-type').value;
    let openTime = normalizeTimeStr(document.getElementById('edit-poi-open').value) || '08:00';
    let closeTime = normalizeTimeStr(document.getElementById('edit-poi-close').value) || '18:00';
    if (hoursType === '24h') { openTime = '00:00'; closeTime = '23:59'; }

    const scoreRaw = document.getElementById('edit-poi-score').value;
    const score = parseInt(scoreRaw);
    if (isNaN(score) || score < 0 || score > 100) {
        alert('推荐分值必须在 0-100 之间');
        return;
    }

    let type = 'spot';
    let visitDuration = 0;

    if (level === 'L1') {
        type = 'scenic';
        visitDuration = 0;
    } else if (level === 'L2' || level === 'L3') {
        type = 'spot';
        visitDuration = parseInt(document.getElementById('edit-poi-visit').value) || 0;
    } else if (level === 'L4') {
        const subtypes = getFacilitySubtypeCheckboxes();
        type = subtypes.length > 0 ? 'facility' : 'service_place';
        visitDuration = parseInt(document.getElementById('edit-poi-visit').value) || 0;
    }

    if (visitDuration > MAX_POI_DURATION) {
        alert(`游览时长不得超过 ${MAX_POI_DURATION / 60} 小时（${MAX_POI_DURATION} 分钟）`);
        return;
    }

    let isCoreNode = false;
    if (existingPoi && existingPoi.parent_id) {
        isCoreNode = true;
    } else {
        isCoreNode = document.getElementById('edit-poi-core-node').checked;
    }

    let scenicIdVal = null;
    if (level !== 'L1') {
        const raw = document.getElementById('edit-poi-scenic')?.value || '';
        if (raw && isValidId(raw)) scenicIdVal = toSafeId(raw);
    }

    const updates = {
        name: document.getElementById('edit-poi-name').value.trim(),
        type: type,
        data_level: level,
        category: document.getElementById('edit-poi-category').value,
        lat: parseFloat(document.getElementById('edit-poi-lat').value) || 0,
        lng: parseFloat(document.getElementById('edit-poi-lng').value) || 0,
        hours_type: hoursType,
        open_time: openTime,
        close_time: closeTime,
        visit_duration: visitDuration,
        description: document.getElementById('edit-poi-desc').value,
        is_core_node: isCoreNode,
        scenic_id: scenicIdVal,
        voice_mp3: document.getElementById('edit-poi-voice-mp3').value || null,
        recommend_score: score,
        status: 'active'
    };

    if (type === 'facility') {
        const subtypes = getFacilitySubtypeCheckboxes();
        updates.facility_subtype = subtypes.length > 0 ? subtypes : null;
    } else {
        updates.facility_subtype = null;
    }

    if (!updates.name) { alert('请输入名称'); return; }

    try {
        if (isNew) {
            updates.parent_id = null;
            await insertPoi(updates);
            await closeModal('poiModal');
            await initAdminUI();
            alert('新增成功');
        } else {
            updates.parent_id = existingPoi && isValidId(existingPoi.parent_id)
                ? toSafeId(existingPoi.parent_id) : null;
            if (existingPoi && existingPoi.tour_route) updates.tour_route = existingPoi.tour_route;
            await updatePoi(toSafeId(poiId), updates);
            await closeModal('poiModal');
            await initAdminUI();
            alert('保存成功');
        }
    } catch (e) {
        alert('保存失败：' + e.message);
        console.error(e);
    }
}

export async function deletePoi(id) {
    const poi = allPois.find(p => String(p.id) === String(id));
    if (!poi) return;
    const subPois = allPois.filter(p => String(p.parent_id) === String(id));
    const affectedL3s = allPois.filter(p =>
        Array.isArray(p.tour_route) && p.tour_route.some(x => String(x) === String(id))
    );

    let dependents = [];
    try {
        dependents = await getDependents(toSafeId(id));
    } catch (e) { console.warn('查询依赖者失败:', e); }

    if (dependents.length > 0) {
        const names = dependents.map(d => d.name).join('、');
        alert(`无法删除：有 ${dependents.length} 个 POI 参照了它作为基准：\n${names}\n\n请先为这些 POI 重新指定基准 POI。`);
        return;
    }

    let msg = '确认删除此POI？其关联的交通耗时记录也会一并清理。';
    if (subPois.length > 0) {
        msg = `该 L3 下有 ${subPois.length} 个核心节点，删除后将自动解除关联，它们会恢复为普通景点。是否继续？`;
    }
    if (affectedL3s.length > 0 && subPois.length === 0) {
        msg = `有 ${affectedL3s.length} 个 L3 的 tour_route 引用了此 POI，将同步移除。是否继续？`;
    }
    if (!confirm(msg)) return;

    try {
        if (subPois.length > 0) {
            await Promise.all(subPois.map(p => updatePoi(toSafeId(p.id), {
                parent_id: null, is_core_node: false
            })));
        }
        for (const l3 of affectedL3s) {
            if (String(l3.id) === String(id)) continue;
            const newTr = l3.tour_route.filter(x => String(x) !== String(id));
            await updatePoi(toSafeId(l3.id), { tour_route: newTr });
        }
        try {
            await deleteTransportTimesForPoi(toSafeId(id));
        } catch (e) { console.warn('[deletePoi] 清理交通失败:', e); }

        await apiDeletePoi(toSafeId(id));
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
}

// ============================================================
// 交通耗时编辑器（基准 + 偏移方案）
// ★ 过滤：非核心节点 + L2/L3/L4 + 有效 id + 分值 ≥ 30
// ============================================================
export function renderTransportEditor(times) {
    const container = document.getElementById('transport-editor');
    if (!container) return;

    const poiList = allPois.filter(p =>
        !p.is_core_node &&
        (p.data_level === 'L2' || p.data_level === 'L3' || p.data_level === 'L4') &&
        isValidId(p.id) &&
        (p.recommend_score || 0) >= 30
    );
    if (poiList.length === 0) {
        container.innerHTML = '<p class="text-secondary">暂无分值 ≥ 30 的 L2/L3/L4 景点。</p>';
        return;
    }
    currentTransportPoiList = poiList;

    const timeMap = {};
    times.forEach(t => {
        timeMap[`${t.poi_a}_${t.poi_b}`] = t.time_min;
    });

    function getTime(idA, idB) {
        const a = Math.min(Number(idA), Number(idB));
        const b = Math.max(Number(idA), Number(idB));
        const v = timeMap[`${a}_${b}`];
        return (v === undefined || v === null) ? '' : v;
    }

    function renderBaseOptions(currentPoiId, selectedBaseId) {
        const currentIdNum = Number(currentPoiId);
        const candidates = poiList
            .filter(p => Number(p.id) < currentIdNum)
            .sort((a, b) => Number(a.id) - Number(b.id));
        let opts = '<option value="">（无）</option>';
        candidates.forEach(p => {
            const sel = String(p.id) === String(selectedBaseId) ? 'selected' : '';
            opts += `<option value="${p.id}" ${sel}>${p.name}</option>`;
        });
        return opts;
    }

    let html = '';

    // 第一块：红军广场
    html += `<div class="transport-group card mb-2" style="border:2px solid #1b5e20;">
        <div class="card-header" style="cursor:pointer;background:#e8f5e9;" onclick="this.nextElementSibling.classList.toggle('hidden')">
            <b>🏠 红军广场（县城）</b> <span class="text-secondary">→ 各景点耗时（点击展开）</span>
        </div>
        <div class="card-body hidden">`;

    poiList.forEach(toPoi => {
        const val = getTime(0, toPoi.id);
        html += `<div class="transport-item">
            <span>→ ${toPoi.name}</span>
            <div style="display:flex;align-items:center;">
                <input type="number" value="${val}" placeholder="分钟" 
                       data-from="0" data-to="${toPoi.id}" 
                       oninput="window.markTransportDirty(this)"
                       onchange="window.saveTransportTime(this)">
                <span class="save-status"></span>
            </div>
        </div>`;
    });
    html += `</div></div>`;

    // 每个 POI 卡片
    poiList.forEach(fromPoi => {
        const basePoiId = fromPoi.base_poi_id;
        const baseOffset = fromPoi.base_offset || 0;

        html += `<div class="transport-group card mb-2">
            <div class="card-header" style="cursor:pointer;background:#f8f9fa;" onclick="this.nextElementSibling.classList.toggle('hidden')">
                <b>🚩 ${fromPoi.name}</b> <span class="text-secondary">(点击展开)</span>
            </div>
            <div class="card-body hidden">`;

        const baseOptions = renderBaseOptions(fromPoi.id, basePoiId);
        html += `<div class="base-offset-row" style="display:flex;align-items:center;gap:12px;padding:8px 10px;background:#f0f8f0;border-radius:6px;margin-bottom:10px;border:1px solid #c8e6c9;">
            <label style="margin:0;font-weight:600;color:#1b5e20;font-size:13px;">基准：</label>
            <select class="form-select form-select-sm" style="width:auto;min-width:140px;"
                    onchange="window.onBasePoiChange(this, '${fromPoi.id}')">
                ${baseOptions}
            </select>
            <label style="margin:0;font-weight:600;color:#1b5e20;font-size:13px;">偏移：</label>
            <input type="number" class="form-control form-control-sm" style="width:80px;"
                   value="${baseOffset}"
                   onchange="window.onOffsetChange(this, '${fromPoi.id}')"
                   placeholder="0">
            <span style="font-size:12px;color:#888;">分钟</span>
        </div>`;

        const valToCounty = getTime(fromPoi.id, 0);
        html += `<div class="transport-item">
            <span>→ 红军广场（县城）</span>
            <div style="display:flex;align-items:center;">
                <input type="number" value="${valToCounty}" placeholder="分钟" 
                       data-from="${fromPoi.id}" data-to="0"
                       oninput="window.markTransportDirty(this)"
                       onchange="window.saveTransportTime(this)">
                <span class="save-status"></span>
            </div>
        </div>`;

        poiList.forEach(toPoi => {
            if (String(fromPoi.id) === String(toPoi.id)) return;
            const val = getTime(fromPoi.id, toPoi.id);
            html += `<div class="transport-item">
                <span>→ ${toPoi.name}</span>
                <div style="display:flex;align-items:center;">
                    <input type="number" value="${val}" placeholder="分钟" 
                           data-from="${fromPoi.id}" data-to="${toPoi.id}"
                           oninput="window.markTransportDirty(this)"
                           onchange="window.saveTransportTime(this)">
                    <span class="save-status"></span>
                </div>
            </div>`;
        });

        html += `</div></div>`;
    });

    container.innerHTML = html;
}

// 基准 POI 下拉改变
window.onBasePoiChange = async function(selectEl, poiId) {
    const newBaseId = selectEl.value;
    if (!newBaseId) {
        if (!confirm('清除基准关系？数据保留。')) {
            selectEl.value = '';
            return;
        }
        try {
            await clearBaseRelation(toSafeId(poiId));
            await initAdminUI();
        } catch (e) { alert('操作失败：' + e.message); }
        return;
    }
    const parent = selectEl.closest('.base-offset-row');
    const offsetInput = parent.querySelector('input[type="number"]');
    const offset = parseInt(offsetInput.value) || 0;

    await applyBaseWithOffsetAndReload(poiId, newBaseId, offset);
};

// 偏移值改变
window.onOffsetChange = async function(inputEl, poiId) {
    const offset = parseInt(inputEl.value) || 0;
    const parent = inputEl.closest('.base-offset-row');
    const selectEl = parent.querySelector('select');
    const basePoiId = selectEl.value;
    if (!basePoiId) {
        alert('请先选择基准 POI');
        inputEl.value = '0';
        return;
    }
    if (offset < 0) {
        if (!confirm('偏移为负值，确认继续？')) {
            inputEl.value = '0';
            return;
        }
    }
    await applyBaseWithOffsetAndReload(poiId, basePoiId, offset);
};

async function applyBaseWithOffsetAndReload(poiId, basePoiId, offset) {
    try {
        await applyBaseWithOffset(toSafeId(poiId), toSafeId(basePoiId), offset);
        await initAdminUI();
        alert('已应用基准 + 偏移');
    } catch (e) {
        alert('应用失败：' + e.message);
        console.error(e);
    }
}

// 脏标记
window.markTransportDirty = function(input) {
    if (input.readOnly) return;
    const statusEl = input.parentElement.querySelector('.save-status');
    if (statusEl) {
        statusEl.textContent = '● 待保存';
        statusEl.style.color = '#ff9800';
    }
    input.style.background = '#fff3cd';
};

// 单项保存（手工改某一格）
window.saveTransportTime = async function(input) {
    if (input.dataset.saving === '1') return;

    const from = input.dataset.from;
    const to = input.dataset.to;
    const val = parseInt(input.value);

    if (isNaN(val) || val < 0) {
        if (input.value === '') {
            try {
                await deleteTransportTime(toSafeId(from) ?? 0, toSafeId(to) ?? 0);
                await initAdminUI();
            } catch (e) { alert('删除失败：' + e.message); }
        } else {
            input.value = '';
        }
        return;
    }

    input.dataset.saving = '1';
    try {
        const fromVal = String(from) === '0' ? 0 : toSafeId(from);
        const toVal = String(to) === '0' ? 0 : toSafeId(to);
        await setTransportTime(fromVal, toVal, val);

        const statusEl = input.parentElement.querySelector('.save-status');
        if (statusEl) {
            statusEl.textContent = '✓已保存';
            statusEl.style.color = '#2e7d32';
            setTimeout(() => { statusEl.textContent = ''; statusEl.style.color = ''; }, 1500);
        }
        input.style.background = '#e8f5e9';
        setTimeout(() => { input.style.background = ''; }, 1500);
    } catch (e) {
        alert('保存失败：' + e.message);
        input.style.background = '#ffebee';
    } finally {
        delete input.dataset.saving;
    }
};

// ============================================================
// 路线规划
// ============================================================
export function renderRouteList(routes) {
    const container = document.getElementById('route-list');
    if (!container) return;
    if (!routes || routes.length === 0) {
        container.innerHTML = '<p class="text-secondary">暂无路线，点击右上角"新增路线"创建。</p>';
        return;
    }
    const sorted = [...routes].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    let html = '';
    sorted.forEach(r => {
        const routeType = r.route_type || 'custom';
        const typeLabel = ROUTE_TYPE_LABELS[routeType] || routeType;
        const dayCatLabel = DAY_CATEGORY_LABELS[r.day_category] || '';
        const defaultBadge = r.is_default ? '<span class="default-badge">默认推荐</span>' : '';
        let themeHtml = '';
        if (Array.isArray(r.theme_tags) && r.theme_tags.length > 0) {
            themeHtml = r.theme_tags.map(t => `<span class="theme-tag-badge">${t}</span>`).join('');
        }
        const summaryPois = r.summary_pois ? `📍 ${r.summary_pois}` : '';
        const durationText = r.duration_min ? `${r.duration_min}分钟` : '—';
        const costText = r.estimated_cost ? `人均约${r.estimated_cost}元` : '';
        html += `<div class="route-card">
            <div class="route-header">
                <div>
                    <span class="route-type-badge route-type-${routeType}">${typeLabel}</span>
                    ${dayCatLabel ? `<span class="route-type-badge" style="background:#e8f5e9;color:#1b5e20;">${dayCatLabel}</span>` : ''}
                    ${defaultBadge}
                    <b class="ms-1">${r.name || '未命名'}</b>
                    <div style="margin-top:4px;">${themeHtml}</div>
                </div>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showEditRouteModal('${r.id}')"><i class="fas fa-edit"></i> 编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deleteRoute('${r.id}')"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>
            <div class="route-meta">
                ${r.summary ? `<div style="color:#555;margin:4px 0;">${r.summary}</div>` : ''}
                ${summaryPois ? `<div>${summaryPois}</div>` : ''}
                <div style="margin-top:4px;">⏱️ ${durationText} ${costText ? ` · 💰 ${costText}` : ''} · 排序${r.sort_order || 0}</div>
            </div>
        </div>`;
    });
    container.innerHTML = html;
}

export async function showAddRouteModal() {
    document.getElementById('edit-route-id').value = '';
    document.getElementById('edit-route-name').value = '';
    document.getElementById('edit-route-type').value = 'scenic_internal';
    document.getElementById('edit-route-daycat').value = 'one_day';
    document.getElementById('edit-route-sort').value = '0';
    document.getElementById('edit-route-duration').value = '0';
    document.getElementById('edit-route-cost').value = '';
    document.getElementById('edit-route-summary').value = '';
    document.getElementById('edit-route-summary-pois').value = '';
    document.getElementById('edit-route-desc').value = '';
    setThemeTags([]);
    routeNodesData = [];
    renderRouteNodes();
    document.getElementById('routeModalTitle').textContent = '新增路线';
    new bootstrap.Modal(document.getElementById('routeModal')).show();
}

export async function showEditRouteModal(id) {
    const r = allRoutes.find(x => String(x.id) === String(id));
    if (!r) return;
    document.getElementById('edit-route-id').value = id;
    document.getElementById('edit-route-name').value = r.name || '';
    document.getElementById('edit-route-type').value = r.route_type || 'scenic_internal';
    document.getElementById('edit-route-daycat').value = r.day_category || 'one_day';
    document.getElementById('edit-route-sort').value = r.sort_order || 0;
    document.getElementById('edit-route-duration').value = r.duration_min || 0;
    document.getElementById('edit-route-cost').value = r.estimated_cost || '';
    document.getElementById('edit-route-summary').value = r.summary || '';
    document.getElementById('edit-route-summary-pois').value = r.summary_pois || '';
    document.getElementById('edit-route-desc').value = r.description || '';
    setThemeTags(r.theme_tags || []);

    routeNodesData = [];
    try {
        const nodes = await getRouteNodes(id);
        routeNodesData = nodes.map(n => ({
            node_name: n.node_name || '',
            node_type: n.node_type || 'other',
            poi_id: n.poi_id || null,
            poi_name: n.poi_id ? (allPois.find(p => String(p.id) === String(n.poi_id))?.name || '') : '',
            priority_level: n.priority_level || 2,
            duration_min: n.duration_min || 10,
            duration_short: n.duration_short || null,
            duration_long: n.duration_long || null,
            is_skippable: !!n.is_skippable,
            meal_suitable: n.meal_suitable || '',
            nearby_restaurant: n.nearby_restaurant || '',
            description: n.description || '',
            tips: n.tips || ''
        }));
    } catch (e) { console.warn('加载节点失败:', e); }
    renderRouteNodes();

    document.getElementById('routeModalTitle').textContent = `编辑路线 - ${r.name}`;
    new bootstrap.Modal(document.getElementById('routeModal')).show();
}

function getThemeTags() {
    const tags = [];
    document.querySelectorAll('#route-theme-tags input[type="checkbox"]:checked').forEach(cb => tags.push(cb.value));
    return tags;
}
function setThemeTags(tags) {
    const arr = Array.isArray(tags) ? tags : [];
    document.querySelectorAll('#route-theme-tags input[type="checkbox"]').forEach(cb => {
        cb.checked = arr.includes(cb.value);
    });
}
function calculateRouteTotalDuration() {
    let total = 0, prevPoiId = null;
    routeNodesData.forEach(node => {
        if (prevPoiId && node.poi_id && String(prevPoiId) !== String(node.poi_id)) {
            const a = Math.min(Number(prevPoiId), Number(node.poi_id));
            const b = Math.max(Number(prevPoiId), Number(node.poi_id));
            const preset = allTransportTimes.find(t => t.poi_a === a && t.poi_b === b);
            if (preset) total += preset.time_min || 0;
        }
        total += node.duration_min || 0;
        if (node.poi_id) prevPoiId = node.poi_id;
    });
    return total;
}
function renderRouteNodes() {
    const container = document.getElementById('route-nodes-container');
    if (!container) return;
    if (routeNodesData.length === 0) {
        container.innerHTML = '<p class="text-secondary text-center py-3">暂无节点，点击"添加节点"开始规划</p>';
        document.getElementById('route-total-info').textContent = '（总时长：0分钟）';
        return;
    }
    let html = '';
    routeNodesData.forEach((n, idx) => {
        const typeLabel = NODE_TYPE_LABELS[n.node_type] || '📌 其他';
        const priorityLabel = PRIORITY_LABELS[n.priority_level] || '⭐⭐ 二级';
        const poiName = n.poi_id ? `<span class="text-secondary" style="font-size:11px;">· ${n.poi_name || n.poi_id}</span>` : '';
        html += `<div class="route-node-card">
            <div class="route-node-header">
                <span class="route-node-order">${idx + 1}</span>
                <div class="route-node-info">
                    <div class="route-node-name">${n.node_name || '未命名节点'} <span class="route-node-type-badge">${typeLabel}</span> <span style="font-size:11px;color:#ff9800;margin-left:6px;">${priorityLabel}</span> ${poiName}</div>
                    <div class="route-node-desc"><i class="fas fa-clock"></i> ${n.duration_min || 0}分钟 ${n.is_skippable ? ' · 可跳过' : ''} ${n.meal_suitable ? ' · 可用餐' : ''} ${n.description ? ` · ${n.description}` : ''}</div>
                </div>
                <div class="route-node-actions">
                    <button class="btn btn-sm btn-outline-secondary" onclick="window.moveRouteNode(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>↑</button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="window.moveRouteNode(${idx}, 1)" ${idx === routeNodesData.length - 1 ? 'disabled' : ''}>↓</button>
                    <button class="btn btn-sm btn-outline-primary" onclick="window.editRouteNode(${idx})"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="window.removeRouteNode(${idx})"><i class="fas fa-times"></i></button>
                </div>
            </div>
        </div>`;
    });
    container.innerHTML = html;
    const total = calculateRouteTotalDuration();
    document.getElementById('route-total-info').textContent = `（总时长：${total}分钟）`;
    document.getElementById('edit-route-duration').value = total;
}

window.showAddRouteNodeModal = function() {
    editingNodeIndex = -1;
    document.getElementById('edit-node-index').value = '';
    document.getElementById('edit-node-name').value = '';
    document.getElementById('edit-node-type').value = 'other';
    document.getElementById('edit-node-poi').value = '';
    document.getElementById('edit-node-poi-display').innerHTML = '<span class="text-secondary">点击选择 POI...</span>';
    document.getElementById('edit-node-priority').value = '2';
    document.getElementById('edit-node-duration').value = 10;
    document.getElementById('edit-node-short').value = '';
    document.getElementById('edit-node-long').value = '';
    document.getElementById('edit-node-skippable').checked = false;
    document.getElementById('edit-node-meal').value = '';
    document.getElementById('edit-node-nearby-restaurant').value = '';
    document.getElementById('edit-node-desc').value = '';
    document.getElementById('edit-node-tips').value = '';
    document.getElementById('routeNodeModalTitle').textContent = '添加节点';
    new bootstrap.Modal(document.getElementById('routeNodeModal')).show();
};

window.editRouteNode = function(idx) {
    const node = routeNodesData[idx];
    if (!node) return;
    editingNodeIndex = idx;
    document.getElementById('edit-node-index').value = idx;
    document.getElementById('edit-node-name').value = node.node_name || '';
    document.getElementById('edit-node-type').value = node.node_type || 'other';
    document.getElementById('edit-node-poi').value = node.poi_id || '';
    if (node.poi_id) {
        document.getElementById('edit-node-poi-display').innerHTML = `<b style="color:#1b5e20;">${node.poi_name || node.poi_id}</b>`;
    } else {
        document.getElementById('edit-node-poi-display').innerHTML = '<span class="text-secondary">点击选择 POI...</span>';
    }
    document.getElementById('edit-node-priority').value = String(node.priority_level || 2);
    document.getElementById('edit-node-duration').value = node.duration_min || 10;
    document.getElementById('edit-node-short').value = node.duration_short || '';
    document.getElementById('edit-node-long').value = node.duration_long || '';
    document.getElementById('edit-node-skippable').checked = !!node.is_skippable;
    document.getElementById('edit-node-meal').value = node.meal_suitable || '';
    document.getElementById('edit-node-nearby-restaurant').value = node.nearby_restaurant || '';
    document.getElementById('edit-node-desc').value = node.description || '';
    document.getElementById('edit-node-tips').value = node.tips || '';
    document.getElementById('routeNodeModalTitle').textContent = '编辑节点';
    new bootstrap.Modal(document.getElementById('routeNodeModal')).show();
};

window.saveRouteNode = async function() {
    const name = document.getElementById('edit-node-name').value.trim();
    if (!name) { alert('请输入节点名称'); return; }
    const poiId = document.getElementById('edit-node-poi').value || null;
    const poiName = poiId ? (allPois.find(p => String(p.id) === String(poiId))?.name || '') : '';
    const nodeData = {
        node_name: name,
        node_type: document.getElementById('edit-node-type').value,
        poi_id: poiId, poi_name: poiName,
        priority_level: parseInt(document.getElementById('edit-node-priority').value) || 2,
        duration_min: parseInt(document.getElementById('edit-node-duration').value) || 10,
        duration_short: parseInt(document.getElementById('edit-node-short').value) || null,
        duration_long: parseInt(document.getElementById('edit-node-long').value) || null,
        is_skippable: document.getElementById('edit-node-skippable').checked,
        meal_suitable: document.getElementById('edit-node-meal').value || '',
        nearby_restaurant: document.getElementById('edit-node-nearby-restaurant').value.trim(),
        description: document.getElementById('edit-node-desc').value.trim(),
        tips: document.getElementById('edit-node-tips').value.trim()
    };
    if (editingNodeIndex >= 0 && editingNodeIndex < routeNodesData.length) {
        routeNodesData[editingNodeIndex] = nodeData;
    } else {
        routeNodesData.push(nodeData);
    }
    await closeModal('routeNodeModal');
    renderRouteNodes();
};

window.moveRouteNode = function(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= routeNodesData.length) return;
    [routeNodesData[idx], routeNodesData[newIdx]] = [routeNodesData[newIdx], routeNodesData[idx]];
    renderRouteNodes();
};
window.removeRouteNode = function(idx) {
    if (!confirm('确认删除此节点？')) return;
    routeNodesData.splice(idx, 1);
    renderRouteNodes();
};

window.openPoiPicker = function() {
    poiPickerSelectedId = document.getElementById('edit-node-poi').value || null;
    poiPickerCurrentSearch = '';
    document.getElementById('poi-picker-search').value = '';
    renderPoiPickerList();
    new bootstrap.Modal(document.getElementById('poiPickerModal')).show();
};
function renderPoiPickerList() {
    const container = document.getElementById('poi-picker-list');
    if (!container) return;
    const keyword = (poiPickerCurrentSearch || '').toLowerCase();
    const groups = { L1: [], L2: [], L3: [], L4: [], core: [] };
    allPois.forEach(p => {
        if (!isValidId(p.id)) return;
        let key;
        if (p.is_core_node) key = 'core';
        else key = p.data_level || 'L2';
        if (!groups[key]) groups[key] = [];
        if (keyword && !p.name.toLowerCase().includes(keyword)) return;
        groups[key].push(p);
    });
    const labelMap = {
        L1: '🏞️ L1 景区', L2: '📍 L2 普通景点', L3: '⭐ L3 连续景点',
        L4: '🏛️ L4 服务/设施', core: '🗺️ 核心节点'
    };
    let html = '';
    Object.keys(groups).forEach(k => {
        if (groups[k].length === 0) return;
        html += `<div class="poi-group"><div class="poi-group-title">${labelMap[k] || k} (${groups[k].length})</div>`;
        groups[k].forEach(p => {
            const selected = String(p.id) === String(poiPickerSelectedId) ? 'selected' : '';
            const facilityTag = (p.type === 'facility' && p.facility_subtype)
                ? ` [${subtypesToText(p.facility_subtype)}]` : '';
            html += `<div class="poi-picker-item ${selected}" onclick="window.selectPoiPickerItem('${p.id}', '${p.name.replace(/'/g, "\\'")}')">
                ${p.name}${facilityTag}</div>`;
        });
        html += `</div>`;
    });
    container.innerHTML = html || '<p class="text-secondary">无匹配POI</p>';
}
window.filterPoiPicker = function(keyword) {
    poiPickerCurrentSearch = keyword || '';
    renderPoiPickerList();
};
window.selectPoiPickerItem = function(id, name) {
    poiPickerSelectedId = id;
    renderPoiPickerList();
};
window.clearPoiPicker = function() {
    poiPickerSelectedId = null;
    renderPoiPickerList();
};
window.confirmPoiPicker = async function() {
    if (poiPickerSelectedId) {
        const poi = allPois.find(p => String(p.id) === String(poiPickerSelectedId));
        if (poi) {
            document.getElementById('edit-node-poi').value = poi.id;
            document.getElementById('edit-node-poi-display').innerHTML = `<b style="color:#1b5e20;">${poi.name}</b>`;
        }
    } else {
        document.getElementById('edit-node-poi').value = '';
        document.getElementById('edit-node-poi-display').innerHTML = '<span class="text-secondary">点击选择 POI...</span>';
    }
    await closeModal('poiPickerModal');
};

export async function saveRouteEdit() {
    const id = document.getElementById('edit-route-id').value;
    const name = document.getElementById('edit-route-name').value.trim();
    if (!name) { alert('请输入路线名称'); return; }
    if (routeNodesData.length === 0) { alert('请至少添加一个节点'); return; }
    const totalMin = calculateRouteTotalDuration();
    const themeTags = getThemeTags();
    const data = {
        name: name,
        route_type: document.getElementById('edit-route-type').value,
        day_category: document.getElementById('edit-route-daycat').value,
        sort_order: parseInt(document.getElementById('edit-route-sort').value) || 0,
        duration_min: totalMin,
        estimated_cost: parseFloat(document.getElementById('edit-route-cost').value) || null,
        summary: document.getElementById('edit-route-summary').value.trim(),
        summary_pois: document.getElementById('edit-route-summary-pois').value.trim(),
        description: document.getElementById('edit-route-desc').value.trim(),
        theme_tags: themeTags.length > 0 ? themeTags : null,
        scenic_poi_id: null, is_default: false, start_time: '08:00',
        transport: '', days: 1, group_type: 'default'
    };
    try {
        let routeId = id;
        if (id) await updateRoute(id, data);
        else { const r = await insertRoute(data); routeId = r.id; }
        await deleteRouteNodes(routeId);
        const nodes = routeNodesData.map((n, i) => ({
            route_id: routeId, order_num: i + 1,
            node_name: n.node_name, node_type: n.node_type,
            poi_id: (n.poi_id && isValidId(n.poi_id)) ? toSafeId(n.poi_id) : null,
            priority_level: n.priority_level || 2,
            duration_min: n.duration_min || 10,
            duration_short: n.duration_short || null,
            duration_long: n.duration_long || null,
            is_skippable: !!n.is_skippable,
            meal_suitable: n.meal_suitable || null,
            nearby_restaurant: n.nearby_restaurant || null,
            description: n.description, tips: n.tips,
            transport_mode: '步行', transport_time: 0
        }));
        if (nodes.length > 0) await insertRouteNodes(nodes);
        await closeModal('routeModal');
        await initAdminUI();
        alert('保存成功');
    } catch (e) { alert('保存失败：' + e.message); console.error(e); }
}

export async function deleteRoute(id) {
    if (!confirm('确认删除此路线？')) return;
    try {
        await deleteRouteNodes(id);
        await apiDeleteRoute(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
}

// ============================================================
// 商户 / 留言
// ============================================================
export function renderMerchantList(merchants) {
    const container = document.getElementById('merchant-list');
    if (!container) return;
    container.innerHTML = merchants.map(m => `
        <div class="poi-card"><span><b>${m.display_name || m.id}</b> ${m.phone || ''}</span></div>
    `).join('') || '<p>暂无商户</p>';
}
export async function createMerchant() {
    alert('创建商户功能需后端支持，请使用 Supabase Admin API');
}
export function renderFeedbackList(feedbacks) {
    const container = document.getElementById('feedback-list');
    if (!container) return;
    container.innerHTML = feedbacks.map(f => `
        <div class="poi-card">
            <p><b>${f.message}</b></p>
            <small>${new Date(f.created_at).toLocaleString()}</small>
            ${f.reply ? `<div class="text-success">回复：${f.reply}</div>` : ''}
            <div class="mt-1"><textarea id="reply-${f.id}" class="form-control form-control-sm" rows="2">${f.reply || ''}</textarea></div>
            <button class="btn btn-sm btn-primary mt-1" onclick="window.replyFeedback('${f.id}')">回复</button>
            <button class="btn btn-sm btn-danger mt-1" onclick="window.deleteFeedback('${f.id}')">删除</button>
        </div>
    `).join('') || '<p>暂无留言</p>';
}
export async function replyFeedback(id) {
    const reply = document.getElementById(`reply-${id}`).value;
    try { await updateFeedback(id, { reply }); await initAdminUI(); } catch (e) { alert('回复失败：' + e.message); }
}
export async function deleteFeedback(id) {
    if (!confirm('确认删除？')) return;
    try { await apiDeleteFeedback(id); await initAdminUI(); } catch (e) { alert('删除失败：' + e.message); }
}
export function refreshData() { initAdminUI(); }
