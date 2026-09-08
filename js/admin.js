// js/admin.js - 管理后台完整逻辑（修复命名冲突）
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
import { POI_CATEGORIES } from './config.js';

let allPois = [], allScenic = [], allRoutes = [], allPresets = [], allMerchants = [], allFeedbacks = [];
let currentPoiNodes = {};

// ============================================================
// 初始化
// ============================================================
export async function initAdminUI() {
    try {
        allPois = await getPois();
        allScenic = await getScenicList();
        allRoutes = await getRoutes();
        allPresets = await getTransportPresets();
        allMerchants = await getMerchantsByPoi(null);
        allFeedbacks = await getFeedbacks(null);
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
    let html = '';
    for (let p of pois) {
        const level = p.data_level || 'L3';
        html += `<div class="poi-card" id="poi-card-${p.id}">
            <div class="poi-header">
                <span><b>${p.name}</b> [${p.category || '未分类'}] <span class="data-quality-badge quality-${level}">${level}</span></span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showEditPoiModal('${p.id}')"><i class="fas fa-edit"></i> 编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deletePoi('${p.id}')"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>
            <div id="poi-nodes-${p.id}" class="node-list hidden"></div>
            <button class="btn btn-sm btn-outline-secondary mt-1" onclick="window.togglePoiNodes('${p.id}')"><i class="fas fa-sitemap"></i> 显示子景点</button>
        </div>`;
    }
    container.innerHTML = html || '<p>暂无POI</p>';
}

export async function togglePoiNodes(poiId) {
    const container = document.getElementById(`poi-nodes-${poiId}`);
    if (!container) return;
    if (!container.classList.contains('hidden')) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');
    const data = await getPoiInternal(poiId);
    const nodes = data.nodes || [];
    if (nodes.length === 0) {
        container.innerHTML = '<p class="text-secondary">暂无子景点</p>';
        return;
    }
    let html = '';
    nodes.forEach(n => {
        const typeLabel = { 'core_view': '核心景点', 'entrance': '入口', 'exit': '出口', 'rest_area': '休息区', 'wc': '洗手间', 'food': '餐饮', 'other': '其他' }[n.node_type] || n.node_type;
        html += `<div class="node-item">
            <span><span class="badge bg-secondary">${typeLabel}</span> ${n.node_name} (${n.suggested_duration_min}-${n.suggested_duration_max}分钟)</span>
        </div>`;
    });
    container.innerHTML = html;
}

// 编辑POI弹窗
export async function showEditPoiModal(poiId) {
    const poi = allPois.find(p => p.id === poiId);
    if (!poi) return;
    document.getElementById('edit-poi-id').value = poiId;
    document.getElementById('edit-poi-name').value = poi.name || '';
    document.getElementById('edit-poi-category').value = poi.category || '自然景区';
    document.getElementById('edit-poi-lat').value = poi.lat || '';
    document.getElementById('edit-poi-lng').value = poi.lng || '';
    document.getElementById('edit-poi-open').value = poi.open_time || '08:00';
    document.getElementById('edit-poi-close').value = poi.close_time || '18:00';
    document.getElementById('edit-poi-visit').value = poi.visit_duration || '';
    document.getElementById('edit-poi-desc').value = poi.description || '';
    document.getElementById('edit-poi-level').value = poi.data_level || 'L3';
    document.getElementById('poiModalTitle').textContent = `编辑POI - ${poi.name}`;

    const data = await getPoiInternal(poiId);
    const nodes = data.nodes || [];
    currentPoiNodes[poiId] = nodes;
    renderNodesFields(poiId);
    const modal = new bootstrap.Modal(document.getElementById('poiModal'));
    modal.show();
}

export function renderNodesFields(poiId) {
    const container = document.getElementById('edit-nodes-container');
    const nodes = currentPoiNodes[poiId] || [];
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
    container.innerHTML = html || '<p class="text-secondary">暂无子景点</p>';
}

export function addNodeField() {
    const poiId = document.getElementById('edit-poi-id').value;
    if (!poiId) return;
    if (!currentPoiNodes[poiId]) currentPoiNodes[poiId] = [];
    const name = prompt('节点名称：');
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
    const poiId = document.getElementById('edit-poi-id').value;
    if (!poiId || !currentPoiNodes[poiId]) return;
    if (!confirm('删除此节点？')) return;
    currentPoiNodes[poiId].splice(idx, 1);
    renderNodesFields(poiId);
}

export async function savePoiEdit() {
    const poiId = document.getElementById('edit-poi-id').value;
    if (!poiId) return;
    const updates = {
        name: document.getElementById('edit-poi-name').value.trim(),
        category: document.getElementById('edit-poi-category').value,
        lat: parseFloat(document.getElementById('edit-poi-lat').value),
        lng: parseFloat(document.getElementById('edit-poi-lng').value),
        open_time: document.getElementById('edit-poi-open').value,
        close_time: document.getElementById('edit-poi-close').value,
        visit_duration: parseInt(document.getElementById('edit-poi-visit').value) || 0,
        description: document.getElementById('edit-poi-desc').value,
        data_level: document.getElementById('edit-poi-level').value
    };
    try {
        await updatePoi(poiId, updates);
        const nodes = currentPoiNodes[poiId] || [];
        await deleteInternalNodes(poiId);
        await deleteInternalEdges(poiId);
        for (let n of nodes) {
            await insertInternalNode({ ...n, poi_id: poiId });
        }
        alert('保存成功');
        bootstrap.Modal.getInstance(document.getElementById('poiModal')).hide();
        await initAdminUI();
    } catch (e) {
        alert('保存失败：' + e.message);
    }
}

export async function deletePoi(id) {
    if (!confirm('确认删除此POI及其所有子景点？')) return;
    try {
        await deleteInternalNodes(id);
        await deleteInternalEdges(id);
        await apiDeletePoi(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
}

// ============================================================
// 景区管理
// ============================================================
export function renderScenicList(scenics) {
    const container = document.getElementById('scenic-list');
    if (!container) return;
    container.innerHTML = scenics.map(s => `
        <div class="poi-card">
            <div class="poi-header">
                <span><b>${s.name}</b> [${s.area || '未分区'}]</span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showEditScenicModal('${s.id}')"><i class="fas fa-edit"></i> 编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deleteScenic('${s.id}')"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>
        </div>
    `).join('') || '<p>暂无景区</p>';
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
        lat: parseFloat(document.getElementById('edit-scenic-lat').value),
        lng: parseFloat(document.getElementById('edit-scenic-lng').value),
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
    if (!confirm('确认删除？')) return;
    try { await apiDeleteScenic(id); await initAdminUI(); } catch (e) { alert('删除失败：' + e.message); }
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
    const r = allRoutes.find(x => x.id === id);
    if (!r) return;
    document.getElementById('edit-route-id').value = id;
    document.getElementById('edit-route-name').value = r.name || '';
    document.getElementById('edit-route-time').value = r.start_time || '08:30';
    document.getElementById('edit-route-transport').value = r.transport || '';
    document.getElementById('edit-route-days').value = r.days || 1;
    const nodes = await getRouteNodes(id);
    routeNodesData = nodes.map(n => ({ poi_id: n.poi_id, duration_min: n.duration_min || 60 }));
    renderRouteNodesFields();
    new bootstrap.Modal(document.getElementById('routeModal')).show();
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
    const opts = allPois.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    let html = '';
    routeNodesData.forEach((n, idx) => {
        html += `<div class="row g-1 align-items-center mb-1">
            <div class="col-5"><select class="form-select form-select-sm" onchange="window.updateRouteNode(${idx}, 'poi_id', this.value)">${opts}</select></div>
            <div class="col-3"><input type="number" class="form-control form-control-sm" placeholder="分钟" value="${n.duration_min||60}" onchange="window.updateRouteNode(${idx}, 'duration_min', this.value)"></div>
            <div class="col-2"><button class="btn btn-sm btn-danger" onclick="window.removeRouteNodeField(${idx})"><i class="fas fa-times"></i></button></div>
        </div>`;
    });
    container.innerHTML = html || '<p class="text-secondary">暂无节点</p>';
    // 恢复值
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
        days: parseInt(document.getElementById('edit-route-days').value) || 1
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
    const poiList = allPois.filter(p => !p.parent_id);
    if (poiList.length === 0) { container.innerHTML = '<p>暂无POI数据</p>'; return; }
    const poiMap = {};
    poiList.forEach(p => { poiMap[p.id] = p.name; });
    const ids = poiList.map(p => p.id);
    let html = '<table class="transport-matrix"><thead><tr><th>→</th>';
    ids.forEach(id => { html += `<th>${poiMap[id]}</th>`; });
    html += '</tr></thead><tbody>';
    for (let from of ids) {
        html += `<tr><td><b>${poiMap[from]}</b></td>`;
        for (let to of ids) {
            if (from === to) { html += `<td>—</td>`; continue; }
            const key = `${from}_${to}`;
            const revKey = `${to}_${from}`;
            let val = presets.find(p => p.from_poi_id == from && p.to_poi_id == to)?.time_min;
            if (val === undefined) val = presets.find(p => p.from_poi_id == to && p.to_poi_id == from)?.time_min;
            const isEstimate = val === undefined;
            const displayVal = isEstimate ? '' : val;
            html += `<td><input type="number" value="${displayVal}" placeholder="分钟" data-from="${from}" data-to="${to}" style="${isEstimate ? 'background:#fff3cd;' : ''}" onchange="window.saveTransportTime(this)"></td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}
window.saveTransportTime = async function(input) {
    const from = parseInt(input.dataset.from);
    const to = parseInt(input.dataset.to);
    const val = parseInt(input.value);
    if (isNaN(val) || val < 0) return;
    try {
        await upsertTransportPreset(from, to, val);
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
