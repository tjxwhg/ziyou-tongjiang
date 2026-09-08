// js/admin.js - 管理后台完整实现
import {
    getPois, getPoi, insertPoi, updatePoi, deletePoi,
    getScenicList, insertScenic, updateScenic, deleteScenic,
    getPoiInternal, insertInternalNode, insertInternalEdge,
    deleteInternalNodes, deleteInternalEdges,
    getRoutes, getRoute, insertRoute, updateRoute, deleteRoute,
    getRouteNodes, insertRouteNodes, deleteRouteNodes,
    getTransportPresets, upsertTransportPreset, deleteTransportPresetsForPoi,
    getFeedbacks, updateFeedback, deleteFeedback,
    getMerchantsByPoi, getMerchant, updateMerchant, createMerchantRecord,
    uploadFile
} from './api.js';
import { getCurrentUser } from './auth.js';
import { POI_CATEGORIES } from './config.js';

let allPois = [];
let allScenic = [];
let allRoutes = [];
let transportPresets = {};
let editorMap = null;
let editorNodes = [];
let editorEdges = [];
let currentEditorPoiId = null;
let drawControl = null;
let drawnItems = null;
let tempNodeLatLng = null;

// ============================================================
// 初始化
// ============================================================
export async function initAdminUI() {
    try {
        allPois = await getPois();
        allScenic = await getScenicList();
        allRoutes = await getRoutes();
        const presets = await getTransportPresets();
        transportPresets = {};
        presets.forEach(p => { transportPresets[`${p.from_poi_id}_${p.to_poi_id}`] = p.time_min; });

        renderPoiList(allPois);
        renderScenicList(allScenic);
        renderRouteList(allRoutes);
        renderTransportEditor(presets);
        renderFeedbackList(await getFeedbacks(null));
        populateEditorSelect(allPois);
        populateParentSelect(allPois);
        console.log('[管理后台] 初始化完成');
    } catch (e) {
        console.error('[管理后台] 初始化失败:', e);
        alert('初始化失败：' + e.message);
    }
}

// ============================================================
// POI管理
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
    // 挂载编辑函数
    window.editPoi = editPoiHandler;
    window.deletePoi = deletePoiHandler;
}

async function editPoiHandler(id) {
    const container = document.getElementById(`edit-poi-${id}`);
    if (!container.classList.contains('hidden')) { container.classList.add('hidden'); return; }
    const poi = allPois.find(p => p.id === id);
    if (!poi) return;
    const selectedCats = (poi.category || '').split(',').map(c => c.trim());
    const mainPois = allPois.filter(p => !p.parent_id && p.id !== id);
    let parentOpts = '<option value="">无（独立景点）</option>';
    mainPois.forEach(p => parentOpts += `<option value="${p.id}" ${poi.parent_id==p.id?'selected':''}>${p.name}</option>`);
    container.innerHTML = `
        <div class="row g-2">
            <div class="col-md-4"><label>名称</label><input id="edit-name-${id}" value="${poi.name}" class="form-control"></div>
            <div class="col-md-4"><label>类别</label>
                <select id="edit-category-${id}" class="form-select">
                    ${POI_CATEGORIES.map(c => `<option value="${c}" ${selectedCats.includes(c)?'selected':''}>${c}</option>`).join('')}
                </select>
            </div>
            <div class="col-md-4"><label>归属景区</label><select id="edit-parent-${id}" class="form-select">${parentOpts}</select></div>
            <div class="col-md-3"><label>游览时长(分钟)</label><input type="number" id="edit-visit-${id}" value="${poi.visit_duration||''}" class="form-control"></div>
            <div class="col-md-3"><label>开放时间</label><input type="time" id="edit-open-${id}" value="${poi.open_time||'08:00'}" class="form-control"></div>
            <div class="col-md-3"><label>闭馆时间</label><input type="time" id="edit-close-${id}" value="${poi.close_time||'18:00'}" class="form-control"></div>
            <div class="col-md-3"><label>数据等级</label>
                <select id="edit-level-${id}" class="form-select">
                    <option value="L3" ${poi.data_level==='L3'?'selected':''}>L3 - 基础信息</option>
                    <option value="L2" ${poi.data_level==='L2'?'selected':''}>L2 - 有内部路线</option>
                    <option value="L1" ${poi.data_level==='L1'?'selected':''}>L1 - 完整数据</option>
                </select>
            </div>
            <div class="col-md-6"><label>纬度</label><input type="number" step="any" id="edit-lat-${id}" value="${poi.lat}" class="form-control"></div>
            <div class="col-md-6"><label>经度</label><input type="number" step="any" id="edit-lng-${id}" value="${poi.lng}" class="form-control"></div>
            <div class="col-12"><label>简介</label><textarea id="edit-desc-${id}" class="form-control">${poi.description||''}</textarea></div>
            <div class="col-12"><label>语音文本</label><textarea id="edit-voice-text-${id}" class="form-control">${poi.voice_cn||''}</textarea></div>
            <div class="col-12"><label>MP3语音文件</label><input type="file" accept="audio/*" id="edit-voice-file-${id}" class="form-control"></div>
        </div>
        <button class="btn btn-success mt-2" onclick="window.savePoiEdit('${id}')">保存</button>
        <button class="btn btn-secondary mt-2" onclick="document.getElementById('edit-poi-${id}').classList.add('hidden')">取消</button>
    `;
    container.classList.remove('hidden');
    window.savePoiEdit = async function(id) {
        const name = document.getElementById(`edit-name-${id}`).value.trim();
        const lat = parseFloat(document.getElementById(`edit-lat-${id}`).value);
        const lng = parseFloat(document.getElementById(`edit-lng-${id}`).value);
        if (!name || isNaN(lat) || isNaN(lng)) { alert('名称、经纬度必填'); return; }
        const category = document.getElementById(`edit-category-${id}`).value;
        const parent_id = document.getElementById(`edit-parent-${id}`).value || null;
        const visit_duration = parseInt(document.getElementById(`edit-visit-${id}`).value) || null;
        const open_time = document.getElementById(`edit-open-${id}`).value;
        const close_time = document.getElementById(`edit-close-${id}`).value;
        const data_level = document.getElementById(`edit-level-${id}`).value;
        const description = document.getElementById(`edit-desc-${id}`).value;
        const voice_cn = document.getElementById(`edit-voice-text-${id}`).value.trim();
        const voiceFile = document.getElementById(`edit-voice-file-${id}`).files[0];
        try {
            await updatePoi(id, { name, lat, lng, category, parent_id, visit_duration, open_time, close_time, data_level, description, voice_cn });
            if (voiceFile) {
                const path = `poi_${id}_${Date.now()}.mp3`;
                const url = await uploadFile('audio-guides', path, voiceFile);
                await updatePoi(id, { voice_mp3: url });
            }
            alert('保存成功');
            document.getElementById(`edit-poi-${id}`).classList.add('hidden');
            await refreshAll();
        } catch (e) { alert('保存失败：' + e.message); }
    };
}

async function deletePoiHandler(id) {
    if (!confirm('确认删除此POI？')) return;
    try { await deletePoi(id); await refreshAll(); } 
    catch (e) { alert('删除失败：' + e.message); }
}

window.saveNewPoi = async function() {
    const name = document.getElementById('new-poi-name').value.trim();
    const lat = parseFloat(document.getElementById('new-poi-lat').value);
    const lng = parseFloat(document.getElementById('new-poi-lng').value);
    if (!name || isNaN(lat) || isNaN(lng)) { alert('名称、经纬度必填'); return; }
    const category = document.getElementById('new-poi-category').value;
    const parent_id = document.getElementById('new-poi-parent').value || null;
    const visit_duration = parseInt(document.getElementById('new-poi-visit').value) || null;
    const open_time = document.getElementById('new-poi-open').value;
    const close_time = document.getElementById('new-poi-close').value;
    const data_level = document.getElementById('new-poi-level').value;
    const description = document.getElementById('new-poi-desc').value;
    const voice_cn = document.getElementById('new-poi-voice-text').value.trim();
    const voiceFile = document.getElementById('new-poi-voice').files[0];
    try {
        const inserted = await insertPoi({ name, lat, lng, category, parent_id, visit_duration, open_time, close_time, data_level, description, voice_cn });
        if (voiceFile && inserted) {
            const path = `poi_${inserted.id}_${Date.now()}.mp3`;
            const url = await uploadFile('audio-guides', path, voiceFile);
            await updatePoi(inserted.id, { voice_mp3: url });
        }
        alert('新增成功');
        document.getElementById('add-poi-form').classList.add('hidden');
        await refreshAll();
    } catch (e) { alert('保存失败：' + e.message); }
};

// ============================================================
// 景区管理
// ============================================================
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
            <div id="edit-scenic-${s.id}" class="inline-edit hidden"></div>
        </div>
    `).join('') || '<p>暂无景区</p>';
    window.editScenic = editScenicHandler;
    window.deleteScenic = deleteScenicHandler;
}

async function editScenicHandler(id) {
    const container = document.getElementById(`edit-scenic-${id}`);
    if (!container.classList.contains('hidden')) { container.classList.add('hidden'); return; }
    const s = allScenic.find(x => x.id === id);
    if (!s) return;
    container.innerHTML = `
        <div class="row g-2">
            <div class="col-6"><label>景区名称</label><input id="esc-name-${id}" value="${s.name}" class="form-control"></div>
            <div class="col-6"><label>所属区域</label><input id="esc-area-${id}" value="${s.area||''}" class="form-control"></div>
            <div class="col-6"><label>纬度</label><input type="number" step="any" id="esc-lat-${id}" value="${s.lat}" class="form-control"></div>
            <div class="col-6"><label>经度</label><input type="number" step="any" id="esc-lng-${id}" value="${s.lng}" class="form-control"></div>
            <div class="col-12"><label>简介</label><textarea id="esc-desc-${id}" class="form-control">${s.description||''}</textarea></div>
        </div>
        <button class="btn btn-success mt-2" onclick="window.saveScenicEdit('${id}')">保存</button>
        <button class="btn btn-secondary mt-2" onclick="document.getElementById('edit-scenic-${id}').classList.add('hidden')">取消</button>
    `;
    container.classList.remove('hidden');
    window.saveScenicEdit = async function(id) {
        const name = document.getElementById(`esc-name-${id}`).value.trim();
        const lat = parseFloat(document.getElementById(`esc-lat-${id}`).value);
        const lng = parseFloat(document.getElementById(`esc-lng-${id}`).value);
        if (!name || isNaN(lat) || isNaN(lng)) { alert('名称、经纬度必填'); return; }
        const area = document.getElementById(`esc-area-${id}`).value;
        const description = document.getElementById(`esc-desc-${id}`).value;
        try { await updateScenic(id, { name, lat, lng, area, description }); alert('保存成功'); document.getElementById(`edit-scenic-${id}`).classList.add('hidden'); await refreshAll(); } 
        catch (e) { alert('保存失败：' + e.message); }
    };
}

async function deleteScenicHandler(id) {
    if (!confirm('确认删除此景区？')) return;
    try { await deleteScenic(id); await refreshAll(); } 
    catch (e) { alert('删除失败：' + e.message); }
}

window.saveNewScenic = async function() {
    const name = document.getElementById('new-scenic-name').value.trim();
    const lat = parseFloat(document.getElementById('new-scenic-lat').value);
    const lng = parseFloat(document.getElementById('new-scenic-lng').value);
    if (!name || isNaN(lat) || isNaN(lng)) { alert('名称、经纬度必填'); return; }
    const area = document.getElementById('new-scenic-area').value;
    const description = document.getElementById('new-scenic-desc').value;
    try { await insertScenic({ name, lat, lng, area, description }); alert('新增成功'); document.getElementById('add-scenic-form').classList.add('hidden'); await refreshAll(); } 
    catch (e) { alert('保存失败：' + e.message); }
};

// ============================================================
// POI内部路线编辑器
// ============================================================
function populateEditorSelect(pois) {
    const sel = document.getElementById('editor-poi-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- 选择POI --</option>';
    pois.forEach(p => sel.innerHTML += `<option value="${p.id}">${p.name}</option>`);
}

window.loadPoiForEditor = async function() {
    const sel = document.getElementById('editor-poi-select');
    const poiId = sel.value;
    if (!poiId) { editorNodes = []; editorEdges = []; renderEditorNodes(); return; }
    currentEditorPoiId = poiId;
    try {
        const data = await getPoiInternal(poiId);
        editorNodes = data.nodes || [];
        editorEdges = data.edges || [];
        renderEditorNodes();
        document.getElementById('editor-node-count').textContent = `节点: ${editorNodes.length}`;
        document.getElementById('editor-edge-count').textContent = `路径: ${editorEdges.length}`;
        const level = editorNodes.length > 2 ? 'L1' : (editorNodes.length > 0 ? 'L2' : 'L3');
        document.getElementById('editor-quality-badge').textContent = level;
        document.getElementById('editor-quality-badge').className = `data-quality-badge quality-${level}`;
        // 在地图上显示节点
        if (editorMap) {
            editorMap.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.Polyline) editorMap.removeLayer(l); });
            editorNodes.forEach(n => {
                const marker = L.marker([n.lat, n.lng], { draggable: true }).addTo(editorMap);
                marker.bindPopup(`<b>${n.node_name}</b> (${n.node_type})<br>${n.suggested_duration_min}-${n.suggested_duration_max}分钟`);
                marker.on('dragend', function(e) {
                    const pos = e.target.getLatLng();
                    const node = editorNodes.find(x => x.lat === n.lat && x.lng === n.lng);
                    if (node) { node.lat = pos.lat; node.lng = pos.lng; }
                });
            });
        }
    } catch (e) { console.error(e); alert('加载内部数据失败'); }
};

function renderEditorNodes() {
    const container = document.getElementById('editor-node-list');
    if (!container) return;
    container.innerHTML = editorNodes.map((n, idx) => `
        <div class="node-item">
            <span><span class="badge ${n.node_type === 'core_view' ? 'bg-success' : 'bg-secondary'}">${n.node_type}</span> ${n.node_name} (${n.suggested_duration_min}-${n.suggested_duration_max}分钟)</span>
            <div>
                <button class="btn btn-sm btn-danger" onclick="window.removeEditorNode(${idx})">✕</button>
            </div>
        </div>
    `).join('') || '<span class="text-secondary">暂无节点</span>';
}

window.removeEditorNode = function(idx) {
    if (!confirm('删除此节点？')) return;
    editorNodes.splice(idx, 1);
    renderEditorNodes();
    document.getElementById('editor-node-count').textContent = `节点: ${editorNodes.length}`;
    updateQualityBadge();
};

window.showAddNodeForm = function() {
    document.getElementById('editor-node-form').style.display = 'flex';
    document.getElementById('editor-node-name').value = '';
    document.getElementById('editor-node-type').value = 'core_view';
    document.getElementById('editor-node-dur-min').value = '10';
    document.getElementById('editor-node-dur-max').value = '30';
};

window.saveEditorNode = function() {
    const name = document.getElementById('editor-node-name').value.trim();
    const type = document.getElementById('editor-node-type').value;
    const durMin = parseInt(document.getElementById('editor-node-dur-min').value) || 10;
    const durMax = parseInt(document.getElementById('editor-node-dur-max').value) || 30;
    if (!name) { alert('请输入节点名称'); return; }
    // 获取地图中心坐标
    const center = editorMap ? editorMap.getCenter() : { lat: 31.911705, lng: 107.245033 };
    editorNodes.push({
        id: 'temp_' + Date.now(),
        node_name: name,
        node_type: type,
        lat: center.lat,
        lng: center.lng,
        suggested_duration_min: durMin,
        suggested_duration_max: durMax,
        sort_order: editorNodes.length
    });
    renderEditorNodes();
    document.getElementById('editor-node-form').style.display = 'none';
    document.getElementById('editor-node-count').textContent = `节点: ${editorNodes.length}`;
    updateQualityBadge();
    // 在地图上添加标记
    if (editorMap) {
        const marker = L.marker([center.lat, center.lng], { draggable: true }).addTo(editorMap);
        marker.bindPopup(`<b>${name}</b> (${type})<br>${durMin}-${durMax}分钟`);
        marker.on('dragend', function(e) {
            const pos = e.target.getLatLng();
            const node = editorNodes.find(n => n.node_name === name && n.node_type === type);
            if (node) { node.lat = pos.lat; node.lng = pos.lng; }
        });
    }
};

window.savePoiInternal = async function() {
    if (!currentEditorPoiId) { alert('请先选择POI'); return; }
    if (editorNodes.length === 0) { alert('请至少添加一个节点'); return; }
    try {
        // 先删除旧的节点和边
        await deleteInternalNodes(currentEditorPoiId);
        await deleteInternalEdges(currentEditorPoiId);
        // 插入新节点
        for (let node of editorNodes) {
            const inserted = await insertInternalNode({
                poi_id: currentEditorPoiId,
                node_name: node.node_name,
                node_type: node.node_type,
                lat: node.lat,
                lng: node.lng,
                suggested_duration_min: node.suggested_duration_min || 10,
                suggested_duration_max: node.suggested_duration_max || 30,
                sort_order: node.sort_order || 0
            });
            // 如果有边，更新边引用
        }
        alert('保存成功！');
        await refreshAll();
        // 更新数据等级
        const level = editorNodes.length > 2 ? 'L1' : (editorNodes.length > 0 ? 'L2' : 'L3');
        await updatePoi(currentEditorPoiId, { data_level: level });
        document.getElementById('editor-quality-badge').textContent = level;
        document.getElementById('editor-quality-badge').className = `data-quality-badge quality-${level}`;
    } catch (e) { alert('保存失败：' + e.message); }
};

window.clearPoiInternal = function() {
    if (!confirm('确认清空所有内部节点和路径？')) return;
    editorNodes = [];
    editorEdges = [];
    renderEditorNodes();
    document.getElementById('editor-node-count').textContent = '节点: 0';
    document.getElementById('editor-edge-count').textContent = '路径: 0';
    updateQualityBadge();
    if (editorMap) { editorMap.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.Polyline) editorMap.removeLayer(l); }); }
};

function updateQualityBadge() {
    const level = editorNodes.length > 2 ? 'L1' : (editorNodes.length > 0 ? 'L2' : 'L3');
    document.getElementById('editor-quality-badge').textContent = level;
    document.getElementById('editor-quality-badge').className = `data-quality-badge quality-${level}`;
}

// ============================================================
// 路线管理
// ============================================================
let routeNodes = [];
let currentEditRouteId = null;

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
            <div id="edit-route-${r.id}" class="inline-edit hidden"></div>
        </div>
    `).join('') || '<p>暂无路线</p>';
    window.editRoute = editRouteHandler;
    window.deleteRoute = deleteRouteHandler;
}

async function editRouteHandler(id) {
    const container = document.getElementById(`edit-route-${id}`);
    if (!container.classList.contains('hidden')) { container.classList.add('hidden'); return; }
    const route = allRoutes.find(r => r.id === id);
    if (!route) return;
    document.getElementById('route-form').classList.remove('hidden');
    document.getElementById('edit-route-id').value = id;
    document.getElementById('route-name').value = route.name;
    document.getElementById('route-start-time').value = route.start_time || '08:30';
    document.getElementById('route-transport').value = route.transport || '';
    currentEditRouteId = id;
    const nodes = await getRouteNodes(id);
    routeNodes = nodes.map(n => ({ poi_id: n.poi_id, duration_min: n.duration_min || 60, items: n.items || [] }));
    renderRouteNodes();
    document.getElementById('route-form-title').textContent = '编辑路线';
}

window.deleteRoute = async function(id) {
    if (!confirm('删除路线？')) return;
    try { await deleteRoute(id); await refreshAll(); } 
    catch (e) { alert('删除失败：' + e.message); }
};

function renderRouteNodes() {
    const container = document.getElementById('route-node-selects');
    const opts = allPois.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    let html = '';
    routeNodes.forEach((n, i) => {
        html += `<div class="d-flex gap-2 mb-2">
            <select class="form-select" onchange="window.updateRouteNode(${i}, 'poi_id', this.value)">
                <option value="">--选择--</option>${opts}
            </select>
            <input type="number" class="form-control" style="width:80px" placeholder="分钟" value="${n.duration_min||60}" onchange="window.updateRouteNode(${i}, 'duration_min', this.value)">
            <button class="btn btn-danger" onclick="window.removeRouteNode(${i})">删除</button>
        </div>`;
    });
    container.innerHTML = html;
    routeNodes.forEach((n, i) => {
        const sel = container.querySelectorAll('select')[i];
        if (sel && n.poi_id) sel.value = String(n.poi_id);
    });
    window.updateRouteNode = function(idx, field, value) {
        if (field === 'poi_id') routeNodes[idx].poi_id = value || '';
        else routeNodes[idx].duration_min = parseInt(value) || 60;
    };
    window.removeRouteNode = function(idx) { routeNodes.splice(idx, 1); renderRouteNodes(); };
}

window.addRouteNode = function() { routeNodes.push({ poi_id: '', duration_min: 60, items: [] }); renderRouteNodes(); };

window.saveRoute = async function() {
    const name = document.getElementById('route-name').value.trim();
    if (!name) { alert('输入路线名称'); return; }
    const start_time = document.getElementById('route-start-time').value;
    const transport = document.getElementById('route-transport').value;
    const editId = document.getElementById('edit-route-id').value;
    try {
        let routeId = editId;
        if (editId) { await updateRoute(editId, { name, start_time, transport }); } 
        else { const newRoute = await insertRoute({ name, start_time, transport, days: 1, group_type: 'default' }); routeId = newRoute.id; }
        const nodesPayload = routeNodes.filter(n => n.poi_id).map((n, i) => ({
            route_id: parseInt(routeId), poi_id: parseInt(n.poi_id), order_num: i+1,
            duration_min: n.duration_min || 60, transport_mode: '步行', transport_time: 0, items: n.items || []
        }));
        if (nodesPayload.length === 0) { alert('请至少添加一个有效节点'); return; }
        await deleteRouteNodes(routeId);
        await insertRouteNodes(nodesPayload);
        alert('路线已保存');
        document.getElementById('route-form').classList.add('hidden');
        await refreshAll();
    } catch (e) { alert('保存失败：' + e.message); }
};

// ============================================================
// 交通耗时
// ============================================================
function renderTransportEditor(presets) {
    const container = document.getElementById('transport-editor');
    if (!container) return;
    if (!allPois || allPois.length === 0) { container.innerHTML = '<p>暂无景点数据</p>'; return; }
    let html = '';
    const poiList = allPois.filter(p => !p.parent_id);
    poiList.forEach(poi => {
        html += `<div class="transport-group mb-2 border rounded">
            <div class="transport-header p-2 bg-light" onclick="this.nextElementSibling.classList.toggle('hidden')" style="cursor:pointer;">
                <b>${poi.name}</b> <span class="text-secondary">点击展开</span>
            </div>
            <div class="transport-list p-2 hidden">
                ${poiList.filter(p => p.id !== poi.id).map(target => {
                    const key = `${poi.id}_${target.id}`;
                    const reverseKey = `${target.id}_${poi.id}`;
                    let val = presets.find(p => p.from_poi_id === poi.id && p.to_poi_id === target.id)?.time_min || '';
                    if (!val) val = presets.find(p => p.from_poi_id === target.id && p.to_poi_id === poi.id)?.time_min || '';
                    return `<div class="d-flex justify-content-between py-1 border-bottom">
                        <span>→ ${target.name}</span>
                        <div><input type="number" class="form-control form-control-sm" style="width:80px;display:inline-block" value="${val}" data-from="${poi.id}" data-to="${target.id}" onchange="window.saveTransportHandler(this)"><span class="save-status text-success ms-1"></span></div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    });
    container.innerHTML = html;
    window.saveTransportHandler = async function(input) {
        const from = parseInt(input.dataset.from);
        const to = parseInt(input.dataset.to);
        const val = parseInt(input.value);
        if (isNaN(val) || val < 0) return;
        try {
            await upsertTransportPreset(from, to, val);
            // 反向同步（若不存在则自动填充）
            const existing = transportPresets[`${to}_${from}`];
            if (existing === undefined) {
                await upsertTransportPreset(to, from, val);
            }
            const status = input.parentElement.querySelector('.save-status');
            status.textContent = '✓';
            setTimeout(() => status.textContent = '', 1500);
            await refreshAll();
        } catch (e) { alert('保存失败：' + e.message); }
    };
}

// ============================================================
// 留言管理
// ============================================================
function renderFeedbackList(feedbacks) {
    const container = document.getElementById('feedback-list');
    if (!container) return;
    container.innerHTML = feedbacks.map(f => `
        <div class="card mb-2">
            <div class="d-flex justify-content-between">
                <p class="mb-1">${f.message}</p>
                <button class="btn btn-sm btn-danger" onclick="window.deleteFeedback('${f.id}')">删除</button>
            </div>
            <small class="text-secondary">${new Date(f.created_at).toLocaleString()}</small>
            ${f.reply ? `<div class="text-success mt-1">回复：${f.reply}</div>` : ''}
            <textarea id="reply-${f.id}" class="form-control mt-1" rows="2">${f.reply || ''}</textarea>
            <button class="btn btn-sm btn-primary mt-1" onclick="window.replyFeedback('${f.id}')">回复</button>
        </div>
    `).join('') || '<p>暂无留言</p>';
    window.replyFeedback = async function(id) {
        const reply = document.getElementById(`reply-${id}`).value;
        try { await updateFeedback(id, { reply }); await refreshAll(); } 
        catch (e) { alert('回复失败：' + e.message); }
    };
    window.deleteFeedback = async function(id) {
        if (!confirm('删除此留言？')) return;
        try { await deleteFeedback(id); await refreshAll(); } 
        catch (e) { alert('删除失败：' + e.message); }
    };
}

// ============================================================
// 商户管理
// ============================================================
window.createMerchant = async function() {
    const email = prompt('商户邮箱'); if (!email) return;
    const pwd = prompt('密码'); if (!pwd) return;
    const name = prompt('商户名称'); if (!name) return;
    const poiId = prompt('绑定POI ID（可留空）');
    try {
        // 需要服务端支持，前端仅演示
        alert('商户创建需通过 Supabase Admin API，请联系管理员');
    } catch (e) { alert('创建失败：' + e.message); }
};

// ============================================================
// 辅助
// ============================================================
function populateParentSelect(pois) {
    const sel = document.getElementById('new-poi-parent');
    const mainPois = pois.filter(p => !p.parent_id);
    sel.innerHTML = '<option value="">无（独立景点）</option>';
    mainPois.forEach(p => sel.innerHTML += `<option value="${p.id}">${p.name}</option>`);
}

async function refreshAll() {
    allPois = await getPois();
    allScenic = await getScenicList();
    allRoutes = await getRoutes();
    const presets = await getTransportPresets();
    transportPresets = {};
    presets.forEach(p => { transportPresets[`${p.from_poi_id}_${p.to_poi_id}`] = p.time_min; });
    renderPoiList(allPois);
    renderScenicList(allScenic);
    renderRouteList(allRoutes);
    renderTransportEditor(presets);
    renderFeedbackList(await getFeedbacks(null));
    populateEditorSelect(allPois);
    populateParentSelect(allPois);
}

// ============================================================
// 编辑器地图初始化
// ============================================================
export function initEditorMap() {
    if (editorMap) return editorMap;
    editorMap = L.map('poi-editor-map', { zoomControl: true }).setView([31.911705, 107.245033], 12);
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
        subdomains: ['1','2','3','4'], maxZoom: 18
    }).addTo(editorMap);
    return editorMap;
}

// 在页面加载完成后初始化编辑器地图
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initEditorMap, 500);
});
