// js/admin.js - 管理后台完整逻辑（三层级架构）
import {
    getPois, getPoi, insertPoi, updatePoi, deletePoi as apiDeletePoi,
    getRoutes, getRoute, insertRoute, updateRoute, deleteRoute as apiDeleteRoute,
    getRouteNodes, insertRouteNodes, deleteRouteNodes,
    getTransportPresets, upsertTransportPreset,
    getMerchantsByPoi, getMerchant, updateMerchant, createMerchantRecord,
    getReservations, updateReservation,
    getFeedbacks, updateFeedback, deleteFeedback as apiDeleteFeedback,
    uploadFile
} from './api.js';

let allPois = [], allRoutes = [], allPresets = [], allMerchants = [], allFeedbacks = [];
let currentEditingPoiId = null;
let currentSubPoiIds = [];
let categoryManuallySet = false;

let routeNodesData = [];
let editingNodeIndex = -1;

let poiPickerSelectedId = null;
let poiPickerCurrentSearch = '';

// ============================================================
// 标签与徽章
// ============================================================
const LEVEL_LABELS = {
    L1: '🏞️ L1 景区',
    L2: '📍 L2 景点',
    L3: '⭐ L3 连续景点',
    L4: '🏛️ L4 预留'
};

const LEVEL_CLASSES = {
    L1: 'quality-L1',
    L2: 'quality-L2',
    L3: 'quality-L3',
    L4: 'quality-L4'
};

const FACILITY_SUBTYPE_LABELS = {
    restaurant: '🍽️ 餐厅',
    hotel: '🏨 住宿',
    shopping: '🛍️ 购物',
    service: '🚻 服务设施'
};

const FACILITY_SUBTYPE_CLASSES = {
    restaurant: 'type-badge-restaurant',
    hotel: 'type-badge-hotel',
    shopping: 'type-badge-shopping',
    service: 'type-badge-service'
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

const DAY_CATEGORY_LABELS = {
    half_day: '🌤️ 半日游', one_day: '☀️ 一日游', multi_day: '📅 多日游'
};

const NODE_TYPE_LABELS = {
    entrance: '🚪 入口', parking: '🅿️ 停车场', rest: '☕ 休息区',
    core_view: '⭐ 核心景点', spot: '📍 景点参观', entertainment: '🎢 游玩项目',
    wc: '🚻 卫生间', exit: '🚪 出口', other: '📌 其他'
};

const PRIORITY_LABELS = { 1: '⭐ 一级', 2: '⭐⭐ 二级', 3: '⭐⭐⭐ 三级' };

// 按等级显示的类型徽章
function getLevelBadge(level) {
    const cls = LEVEL_CLASSES[level] || 'quality-L4';
    const label = LEVEL_LABELS[level] || level;
    return `<span class="data-quality-badge ${cls}">${label}</span>`;
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

// ============================================================
// 时间选择器：30 分钟一档
// ============================================================
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
    const openHtml = opts.map(v => `<option value="${v}">${v}</option>`).join('');
    const closeHtml = opts.map(v => `<option value="${v}">${v}</option>`).join('') +
                      `<option value="23:59">23:59</option>`;
    openSel.innerHTML = openHtml;
    closeSel.innerHTML = closeHtml;
}

// 时间标准化：兼容 'HH:MM'、'HH:MM:SS'
function normalizeTimeStr(t) {
    if (t === null || t === undefined || t === '') return '';
    const s = String(t).trim();
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return '';
    const h = String(parseInt(m[1], 10)).padStart(2, '0');
    return `${h}:${m[2]}`;
}

// 安全设置下拉框值
function setSelectValueSafe(sel, val) {
    if (!sel) return;
    if (!val) { sel.selectedIndex = -1; return; }
    if (sel.options.length === 0) populateTimeSelects();
    let found = false;
    for (let opt of sel.options) {
        if (opt.value === val) { found = true; break; }
    }
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
        const [pois, routes, presets, merchants, feedbacks] = await Promise.all([
            getPois(), getRoutes(), getTransportPresets(),
            getMerchantsByPoi(null), getFeedbacks(null)
        ]);
        allPois = pois;
        allRoutes = routes;
        allPresets = presets;
        allMerchants = merchants;
        allFeedbacks = feedbacks;
        renderPoiList(allPois);
        renderRouteList(allRoutes);
        renderTransportEditor(allPresets);
        renderMerchantList(allMerchants);
        renderFeedbackList(allFeedbacks);
        console.log('[管理后台] 初始化完成');
    } catch (e) {
        console.error('[管理后台] 初始化失败:', e);
        alert('初始化失败：' + e.message);
    }
}

// ============================================================
// POI 列表渲染
// ============================================================
export function renderPoiList(pois) {
    const container = document.getElementById('poi-list');
    if (!container) return;

    const topLevelPois = pois.filter(p => !p.parent_id);

    let html = '';
    for (let p of topLevelPois) {
        const level = p.data_level || 'L2';
        const levelBadge = getLevelBadge(level);

        const catIcon = CATEGORY_ICONS[p.category] || '';
        const catBadge = p.category ? `<span class="category-badge">${catIcon} ${p.category}</span>` : '';
        const voiceBadge = p.voice_mp3 ? `<span class="voice-badge">🔊 语音</span>` : '';

        const hoursText = p.hours_type === '24h'
            ? '<span class="badge bg-info text-dark">24H</span>'
            : (p.open_time && p.close_time
                ? `<span class="text-secondary small">${normalizeTimeStr(p.open_time)}-${normalizeTimeStr(p.close_time)}</span>`
                : '');

        const subItems = pois.filter(x => String(x.parent_id) === String(p.id));
        const l2Count = subItems.filter(x => x.data_level === 'L2').length;
        const l3Count = subItems.filter(x => x.data_level === 'L3').length;
        const l4Count = subItems.filter(x => x.data_level === 'L4').length;

        let subInfo = '';
        if (subItems.length > 0) {
            subInfo = ` <span class="text-secondary" style="font-size:12px;">(${l2Count}普通 ${l3Count}连续 ${l4Count}场所/设施)</span>`;
        }

        const featuredTag = p.is_featured ? ` <span class="featured-badge">⭐经典</span>` : '';
        // L1 时长显示（无）
        const durationInfo = level === 'L2'
            ? ` <span class="text-secondary small">${p.visit_duration || 0}分钟</span>`
            : (level === 'L3' ? ` <span class="text-secondary small">${p.visit_duration || 0}分钟(累加)</span>` : '');

        html += `<div class="poi-card" id="poi-card-${p.id}">
            <div class="poi-header">
                <span>${levelBadge} <b>${p.name}</b>${featuredTag} ${catBadge}${voiceBadge}${durationInfo} ${hoursText}${subInfo}</span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showEditPoiModal('${p.id}')"><i class="fas fa-edit"></i> 编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deletePoi('${p.id}')"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>`;

        if (subItems.length > 0) {
            // 排序：L2(普通) > L3(连续) > L4(场所/设施) > 节点
            const order = { L2: 0, L3: 1, L4: 2 };
            const sorted = [...subItems].sort((a, b) => {
                const oa = a.type === 'core_node' ? 9 : (order[a.data_level] ?? 5);
                const ob = b.type === 'core_node' ? 9 : (order[b.data_level] ?? 5);
                return oa - ob;
            });

            html += `<div class="node-list mt-2">`;
            sorted.forEach(sub => {
                const subLevel = sub.type === 'core_node' ? null : (sub.data_level || 'L2');
                const subBadge = sub.type === 'core_node'
                    ? `<span class="type-badge type-badge-core">⭐ 节点</span>`
                    : getLevelBadge(subLevel);
                const subCatIcon = CATEGORY_ICONS[sub.category] || '';
                const subCat = sub.category ? ` <span class="category-badge">${subCatIcon} ${sub.category}</span>` : '';
                const subDur = sub.visit_duration ? ` <span class="text-secondary small">(${sub.visit_duration}分钟)</span>` : '';
                const facilityTag = sub.type === 'facility' ? ' ' + getFacilitySubtypeBadge(sub.facility_subtype) : '';
                const subHours = sub.hours_type === '24h' ? ' <span class="badge bg-info text-dark" style="font-size:10px;">24H</span>' : '';

                html += `<div class="sub-poi-item">
                    <span>${subBadge} ${sub.name}${facilityTag}${subCat}${subHours}${subDur}</span>
                    <button class="btn btn-sm btn-outline-secondary" onclick="window.showEditPoiModal('${sub.id}')"><i class="fas fa-edit"></i></button>
                </div>`;

                // 若子项本身是 L3，展开其内部节点
                if (subLevel === 'L3') {
                    const innerNodes = pois.filter(x => String(x.parent_id) === String(sub.id));
                    if (innerNodes.length > 0) {
                        html += `<div style="margin-left:30px;border-left:2px dashed #ffeb3b;padding-left:10px;">`;
                        innerNodes.forEach(n => {
                            html += `<div class="sub-poi-item" style="background:#fffde7;">
                                <span><span class="type-badge type-badge-core">⭐ 节点</span> ${n.name} <span class="text-secondary small">(${n.visit_duration || 0}分钟)</span></span>
                                <button class="btn btn-sm btn-outline-secondary" onclick="window.showEditPoiModal('${n.id}')"><i class="fas fa-edit"></i></button>
                            </div>`;
                        });
                        html += `</div>`;
                    }
                }
            });
            html += `</div>`;
        }

        html += `</div>`;
    }
    container.innerHTML = html || '<p>暂无POI</p>';
}

// ============================================================
// 新增 / 编辑 POI
// ============================================================
export function showAddPoiModal() {
    currentEditingPoiId = null;
    currentSubPoiIds = [];
    categoryManuallySet = false;

    populateTimeSelects();

    document.getElementById('edit-poi-id').value = '';
    document.getElementById('edit-poi-name').value = '';
    document.getElementById('edit-poi-level').value = 'L2';
    document.getElementById('edit-poi-category').value = '自然景区';
    document.getElementById('edit-poi-lat').value = '';
    document.getElementById('edit-poi-lng').value = '';
    document.getElementById('edit-poi-hours-type').value = 'custom';
    setSelectValueSafe(document.getElementById('edit-poi-open'), '08:00');
    setSelectValueSafe(document.getElementById('edit-poi-close'), '18:00');
    document.getElementById('edit-poi-visit').value = '';
    document.getElementById('edit-poi-desc').value = '';
    document.getElementById('edit-poi-featured').checked = false;

    document.getElementById('edit-poi-voice-file').value = '';
    document.getElementById('edit-poi-voice-mp3').value = '';
    document.getElementById('edit-poi-voice-status').textContent = '';
    document.getElementById('edit-poi-voice-preview').innerHTML = '';

    setFacilitySubtypeCheckboxes([]);
    refreshParentSelect(null, 'L2');

    document.getElementById('poiModalTitle').textContent = '新增POI';
    togglePoiLevelUI();
    toggleHoursTypeUI();
    renderSubPoiList();

    const modal = new bootstrap.Modal(document.getElementById('poiModal'));
    modal.show();
}

export async function showEditPoiModal(poiId) {
    const poi = allPois.find(p => String(p.id) === String(poiId));
    if (!poi) return;
    currentEditingPoiId = poiId;
    categoryManuallySet = true;

    populateTimeSelects();

    document.getElementById('edit-poi-id').value = poiId;
    document.getElementById('edit-poi-name').value = poi.name || '';
    document.getElementById('edit-poi-level').value = poi.data_level || 'L2';
    document.getElementById('edit-poi-category').value = poi.category || '自然景区';
    document.getElementById('edit-poi-lat').value = poi.lat || '';
    document.getElementById('edit-poi-lng').value = poi.lng || '';
    document.getElementById('edit-poi-hours-type').value = poi.hours_type || 'custom';

    const openVal = normalizeTimeStr(poi.open_time) || '08:00';
    const closeVal = normalizeTimeStr(poi.close_time) || '18:00';
    setSelectValueSafe(document.getElementById('edit-poi-open'), openVal);
    setSelectValueSafe(document.getElementById('edit-poi-close'), closeVal);

    document.getElementById('edit-poi-visit').value = poi.visit_duration || '';
    document.getElementById('edit-poi-desc').value = poi.description || '';
    document.getElementById('edit-poi-featured').checked = !!poi.is_featured;

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

    refreshParentSelect(poiId, poi.data_level || 'L2');

    document.getElementById('poiModalTitle').textContent = `编辑POI - ${poi.name}`;
    togglePoiLevelUI();
    toggleHoursTypeUI();
    renderSubPoiList();

    const modal = new bootstrap.Modal(document.getElementById('poiModal'));
    modal.show();
}

// 刷新"所属景区"下拉：L2/L3 的父级必须是 L1 景区
function refreshParentSelect(currentId, currentLevel) {
    const parentSelect = document.getElementById('edit-poi-parent');
    parentSelect.innerHTML = '<option value="">-- 不关联（独立存在）--</option>';
    const currentPoi = currentId ? allPois.find(x => String(x.id) === String(currentId)) : null;

    // L1 景区的候选：所有 data_level = L1 的顶级 POI
    allPois.filter(p =>
        p.data_level === 'L1' &&
        !p.parent_id &&
        String(p.id) !== String(currentId)
    ).forEach(p => {
        const selected = currentPoi && String(p.id) === String(currentPoi.parent_id) ? 'selected' : '';
        parentSelect.innerHTML += `<option value="${p.id}" ${selected}>🏞️ ${p.name}</option>`;
    });

    // L3 节点的父级可以是 L3 景点（可选，因为节点一般挂在 L3 下）
    if (currentLevel === 'node') {
        allPois.filter(p =>
            p.data_level === 'L3' &&
            !p.parent_id &&
            String(p.id) !== String(currentId)
        ).forEach(p => {
            const selected = currentPoi && String(p.id) === String(currentPoi.parent_id) ? 'selected' : '';
            parentSelect.innerHTML += `<option value="${p.id}" ${selected}>⭐ ${p.name} (L3)</option>`;
        });
    }
}

// ★ 语音上传
window.onPoiVoiceSelected = async function(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
        alert('请选择音频文件（MP3）'); event.target.value = ''; return;
    }
    if (file.size > 10 * 1024 * 1024) {
        alert('音频文件不得超过 10MB'); event.target.value = ''; return;
    }
    const statusEl = document.getElementById('edit-poi-voice-status');
    statusEl.textContent = '上传中...';
    statusEl.className = 'text-warning small';
    try {
        const poiId = document.getElementById('edit-poi-id').value || 'new_' + Date.now();
        const ext = file.name.split('.').pop() || 'mp3';
        const path = `poi-voices/${poiId}_${Date.now()}.${ext}`;
        const publicUrl = await uploadFile('merchant-images', path, file);
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

// ★ 开放时段类型切换
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

// ============================================================
// 子类型复选框
// ============================================================
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

// ============================================================
// 分类联动
// ============================================================
window.onCategoryChange = function() { categoryManuallySet = true; };

window.onParentChange = function() {
    if (categoryManuallySet) return;
    const parentId = document.getElementById('edit-poi-parent').value;
    if (!parentId) return;
    const parent = allPois.find(p => String(p.id) === String(parentId));
    if (parent && parent.category) {
        document.getElementById('edit-poi-category').value = parent.category;
    }
};

window.onFacilitySubtypeChange = function() {
    if (categoryManuallySet) return;
    const subtypes = getFacilitySubtypeCheckboxes();
    const catSelect = document.getElementById('edit-poi-category');
    if (subtypes.includes('restaurant') || subtypes.includes('hotel')) {
        catSelect.value = '餐饮住宿';
    } else if (subtypes.includes('shopping')) {
        catSelect.value = '购物消费';
    } else if (subtypes.includes('service')) {
        catSelect.value = '公共服务';
    }
};

// ============================================================
// 等级切换 UI（核心：按 data_level 显示不同字段）
// ============================================================
export function togglePoiLevelUI() {
    const level = document.getElementById('edit-poi-level').value;
    const fieldFacilitySubtype = document.getElementById('field-facility-subtype');
    const fieldParent = document.getElementById('field-parent');
    const fieldDuration = document.getElementById('field-duration');
    const fieldFeatured = document.getElementById('field-featured');
    const subSection = document.getElementById('sub-poi-section');
    const parentRequired = document.getElementById('parent-required');
    const durationHint = document.getElementById('duration-readonly-hint');
    const visitInput = document.getElementById('edit-poi-visit');
    const subTitle = document.getElementById('sub-poi-title');
    const subHint = document.getElementById('sub-poi-hint');

    // 重置
    fieldFacilitySubtype.classList.add('hidden');
    fieldParent.classList.add('hidden');
    fieldDuration.classList.add('hidden');
    fieldFeatured.classList.add('hidden');
    subSection.classList.add('hidden');
    durationHint.textContent = '';
    visitInput.readOnly = false;

    if (level === 'L1') {
        // L1 景区：容器，无时长，有子项管理
        subSection.classList.remove('hidden');
        if (subTitle) subTitle.textContent = '景点管理';
        if (subHint) subHint.textContent = '景区的子项可为 L2 普通景点、L3 连续景点、L4 服务场所/设施。景区下必须至少有 1 个景点。';
        if (parentRequired) parentRequired.textContent = '（L1 无父级）';
    } else if (level === 'L2') {
        // L2 普通景点：有时长，可归属景区
        fieldParent.classList.remove('hidden');
        fieldDuration.classList.remove('hidden');
        fieldFeatured.classList.remove('hidden');
        if (parentRequired) parentRequired.textContent = '*（必须选择所属景区）';
        durationHint.textContent = '（分钟，手填）';
    } else if (level === 'L3') {
        // L3 连续景点：内部节点累加时长，仅允许节点
        fieldParent.classList.remove('hidden');
        fieldDuration.classList.remove('hidden');
        subSection.classList.remove('hidden');
        if (subTitle) subTitle.textContent = '节点管理';
        if (subHint) subHint.textContent = '连续景点的子项只能是核心节点（core_node）。节点总时长 = 连续景点总时长，不可打断。';
        if (parentRequired) parentRequired.textContent = '*（必须选择所属景区）';
        durationHint.textContent = '（自动累加，只读）';
        visitInput.readOnly = true;
    } else if (level === 'L4') {
        // L4 预留：服务场所/设施
        fieldParent.classList.remove('hidden');
        fieldDuration.classList.remove('hidden');
        fieldFacilitySubtype.classList.remove('hidden');
        if (parentRequired) parentRequired.textContent = '（可选）';
        durationHint.textContent = '（分钟，手填，用于参考）';
    }
}

// ============================================================
// 子项管理
// ============================================================
function renderSubPoiList() {
    const container = document.getElementById('sub-poi-list');
    if (!container) return;
    if (!currentEditingPoiId) {
        container.innerHTML = '<p class="text-secondary small mb-0">请先保存POI，再次编辑时即可管理子项。</p>';
        return;
    }
    const subPois = allPois.filter(p => String(p.parent_id) === String(currentEditingPoiId));
    currentSubPoiIds = subPois.map(p => p.id);
    if (subPois.length === 0) {
        container.innerHTML = '<p class="text-secondary small mb-0">暂无子项。</p>';
        return;
    }
    const order = { L2: 0, L3: 1, L4: 2 };
    const sorted = [...subPois].sort((a, b) => {
        const oa = a.type === 'core_node' ? 9 : (order[a.data_level] ?? 5);
        const ob = b.type === 'core_node' ? 9 : (order[b.data_level] ?? 5);
        return oa - ob;
    });

    let html = '';
    sorted.forEach(sub => {
        const subLevel = sub.type === 'core_node' ? null : (sub.data_level || 'L2');
        const subBadge = sub.type === 'core_node'
            ? `<span class="type-badge type-badge-core">⭐ 节点</span>`
            : getLevelBadge(subLevel);
        const featuredTag = sub.is_featured ? ' <span class="featured-badge">⭐</span>' : '';
        const catIcon = CATEGORY_ICONS[sub.category] || '';
        const catBadge = sub.category ? ` <span class="category-badge">${catIcon} ${sub.category}</span>` : '';
        const facilityTag = sub.type === 'facility' ? ' ' + getFacilitySubtypeBadge(sub.facility_subtype) : '';

        html += `<div class="sub-poi-item">
            <span>${subBadge} ${sub.name}${facilityTag}${featuredTag}${catBadge} <span class="text-secondary small">(${sub.visit_duration || 0}分钟)</span></span>
            <div>
                <button class="btn btn-sm btn-outline-secondary me-1" onclick="window.showEditPoiModal('${sub.id}')"><i class="fas fa-edit"></i> 编辑</button>
                <button class="btn btn-sm btn-danger" onclick="window.removeSubPoi('${sub.id}')"><i class="fas fa-unlink"></i> 移出</button>
            </div>
        </div>`;
    });
    container.innerHTML = html;
}

export function showSelectSubPoiModal() {
    if (!currentEditingPoiId) { alert('请先保存POI'); return; }
    const currentPoi = allPois.find(p => String(p.id) === String(currentEditingPoiId));
    if (!currentPoi) return;
    const currentLevel = currentPoi.data_level || 'L2';

    let candidates = [];
    if (currentLevel === 'L1') {
        // L1 景区可以添加：无父级的 L2 / L3 / L4
        candidates = allPois.filter(p =>
            !p.parent_id &&
            p.id !== currentPoi.id &&
            ['L2', 'L3', 'L4'].includes(p.data_level)
        );
    } else if (currentLevel === 'L3') {
        // L3 连续景点只能添加 core_node
        candidates = allPois.filter(p =>
            p.type === 'core_node' &&
            p.id !== currentPoi.id
        );
    } else {
        alert('仅 L1 景区和 L3 连续景点可管理子项');
        return;
    }

    const list = document.getElementById('sub-poi-select-list');
    if (!list) return;
    if (candidates.length === 0) {
        list.innerHTML = '<p class="text-secondary">没有可添加的 POI</p>';
        return;
    }

    let html = '';
    // 按等级分组
    const groups = {};
    candidates.forEach(p => {
        const key = p.type === 'core_node' ? 'core_node' : (p.data_level || 'L2');
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    });

    Object.keys(groups).forEach(key => {
        const labelMap = {
            L2: '📍 L2 普通景点',
            L3: '⭐ L3 连续景点',
            L4: '🏛️ L4 服务场所/设施',
            core_node: '⭐ 核心节点'
        };
        html += `<div style="margin-bottom:8px;"><b style="color:#1b5e20;">${labelMap[key] || key}</b></div>`;
        groups[key].forEach(p => {
            const facilityTag = p.type === 'facility' && p.facility_subtype
                ? ` [${subtypesToText(p.facility_subtype)}]` : '';
            const currentParent = p.parent_id ? ` <span class="text-warning small">(已属其他父级)</span>` : '';
            html += `<label style="display:flex;align-items:center;padding:6px 8px;border-bottom:1px solid #f0f0f0;cursor:pointer;">
                <input type="checkbox" value="${p.id}" style="margin-right:8px;">
                <span>${p.name}${facilityTag}</span>${currentParent}
                <span style="color:#888;font-size:12px;margin-left:8px;">${p.visit_duration || 0}分钟</span>
            </label>`;
        });
    });

    list.innerHTML = html;
    new bootstrap.Modal(document.getElementById('selectSubPoiModal')).show();
}

export async function confirmSubPoiSelection() {
    const list = document.getElementById('sub-poi-select-list');
    if (!list) return;
    const checkboxes = list.querySelectorAll('input[type="checkbox"]');
    const selectedIds = [];
    checkboxes.forEach(cb => { if (cb.checked) selectedIds.push(cb.value); });
    if (selectedIds.length === 0) {
        bootstrap.Modal.getInstance(document.getElementById('selectSubPoiModal')).hide();
        return;
    }
    try {
        await Promise.all(selectedIds.map(id => updatePoi(id, { parent_id: currentEditingPoiId })));
        selectedIds.forEach(id => {
            const p = allPois.find(x => String(x.id) === String(id));
            if (p) p.parent_id = currentEditingPoiId;
        });
        // 若是 L3 景点，重算时长
        const currentPoi = allPois.find(p => String(p.id) === String(currentEditingPoiId));
        if (currentPoi && currentPoi.data_level === 'L3') {
            await recomputeL3Duration(currentEditingPoiId);
        }
        bootstrap.Modal.getInstance(document.getElementById('selectSubPoiModal')).hide();
        renderSubPoiList();
        await initAdminUI();
        alert(`已添加 ${selectedIds.length} 个子项`);
    } catch (e) { alert('添加失败：' + e.message); }
}

export async function removeSubPoi(subPoiId) {
    if (!confirm('确认将该子项从父级移出？')) return;
    try {
        await updatePoi(subPoiId, { parent_id: null });
        const poi = allPois.find(p => String(p.id) === String(subPoiId));
        if (poi) poi.parent_id = null;
        const currentPoi = allPois.find(p => String(p.id) === String(currentEditingPoiId));
        if (currentPoi && currentPoi.data_level === 'L3') {
            await recomputeL3Duration(currentEditingPoiId);
        }
        renderSubPoiList();
        await initAdminUI();
    } catch (e) { alert('移出失败：' + e.message); }
}

// 重算 L3 景点时长
async function recomputeL3Duration(l3Id) {
    const subs = allPois.filter(p => String(p.parent_id) === String(l3Id));
    const total = subs.reduce((s, x) => s + (x.visit_duration || 0), 0);
    await updatePoi(l3Id, { visit_duration: total });
    const p = allPois.find(x => String(x.id) === String(l3Id));
    if (p) p.visit_duration = total;
}

// ============================================================
// 保存 POI（含等级校验）
// ============================================================
export async function savePoiEdit() {
    const poiId = document.getElementById('edit-poi-id').value;
    const isNew = !poiId;
    const level = document.getElementById('edit-poi-level').value;

    // 校验等级与父级的关系
    let parentId = null;
    if (level !== 'L1') {
        const parentRaw = document.getElementById('edit-poi-parent').value;
        if (parentRaw) parentId = parentRaw;
    }

    // L2/L3 必须选择所属景区
    if ((level === 'L2' || level === 'L3') && !parentId) {
        alert('L2 普通景点和 L3 连续景点必须选择所属景区');
        return;
    }

    const hoursType = document.getElementById('edit-poi-hours-type').value;
    let openTime = normalizeTimeStr(document.getElementById('edit-poi-open').value) || '08:00';
    let closeTime = normalizeTimeStr(document.getElementById('edit-poi-close').value) || '18:00';
    if (hoursType === '24h') {
        openTime = '00:00';
        closeTime = '23:59';
    }

    // 根据等级推导 type 和 visit_duration
    let type = 'spot';
    let visitDuration = 0;

    if (level === 'L1') {
        type = 'scenic';
        visitDuration = 0;
    } else if (level === 'L2') {
        type = 'spot';
        visitDuration = parseInt(document.getElementById('edit-poi-visit').value) || 60;
    } else if (level === 'L3') {
        type = 'spot';
        // 自动累加子节点
        const subs = allPois.filter(p => String(p.parent_id) === String(poiId));
        visitDuration = subs.reduce((s, x) => s + (x.visit_duration || 0), 0);
        if (visitDuration === 0 && isNew) {
            alert('L3 连续景点需先保存后添加节点，请先以其他等级保存或先创建再添加节点');
            return;
        }
    } else if (level === 'L4') {
        // L4 服务场所/设施：根据子类型推断 type
        const subtypes = getFacilitySubtypeCheckboxes();
        if (subtypes.length > 0) {
            type = 'facility';
        } else {
            type = 'service_place';
        }
        visitDuration = parseInt(document.getElementById('edit-poi-visit').value) || 0;
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
        parent_id: parentId,
        voice_mp3: document.getElementById('edit-poi-voice-mp3').value || null,
        status: 'active'
    };

    // 设施子类型
    if (type === 'facility') {
        const subtypes = getFacilitySubtypeCheckboxes();
        updates.facility_subtype = subtypes.length > 0 ? subtypes : null;
    } else {
        updates.facility_subtype = null;
    }

    // 经典标记（仅 L2 普通景点）
    updates.is_featured = (level === 'L2')
        ? document.getElementById('edit-poi-featured').checked : false;

    if (!updates.name) { alert('请输入名称'); return; }

    try {
        if (isNew) {
            // L3 新建时先创建空的 L3，然后由用户添加节点
            if (level === 'L3') {
                const result = await insertPoi(updates);
                // 创建后再自动跳转编辑该 POI
                bootstrap.Modal.getInstance(document.getElementById('poiModal')).hide();
                await initAdminUI();
                alert('L3 连续景点已创建，请再次点击编辑以添加节点');
                setTimeout(() => window.showEditPoiModal(result.id), 200);
                return;
            }
            await insertPoi(updates);
        } else {
            await updatePoi(poiId, updates);
        }

        // L1 容器校验：保存后检查是否有子项
        if (level === 'L1' && !isNew) {
            const subs = allPois.filter(p => String(p.parent_id) === String(poiId));
            if (subs.length === 0) {
                setTimeout(() => alert('提示：该景区下还没有景点，请通过"子项管理"添加至少 1 个景点。'), 300);
            }
        }

        alert(isNew ? '新增成功' : '保存成功');
        bootstrap.Modal.getInstance(document.getElementById('poiModal')).hide();
        await initAdminUI();
    } catch (e) {
        alert('保存失败：' + e.message);
        console.error(e);
    }
}

export async function deletePoi(id) {
    const poi = allPois.find(p => String(p.id) === String(id));
    if (!poi) return;
    const subPois = allPois.filter(p => String(p.parent_id) === String(id));
    let msg = '确认删除此POI？';
    if (subPois.length > 0) {
        msg = `该POI下有 ${subPois.length} 个子项，删除后子项将解除关联（不会删除），是否继续？`;
    }
    if (!confirm(msg)) return;
    try {
        if (subPois.length > 0) {
            await Promise.all(subPois.map(p => updatePoi(p.id, { parent_id: null })));
        }
        await apiDeletePoi(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
}

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
    document.querySelectorAll('#route-theme-tags input[type="checkbox"]:checked').forEach(cb => {
        tags.push(cb.value);
    });
    return tags;
}

function setThemeTags(tags) {
    const arr = Array.isArray(tags) ? tags : [];
    document.querySelectorAll('#route-theme-tags input[type="checkbox"]').forEach(cb => {
        cb.checked = arr.includes(cb.value);
    });
}

function calculateRouteTotalDuration() {
    let total = 0;
    let prevPoiId = null;
    routeNodesData.forEach(node => {
        if (prevPoiId && node.poi_id && String(prevPoiId) !== String(node.poi_id)) {
            const prevPoi = allPois.find(p => String(p.id) === String(prevPoiId));
            const curPoi = allPois.find(p => String(p.id) === String(node.poi_id));
            // 同景区不计交通
            const sameScenic = prevPoi && curPoi
                && prevPoi.parent_id && curPoi.parent_id
                && String(prevPoi.parent_id) === String(curPoi.parent_id);
            if (!sameScenic) {
                const preset = allPresets.find(p =>
                    (String(p.from_poi_id) === String(prevPoiId) && String(p.to_poi_id) === String(node.poi_id)) ||
                    (String(p.from_poi_id) === String(node.poi_id) && String(p.to_poi_id) === String(prevPoiId))
                );
                if (preset) total += preset.time_min || 0;
            }
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
                    <div class="route-node-name">
                        ${n.node_name || '未命名节点'}
                        <span class="route-node-type-badge">${typeLabel}</span>
                        <span style="font-size:11px;color:#ff9800;margin-left:6px;">${priorityLabel}</span>
                        ${poiName}
                    </div>
                    <div class="route-node-desc">
                        <i class="fas fa-clock"></i> ${n.duration_min || 0}分钟
                        ${n.is_skippable ? ' · 可跳过' : ''}
                        ${n.meal_suitable ? ' · 可用餐' : ''}
                        ${n.description ? ` · ${n.description}` : ''}
                    </div>
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

window.saveRouteNode = function() {
    const name = document.getElementById('edit-node-name').value.trim();
    if (!name) { alert('请输入节点名称'); return; }
    const poiId = document.getElementById('edit-node-poi').value || null;
    const poiName = poiId ? (allPois.find(p => String(p.id) === String(poiId))?.name || '') : '';
    const nodeData = {
        node_name: name,
        node_type: document.getElementById('edit-node-type').value,
        poi_id: poiId,
        poi_name: poiName,
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
    bootstrap.Modal.getInstance(document.getElementById('routeNodeModal')).hide();
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

// ============================================================
// POI 选择器
// ============================================================
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
    const groups = { L1: [], L2: [], L3: [], L4: [], core_node: [] };
    allPois.forEach(p => {
        const key = p.type === 'core_node' ? 'core_node' : (p.data_level || 'L2');
        if (!groups[key]) groups[key] = [];
        if (keyword && !p.name.toLowerCase().includes(keyword)) return;
        groups[key].push(p);
    });
    const labelMap = {
        L1: '🏞️ L1 景区', L2: '📍 L2 普通景点', L3: '⭐ L3 连续景点',
        L4: '🏛️ L4 服务场所/设施', core_node: '⭐ 核心节点'
    };
    let html = '';
    Object.keys(groups).forEach(k => {
        if (groups[k].length === 0) return;
        html += `<div class="poi-group">
            <div class="poi-group-title">${labelMap[k] || k} (${groups[k].length})</div>`;
        groups[k].forEach(p => {
            const selected = String(p.id) === String(poiPickerSelectedId) ? 'selected' : '';
            const facilityTag = (p.type === 'facility' && p.facility_subtype)
                ? ` [${subtypesToText(p.facility_subtype)}]` : '';
            html += `<div class="poi-picker-item ${selected}" onclick="window.selectPoiPickerItem('${p.id}', '${p.name.replace(/'/g, "\\'")}')">
                ${p.name}${facilityTag}
            </div>`;
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

window.confirmPoiPicker = function() {
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
    bootstrap.Modal.getInstance(document.getElementById('poiPickerModal')).hide();
};

// ============================================================
// 保存路线
// ============================================================
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
        scenic_poi_id: null,
        is_default: false,
        start_time: '08:00',
        transport: '',
        days: 1,
        group_type: 'default'
    };
    try {
        let routeId = id;
        if (id) {
            await updateRoute(id, data);
        } else {
            const r = await insertRoute(data);
            routeId = r.id;
        }
        await deleteRouteNodes(routeId);
        const nodes = routeNodesData.map((n, i) => ({
            route_id: routeId,
            order_num: i + 1,
            node_name: n.node_name,
            node_type: n.node_type,
            poi_id: n.poi_id || null,
            priority_level: n.priority_level || 2,
            duration_min: n.duration_min || 10,
            duration_short: n.duration_short || null,
            duration_long: n.duration_long || null,
            is_skippable: !!n.is_skippable,
            meal_suitable: n.meal_suitable || null,
            nearby_restaurant: n.nearby_restaurant || null,
            description: n.description,
            tips: n.tips,
            transport_mode: '步行',
            transport_time: 0
        }));
        if (nodes.length > 0) await insertRouteNodes(nodes);
        alert('保存成功');
        bootstrap.Modal.getInstance(document.getElementById('routeModal')).hide();
        await initAdminUI();
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
// 交通耗时（仅顶层 L1 及独立 L2/L3）
// ============================================================
export function renderTransportEditor(presets) {
    const container = document.getElementById('transport-editor');
    if (!container) return;
    const poiList = allPois.filter(p => !p.parent_id && p.data_level !== 'L1');
    if (poiList.length === 0) { container.innerHTML = '<p>暂无独立的 L2/L3 数据</p>'; return; }
    let html = '';
    poiList.forEach(fromPoi => {
        html += `<div class="transport-group card mb-2">
            <div class="card-header" style="cursor:pointer;background:#f8f9fa;" onclick="this.nextElementSibling.classList.toggle('hidden')">
                <b>🚩 ${fromPoi.name}</b> <span class="text-secondary">(点击展开)</span>
            </div>
            <div class="card-body hidden">`;
        poiList.forEach(toPoi => {
            if (String(fromPoi.id) === String(toPoi.id)) return;
            let val = presets.find(p => String(p.from_poi_id) === String(fromPoi.id) && String(p.to_poi_id) === String(toPoi.id))?.time_min;
            if (val === undefined) val = presets.find(p => String(p.from_poi_id) === String(toPoi.id) && String(p.to_poi_id) === String(fromPoi.id))?.time_min;
            const isEstimate = val === undefined;
            const displayVal = isEstimate ? '' : val;
            html += `<div class="transport-item">
                <span>→ ${toPoi.name}</span>
                <div>
                    <input type="number" value="${displayVal}" placeholder="分钟" 
                           data-from="${fromPoi.id}" data-to="${toPoi.id}" 
                           style="${isEstimate ? 'background:#fff3cd;' : ''}" 
                           onchange="window.saveTransportTime(this)">
                    <span class="save-status"></span>
                </div>
            </div>`;
        });
        html += `</div></div>`;
    });
    container.innerHTML = html;
}

window.saveTransportTime = async function(input) {
    const from = input.dataset.from;
    const to = input.dataset.to;
    const val = parseInt(input.value);
    if (isNaN(val) || val < 0) return;
    try {
        await upsertTransportPreset(from, to, val);
        const presets = await getTransportPresets();
        allPresets = presets;
        const reverseExists = presets.some(p => String(p.from_poi_id) === String(to) && String(p.to_poi_id) === String(from));
        if (!reverseExists) {
            await upsertTransportPreset(to, from, val);
        }
        document.querySelectorAll('#transport-editor input[type="number"]').forEach(inp => {
            const f = inp.dataset.from;
            const t = inp.dataset.to;
            if (String(f) === String(to) && String(t) === String(from) && inp.value === '') inp.value = val;
        });
        const status = input.parentElement.querySelector('.save-status');
        if (status) { status.textContent = '✓已保存'; setTimeout(() => status.textContent = '', 1500); }
        input.style.background = '#e8f5e9';
        setTimeout(() => input.style.background = '', 1500);
    } catch (e) { alert('保存失败：' + e.message); }
};

// ============================================================
// 商户管理
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

// ============================================================
// 留言管理
// ============================================================
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

// ============================================================
// 工具
// ============================================================
export function refreshData() { initAdminUI(); }
