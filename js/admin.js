// js/admin.js - 管理后台完整逻辑（分类与类型解耦 + facility多子类型 + UUID兼容）
import {
    getPois, getPoi, insertPoi, updatePoi, deletePoi as apiDeletePoi,
    getScenicList, insertScenic, updateScenic, deleteScenic as apiDeleteScenic,
    getRoutes, getRoute, insertRoute, updateRoute, deleteRoute as apiDeleteRoute,
    getRouteNodes, insertRouteNodes, deleteRouteNodes,
    getTransportPresets, upsertTransportPreset,
    getMerchantsByPoi, getMerchant, updateMerchant, createMerchantRecord,
    getReservations, updateReservation,
    getFeedbacks, updateFeedback, deleteFeedback as apiDeleteFeedback,
    uploadFile
} from './api.js';

let allPois = [], allScenic = [], allRoutes = [], allPresets = [], allMerchants = [], allFeedbacks = [];
let currentEditingPoiId = null;
let currentSubPoiIds = [];
let currentTourRoute = [];

// ★ 追踪用户是否手动修改过分类
let categoryManuallySet = false;

// ============================================================
// 类型标签与徽章
// ============================================================
const TYPE_LABELS = {
    scenic: '🏞️ 景区',
    core_node: '⭐ 核心节点',
    spot: '📍 景点',
    facility: '🏢 公共场所'
};

const FACILITY_SUBTYPE_LABELS = {
    restaurant: '🍽️ 餐厅',
    hotel: '🏨 住宿',
    shopping: '🛍️ 购物',
    service: '🚻 服务设施'
};

const TYPE_CLASSES = {
    scenic: 'type-badge-scenic',
    core_node: 'type-badge-core',
    spot: 'type-badge-spot',
    facility: 'type-badge-facility'
};

const FACILITY_SUBTYPE_CLASSES = {
    restaurant: 'type-badge-restaurant',
    hotel: 'type-badge-hotel',
    shopping: 'type-badge-shopping',
    service: 'type-badge-service'
};

const CATEGORY_ICONS = {
    '自然景区': '🏔️',
    '红色景区': '🔴',
    '文博场馆': '🏛️',
    '餐饮住宿': '🍽️',
    '交通枢纽': '🚌',
    '游玩娱乐': '🎢',
    '购物消费': '🛍️',
    '公共服务': '🏛️'
};

function getTypeBadge(type, facilitySubtype) {
    const t = type || 'spot';

    if (t === 'facility') {
        let subtypes = [];
        if (Array.isArray(facilitySubtype)) {
            subtypes = facilitySubtype.filter(s => s);
        } else if (facilitySubtype) {
            subtypes = [facilitySubtype];
        }

        if (subtypes.length === 0) {
            return `<span class="type-badge type-badge-facility">🏢 公共场所</span>`;
        }

        return subtypes.map(sub => {
            const cls = FACILITY_SUBTYPE_CLASSES[sub] || 'type-badge-facility';
            const label = FACILITY_SUBTYPE_LABELS[sub] || sub;
            return `<span class="type-badge ${cls}">${label}</span>`;
        }).join('');
    }

    return `<span class="type-badge ${TYPE_CLASSES[t] || 'type-badge-spot'}">${TYPE_LABELS[t] || t}</span>`;
}

function subtypesToText(subtypes) {
    if (!Array.isArray(subtypes) || subtypes.length === 0) return '';
    return subtypes.map(s => (FACILITY_SUBTYPE_LABELS[s] || s).replace(/^[^\s]+\s/, '')).join('/');
}

// ============================================================
// 初始化
// ============================================================
export async function initAdminUI() {
    try {
        const [pois, scenic, routes, presets, merchants, feedbacks] = await Promise.all([
            getPois(),
            getScenicList(),
            getRoutes(),
            getTransportPresets(),
            getMerchantsByPoi(null),
            getFeedbacks(null)
        ]);
        allPois = pois;
        allScenic = scenic;
        allRoutes = routes;
        allPresets = presets;
        allMerchants = merchants;
        allFeedbacks = feedbacks;
        renderPoiList(allPois);
        renderScenicList(allScenic);
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
        const level = p.data_level || 'L3';
        const scenic = allScenic.find(s => String(s.id) === String(p.scenic_id));
        const scenicName = scenic ? `[${scenic.name}]` : '';
        const poiType = p.type || 'spot';
        const typeBadge = getTypeBadge(poiType, p.facility_subtype);

        // 分类徽章
        const catIcon = CATEGORY_ICONS[p.category] || '';
        const catBadge = p.category ? `<span class="category-badge">${catIcon} ${p.category}</span>` : '';

        // 子项
        const subItems = pois.filter(x => String(x.parent_id) === String(p.id));
        const coreCount = subItems.filter(x => x.type === 'core_node').length;
        const spotCount = subItems.filter(x => x.type === 'spot').length;
        const facCount = subItems.filter(x => x.type === 'facility').length;

        let subInfo = '';
        if (subItems.length > 0) {
            subInfo = ` <span class="text-secondary" style="font-size:12px;">(${coreCount}核心 ${spotCount}景点 ${facCount}场所)</span>`;
        }

        const featuredTag = p.is_featured ? ` <span class="featured-badge">⭐经典</span>` : '';

        html += `<div class="poi-card" id="poi-card-${p.id}">
            <div class="poi-header">
                <span>${typeBadge} <b>${p.name}</b>${featuredTag} ${scenicName} ${catBadge} <span class="data-quality-badge quality-${level}">${level}</span>${subInfo}</span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showEditPoiModal('${p.id}')"><i class="fas fa-edit"></i> 编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deletePoi('${p.id}')"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>`;

        if (subItems.length > 0) {
            html += `<div class="node-list mt-2">`;
            subItems.forEach(sub => {
                const subType = sub.type || 'spot';
                const subBadge = getTypeBadge(subType, sub.facility_subtype);
                const subCatIcon = CATEGORY_ICONS[sub.category] || '';
                const subCat = sub.category ? ` <span class="category-badge">${subCatIcon} ${sub.category}</span>` : '';
                html += `<div class="sub-poi-item">
                    <span>${subBadge} ${sub.name}${subCat} <span class="text-secondary small">(${sub.visit_duration || 0}分钟)</span></span>
                    <button class="btn btn-sm btn-outline-secondary" onclick="window.showEditPoiModal('${sub.id}')"><i class="fas fa-edit"></i></button>
                </div>`;
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
    currentTourRoute = [];
    categoryManuallySet = false;   // ★ 重置标记

    document.getElementById('edit-poi-id').value = '';
    document.getElementById('edit-poi-name').value = '';
    document.getElementById('edit-poi-type').value = 'spot';
    document.getElementById('edit-poi-category').value = '自然景区';
    document.getElementById('edit-poi-lat').value = '';
    document.getElementById('edit-poi-lng').value = '';
    document.getElementById('edit-poi-open').value = '08:00';
    document.getElementById('edit-poi-close').value = '18:00';
    document.getElementById('edit-poi-visit').value = '';
    document.getElementById('edit-poi-desc').value = '';
    document.getElementById('edit-poi-level').value = 'L3';
    document.getElementById('edit-poi-featured').checked = false;

    setFacilitySubtypeCheckboxes([]);

    const scenicSelect = document.getElementById('edit-poi-scenic');
    scenicSelect.innerHTML = '<option value="">无关联</option>';
    allScenic.forEach(s => {
        scenicSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });

    const parentSelect = document.getElementById('edit-poi-parent');
    parentSelect.innerHTML = '<option value="">-- 不关联（独立存在）--</option>';
    allPois.filter(p => p.type === 'scenic' && !p.parent_id).forEach(p => {
        parentSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });

    document.getElementById('poiModalTitle').textContent = '新增POI';
    togglePoiTypeUI();
    renderTourRoute();
    renderSubPoiList();

    const modal = new bootstrap.Modal(document.getElementById('poiModal'));
    modal.show();
}

export async function showEditPoiModal(poiId) {
    const poi = allPois.find(p => String(p.id) === String(poiId));
    if (!poi) {
        console.warn('POI 未找到:', poiId);
        return;
    }
    currentEditingPoiId = poiId;
    categoryManuallySet = true;   // ★ 已有数据，视为用户设置过

    document.getElementById('edit-poi-id').value = poiId;
    document.getElementById('edit-poi-name').value = poi.name || '';
    document.getElementById('edit-poi-type').value = poi.type || 'spot';
    document.getElementById('edit-poi-category').value = poi.category || '自然景区';
    document.getElementById('edit-poi-lat').value = poi.lat || '';
    document.getElementById('edit-poi-lng').value = poi.lng || '';
    document.getElementById('edit-poi-open').value = poi.open_time || '08:00';
    document.getElementById('edit-poi-close').value = poi.close_time || '18:00';
    document.getElementById('edit-poi-visit').value = poi.visit_duration || '';
    document.getElementById('edit-poi-desc').value = poi.description || '';
    document.getElementById('edit-poi-level').value = poi.data_level || 'L3';
    document.getElementById('edit-poi-featured').checked = !!poi.is_featured;

    let subtypes = [];
    if (Array.isArray(poi.facility_subtype)) subtypes = poi.facility_subtype;
    else if (poi.facility_subtype) subtypes = [poi.facility_subtype];
    setFacilitySubtypeCheckboxes(subtypes);

    const scenicSelect = document.getElementById('edit-poi-scenic');
    scenicSelect.innerHTML = '<option value="">无关联</option>';
    allScenic.forEach(s => {
        const selected = String(s.id) === String(poi.scenic_id) ? 'selected' : '';
        scenicSelect.innerHTML += `<option value="${s.id}" ${selected}>${s.name}</option>`;
    });

    const parentSelect = document.getElementById('edit-poi-parent');
    parentSelect.innerHTML = '<option value="">-- 不关联（独立存在）--</option>';
    allPois.filter(p => p.type === 'scenic' && !p.parent_id && String(p.id) !== String(poiId)).forEach(p => {
        const selected = String(p.id) === String(poi.parent_id) ? 'selected' : '';
        parentSelect.innerHTML += `<option value="${p.id}" ${selected}>${p.name}</option>`;
    });

    currentTourRoute = [];
    if (poi.tour_route && Array.isArray(poi.tour_route)) {
        poi.tour_route.forEach(id => {
            const sub = allPois.find(x => String(x.id) === String(id));
            if (sub) currentTourRoute.push({
                id: sub.id, name: sub.name, type: sub.type, facility_subtype: sub.facility_subtype
            });
        });
    }

    document.getElementById('poiModalTitle').textContent = `编辑POI - ${poi.name}`;
    togglePoiTypeUI();
    renderTourRoute();
    renderSubPoiList();

    const modal = new bootstrap.Modal(document.getElementById('poiModal'));
    modal.show();
}

// ============================================================
// 子类型复选框：读取 / 回填
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
        if (cb) {
            cb.checked = arr.includes(cb.value);
        }
    });
}

// ============================================================
// ★ 分类联动事件处理器
// ============================================================

// 用户手动改分类 → 标记
window.onCategoryChange = function() {
    categoryManuallySet = true;
};

// 用户切换父景区 → 若未手动改过分类，则继承父景区分类
window.onParentChange = function() {
    if (categoryManuallySet) return;

    const parentId = document.getElementById('edit-poi-parent').value;
    if (!parentId) return;

    const parent = allPois.find(p => String(p.id) === String(parentId));
    if (parent && parent.category) {
        document.getElementById('edit-poi-category').value = parent.category;
    }
};

// 用户勾选/取消设施子类型 → 若未手动改过分类，则根据子类型自动更新
window.onFacilitySubtypeChange = function() {
    if (categoryManuallySet) return;

    const subtypes = getFacilitySubtypeCheckboxes();
    const catSelect = document.getElementById('edit-poi-category');

    // 判断优先级：餐厅/住宿 > 购物 > 服务
    if (subtypes.includes('restaurant') || subtypes.includes('hotel')) {
        catSelect.value = '餐饮住宿';
    } else if (subtypes.includes('shopping')) {
        catSelect.value = '购物消费';
    } else if (subtypes.includes('service')) {
        catSelect.value = '公共服务';
    }
};

// ============================================================
// 根据类型切换字段显示
// ============================================================
export function togglePoiTypeUI() {
    const type = document.getElementById('edit-poi-type').value;

    const fieldFacilitySubtype = document.getElementById('field-facility-subtype');
    const fieldParent = document.getElementById('field-parent');
    const fieldDuration = document.getElementById('field-duration');
    const fieldFeatured = document.getElementById('field-featured');
    const subSection = document.getElementById('sub-poi-section');
    const routeSection = document.getElementById('tour-route-section');
    const parentRequired = document.getElementById('parent-required');

    // 全部隐藏（★ 注意：分类字段不再隐藏）
    fieldFacilitySubtype.classList.add('hidden');
    fieldParent.classList.add('hidden');
    fieldDuration.classList.add('hidden');
    fieldFeatured.classList.add('hidden');
    subSection.classList.add('hidden');
    routeSection.classList.add('hidden');

    if (type === 'scenic') {
        subSection.classList.remove('hidden');
        routeSection.classList.remove('hidden');
    } else if (type === 'core_node') {
        fieldParent.classList.remove('hidden');
        fieldDuration.classList.remove('hidden');
        if (parentRequired) parentRequired.textContent = '*';
    } else if (type === 'spot') {
        fieldParent.classList.remove('hidden');
        fieldDuration.classList.remove('hidden');
        fieldFeatured.classList.remove('hidden');
        if (parentRequired) parentRequired.textContent = '*';
    } else if (type === 'facility') {
        fieldFacilitySubtype.classList.remove('hidden');
        fieldParent.classList.remove('hidden');
        if (parentRequired) parentRequired.textContent = '（可选）';
    }
}

// ============================================================
// 子项管理
// ============================================================
function renderSubPoiList() {
    const container = document.getElementById('sub-poi-list');
    if (!container) return;

    if (!currentEditingPoiId) {
        container.innerHTML = '<p class="text-secondary small mb-0">请先保存景区，再次编辑时即可管理子项。</p>';
        return;
    }

    const subPois = allPois.filter(p => String(p.parent_id) === String(currentEditingPoiId));
    currentSubPoiIds = subPois.map(p => p.id);

    if (subPois.length === 0) {
        container.innerHTML = '<p class="text-secondary small mb-0">暂无子项，点击上方按钮添加。</p>';
        return;
    }

    // ★ 按类型排序：核心节点 → 景点 → 公共场所（不按分类分组）
    const order = { core_node: 1, spot: 2, facility: 3 };
    const sorted = [...subPois].sort((a, b) => (order[a.type] || 9) - (order[b.type] || 9));

    let html = '';
    sorted.forEach(sub => {
        const subType = sub.type || 'spot';
        const subBadge = getTypeBadge(subType, sub.facility_subtype);
        const featuredTag = sub.is_featured ? ' <span class="featured-badge">⭐</span>' : '';
        const catIcon = CATEGORY_ICONS[sub.category] || '';
        const catBadge = sub.category ? ` <span class="category-badge">${catIcon} ${sub.category}</span>` : '';
        html += `<div class="sub-poi-item">
            <span>${subBadge} ${sub.name}${featuredTag}${catBadge} <span class="text-secondary small">(${sub.visit_duration || 0}分钟)</span></span>
            <div>
                <button class="btn btn-sm btn-outline-secondary me-1" onclick="window.showEditPoiModal('${sub.id}')"><i class="fas fa-edit"></i> 编辑</button>
                <button class="btn btn-sm btn-danger" onclick="window.removeSubPoi('${sub.id}')"><i class="fas fa-unlink"></i> 移出</button>
            </div>
        </div>`;
    });
    container.innerHTML = html;
}

export function showSelectSubPoiModal() {
    if (!currentEditingPoiId) {
        alert('请先保存景区后再添加子项');
        return;
    }

    const list = document.getElementById('sub-poi-select-list');
    if (!list) return;

    const candidates = allPois.filter(p =>
        String(p.id) !== String(currentEditingPoiId) &&
        !p.parent_id &&
        p.type !== 'scenic'
    );

    if (candidates.length === 0) {
        list.innerHTML = '<p class="text-secondary">没有可添加的独立 POI</p>';
        return;
    }

    const grouped = { core_node: [], spot: [], facility: [] };
    candidates.forEach(p => {
        const t = p.type || 'spot';
        if (!grouped[t]) grouped[t] = [];
        grouped[t].push(p);
    });

    let html = '';
    Object.keys(grouped).forEach(t => {
        if (grouped[t].length === 0) return;
        html += `<div style="margin-bottom:8px;"><b style="color:#1b5e20;">${TYPE_LABELS[t] || t}</b></div>`;
        grouped[t].forEach(p => {
            const subLabel = (t === 'facility' && p.facility_subtype)
                ? ` <span class="text-secondary" style="font-size:11px;">[${subtypesToText(p.facility_subtype)}]</span>`
                : '';
            const catLabel = p.category
                ? ` <span class="text-secondary" style="font-size:11px;">· ${p.category}</span>`
                : '';
            html += `<label style="display:flex;align-items:center;padding:6px 8px;border-bottom:1px solid #f0f0f0;cursor:pointer;">
                <input type="checkbox" value="${p.id}" style="margin-right:8px;">
                <span>${p.name}</span>${subLabel}${catLabel}
                <span style="color:#888;font-size:12px;margin-left:8px;">${p.visit_duration || 0}分钟</span>
            </label>`;
        });
    });
    list.innerHTML = html;

    const modal = new bootstrap.Modal(document.getElementById('selectSubPoiModal'));
    modal.show();
}

export async function confirmSubPoiSelection() {
    const list = document.getElementById('sub-poi-select-list');
    if (!list) return;

    const checkboxes = list.querySelectorAll('input[type="checkbox"]');
    const selectedIds = [];
    checkboxes.forEach(cb => {
        if (cb.checked) selectedIds.push(cb.value);
    });

    if (selectedIds.length === 0) {
        bootstrap.Modal.getInstance(document.getElementById('selectSubPoiModal')).hide();
        return;
    }

    try {
        await Promise.all(selectedIds.map(id =>
            updatePoi(id, { parent_id: currentEditingPoiId })
        ));

        selectedIds.forEach(id => {
            const p = allPois.find(x => String(x.id) === String(id));
            if (p) p.parent_id = currentEditingPoiId;
        });

        bootstrap.Modal.getInstance(document.getElementById('selectSubPoiModal')).hide();
        renderSubPoiList();
        renderPoiList(allPois);
        alert(`已添加 ${selectedIds.length} 个子项`);
    } catch (e) {
        alert('添加失败：' + e.message);
        console.error(e);
    }
}

export async function removeSubPoi(subPoiId) {
    if (!confirm('确认将该子项从景区移出？（子项本身不会被删除）')) return;
    try {
        await updatePoi(subPoiId, { parent_id: null });
        const poi = allPois.find(p => String(p.id) === String(subPoiId));
        if (poi) poi.parent_id = null;

        currentTourRoute = currentTourRoute.filter(x => String(x.id) !== String(subPoiId));
        renderTourRoute();

        renderSubPoiList();
        renderPoiList(allPois);
    } catch (e) {
        alert('移出失败：' + e.message);
    }
}

// ============================================================
// 浏览路线规划
// ============================================================
function renderTourRoute() {
    const container = document.getElementById('tour-route-list');
    if (!container) return;

    if (currentTourRoute.length === 0) {
        container.innerHTML = '<p class="text-secondary small mb-0">暂无路线节点，点击"从子项加载"或手动添加。</p>';
        return;
    }

    let html = '';
    currentTourRoute.forEach((item, idx) => {
        let typeLabel = '';
        if (item.type === 'facility' && item.facility_subtype) {
            typeLabel = subtypesToText(item.facility_subtype);
        } else {
            typeLabel = (TYPE_LABELS[item.type] || item.type || '').replace(/^[^\s]+\s/, '');
        }
        html += `<div class="route-item">
            <span class="route-order">${idx + 1}</span>
            <span style="flex:1;">${item.name} <span class="text-secondary small">[${typeLabel}]</span></span>
            <button class="btn btn-sm btn-outline-secondary" onclick="window.moveTourRouteItem(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn btn-sm btn-outline-secondary" onclick="window.moveTourRouteItem(${idx}, 1)" ${idx === currentTourRoute.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn btn-sm btn-danger" onclick="window.removeTourRouteItem(${idx})">✕</button>
        </div>`;
    });
    container.innerHTML = html;
}

export function loadSubItemsForRoute() {
    if (!currentEditingPoiId) {
        alert('请先保存景区');
        return;
    }
    const subPois = allPois.filter(p => String(p.parent_id) === String(currentEditingPoiId));
    if (subPois.length === 0) {
        alert('该景区暂无子项');
        return;
    }

    const order = { core_node: 1, spot: 2, facility: 3 };
    const sorted = [...subPois].sort((a, b) => {
        const oa = order[a.type] || 9, ob = order[b.type] || 9;
        if (oa !== ob) return oa - ob;
        return (a.sort_order || 0) - (b.sort_order || 0);
    });

    currentTourRoute = sorted.map(p => ({
        id: p.id, name: p.name, type: p.type, facility_subtype: p.facility_subtype
    }));
    renderTourRoute();
}

export function addTourRouteItem() {
    if (!currentEditingPoiId) {
        alert('请先保存景区');
        return;
    }
    const subPois = allPois.filter(p => String(p.parent_id) === String(currentEditingPoiId));
    if (subPois.length === 0) {
        alert('该景区暂无子项');
        return;
    }

    let msg = '请选择要添加的子项（输入序号）：\n';
    subPois.forEach((p, i) => {
        const label = p.type === 'facility' && p.facility_subtype
            ? subtypesToText(p.facility_subtype)
            : (TYPE_LABELS[p.type] || '').replace(/^[^\s]+\s/, '');
        msg += `${i + 1}. ${p.name} [${label}]\n`;
    });
    const input = prompt(msg);
    if (!input) return;
    const idx = parseInt(input) - 1;
    if (idx < 0 || idx >= subPois.length) { alert('序号无效'); return; }

    const p = subPois[idx];
    currentTourRoute.push({ id: p.id, name: p.name, type: p.type, facility_subtype: p.facility_subtype });
    renderTourRoute();
}

export function moveTourRouteItem(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= currentTourRoute.length) return;
    [currentTourRoute[idx], currentTourRoute[newIdx]] = [currentTourRoute[newIdx], currentTourRoute[idx]];
    renderTourRoute();
}

export function removeTourRouteItem(idx) {
    currentTourRoute.splice(idx, 1);
    renderTourRoute();
}

// ============================================================
// 保存 POI
// ============================================================
export async function savePoiEdit() {
    const poiId = document.getElementById('edit-poi-id').value;
    const isNew = !poiId;
    const poiType = document.getElementById('edit-poi-type').value;

    const scenicIdRaw = document.getElementById('edit-poi-scenic').value;
    const scenicId = scenicIdRaw || null;

    let parentId = null;
    if (poiType !== 'scenic') {
        const parentRaw = document.getElementById('edit-poi-parent').value;
        if (parentRaw) parentId = parentRaw;
    }

    const updates = {
        name: document.getElementById('edit-poi-name').value.trim(),
        type: poiType,
        category: document.getElementById('edit-poi-category').value,   // ★ 所有类型都保存分类
        lat: parseFloat(document.getElementById('edit-poi-lat').value) || 0,
        lng: parseFloat(document.getElementById('edit-poi-lng').value) || 0,
        open_time: document.getElementById('edit-poi-open').value,
        close_time: document.getElementById('edit-poi-close').value,
        description: document.getElementById('edit-poi-desc').value,
        data_level: document.getElementById('edit-poi-level').value,
        scenic_id: scenicId,
        parent_id: parentId,
        status: 'active'
    };

    // 公共场所子类型
    if (poiType === 'facility') {
        const subtypes = getFacilitySubtypeCheckboxes();
        if (subtypes.length === 0) {
            alert('公共场所至少选择一种子类型');
            return;
        }
        updates.facility_subtype = subtypes;
    } else {
        updates.facility_subtype = null;
    }

    // 游览时长
    if (poiType === 'core_node' || poiType === 'spot') {
        updates.visit_duration = parseInt(document.getElementById('edit-poi-visit').value) || 0;
    } else {
        updates.visit_duration = 0;
    }

    // 经典标记
    updates.is_featured = (poiType === 'spot')
        ? document.getElementById('edit-poi-featured').checked
        : false;

    // 浏览路线
    if (poiType === 'scenic') {
        updates.tour_route = currentTourRoute.map(x => x.id);
    } else {
        updates.tour_route = null;
    }

    // 校验
    if (!updates.name) { alert('请输入名称'); return; }
    if ((poiType === 'core_node' || poiType === 'spot') && !parentId) {
        alert('核心节点/景点必须选择所属景区');
        return;
    }

    try {
        if (isNew) {
            await insertPoi(updates);
        } else {
            await updatePoi(poiId, updates);
        }

        alert(isNew ? '新增成功' : '保存成功');
        bootstrap.Modal.getInstance(document.getElementById('poiModal')).hide();
        await initAdminUI();
    } catch (e) {
        alert('保存失败：' + e.message);
        console.error(e);
    }
}

// ============================================================
// 删除 POI
// ============================================================
export async function deletePoi(id) {
    const poi = allPois.find(p => String(p.id) === String(id));
    if (!poi) return;

    const subPois = allPois.filter(p => String(p.parent_id) === String(id));

    let msg = '确认删除此POI？';
    if (subPois.length > 0) {
        msg = `该景区下有 ${subPois.length} 个子项，删除后子项将解除关联（不会删除），是否继续？`;
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
// 景区管理（ztj_scenic 表）
// ============================================================
export function renderScenicList(scenics) {
    const container = document.getElementById('scenic-list');
    if (!container) return;
    let html = '';
    for (let s of scenics) {
        const relatedPois = allPois.filter(p => String(p.scenic_id) === String(s.id));
        html += `<div class="poi-card">
            <div class="poi-header">
                <span><b>${s.name}</b> [${s.area || '未分区'}] <span class="text-secondary">(${relatedPois.length}个关联POI)</span></span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showEditScenicModal('${s.id}')"><i class="fas fa-edit"></i> 编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deleteScenic('${s.id}')"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>
        </div>`;
    }
    container.innerHTML = html || '<p>暂无景区</p>';
}

export function toggleScenicPois(scenicId) {
    const container = document.getElementById(`scenic-pois-${scenicId}`);
    if (container) container.classList.toggle('hidden');
}

export async function showEditScenicModal(id) {
    const s = allScenic.find(x => String(x.id) === String(id));
    if (!s) return;
    document.getElementById('edit-scenic-id').value = id;
    document.getElementById('edit-scenic-name').value = s.name || '';
    document.getElementById('edit-scenic-area').value = s.area || '';
    document.getElementById('edit-scenic-lat').value = s.lat || '';
    document.getElementById('edit-scenic-lng').value = s.lng || '';
    document.getElementById('edit-scenic-desc').value = s.description || '';
    new bootstrap.Modal(document.getElementById('scenicModal')).show();
}
export function showAddScenicModal() {
    document.getElementById('edit-scenic-id').value = '';
    document.getElementById('edit-scenic-name').value = '';
    document.getElementById('edit-scenic-area').value = '';
    document.getElementById('edit-scenic-lat').value = '';
    document.getElementById('edit-scenic-lng').value = '';
    document.getElementById('edit-scenic-desc').value = '';
    new bootstrap.Modal(document.getElementById('scenicModal')).show();
}
export async function saveScenicEdit() {
    const id = document.getElementById('edit-scenic-id').value;
    const data = {
        name: document.getElementById('edit-scenic-name').value.trim(),
        area: document.getElementById('edit-scenic-area').value.trim(),
        lat: parseFloat(document.getElementById('edit-scenic-lat').value) || 0,
        lng: parseFloat(document.getElementById('edit-scenic-lng').value) || 0,
        description: document.getElementById('edit-scenic-desc').value
    };
    try {
        if (id) await updateScenic(id, data);
        else await insertScenic(data);
        alert('保存成功');
        bootstrap.Modal.getInstance(document.getElementById('scenicModal')).hide();
        await initAdminUI();
    } catch (e) { alert('保存失败：' + e.message); }
}
export async function deleteScenic(id) {
    if (!confirm('确认删除此景区？')) return;
    try {
        const related = allPois.filter(p => String(p.scenic_id) === String(id));
        for (let p of related) {
            await updatePoi(p.id, { scenic_id: null });
        }
        await apiDeleteScenic(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
}

// ============================================================
// 路线管理
// ============================================================
export function renderRouteList(routes) {
    const container = document.getElementById('route-list');
    if (!container) return;
    container.innerHTML = routes.map(r => `
        <div class="poi-card">
            <div class="poi-header">
                <span><b>${r.name}</b> (${r.start_time || '未设'}) ${r.transport || ''}</span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showEditRouteModal('${r.id}')"><i class="fas fa-edit"></i> 编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deleteRoute('${r.id}')"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>
        </div>
    `).join('') || '<p>暂无路线</p>';
}

let routeNodesData = [];

export async function showEditRouteModal(id) {
    const r = allRoutes.find(x => String(x.id) === String(id));
    if (!r) return;
    document.getElementById('edit-route-id').value = id;
    document.getElementById('edit-route-name').value = r.name || '';
    document.getElementById('edit-route-time').value = r.start_time || '08:30';
    document.getElementById('edit-route-transport').value = r.transport || '';
    document.getElementById('edit-route-days').value = r.days || 1;

    document.getElementById('edit-route-nodes-container').innerHTML = '<p class="text-secondary">加载中...</p>';
    const modal = new bootstrap.Modal(document.getElementById('routeModal'));
    modal.show();

    try {
        const nodes = await getRouteNodes(id);
        routeNodesData = nodes.map(n => ({ poi_id: n.poi_id, duration_min: n.duration_min || 60 }));
        renderRouteNodesFields();
    } catch (e) {
        document.getElementById('edit-route-nodes-container').innerHTML = '<p class="text-danger">加载失败</p>';
    }
}
export function showAddRouteModal() {
    document.getElementById('edit-route-id').value = '';
    document.getElementById('edit-route-name').value = '';
    document.getElementById('edit-route-time').value = '08:30';
    document.getElementById('edit-route-transport').value = '';
    document.getElementById('edit-route-days').value = '1';
    routeNodesData = [];
    renderRouteNodesFields();
    new bootstrap.Modal(document.getElementById('routeModal')).show();
}
function renderRouteNodesFields() {
    const container = document.getElementById('edit-route-nodes-container');
    const opts = allPois.filter(p => p.type === 'scenic').map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    let html = '';
    routeNodesData.forEach((n, idx) => {
        html += `<div class="row g-1 align-items-center mb-1">
            <div class="col-5"><select class="form-select form-select-sm" onchange="window.updateRouteNode(${idx}, 'poi_id', this.value)">${opts}</select></div>
            <div class="col-3"><input type="number" class="form-control form-control-sm" placeholder="分钟" value="${n.duration_min||60}" onchange="window.updateRouteNode(${idx}, 'duration_min', this.value)"></div>
            <div class="col-2"><button class="btn btn-sm btn-danger" onclick="window.removeRouteNodeField(${idx})"><i class="fas fa-times"></i></button></div>
        </div>`;
    });
    container.innerHTML = html || '<p class="text-secondary">暂无节点</p>';
    document.querySelectorAll('#edit-route-nodes-container select').forEach((sel, i) => {
        if (routeNodesData[i] && routeNodesData[i].poi_id) sel.value = routeNodesData[i].poi_id;
    });
}
window.updateRouteNode = function(idx, field, val) {
    if (field === 'poi_id') routeNodesData[idx].poi_id = val;
    else routeNodesData[idx].duration_min = parseInt(val) || 60;
};
window.removeRouteNodeField = function(idx) {
    routeNodesData.splice(idx, 1);
    renderRouteNodesFields();
};
export function addRouteNodeField() {
    routeNodesData.push({ poi_id: '', duration_min: 60 });
    renderRouteNodesFields();
}
export async function saveRouteEdit() {
    const id = document.getElementById('edit-route-id').value;
    const data = {
        name: document.getElementById('edit-route-name').value.trim(),
        start_time: document.getElementById('edit-route-time').value,
        transport: document.getElementById('edit-route-transport').value,
        days: parseInt(document.getElementById('edit-route-days').value) || 1,
        group_type: 'default'
    };
    try {
        let routeId = id;
        if (id) { await updateRoute(id, data); } else { const r = await insertRoute(data); routeId = r.id; }
        await deleteRouteNodes(routeId);
        const nodes = routeNodesData.filter(n => n.poi_id).map((n, i) => ({
            route_id: routeId,
            poi_id: n.poi_id,
            order_num: i + 1,
            duration_min: n.duration_min || 60,
            transport_mode: '步行',
            transport_time: 0
        }));
        if (nodes.length > 0) await insertRouteNodes(nodes);
        alert('保存成功');
        bootstrap.Modal.getInstance(document.getElementById('routeModal')).hide();
        await initAdminUI();
    } catch (e) { alert('保存失败：' + e.message); }
}
export async function deleteRoute(id) {
    if (!confirm('确认删除？')) return;
    try { await apiDeleteRoute(id); await initAdminUI(); } catch (e) { alert('删除失败：' + e.message); }
}

// ============================================================
// 交通耗时（只显示景区）
// ============================================================
export function renderTransportEditor(presets) {
    const container = document.getElementById('transport-editor');
    if (!container) return;
    const poiList = allPois.filter(p => p.type === 'scenic');
    if (poiList.length === 0) { container.innerHTML = '<p>暂无景区数据</p>'; return; }

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
