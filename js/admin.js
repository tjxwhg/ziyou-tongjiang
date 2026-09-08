// js/admin.js - 管理后台核心逻辑（完整版）
import {
    getPois, insertPoi, updatePoi, deletePoi,
    getScenicList, insertScenic, updateScenic, deleteScenic,
    getRoutes, insertRoute, updateRoute, deleteRoute,
    getRouteNodes, insertRouteNodes, deleteRouteNodes,
    getTransportPresets, upsertTransportPreset, deleteTransportPresetsForPoi,
    getFeedbacks, updateFeedback, deleteFeedback,
    getMerchant, updateMerchant, createMerchantRecord,
    getPoiInternal, insertInternalNode, insertInternalEdge, deleteInternalNodes, deleteInternalEdges,
    uploadFile, getMerchantsByPoi
} from './api.js';
import { getCurrentUser } from './auth.js';
import { POI_CATEGORIES } from './config.js';

// ===== 状态 =====
let allPois = [];
let allScenics = [];
let allRoutes = [];
let allTransportPresets = [];
let allFeedbacks = [];
let allMerchants = [];
let editingPoiId = null;
let editingScenicId = null;
let editingRouteId = null;
let routeNodes = [];
let poiNodes = [];

// ===== 初始化 =====
export async function initAdminUI() {
    try {
        allPois = await getPois();
        allScenics = await getScenicList();
        allRoutes = await getRoutes();
        allTransportPresets = await getTransportPresets();
        allFeedbacks = await getFeedbacks(null);
        allMerchants = await getMerchantsByPoi(null); // 获取所有商户

        renderPoiList();
        renderScenicList();
        renderRouteList();
        renderTransportMatrix();
        renderMerchantList();
        renderFeedbackList();
        console.log('[管理后台] 初始化完成');
    } catch (e) {
        console.error('[管理后台] 初始化失败:', e);
        alert('初始化失败：' + e.message);
    }
}

// ===== 渲染 POI 列表 =====
function renderPoiList() {
    const container = document.getElementById('poi-list');
    if (!container) return;
    container.innerHTML = allPois.map(p => `
        <div class="card mb-2">
            <div class="d-flex justify-content-between align-items-center p-2">
                <span>
                    <b>${p.name}</b> [${p.category || '未分类'}]
                    <span class="data-quality-badge quality-${p.data_level || 'L3'}">${p.data_level || 'L3'}</span>
                </span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showPoiModal('${p.id}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deletePoi('${p.id}')">删除</button>
                </div>
            </div>
        </div>
    `).join('') || '<p>暂无POI</p>';
}

// ===== POI 模态框 =====
export async function showPoiModal(poiId) {
    const modal = new bootstrap.Modal(document.getElementById('poiModal'));
    const title = document.getElementById('poiModalTitle');
    if (poiId) {
        title.textContent = '编辑景点';
        editingPoiId = poiId;
        const poi = allPois.find(p => p.id === poiId);
        if (!poi) return;
        document.getElementById('edit-poi-id').value = poiId;
        document.getElementById('edit-poi-name').value = poi.name || '';
        document.getElementById('edit-poi-category').value = poi.category || '自然景区';
        document.getElementById('edit-poi-visit').value = poi.visit_duration || 60;
        document.getElementById('edit-poi-open').value = poi.open_time || '08:00';
        document.getElementById('edit-poi-close').value = poi.close_time || '18:00';
        document.getElementById('edit-poi-lat').value = poi.lat || '';
        document.getElementById('edit-poi-lng').value = poi.lng || '';
        document.getElementById('edit-poi-desc').value = poi.description || '';
        document.getElementById('edit-poi-voice-text').value = poi.voice_cn || '';
        document.getElementById('edit-poi-level').value = poi.data_level || 'L3';
        // 父级景区
        const parentSel = document.getElementById('edit-poi-parent');
        parentSel.innerHTML = '<option value="">无</option>';
        allScenics.forEach(s => {
            parentSel.innerHTML += `<option value="${s.id}" ${poi.parent_id === s.id ? 'selected' : ''}>${s.name}</option>`;
        });
        // 加载内部节点
        await loadPoiNodes(poiId);
        // 加载语音文件（如果有）
    } else {
        title.textContent = '新增景点';
        editingPoiId = null;
        document.getElementById('edit-poi-id').value = '';
        document.getElementById('edit-poi-name').value = '';
        document.getElementById('edit-poi-category').value = '自然景区';
        document.getElementById('edit-poi-visit').value = 60;
        document.getElementById('edit-poi-open').value = '08:00';
        document.getElementById('edit-poi-close').value = '18:00';
        document.getElementById('edit-poi-lat').value = '';
        document.getElementById('edit-poi-lng').value = '';
        document.getElementById('edit-poi-desc').value = '';
        document.getElementById('edit-poi-voice-text').value = '';
        document.getElementById('edit-poi-level').value = 'L3';
        document.getElementById('edit-poi-parent').innerHTML = '<option value="">无</option>' + allScenics.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        poiNodes = [];
        renderPoiNodes();
    }
    modal.show();
}

async function loadPoiNodes(poiId) {
    const data = await getPoiInternal(poiId);
    poiNodes = data.nodes || [];
    renderPoiNodes();
}

function renderPoiNodes() {
    const container = document.getElementById('edit-poi-nodes-list');
    container.innerHTML = poiNodes.map((n, idx) => `
        <div class="node-item">
            <span class="node-info">
                <b>${n.node_name || '未命名'}</b> (${n.node_type}) ${n.suggested_duration_min}-${n.suggested_duration_max}分钟
            </span>
            <span class="node-actions">
                <button class="btn btn-sm btn-secondary" onclick="window.editPoiNode(${idx})">编辑</button>
                <button class="btn btn-sm btn-danger" onclick="window.deletePoiNode(${idx})">删除</button>
            </span>
        </div>
    `).join('') || '<p class="text-secondary">暂无内部节点</p>';
}

export function addPoiNode() {
    const name = prompt('节点名称:');
    if (!name) return;
    const type = prompt('类型 (core_view/entrance/exit/rest_area/wc/food/other):', 'core_view');
    const durMin = parseInt(prompt('最短停留(分钟):', '10')) || 10;
    const durMax = parseInt(prompt('最长停留(分钟):', '30')) || 30;
    const lat = parseFloat(prompt('纬度:'));
    const lng = parseFloat(prompt('经度:'));
    if (isNaN(lat) || isNaN(lng)) { alert('经纬度必须为数字'); return; }
    poiNodes.push({
        node_name: name,
        node_type: type || 'core_view',
        suggested_duration_min: durMin,
        suggested_duration_max: durMax,
        lat: lat,
        lng: lng,
        // 其他字段：audio_mp3, radius_geofence 等暂不处理
    });
    renderPoiNodes();
}

window.editPoiNode = function(idx) {
    const n = poiNodes[idx];
    if (!n) return;
    const name = prompt('节点名称:', n.node_name) || n.node_name;
    const type = prompt('类型:', n.node_type) || n.node_type;
    const durMin = parseInt(prompt('最短停留:', n.suggested_duration_min)) || n.suggested_duration_min;
    const durMax = parseInt(prompt('最长停留:', n.suggested_duration_max)) || n.suggested_duration_max;
    const lat = parseFloat(prompt('纬度:', n.lat));
    const lng = parseFloat(prompt('经度:', n.lng));
    if (isNaN(lat) || isNaN(lng)) { alert('经纬度必须为数字'); return; }
    Object.assign(n, { node_name: name, node_type: type, suggested_duration_min: durMin, suggested_duration_max: durMax, lat, lng });
    renderPoiNodes();
};

window.deletePoiNode = function(idx) {
    if (!confirm('删除此节点？')) return;
    poiNodes.splice(idx, 1);
    renderPoiNodes();
};

export async function savePoi() {
    const id = document.getElementById('edit-poi-id').value;
    const name = document.getElementById('edit-poi-name').value.trim();
    const category = document.getElementById('edit-poi-category').value;
    const visit_duration = parseInt(document.getElementById('edit-poi-visit').value) || 0;
    const open_time = document.getElementById('edit-poi-open').value || '08:00';
    const close_time = document.getElementById('edit-poi-close').value || '18:00';
    const lat = parseFloat(document.getElementById('edit-poi-lat').value);
    const lng = parseFloat(document.getElementById('edit-poi-lng').value);
    const description = document.getElementById('edit-poi-desc').value;
    const voice_cn = document.getElementById('edit-poi-voice-text').value.trim();
    const parent_id = document.getElementById('edit-poi-parent').value || null;
    const data_level = document.getElementById('edit-poi-level').value || 'L3';

    if (!name || isNaN(lat) || isNaN(lng)) { alert('名称和经纬度必填'); return; }

    const poiData = { name, category, visit_duration, open_time, close_time, lat, lng, description, voice_cn, parent_id, data_level };

    try {
        let poiId = id;
        if (id) {
            // 更新
            await updatePoi(id, poiData);
            // 处理节点
            await deleteInternalNodes(id);
            for (let node of poiNodes) {
                await insertInternalNode({ ...node, poi_id: id });
            }
        } else {
            const inserted = await insertPoi(poiData);
            poiId = inserted.id;
            for (let node of poiNodes) {
                await insertInternalNode({ ...node, poi_id: inserted.id });
            }
        }
        // 处理语音文件上传
        const fileInput = document.getElementById('edit-poi-voice-file');
        if (fileInput && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const path = `poi_${poiId}_${Date.now()}.mp3`;
            const url = await uploadFile('audio-guides', path, file);
            await updatePoi(poiId, { voice_mp3: url });
        }
        alert('保存成功');
        bootstrap.Modal.getInstance(document.getElementById('poiModal')).hide();
        await initAdminUI();
    } catch (e) {
        alert('保存失败：' + e.message);
    }
}

export async function deletePoi(id) {
    if (!confirm('确认删除此POI及其所有内部节点？')) return;
    try {
        await deleteInternalNodes(id);
        await deletePoi(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
}

// ===== 景区管理 =====
export function showScenicModal(scenicId) {
    const modal = new bootstrap.Modal(document.getElementById('scenicModal'));
    if (scenicId) {
        editingScenicId = scenicId;
        const s = allScenics.find(item => item.id === scenicId);
        if (!s) return;
        document.getElementById('edit-scenic-id').value = s.id;
        document.getElementById('edit-scenic-name').value = s.name || '';
        document.getElementById('edit-scenic-area').value = s.area || '';
        document.getElementById('edit-scenic-lat').value = s.lat || '';
        document.getElementById('edit-scenic-lng').value = s.lng || '';
        document.getElementById('edit-scenic-desc').value = s.description || '';
    } else {
        editingScenicId = null;
        document.getElementById('edit-scenic-id').value = '';
        document.getElementById('edit-scenic-name').value = '';
        document.getElementById('edit-scenic-area').value = '';
        document.getElementById('edit-scenic-lat').value = '';
        document.getElementById('edit-scenic-lng').value = '';
        document.getElementById('edit-scenic-desc').value = '';
    }
    modal.show();
}

export async function saveScenic() {
    const id = document.getElementById('edit-scenic-id').value;
    const name = document.getElementById('edit-scenic-name').value.trim();
    const area = document.getElementById('edit-scenic-area').value.trim();
    const lat = parseFloat(document.getElementById('edit-scenic-lat').value);
    const lng = parseFloat(document.getElementById('edit-scenic-lng').value);
    const description = document.getElementById('edit-scenic-desc').value;

    if (!name) { alert('景区名称必填'); return; }
    try {
        if (id) {
            await updateScenic(id, { name, area, lat, lng, description });
        } else {
            await insertScenic({ name, area, lat, lng, description });
        }
        alert('保存成功');
        bootstrap.Modal.getInstance(document.getElementById('scenicModal')).hide();
        await initAdminUI();
    } catch (e) { alert('保存失败：' + e.message); }
}

export async function deleteScenic(id) {
    if (!confirm('确认删除此景区？')) return;
    try {
        await deleteScenic(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
}

function renderScenicList() {
    const container = document.getElementById('scenic-list');
    container.innerHTML = allScenics.map(s => `
        <div class="card mb-2">
            <div class="d-flex justify-content-between align-items-center p-2">
                <span><b>${s.name}</b> [${s.area || '未分区'}]</span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showScenicModal('${s.id}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deleteScenic('${s.id}')">删除</button>
                </div>
            </div>
        </div>
    `).join('') || '<p>暂无景区</p>';
}

// ===== 路线管理 =====
export function showRouteModal(routeId) {
    const modal = new bootstrap.Modal(document.getElementById('routeModal'));
    if (routeId) {
        editingRouteId = routeId;
        const r = allRoutes.find(item => item.id === routeId);
        if (!r) return;
        document.getElementById('edit-route-id').value = r.id;
        document.getElementById('edit-route-name').value = r.name || '';
        document.getElementById('edit-route-start').value = r.start_time || '08:30';
        document.getElementById('edit-route-transport').value = r.transport || '';
        loadRouteNodes(routeId);
    } else {
        editingRouteId = null;
        document.getElementById('edit-route-id').value = '';
        document.getElementById('edit-route-name').value = '';
        document.getElementById('edit-route-start').value = '08:30';
        document.getElementById('edit-route-transport').value = '';
        routeNodes = [];
        renderRouteNodes();
    }
    modal.show();
}

async function loadRouteNodes(routeId) {
    const nodes = await getRouteNodes(routeId);
    routeNodes = nodes.map(n => ({
        poi_id: n.poi_id,
        duration_min: n.duration_min || 60,
        items: n.items || []
    }));
    renderRouteNodes();
}

function renderRouteNodes() {
    const container = document.getElementById('edit-route-nodes-list');
    container.innerHTML = routeNodes.map((n, idx) => `
        <div class="d-flex align-items-center gap-2 mb-1">
            <select class="form-select form-select-sm" style="flex:1" onchange="window.updateRouteNode(${idx}, 'poi_id', this.value)">
                <option value="">--选择POI--</option>
                ${allPois.map(p => `<option value="${p.id}" ${n.poi_id === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
            </select>
            <input type="number" class="form-control form-control-sm" style="width:80px" placeholder="分钟" value="${n.duration_min || 60}" onchange="window.updateRouteNode(${idx}, 'duration_min', this.value)">
            <button class="btn btn-sm btn-danger" onclick="window.removeRouteNode(${idx})">✕</button>
        </div>
    `).join('') || '<p class="text-secondary">暂无节点</p>';
}

window.updateRouteNode = function(idx, field, value) {
    if (field === 'poi_id') routeNodes[idx].poi_id = value || '';
    else routeNodes[idx].duration_min = parseInt(value) || 60;
};
window.removeRouteNode = function(idx) {
    routeNodes.splice(idx, 1);
    renderRouteNodes();
};
export function addRouteNode() {
    routeNodes.push({ poi_id: '', duration_min: 60, items: [] });
    renderRouteNodes();
}

export async function saveRoute() {
    const id = document.getElementById('edit-route-id').value;
    const name = document.getElementById('edit-route-name').value.trim();
    const start_time = document.getElementById('edit-route-start').value;
    const transport = document.getElementById('edit-route-transport').value.trim();

    if (!name) { alert('路线名称必填'); return; }
    try {
        let routeId = id;
        if (id) {
            await updateRoute(id, { name, start_time, transport });
        } else {
            const inserted = await insertRoute({ name, start_time, transport, days: 1, group_type: 'default' });
            routeId = inserted.id;
        }
        // 保存节点
        await deleteRouteNodes(routeId);
        const nodesPayload = routeNodes.filter(n => n.poi_id).map((n, i) => ({
            route_id: parseInt(routeId),
            poi_id: parseInt(n.poi_id),
            order_num: i + 1,
            duration_min: n.duration_min || 60,
            transport_mode: '步行',
            transport_time: 0,
            items: n.items || []
        }));
        if (nodesPayload.length > 0) {
            await insertRouteNodes(nodesPayload);
        }
        alert('保存成功');
        bootstrap.Modal.getInstance(document.getElementById('routeModal')).hide();
        await initAdminUI();
    } catch (e) { alert('保存失败：' + e.message); }
}

export async function deleteRoute(id) {
    if (!confirm('确认删除此路线？')) return;
    try {
        await deleteRouteNodes(id);
        await deleteRoute(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
}

function renderRouteList() {
    const container = document.getElementById('route-list');
    container.innerHTML = allRoutes.map(r => `
        <div class="card mb-2">
            <div class="d-flex justify-content-between align-items-center p-2">
                <span><b>${r.name}</b> (${r.start_time || '未设'})</span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.showRouteModal('${r.id}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deleteRoute('${r.id}')">删除</button>
                </div>
            </div>
        </div>
    `).join('') || '<p>暂无路线</p>';
}

// ===== 交通耗时矩阵 =====
function renderTransportMatrix() {
    const container = document.getElementById('transport-editor');
    if (!container) return;
    if (allPois.length === 0) { container.innerHTML = '<p>请先添加POI</p>'; return; }

    // 构建矩阵
    const poiMap = {};
    allPois.forEach(p => poiMap[p.id] = p);
    const poiIds = allPois.map(p => p.id);

    let html = `<table class="table table-bordered transport-table"><thead><tr><th>→</th>`;
    poiIds.forEach(id => {
        html += `<th>${poiMap[id].name}</th>`;
    });
    html += `</tr></thead><tbody>`;
    poiIds.forEach(fromId => {
        html += `<tr><td><b>${poiMap[fromId].name}</b></td>`;
        poiIds.forEach(toId => {
            if (fromId === toId) {
                html += `<td>-</td>`;
            } else {
                const key = `${fromId}_${toId}`;
                const preset = allTransportPresets.find(p => p.from_poi_id == fromId && p.to_poi_id == toId);
                const val = preset ? preset.time_min : '';
                html += `<td><input type="number" value="${val}" data-from="${fromId}" data-to="${toId}" onchange="window.saveTransportCell(this)" placeholder="分钟"></td>`;
            }
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
}

export async function saveTransportCell(input) {
    const from = input.dataset.from;
    const to = input.dataset.to;
    const val = parseInt(input.value);
    if (isNaN(val) || val < 0) return;
    try {
        await upsertTransportPreset(from, to, val);
        // 自动填充反向
        const reversePreset = allTransportPresets.find(p => p.from_poi_id == to && p.to_poi_id == from);
        if (!reversePreset) {
            await upsertTransportPreset(to, from, val);
        }
        alert('保存成功');
        await initAdminUI(); // 刷新数据
    } catch (e) { alert('保存失败：' + e.message); }
}

// ===== 商户管理 =====
export function showMerchantModal() {
    const modal = new bootstrap.Modal(document.getElementById('merchantModal'));
    document.getElementById('new-merchant-email').value = '';
    document.getElementById('new-merchant-pwd').value = '';
    document.getElementById('new-merchant-name').value = '';
    document.getElementById('new-merchant-poi').value = '';
    modal.show();
}

export async function saveMerchant() {
    const email = document.getElementById('new-merchant-email').value.trim();
    const pwd = document.getElementById('new-merchant-pwd').value;
    const name = document.getElementById('new-merchant-name').value.trim();
    const poiId = document.getElementById('new-merchant-poi').value.trim() || null;

    if (!email || !pwd || !name) { alert('请填写完整信息'); return; }
    try {
        // 注意：此操作需要服务端支持，前端无法直接创建用户
        // 我们仅创建商户记录，前提是用户已存在
        // 实际应调用 Supabase Admin API 或云函数
        alert('商户创建功能需后端支持，暂未实现。请手动在 Supabase 创建用户后，在 ztj_merchants 插入记录。');
        // 这里留作示例
        // await createMerchantRecord(userId, name, poiId);
        bootstrap.Modal.getInstance(document.getElementById('merchantModal')).hide();
    } catch (e) { alert('创建失败：' + e.message); }
}

export async function deleteMerchant(id) {
    if (!confirm('确认删除此商户？')) return;
    try {
        // 实际应删除商户记录和用户
        alert('删除功能需后端支持');
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
}

function renderMerchantList() {
    const container = document.getElementById('merchant-list');
    container.innerHTML = allMerchants.map(m => `
        <div class="card mb-2">
            <div class="d-flex justify-content-between align-items-center p-2">
                <span><b>${m.display_name}</b> (${m.id})</span>
                <div>
                    <button class="btn btn-sm btn-danger" onclick="window.deleteMerchant('${m.id}')">删除</button>
                </div>
            </div>
        </div>
    `).join('') || '<p>暂无商户</p>';
}

// ===== 留言管理 =====
export function loadFeedbacks() {
    return allFeedbacks;
}

export async function replyFeedback(id) {
    const reply = prompt('回复内容:');
    if (reply === null) return;
    try {
        await updateFeedback(id, { reply });
        await initAdminUI();
    } catch (e) { alert('回复失败：' + e.message); }
}

export async function deleteFeedback(id) {
    if (!confirm('确认删除此留言？')) return;
    try {
        await deleteFeedback(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
}

function renderFeedbackList() {
    const container = document.getElementById('feedback-list');
    container.innerHTML = allFeedbacks.map(f => `
        <div class="card mb-2">
            <p>${f.message}</p>
            <small>${new Date(f.created_at).toLocaleString()}</small>
            ${f.reply ? `<div class="text-success">回复：${f.reply}</div>` : ''}
            <textarea id="reply-${f.id}" class="form-control mt-1" rows="2">${f.reply || ''}</textarea>
            <button class="btn btn-sm btn-primary mt-1" onclick="window.replyFeedback('${f.id}')">回复</button>
            <button class="btn btn-sm btn-danger mt-1" onclick="window.deleteFeedback('${f.id}')">删除</button>
        </div>
    `).join('') || '<p>暂无留言</p>';
}
