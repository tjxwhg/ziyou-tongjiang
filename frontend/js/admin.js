// js/admin.js - 管理后台核心逻辑（修复重复声明版）
import {
    getPois, getPoi, insertPoi, updatePoi, deletePoi as apiDeletePoi,
    getRoutes, getRoute, insertRoute, updateRoute, deleteRoute as apiDeleteRoute,
    getRouteNodes, insertRouteNodes, deleteRouteNodes,
    getTransportPresets, upsertTransportPreset, deleteTransportPresetsForPoi,
    getMerchantsByPoi, getMerchant, updateMerchant, createMerchantRecord,
    getReservations, updateReservation,
    getFeedbacks, updateFeedback, deleteFeedback as apiDeleteFeedback,
    uploadFile, getPoiInternal, getPoisInfo,
    getScenicList, insertScenic, updateScenic, deleteScenic as apiDeleteScenic
} from './api.js';
import { getCurrentUser } from './auth.js';
import { POI_CATEGORIES, EXCLUDED_TRANSPORT_CATS } from './config.js';

let allPois = [];
let allRoutes = [];
let transportPresets = {};
let allScenic = [];

// ============================================================
// 初始化管理后台 UI
// ============================================================
export async function initAdminUI() {
    try {
        allPois = await getPois();
        allScenic = await getScenicList();
        allRoutes = await getRoutes();
        const presets = await getTransportPresets();
        transportPresets = {};
        presets.forEach(p => {
            transportPresets[`${p.from_poi_id}_${p.to_poi_id}`] = p.time_min;
        });
        renderPoiList(allPois);
        renderScenicList(allScenic);
        renderRouteList(allRoutes);
        renderTransportEditor(presets);
        renderFeedbackList(await getFeedbacks(null));
        populateEditorSelect(allPois);
        console.log('[管理后台] 初始化完成');
    } catch (e) {
        console.error('[管理后台] 初始化失败:', e);
        alert('初始化失败：' + e.message);
    }
}

// ============================================================
// POI 管理
// ============================================================
export async function loadAllPois() { return getPois(); }
export async function addPoi(poiData, voiceFile) {
    const inserted = await insertPoi(poiData);
    if (voiceFile && inserted) {
        const path = `poi_${inserted.id}_${Date.now()}.mp3`;
        const url = await uploadFile('audio-guides', path, voiceFile);
        await updatePoi(inserted.id, { voice_mp3: url });
    }
    return inserted;
}
export async function editPoi(id, updates, voiceFile) {
    if (voiceFile) {
        const path = `poi_${id}_${Date.now()}.mp3`;
        const url = await uploadFile('audio-guides', path, voiceFile);
        updates.voice_mp3 = url;
    }
    await updatePoi(id, updates);
}
export async function deletePoi(id) {
    await deleteTransportPresetsForPoi(id);
    await apiDeletePoi(id);
}

// ============================================================
// 景区管理（新增）
// ============================================================
export async function loadScenicList() { return getScenicList(); }
export async function addScenic(data) { return insertScenic(data); }
export async function editScenic(id, updates) { return updateScenic(id, updates); }
export async function deleteScenic(id) { return apiDeleteScenic(id); }

// ============================================================
// 路线管理
// ============================================================
export async function loadAllRoutes() { return getRoutes(); }
export async function addRoute(routeData) { return insertRoute(routeData); }
export async function editRoute(id, updates) { await updateRoute(id, updates); }
export async function deleteRoute(id) {
    await deleteRouteNodes(id);
    await apiDeleteRoute(id);
}
export async function getNodesForRoute(routeId) { return getRouteNodes(routeId); }
export async function saveRouteNodes(routeId, nodes) {
    await deleteRouteNodes(routeId);
    if (nodes && nodes.length) await insertRouteNodes(nodes);
}

// ============================================================
// 交通预设管理
// ============================================================
export async function loadTransportPresets() { return getTransportPresets(); }
export async function saveTransportTime(from, to, time) {
    await upsertTransportPreset(from, to, time);
}
export function removeTransportPoi(poiId) {
    const excluded = JSON.parse(localStorage.getItem('excludedTransportPois') || '[]');
    if (!excluded.includes(poiId)) {
        excluded.push(poiId);
        localStorage.setItem('excludedTransportPois', JSON.stringify(excluded));
    }
}

// ============================================================
// 留言管理
// ============================================================
export async function fetchAllFeedbacks() { return getFeedbacks(null); }
export async function replyToFeedback(id, reply) { await updateFeedback(id, { reply }); }
export async function deleteFeedback(id) { await apiDeleteFeedback(id); }

// ============================================================
// 渲染函数
// ============================================================
function renderPoiList(pois) {
    const container = document.getElementById('poi-list');
    if (!container) return;
    container.innerHTML = pois.map(p => `
        <div class="card mb-2" id="poi-card-${p.id}">
            <div class="d-flex justify-content-between align-items-center p-2">
                <span><b>${p.name}</b> [${p.category || '未分类'}]</span>
                <div>
                    <span class="data-quality-badge quality-${p.data_level || 'L3'}">${p.data_level || 'L3'}</span>
                    <button class="btn btn-sm btn-secondary" onclick="window.editPoi('${p.id}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deletePoi('${p.id}')">删除</button>
                </div>
            </div>
            <div id="edit-poi-${p.id}" class="inline-edit hidden"></div>
        </div>
    `).join('') || '<p>暂无POI</p>';
}

function renderScenicList(scenics) {
    const container = document.getElementById('scenic-list');
    if (!container) return;
    container.innerHTML = scenics.map(s => `
        <div class="card mb-2">
            <div class="d-flex justify-content-between align-items-center p-2">
                <span><b>${s.name}</b> [${s.area || '未分区'}]</span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.editScenic('${s.id}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deleteScenic('${s.id}')">删除</button>
                </div>
            </div>
        </div>
    `).join('') || '<p>暂无景区</p>';
}

function renderRouteList(routes) {
    const container = document.getElementById('route-list');
    if (!container) return;
    container.innerHTML = routes.map(r => `
        <div class="card mb-2">
            <div class="d-flex justify-content-between align-items-center p-2">
                <span><b>${r.name}</b> (${r.start_time || '未设'})</span>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="window.editRoute('${r.id}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="window.deleteRoute('${r.id}')">删除</button>
                </div>
            </div>
        </div>
    `).join('') || '<p>暂无路线</p>';
}

function renderTransportEditor(presets) {
    const container = document.getElementById('transport-editor');
    if (!container) return;
    // 简化显示，完整实现可扩展
    container.innerHTML = '<p>交通耗时编辑器已加载（完整实现请参考 admin.js）</p>';
}

function renderFeedbackList(feedbacks) {
    const container = document.getElementById('feedback-list');
    if (!container) return;
    container.innerHTML = feedbacks.map(f => `
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

function populateEditorSelect(pois) {
    const sel = document.getElementById('editor-poi-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- 选择POI --</option>';
    pois.forEach(p => {
        sel.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });
}

// ============================================================
// 挂载全局函数（供 HTML onclick 调用）
// ============================================================
window.editPoi = async (id) => {
    // 简单编辑实现（可扩展）
    alert('编辑功能开发中，请使用 Supabase 直接编辑');
};
window.deletePoi = async (id) => {
    if (!confirm('确认删除此POI？')) return;
    try {
        await deletePoi(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
};
window.editScenic = async (id) => {
    alert('编辑功能开发中');
};
window.deleteScenic = async (id) => {
    if (!confirm('确认删除此景区？')) return;
    try {
        await deleteScenic(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
};
window.editRoute = async (id) => { alert('编辑功能开发中'); };
window.deleteRoute = async (id) => {
    if (!confirm('确认删除此路线？')) return;
    try {
        await deleteRoute(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
};
window.replyFeedback = async (id) => {
    const reply = document.getElementById(`reply-${id}`).value;
    try {
        await replyToFeedback(id, reply);
        await initAdminUI();
    } catch (e) { alert('回复失败：' + e.message); }
};
window.deleteFeedback = async (id) => {
    if (!confirm('确认删除此留言？')) return;
    try {
        await deleteFeedback(id);
        await initAdminUI();
    } catch (e) { alert('删除失败：' + e.message); }
};
window.saveNewPoi = async () => {
    alert('保存POI功能开发中');
};
window.saveNewScenic = async () => {
    alert('保存景区功能开发中');
};
window.refreshData = () => { initAdminUI(); };
window.loadPoiForEditor = () => { /* 编辑器功能 */ };
window.savePoiInternal = () => { /* 内部路线保存 */ };
window.clearPoiInternal = () => { /* 清空内部路线 */ };
window.enableDrawMode = (mode) => { /* 绘制模式 */ };
window.disableDrawMode = () => { /* 浏览模式 */ };
window.saveEditorNode = () => { /* 保存节点 */ };
