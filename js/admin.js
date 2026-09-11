// js/admin.js - 管理后台完整逻辑（支持景区/景点类型 + 子景点管理）
import {
    getPois, getPoi, insertPoi, updatePoi, deletePoi as apiDeletePoi,
    getScenicList, insertScenic, updateScenic, deleteScenic as apiDeleteScenic,
    getRoutes, getRoute, insertRoute, updateRoute, deleteRoute as apiDeleteRoute,
    getRouteNodes, insertRouteNodes, deleteRouteNodes,
    getTransportPresets, upsertTransportPreset,
    getMerchantsByPoi, getMerchant, updateMerchant, createMerchantRecord,
    getReservations, updateReservation,
    getFeedbacks, updateFeedback, deleteFeedback as apiDeleteFeedback,
    uploadFile, getPoiInternal, insertInternalNode, insertInternalEdge,
    deleteInternalNodes, deleteInternalEdges
} from './api.js';

let allPois = [], allScenic = [], allRoutes = [], allPresets = [], allMerchants = [], allFeedbacks = [];
let currentPoiNodes = {};
let currentEditingPoiId = null;
let currentSubPoiIds = [];   // 当前编辑POI的子景点ID列表

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
// POI 管理
// ============================================================
export function renderPoiList(pois) {
    const container = document.getElementById('poi-list');
    if (!container) return;

    // 主列表只显示 parent_id 为空的 POI（独立景点和景区）
    const topLevelPois = pois.filter(p => !p.parent_id);

    let html = '';
    for (let p of topLevelPois) {
        const level = p.data_level || 'L3';
        const scenic = allScenic.find(s => s.id === p.scenic_id);
        const scenicName = scenic ? `[${scenic.name}]` : '';
        const poiType = p.type || 'spot';

        // 子景点数量
        const subPois = pois.filter(x => x.parent_id === p.id);
        const subPoiCount = subPois.length;

        // 类型徽章
        const typeBadge = poiType === 'scenic'
            ? `<span class="type-badge-scenic"><i class="fas fa-mountain"></i> 景区</span>`
            : `<span class="type-badge-spot"><i class="fas fa-map-pin"></i> 景点</span>`;

        html += `<div class="poi-card" id="poi-card-${p.id}">
            <div class="poi-header">
                <span>${typeBadge} <b>${p.name}</b> ${scenicName} [${p.category || '未分类'}] <span class="data-quality-badge quality-${level}">${level}</span>${subPoiCount > 0 ? ` <span class="text-secondary">(${subPoiCount}个子景点)</span>` : ''}</span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showEditPoiModal('${p.id}')"><i class="fas fa-edit"></i> 编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deletePoi('${p.id}')"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>
            ${subPoiCount > 0 ? `
                <div class="node-list mt-2" id="poi-nodes-${p.id}">
                    ${subPois.map(sub => `
                        <div class="sub-poi-item">
                            <span>📌 ${sub.name} <span class="text-secondary small">(${sub.visit_duration || 0}分钟)</span></span>
                            <button class="btn btn-sm btn-outline-secondary" onclick="window.showEditPoiModal('${sub.id}')"><i class="fas fa-edit"></i></button>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            <button class="btn btn-sm btn-outline-secondary mt-1" onclick="window.togglePoiNodes('${p.id}')"><i class="fas fa-sitemap"></i> 显示内部点位</button>
            <div id="internal-nodes-${p.id}" class="hidden"></div>
        </div>`;
    }
    container.innerHTML = html || '<p>暂无POI</p>';
}

// 展开内部点位（入口/休息区/洗手间等）
export async function togglePoiNodes(poiId) {
    const container = document.getElementById(`internal-nodes-${poiId}`);
    if (!container) return;
    if (!container.classList.contains('hidden')) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');
    container.innerHTML = '<p class="text-secondary">加载中...</p>';
    const data = await getPoiInternal(poiId);
    const nodes = data.nodes || [];
    if (nodes.length === 0) {
        container.innerHTML = '<p class="text-secondary small mb-0">暂无内部点位</p>';
        return;
    }
    let html = '<div class="node-list mt-1">';
    nodes.forEach(n => {
        const typeLabel = { 'core_view': '核心景点', 'entrance': '入口', 'exit': '出口', 'rest_area': '休息区', 'wc': '洗手间', 'food': '餐饮', 'other': '其他' }[n.node_type] || n.node_type;
        html += `<div class="node-item">
            <span><span class="badge bg-secondary">${typeLabel}</span> ${n.node_name} (${n.suggested_duration_min}-${n.suggested_duration_max}分钟)</span>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
}

// ============================================================
// 新增/编辑 POI
// ============================================================
export function showAddPoiModal() {
    currentEditingPoiId = null;
    currentSubPoiIds = [];
    document.getElementById('edit-poi-id').value = '';
    document.getElementById('edit-poi-name').value = '';
    document.getElementById('edit-poi-type').value = 'spot';   // 默认景点
    document.getElementById('edit-poi-category').value = '自然景区';
    document.getElementById('edit-poi-lat').value = '';
    document.getElementById('edit-poi-lng').value = '';
    document.getElementById('edit-poi-open').value = '08:00';
    document.getElementById('edit-poi-close').value = '18:00';
    document.getElementById('edit-poi-visit').value = '';
    document.getElementById('edit-poi-desc').value = '';
    document.getElementById('edit-poi-level').value = 'L3';
    const scenicSelect = document.getElementById('edit-poi-scenic');
    scenicSelect.innerHTML = '<option value="">无关联景区</option>';
    allScenic.forEach(s => {
        scenicSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });
    document.getElementById('poiModalTitle').textContent = '新增POI';
    currentPoiNodes['new'] = [];
    renderNodesFields('new');
    togglePoiTypeUI();   // 根据类型显示/隐藏子景点区域

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
    const scenicSelect = document.getElementById('edit-poi-scenic');
    scenicSelect.innerHTML = '<option value="">无关联景区</option>';
    allScenic.forEach(s => {
        scenicSelect.innerHTML += `<option value="${s.id}" ${poi.scenic_id === s.id ? 'selected' : ''}>${s.name}</option>`;
    });
    document.getElementById('poiModalTitle').textContent = `编辑POI - ${poi.name}`;

    // 加载内部点位
    document.getElementById('edit-nodes-container').innerHTML = '<p class="text-secondary">加载中...</p>';

    // 根据类型显示/隐藏子景点区域，并渲染子景点
    togglePoiTypeUI();

    const modal = new bootstrap.Modal(document.getElementById('poiModal'));
    modal.show();

    // 异步加载内部点位
    try {
        const data = await getPoiInternal(poiId);
        const nodes = data.nodes || [];
        currentPoiNodes[poiId] = nodes;
        renderNodesFields(poiId);
    } catch (e) {
        console.warn('加载内部点位失败:', e);
        document.getElementById('edit-nodes-container').innerHTML = '<p class="text-danger">加载失败</p>';
    }
}

// ★ 切换类型时更新界面显示
export function togglePoiTypeUI() {
    const type = document.getElementById('edit-poi-type').value;
    const subSection = document.getElementById('sub-poi-section');

    if (type === 'scenic') {
        subSection.classList.remove('hidden');
        renderSubPoiList();
    } else {
        subSection.classList.add('hidden');
    }
}

// ★ 渲染当前编辑POI的子景点列表
function renderSubPoiList() {
    const container = document.getElementById('sub-poi-list');
    if (!container) return;

    // 新增模式还没保存，无法绑定子景点
    if (!currentEditingPoiId) {
        container.innerHTML = '<p class="text-secondary small mb-0">请先保存POI，再次编辑时即可添加子景点。</p>';
        return;
    }

    const subPois = allPois.filter(p => p.parent_id === Number(currentEditingPoiId));
    currentSubPoiIds = subPois.map(p => p.id);

    if (subPois.length === 0) {
        container.innerHTML = '<p class="text-secondary small mb-0">暂无子景点，点击上方按钮添加。</p>';
        return;
    }

    let html = '';
    subPois.forEach(sub => {
        html += `<div class="sub-poi-item">
            <span>📌 ${sub.name} <span class="text-secondary small">[${sub.category || '未分类'}] ${sub.visit_duration || 0}分钟</span></span>
            <div>
                <button class="btn btn-sm btn-outline-secondary me-1" onclick="window.showEditPoiModal('${sub.id}')"><i class="fas fa-edit"></i> 编辑</button>
                <button class="btn btn-sm btn-danger" onclick="window.removeSubPoi('${sub.id}')"><i class="fas fa-unlink"></i> 移出</button>
            </div>
        </div>`;
    });
    container.innerHTML = html;
}

// ★ 打开子景点选择弹窗
export function showSelectSubPoiModal() {
    if (!currentEditingPoiId) {
        alert('请先保存POI后再添加子景点');
        return;
    }

    const list = document.getElementById('sub-poi-select-list');
    if (!list) return;

    // 候选：所有 type='spot' 且 (parent_id 为空 或 parent_id === 当前ID) 的 POI
    // 排除当前编辑的 POI 自身
    const candidates = allPois.filter(p =>
        (p.type === 'spot' || !p.type) &&
        p.id !== Number(currentEditingPoiId) &&
        (p.parent_id === null || p.parent_id === undefined || p.parent_id === Number(currentEditingPoiId))
    );

    if (candidates.length === 0) {
        list.innerHTML = '<p class="text-secondary">没有可添加的景点POI</p>';
        return;
    }

    // 按分类分组
    const grouped = {};
    candidates.forEach(p => {
        const cat = p.category || '未分类';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(p);
    });

    let html = '';
    Object.keys(grouped).forEach(cat => {
        html += `<div style="margin-bottom:8px;"><b style="color:#1b5e20;">📁 ${cat}</b></div>`;
        grouped[cat].forEach(p => {
            const checked = p.parent_id === Number(currentEditingPoiId) ? 'checked' : '';
            html += `<label style="display:flex;align-items:center;padding:6px 8px;border-bottom:1px solid #f0f0f0;cursor:pointer;">
                <input type="checkbox" value="${p.id}" ${checked} style="margin-right:8px;">
                <span>${p.name}</span>
                <span style="color:#888;font-size:12px;margin-left:8px;">${p.visit_duration || 0}分钟</span>
            </label>`;
        });
    });
    list.innerHTML = html;

    const modal = new bootstrap.Modal(document.getElementById('selectSubPoiModal'));
    modal.show();
}

// ★ 确认子景点选择（对比差异，更新 parent_id）
export async function confirmSubPoiSelection() {
    const list = document.getElementById('sub-poi-select-list');
    if (!list) return;

    const checkboxes = list.querySelectorAll('input[type="checkbox"]');
    const selectedIds = new Set();
    checkboxes.forEach(cb => {
        if (cb.checked) selectedIds.add(Number(cb.value));
    });

    const currentParentId = Number(currentEditingPoiId);

    // 找出需要添加的（选中但 parent_id 不是当前ID）
    const toAdd = allPois.filter(p => selectedIds.has(p.id) && p.parent_id !== currentParentId);
    // 找出需要移除的（未选中但 parent_id 是当前ID）
    const toRemove = allPois.filter(p => p.parent_id === currentParentId && !selectedIds.has(p.id));

    if (toAdd.length === 0 && toRemove.length === 0) {
        // 没有变化
        bootstrap.Modal.getInstance(document.getElementById('selectSubPoiModal')).hide();
        return;
    }

    try {
        // 并行更新
        const updates = [
            ...toAdd.map(p => updatePoi(p.id, { parent_id: currentParentId, type: 'spot' })),
            ...toRemove.map(p => updatePoi(p.id, { parent_id: null }))
        ];
        await Promise.all(updates);

        // 本地更新 allPois
        toAdd.forEach(p => { p.parent_id = currentParentId; p.type = 'spot'; });
        toRemove.forEach(p => { p.parent_id = null; });

        bootstrap.Modal.getInstance(document.getElementById('selectSubPoiModal')).hide();
        renderSubPoiList();
        renderPoiList(allPois);
        alert('子景点已更新');
    } catch (e) {
        alert('更新失败：' + e.message);
        console.error(e);
    }
}

// ★ 移除子景点（解除 parent_id 关联）
export async function removeSubPoi(subPoiId) {
    if (!confirm('确认将该景点从当前景区移出？')) return;
    try {
        await updatePoi(subPoiId, { parent_id: null });
        const poi = allPois.find(p => p.id === Number(subPoiId));
        if (poi) poi.parent_id = null;
        renderSubPoiList();
        renderPoiList(allPois);
    } catch (e) {
        alert('移出失败：' + e.message);
    }
}

// ============================================================
// 内部点位编辑（入口/休息区/洗手间等）
// ============================================================
export function renderNodesFields(poiId) {
    const container = document.getElementById('edit-nodes-container');
    const nodes = currentPoiNodes[poiId] || currentPoiNodes['new'] || [];
    let html = '';
    nodes.forEach((n, idx) => {
        const typeLabel = { 'core_view': '核心景点', 'entrance': '入口', 'exit': '出口', 'rest_area': '休息区', 'wc': '洗手间', 'food': '餐饮', 'other': '其他' }[n.node_type] || n.node_type;
        html += `<div class="node-item" data-idx="${idx}">
            <span><span class="badge bg-secondary">${typeLabel}</span> ${n.node_name || '未命名'}</span>
            <div>
                <span class="text-secondary">${n.suggested_duration_min || 0}-${n.suggested_duration_max || 0}分钟</span>
                <button class="btn btn-sm btn-danger" onclick="window.removeNodeField(${idx})"><i class="fas fa-times"></i></button>
            </div>
        </div>`;
    });
    container.innerHTML = html || '<p class="text-secondary">暂无内部点位</p>';
}

export function addNodeField() {
    const poiId = document.getElementById('edit-poi-id').value || 'new';
    if (!currentPoiNodes[poiId]) currentPoiNodes[poiId] = [];
    const name = prompt('点位名称：');
    if (!name) return;
    const type = prompt('类型 (core_view/entrance/exit/rest_area/wc/food/other)：', 'core_view');
    const durMin = parseInt(prompt('最短停留分钟：', '15')) || 15;
    const durMax = parseInt(prompt('最长停留分钟：', '30')) || 30;
    currentPoiNodes[poiId].push({
        node_name: name,
        node_type: type || 'other',
        suggested_duration_min: durMin,
        suggested_duration_max: durMax
    });
    renderNodesFields(poiId);
}

export function removeNodeField(idx) {
    const poiId = document.getElementById('edit-poi-id').value || 'new';
    if (!poiId || !currentPoiNodes[poiId]) return;
    if (!confirm('删除此点位？')) return;
    currentPoiNodes[poiId].splice(idx, 1);
    renderNodesFields(poiId);
}

// ============================================================
// 保存 POI（含类型、子景点处理）
// ============================================================
export async function savePoiEdit() {
    const poiId = document.getElementById('edit-poi-id').value;
    const isNew = !poiId;
    const scenicId = document.getElementById('edit-poi-scenic').value || null;
    const poiType = document.getElementById('edit-poi-type').value;

    const updates = {
        name: document.getElementById('edit-poi-name').value.trim(),
        type: poiType,
        category: document.getElementById('edit-poi-category').value,
        lat: parseFloat(document.getElementById('edit-poi-lat').value) || 0,
        lng: parseFloat(document.getElementById('edit-poi-lng').value) || 0,
        open_time: document.getElementById('edit-poi-open').value,
        close_time: document.getElementById('edit-poi-close').value,
        visit_duration: parseInt(document.getElementById('edit-poi-visit').value) || 0,
        description: document.getElementById('edit-poi-desc').value,
        data_level: document.getElementById('edit-poi-level').value,
        scenic_id: scenicId,
        status: 'active'
    };

    try {
        let savedPoiId = poiId;

        if (isNew) {
            const result = await insertPoi(updates);
            savedPoiId = result.id;
        } else {
            // ★ 从景区切换为景点，需要解除所有子景点关联
            const oldPoi = allPois.find(p => p.id === Number(poiId));
            if (oldPoi && oldPoi.type === 'scenic' && poiType === 'spot') {
                const subPois = allPois.filter(p => p.parent_id === Number(poiId));
                if (subPois.length > 0) {
                    if (!confirm(`该景区下有 ${subPois.length} 个子景点，切换为"景点"后将解除它们的关联，是否继续？`)) {
                        return;
                    }
                    await Promise.all(subPois.map(p => updatePoi(p.id, { parent_id: null })));
                    subPois.forEach(p => { p.parent_id = null; });
                }
            }
            await updatePoi(poiId, updates);
        }

        // 处理内部点位
        const nodes = currentPoiNodes[poiId] || currentPoiNodes['new'] || [];
        if (savedPoiId) {
            await deleteInternalNodes(savedPoiId);
            for (let n of nodes) {
                try {
                    await insertInternalNode({ ...n, poi_id: savedPoiId });
                } catch (insertErr) {
                    if (insertErr.code === '42501') {
                        alert('插入内部点位失败：行级安全策略(RLS)限制。请在 Supabase 中为 "poi_internal_nodes" 表启用允许认证用户插入的策略。');
                    } else {
                        throw insertErr;
                    }
                    return;
                }
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

// ============================================================
// 删除 POI（含子景点处理）
// ============================================================
export async function deletePoi(id) {
    const poi = allPois.find(p => p.id === Number(id));
    const subPois = allPois.filter(p => p.parent_id === Number(id));

    let msg = '确认删除此POI及其所有内部点位？';
    if (subPois.length > 0) {
        msg = `该景区下有 ${subPois.length} 个子景点，删除后将解除它们的关联（子景点本身不会被删除）。是否继续？`;
    }
    if (!confirm(msg)) return;

    try {
        // 先解除子景点关联
        if (subPois.length > 0) {
            await Promise.all(subPois.map(p => updatePoi(p.id, { parent_id: null })));
        }
        await deleteInternalNodes(id);
        await apiDeletePoi(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
}

// ============================================================
// 景区管理（ztj_scenic 表，与 POI 的 type='scenic' 是不同概念）
// ============================================================
export function renderScenicList(scenics) {
    const container = document.getElementById('scenic-list');
    if (!container) return;
    let html = '';
    for (let s of scenics) {
        const relatedPois = allPois.filter(p => p.scenic_id === s.id);
        html += `<div class="poi-card" id="scenic-card-${s.id}">
            <div class="poi-header">
                <span><b>${s.name}</b> [${s.area || '未分区'}] <span class="text-secondary">(${relatedPois.length}个关联POI)</span></span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showEditScenicModal('${s.id}')"><i class="fas fa-edit"></i> 编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deleteScenic('${s.id}')"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>
            <div id="scenic-pois-${s.id}" class="hidden mt-2">
                <div class="d-flex gap-2 mb-1">
                    <span class="fw-bold">关联POI：</span>
                    <button class="btn btn-sm btn-outline-success" onclick="window.showAddPoiToScenic('${s.id}')"><i class="fas fa-plus"></i> 添加POI</button>
                </div>
                ${relatedPois.length > 0 ? relatedPois.map(p => `
                    <div class="node-item">
                        <span>${p.name} [${p.category || '未分类'}]</span>
                        <button class="btn btn-sm btn-danger" onclick="window.removePoiFromScenic('${p.id}', '${s.id}')"><i class="fas fa-times"></i> 移除</button>
                    </div>
                `).join('') : '<p class="text-secondary">暂无关联POI</p>'}
            </div>
            <button class="btn btn-sm btn-outline-secondary mt-1" onclick="window.toggleScenicPois('${s.id}')"><i class="fas fa-list"></i> 显示关联POI</button>
        </div>`;
    }
    container.innerHTML = html || '<p>暂无景区</p>';
}

export function toggleScenicPois(scenicId) {
    const container = document.getElementById(`scenic-pois-${scenicId}`);
    if (container) container.classList.toggle('hidden');
}

export function showAddPoiToScenic(scenicId) {
    const unassignedPois = allPois.filter(p => !p.scenic_id && !p.parent_id);
    if (unassignedPois.length === 0) {
        alert('没有未关联的POI可添加');
        return;
    }
    const options = unassignedPois.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    const html = `
        <div class="modal fade" id="addPoiToScenicModal" tabindex="-1">
            <div class="modal-dialog"><div class="modal-content">
                <div class="modal-header"><h5>添加POI到景区</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                <div class="modal-body">
                    <select id="add-poi-select" class="form-select">${options}</select>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
                    <button class="btn btn-success" onclick="window.confirmAddPoiToScenic('${scenicId}')">添加</button>
                </div>
            </div></div>
        </div>
    `;
    const old = document.getElementById('addPoiToScenicModal');
    if (old) old.remove();
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);
    const modal = new bootstrap.Modal(document.getElementById('addPoiToScenicModal'));
    modal.show();
}

export async function confirmAddPoiToScenic(scenicId) {
    const poiId = document.getElementById('add-poi-select').value;
    if (!poiId) return;
    try {
        await updatePoi(poiId, { scenic_id: scenicId });
        document.getElementById('addPoiToScenicModal').querySelector('.btn-close').click();
        await initAdminUI();
    } catch (e) { alert('添加失败：' + e.message); }
}

export async function removePoiFromScenic(poiId, scenicId) {
    if (!confirm('确认从景区移除该POI？')) return;
    try {
        await updatePoi(poiId, { scenic_id: null });
        await initAdminUI();
    } catch (e) { alert('移除失败：' + e.message); }
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
    if (!confirm('确认删除此景区？关联的POI将解除关联')) return;
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
    const idNum = Number(id);
    const r = allRoutes.find(x => x.id === idNum);
    if (!r) {
        console.warn('路线未找到:', id);
        return;
    }
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
        console.warn('加载路线节点失败:', e);
        document.getElementById('edit-route-nodes-container').innerHTML = '<p class="text-danger">节点加载失败</p>';
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
    // 只显示主景点（不含子景点）可选
    const opts = allPois.filter(p => !p.parent_id).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
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
// 交通耗时
// ============================================================
export function renderTransportEditor(presets) {
    const container = document.getElementById('transport-editor');
    if (!container) return;
    // 只显示主景点（不含子景点）
    const poiList = allPois.filter(p => !p.parent_id);
    if (poiList.length === 0) { container.innerHTML = '<p>暂无POI数据</p>'; return; }

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
            html += `<div class="transport-item d-flex justify-content-between align-items-center py-1 border-bottom">
                <span>→ ${toPoi.name}</span>
                <div>
                    <input type="number" class="form-control form-control-sm" style="width:80px;display:inline-block;" 
                           value="${displayVal}" placeholder="分钟" 
                           data-from="${fromPoi.id}" data-to="${toPoi.id}" 
                           style="${isEstimate ? 'background:#fff3cd;' : ''}" 
                           onchange="window.saveTransportTime(this)">
                    <span class="save-status ms-1" style="font-size:12px;color:#2e7d32;"></span>
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
        const allInputs = document.querySelectorAll('#transport-editor input[type="number"]');
        allInputs.forEach(inp => {
            const f = parseInt(inp.dataset.from);
            const t = parseInt(inp.dataset.to);
            if (f === to && t === from && inp.value === '') {
                inp.value = val;
            }
        });
        const status = input.parentElement.querySelector('.save-status');
        if (status) {
            status.textContent = '✓已保存';
            setTimeout(() => status.textContent = '', 1500);
        }
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
    const email = prompt('商户邮箱：'); if (!email) return;
    const pwd = prompt('密码：'); if (!pwd) return;
    const name = prompt('商户名称：'); if (!name) return;
    const poiId = prompt('绑定POI ID（可留空）：');
    try {
        alert('创建商户功能需后端支持，请使用 Supabase Admin API');
    } catch (e) { alert('创建失败：' + e.message); }
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
