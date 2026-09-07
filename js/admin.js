// js/admin.js - 管理后台核心逻辑
import {
    getPois, insertPoi, updatePoi, deletePoi,
    getScenicList, insertScenic, updateScenic, deleteScenic,
    getRoutes, insertRoute, updateRoute, deleteRoute,
    getRouteNodes, insertRouteNodes, deleteRouteNodes,
    getTransportPresets, upsertTransportPreset, deleteTransportPresetsForPoi,
    getFeedbacks, updateFeedback, deleteFeedback,
    getPoiInternal, deleteInternalNodes, deleteInternalEdges
} from './api.js';

// ============================================================
// 初始化管理后台
// ============================================================
export async function initAdminUI() {
    try {
        const pois = await getPois();
        const scenics = await getScenicList();
        const routes = await getRoutes();
        const presets = await getTransportPresets();
        renderPoiList(pois);
        renderScenicList(scenics);
        renderRouteList(routes);
        renderTransportEditor(presets);
        renderFeedbackList(await getFeedbacks(null));
        populateEditorSelect(pois);
        console.log('[管理后台] 初始化完成');
    } catch (e) {
        console.error('[管理后台] 初始化失败:', e);
        alert('初始化失败：' + e.message);
    }
}

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
    container.innerHTML = '<p>交通耗时编辑器已加载（完整实现请参考扩展）</p>';
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
    pois.forEach(p => { sel.innerHTML += `<option value="${p.id}">${p.name}</option>`; });
}

// ============================================================
// 全局函数
// ============================================================
window.editPoi = async (id) => { alert('编辑功能开发中'); };
window.deletePoi = async (id) => {
    if (!confirm('确认删除此POI？')) return;
    try { await deletePoi(id); await initAdminUI(); } catch (e) { alert('删除失败：' + e.message); }
};
window.editScenic = async (id) => { alert('编辑功能开发中'); };
window.deleteScenic = async (id) => {
    if (!confirm('确认删除此景区？')) return;
    try { await deleteScenic(id); await initAdminUI(); } catch (e) { alert('删除失败：' + e.message); }
};
window.editRoute = async (id) => { alert('编辑功能开发中'); };
window.deleteRoute = async (id) => {
    if (!confirm('确认删除此路线？')) return;
    try { await deleteRoute(id); await initAdminUI(); } catch (e) { alert('删除失败：' + e.message); }
};
window.replyFeedback = async (id) => {
    const reply = document.getElementById(`reply-${id}`).value;
    try { await updateFeedback(id, { reply }); await initAdminUI(); } catch (e) { alert('回复失败：' + e.message); }
};
window.deleteFeedback = async (id) => {
    if (!confirm('确认删除此留言？')) return;
    try { await deleteFeedback(id); await initAdminUI(); } catch (e) { alert('删除失败：' + e.message); }
};
window.saveNewPoi = async () => { alert('保存POI功能开发中'); };
window.saveNewScenic = async () => { alert('保存景区功能开发中'); };
window.refreshData = () => { initAdminUI(); };