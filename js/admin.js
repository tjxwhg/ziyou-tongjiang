// js/admin.js - 管理后台完整逻辑（4类型体系 + 浏览路线 + 子项管理）
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
let currentTourRoute = [];   // 浏览路线：[{id, name, type}]

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
// POI 类型辅助
// ============================================================
const TYPE_LABELS = {
    scenic: '🏞️ 景区',
    core_node: '⭐ 核心节点',
    spot: '📍 景点',
    facility: '🏢 公共场所'
};
const TYPE_CLASSES = {
    scenic: 'type-badge-scenic',
    core_node: 'type-badge-core',
    spot: 'type-badge-spot',
    facility: 'type-badge-facility'
};

function getTypeBadge(type) {
    const t = type || 'spot';
    return `<span class="type-badge ${TYPE_CLASSES[t] || 'type-badge-spot'}">${TYPE_LABELS[t] || t}</span>`;
}

// ============================================================
// POI 列表渲染
// ============================================================
export function renderPoiList(pois) {
    const container = document.getElementById('poi-list');
    if (!container) return;

    // 顶层 POI：parent_id 为空的 景区/景点/核心节点
    const topLevelPois = pois.filter(p => !p.parent_id);

    let html = '';
    for (let p of topLevelPois) {
        const level = p.data_level || 'L3';
        const scenic = allScenic.find(s => s.id === p.scenic_id);
        const scenicName = scenic ? `[${scenic.name}]` : '';
        const poiType = p.type || 'spot';
        const typeBadge = getTypeBadge(poiType);

        // 子项列表
        const subItems = pois.filter(x => x.parent_id === p.id);
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
                <span>${typeBadge} <b>${p.name}</b>${featuredTag} ${scenicName} [${p.category || '未分类'}] <span class="data-quality-badge quality-${level}">${level}</span>${subInfo}</span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showEditPoiModal('${p.id}')"><i class="fas fa-edit"></i> 编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deletePoi('${p.id}')"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>`;

        // 景区：显示子项列表
        if (subItems.length > 0) {
            html += `<div class="node-list mt-2">`;
            subItems.forEach(sub => {
                const subType = sub.type || 'spot';
                const subBadge = getTypeBadge(subType);
                html += `<div class="sub-poi-item">
                    <span>${subBadge} ${sub.name} <span class="text-secondary small">(${sub.visit_duration || 0}分钟)</span></span>
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

    // 下拉列表
    const scenicSelect = document.getElementById('edit-poi-scenic');
    scenicSelect.innerHTML = '<option value="">无关联</option>';
    allScenic.forEach(s => {
        scenicSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });

    // 所属景区下拉（parent_id）
    const parentSelect = document.getElementById('edit-poi-parent');
    parentSelect.innerHTML = '<option value="">-- 请选择 --</option>';
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
    const idNum = Number(poiId);
    const poi = allPois.find(p => p.id === idNum);
    if (!poi) {
        console.warn('POI 未找到:', poiId);
        return;
    }
    currentEditingPoiId = poiId;

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

    // scenic 表关联
    const scenicSelect = document.getElementById('edit-poi-scenic');
    scenicSelect.innerHTML = '<option value="">无关联</option>';
    allScenic.forEach(s => {
        scenicSelect.innerHTML += `<option value="${s.id}" ${poi.scenic_id === s.id ? 'selected' : ''}>${s.name}</option>`;
    });

    // 所属景区下拉（parent_id）
    const parentSelect = document.getElementById('edit-poi-parent');
    parentSelect.innerHTML = '<option value="">-- 请选择 --</option>';
    allPois.filter(p => p.type === 'scenic' && !p.parent_id && p.id !== Number(poiId)).forEach(p => {
        parentSelect.innerHTML += `<option value="${p.id}" ${poi.parent_id === p.id ? 'selected' : ''}>${p.name}</option>`;
    });

    // 浏览路线
    currentTourRoute = [];
    if (poi.tour_route && Array.isArray(poi.tour_route)) {
        poi.tour_route.forEach(id => {
            const sub = allPois.find(x => x.id === Number(id));
            if (sub) currentTourRoute.push({ id: sub.id, name: sub.name, type: sub.type });
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
// 根据类型切换字段显示
// ============================================================
export function togglePoiTypeUI() {
    const type = document.getElementById('edit-poi-type').value;

    // 字段显示控制
    const fieldCategory = document.getElementById('field-category');
    const fieldParent = document.getElementById('field-parent');
    const fieldDuration = document.getElementById('field-duration');
    const fieldFeatured = document.getElementById('field-featured');
    const subSection = document.getElementById('sub-poi-section');
    const routeSection = document.getElementById('tour-route-section');

    if (type === 'scenic') {
        fieldCategory.classList.remove('hidden');
        fieldParent.classList.add('hidden');
        fieldDuration.classList.add('hidden');
        fieldFeatured.classList.add('hidden');
        subSection.classList.remove('hidden');
        routeSection.classList.remove('hidden');
    } else if (type === 'core_node') {
        fieldCategory.classList.add('hidden');
        fieldParent.classList.remove('hidden');
        fieldDuration.classList.remove('hidden');
        fieldFeatured.classList.add('hidden');
        subSection.classList.add('hidden');
        routeSection.classList.add('hidden');
    } else if (type === 'spot') {
        fieldCategory.classList.add('hidden');
        fieldParent.classList.remove('hidden');
        fieldDuration.classList.remove('hidden');
        fieldFeatured.classList.remove('hidden');
        subSection.classList.add('hidden');
        routeSection.classList.add('hidden');
    } else if (type === 'facility') {
        fieldCategory.classList.add('hidden');
        fieldParent.classList.remove('hidden');
        fieldDuration.classList.add('hidden');
        fieldFeatured.classList.add('hidden');
        subSection.classList.add('hidden');
        routeSection.classList.add('hidden');
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

    const subPois = allPois.filter(p => p.parent_id === Number(currentEditingPoiId));
    currentSubPoiIds = subPois.map(p => p.id);

    if (subPois.length === 0) {
        container.innerHTML = '<p class="text-secondary small mb-0">暂无子项，点击上方按钮添加。</p>';
        return;
    }

    // 按类型分组排序：核心节点 → 景点 → 公共场所
    const order = { core_node: 1, spot: 2, facility: 3 };
    const sorted = [...subPois].sort((a, b) => (order[a.type] || 9) - (order[b.type] || 9));

    let html = '';
    sorted.forEach(sub => {
        const subType = sub.type || 'spot';
        const subBadge = getTypeBadge(subType);
        const featuredTag = sub.is_featured ? ' <span class="featured-badge">⭐</span>' : '';
        html += `<div class="sub-poi-item">
            <span>${subBadge} ${sub.name}${featuredTag} <span class="text-secondary small">(${sub.visit_duration || 0}分钟)</span></span>
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

    // 候选：所有未归属任何景区的 POI（parent_id 为空），排除自身和景区类型
    const candidates = allPois.filter(p =>
        p.id !== Number(currentEditingPoiId) &&
        !p.parent_id &&
        p.type !== 'scenic'
    );

    if (candidates.length === 0) {
        list.innerHTML = '<p class="text-secondary">没有可添加的独立 POI</p>';
        return;
    }

    // 按类型分组
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
            html += `<label style="display:flex;align-items:center;padding:6px 8px;border-bottom:1px solid #f0f0f0;cursor:pointer;">
                <input type="checkbox" value="${p.id}" style="margin-right:8px;">
                <span>${p.name}</span>
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
        if (cb.checked) selectedIds.push(Number(cb.value));
    });

    if (selectedIds.length === 0) {
        bootstrap.Modal.getInstance(document.getElementById('selectSubPoiModal')).hide();
        return;
    }

    try {
        await Promise.all(selectedIds.map(id =>
            updatePoi(id, { parent_id: Number(currentEditingPoiId) })
        ));

        // 本地更新
        selectedIds.forEach(id => {
            const p = allPois.find(x => x.id === id);
            if (p) p.parent_id = Number(currentEditingPoiId);
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
        const poi = allPois.find(p => p.id === Number(subPoiId));
        if (poi) poi.parent_id = null;

        // 从浏览路线中也移除
        currentTourRoute = currentTourRoute.filter(x => x.id !== Number(subPoiId));
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
        const typeLabel = (TYPE_LABELS[item.type] || item.type || '').replace(/^[^\s]+\s/, '');
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
    const subPois = allPois.filter(p => p.parent_id === Number(currentEditingPoiId));
    if (subPois.length === 0) {
        alert('该景区暂无子项');
        return;
    }

    // 按类型排序：核心节点→景点→公共场所，再按 sort_order
    const order = { core_node: 1, spot: 2, facility: 3 };
    const sorted = [...subPois].sort((a, b) => {
        const oa = order[a.type] || 9, ob = order[b.type] || 9;
        if (oa !== ob) return oa - ob;
        return (a.sort_order || 0) - (b.sort_order || 0);
    });

    currentTourRoute = sorted.map(p => ({ id: p.id, name: p.name, type: p.type }));
    renderTourRoute();
}

export function addTourRouteItem() {
    if (!currentEditingPoiId) {
        alert('请先保存景区');
        return;
    }
    const subPois = allPois.filter(p => p.parent_id === Number(currentEditingPoiId));
    if (subPois.length === 0) {
        alert('该景区暂无子项');
        return;
    }

    // 简单选择器：用 prompt 让用户输入序号（临时方案）
    let msg = '请选择要添加的子项（输入序号）：\n';
    subPois.forEach((p, i) => {
        msg += `${i + 1}. ${p.name} [${(TYPE_LABELS[p.type] || '').replace(/^[^\s]+\s/, '')}]\n`;
    });
    const input = prompt(msg);
    if (!input) return;
    const idx = parseInt(input) - 1;
    if (idx < 0 || idx >= subPois.length) { alert('序号无效'); return; }

    const p = subPois[idx];
    currentTourRoute.push({ id: p.id, name: p.name, type: p.type });
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

    // 处理 scenic_id
    const scenicIdRaw = document.getElementById('edit-poi-scenic').value;
    const scenicId = scenicIdRaw ? parseInt(scenicIdRaw) : null;

    // 处理 parent_id
    let parentId = null;
    if (poiType !== 'scenic') {
        const parentRaw = document.getElementById('edit-poi-parent').value;
        if (parentRaw) parentId = parseInt(parentRaw);
    }

    const updates = {
        name: document.getElementById('edit-poi-name').value.trim(),
        type: poiType,
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

    // 分类：景区自己设置，其他继承或默认
    if (poiType === 'scenic') {
        updates.category = document.getElementById('edit-poi-category').value;
    } else {
        // 从父景区继承分类
        if (parentId) {
            const parent = allPois.find(p => p.id === parentId);
            updates.category = parent ? (parent.category || '自然景区') : '自然景区';
        } else {
            updates.category = '自然景区';
        }
    }

    // 游览时长：核心节点/景点设置
    if (poiType === 'core_node' || poiType === 'spot') {
        updates.visit_duration = parseInt(document.getElementById('edit-poi-visit').value) || 0;
    } else {
        updates.visit_duration = 0;
    }

    // 经典标记
    updates.is_featured = (poiType === 'spot')
        ? document.getElementById('edit-poi-featured').checked
        : false;

    // 浏览路线（仅景区）
    if (poiType === 'scenic') {
        updates.tour_route = currentTourRoute.map(x => x.id);
    } else {
        updates.tour_route = null;
    }

    if (!updates.name) { alert('请输入名称'); return; }
    if (poiType !== 'scenic' && !parentId) { alert('请选择所属景区'); return; }

    try {
        let savedPoiId = poiId;

        if (isNew) {
            const result = await insertPoi(updates);
            savedPoiId = result.id;
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
    const poi = allPois.find(p => p.id === Number(id));
    if (!poi) return;

    const subPois = allPois.filter(p => p.parent_id === Number(id));

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
// 景区管理（ztj_scenic 表，保留原逻辑）
// ============================================================
export function renderScenicList(scenics) {
    const container = document.getElementById('scenic-list');
    if (!container) return;
    let html = '';
    for (let s of scenics) {
        const relatedPois = allPois.filter(p => p.scenic_id === s.id);
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
    const s = allScenic.find(x => x.id === id);
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
        const related = allPois.filter(p => p.scenic_id === id);
        for (let p of related) {
            await updatePoi(p.id, { scenic_id: null });
        }
        await apiDeleteScenic(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
}

// ============================================================
// 路线管理（保留原逻辑）
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
    const idNum = Number(id);
    const r = allRoutes.find(x => x.id === idNum);
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
    // 只显示景区类型 POI
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
            route_id: parseInt(routeId),
            poi_id: parseInt(n.poi_id),
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
    // 只显示景区类型 POI
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
            if (fromPoi.id === toPoi.id) return;
            let val = presets.find(p => p.from_poi_id == fromPoi.id && p.to_poi_id == toPoi.id)?.time_min;
            if (val === undefined) val = presets.find(p => p.from_poi_id == toPoi.id && p.to_poi_id == fromPoi.id)?.time_min;
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
    const from = parseInt(input.dataset.from);
    const to = parseInt(input.dataset.to);
    const val = parseInt(input.value);
    if (isNaN(val) || val < 0) return;
    try {
        await upsertTransportPreset(from, to, val);
        const presets = await getTransportPresets();
        const reverseExists = presets.some(p => p.from_poi_id === to && p.to_poi_id === from);
        if (!reverseExists) {
            await upsertTransportPreset(to, from, val);
        }
        document.querySelectorAll('#transport-editor input[type="number"]').forEach(inp => {
            const f = parseInt(inp.dataset.from);
            const t = parseInt(inp.dataset.to);
            if (f === to && t === from && inp.value === '') inp.value = val;
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
