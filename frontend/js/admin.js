// js/admin.js - 管理后台核心逻辑
import { 
    getPois, getPoi, insertPoi, updatePoi, deletePoi,
    getRoutes, getRoute, insertRoute, updateRoute, deleteRoute,
    getRouteNodes, insertRouteNodes, deleteRouteNodes,
    getTransportPresets, upsertTransportPreset, deleteTransportPresetsForPoi,
    getMerchantsByPoi, getMerchant, updateMerchant, createMerchantRecord,
    getReservations, updateReservation,
    getFeedbacks, updateFeedback, deleteFeedback,
    uploadFile, getPoiInternal, getPoisInfo
} from './api.js';
import { getCurrentUser } from './auth.js';
import { POI_CATEGORIES, EXCLUDED_TRANSPORT_CATS } from './config.js';

let allPois = [];
let allRoutes = [];
let transportPresets = {};
let currentEditPoiId = null;
let currentEditRouteId = null;
let routeNodes = [];

// ============================================================
// POI管理
// ============================================================
export async function loadAllPois() {
    allPois = await getPois();
    return allPois;
}

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
    await deletePoi(id);
}

// 获取POI内部路网数据（用于编辑器）
export async function loadPoiInternal(poiId) {
    return getPoiInternal(poiId);
}

// 保存POI内部路网（节点+边）
export async function savePoiInternal(poiId, nodes, edges) {
    // 先删除旧的节点和边
    await deletePoiInternal(poiId);
    // 插入新节点
    if (nodes && nodes.length > 0) {
        for (let node of nodes) {
            await insertPoiInternalNode(poiId, node);
        }
    }
    // 插入新边
    if (edges && edges.length > 0) {
        for (let edge of edges) {
            await insertPoiInternalEdge(edge);
        }
    }
    // 更新POI数据等级
    const level = nodes && nodes.length > 2 ? 'L1' : (nodes && nodes.length > 0 ? 'L2' : 'L3');
    await updatePoi(poiId, { data_level: level });
}

export async function deletePoiInternal(poiId) {
    // 实际需要调用Supabase删除
    // 简化：通过supabase直接操作
    const { data: nodes } = await getPoiInternal(poiId);
    if (nodes && nodes.length > 0) {
        const nodeIds = nodes.map(n => n.id);
        // 删除边和节点
        // 实际实现需通过Supabase
    }
}

// ============================================================
// 路线管理
// ============================================================
export async function loadAllRoutes() {
    allRoutes = await getRoutes();
    return allRoutes;
}

export async function addRoute(routeData) {
    return insertRoute(routeData);
}

export async function editRoute(id, updates) {
    await updateRoute(id, updates);
}

export async function deleteRoute(id) {
    await deleteRouteNodes(id);
    await deleteRoute(id);
}

export async function getRouteNodes(routeId) {
    return getRouteNodes(routeId);
}

export async function saveRouteNodes(routeId, nodes) {
    await deleteRouteNodes(routeId);
    if (nodes && nodes.length > 0) {
        await insertRouteNodes(nodes);
    }
}

// ============================================================
// 交通预设管理
// ============================================================
export async function loadTransportPresets() {
    const data = await getTransportPresets();
    transportPresets = {};
    if (data) {
        data.forEach(p => {
            transportPresets[`${p.from_poi_id}_${p.to_poi_id}`] = p.time_min;
        });
    }
    return data;
}

export async function saveTransportTime(from, to, time) {
    await upsertTransportPreset(from, to, time);
}

export async function removeTransportPoi(poiId) {
    // 前端维护排除列表
    const excluded = JSON.parse(localStorage.getItem('excludedTransportPois') || '[]');
    if (!excluded.includes(poiId)) {
        excluded.push(poiId);
        localStorage.setItem('excludedTransportPois', JSON.stringify(excluded));
    }
}

// ============================================================
// 商户管理
// ============================================================
export async function getMerchants() {
    // 获取所有商户
    const { data } = await supabase.from('ztj_merchants').select('*');
    return data || [];
}

export async function createMerchantAccount(email, password, displayName, poiId) {
    // 实际应通过后端API创建用户
    // 前端简化：创建商户记录
    const user = await getCurrentUser();
    if (!user) throw new Error('请先登录');
    // 需要管理员权限，此处仅作示例
    await createMerchantRecord(user.id, displayName, poiId);
}

// ============================================================
// 留言管理
// ============================================================
export async function fetchAllFeedbacks() {
    return getFeedbacks(null);
}

export async function replyToFeedback(id, reply) {
    await updateFeedback(id, { reply });
}

export async function deleteFeedback(id) {
    await deleteFeedback(id);
}

// ============================================================
// POI编辑器相关
// ============================================================
export async function loadPoisForEditor() {
    return getPois();
}

let editorMap = null;
let editorNodes = [];
let editorEdges = [];
let currentEditorPoiId = null;
let drawControl = null;
let drawnItems = null;
let tempNodeData = null;

// 初始化POI编辑器地图
export function initEditorMap(containerId) {
    if (editorMap) return editorMap;
    editorMap = L.map(containerId, { zoomControl: true }).setView([31.911705, 107.245033], 13);
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
        subdomains: ['1', '2', '3', '4'],
        maxZoom: 18
    }).addTo(editorMap);
    return editorMap;
}

export function setEditorPoi(poiId, poiName) {
    currentEditorPoiId = poiId;
    document.getElementById('editor-status').textContent = `编辑: ${poiName}`;
    loadEditorData(poiId);
}

async function loadEditorData(poiId) {
    try {
        const data = await getPoiInternal(poiId);
        editorNodes = data.nodes || [];
        editorEdges = data.edges || [];
        renderEditorNodes();
        renderEditorEdges();
        document.getElementById('editor-node-count').textContent = `节点: ${editorNodes.length}`;
        document.getElementById('editor-edge-count').textContent = `路径: ${editorEdges.length}`;
        // 更新质量等级
        const level = editorNodes.length > 2 ? 'L1' : (editorNodes.length > 0 ? 'L2' : 'L3');
        document.getElementById('editor-quality-badge').textContent = level;
        document.getElementById('editor-quality-badge').className = `data-quality-badge quality-${level}`;
    } catch (e) {
        console.warn('加载编辑器数据失败:', e);
    }
}

function renderEditorNodes() {
    const container = document.getElementById('editor-node-list');
    if (!container) return;
    container.innerHTML = editorNodes.map((n, idx) => `
        <div class="node-item">
            <span>
                <span class="badge bg-secondary">${n.node_type || 'other'}</span>
                ${n.node_name || '未命名'}
            </span>
            <button class="btn btn-sm btn-danger" onclick="window.removeEditorNode(${idx})">✕</button>
        </div>
    `).join('') || '<span class="text-secondary">暂无节点</span>';
}

function renderEditorEdges() {
    // 简单渲染，实际可能显示在地图上
}

export function addEditorNode(nodeData) {
    editorNodes.push({
        id: `temp_${Date.now()}`,
        poi_id: currentEditorPoiId,
        node_name: nodeData.name || '未命名',
        node_type: nodeData.type || 'other',
        lat: nodeData.lat,
        lng: nodeData.lng,
        suggested_duration_min: parseInt(nodeData.durMin) || 10,
        suggested_duration_max: parseInt(nodeData.durMax) || 30,
        sort_order: editorNodes.length
    });
    renderEditorNodes();
    document.getElementById('editor-node-count').textContent = `节点: ${editorNodes.length}`;
}

export function removeEditorNode(index) {
    editorNodes.splice(index, 1);
    renderEditorNodes();
    document.getElementById('editor-node-count').textContent = `节点: ${editorNodes.length}`;
}

export async function saveEditorData() {
    if (!currentEditorPoiId) {
        alert('请先选择POI');
        return;
    }
    try {
        await savePoiInternal(currentEditorPoiId, editorNodes, editorEdges);
        alert('保存成功');
        const level = editorNodes.length > 2 ? 'L1' : (editorNodes.length > 0 ? 'L2' : 'L3');
        document.getElementById('editor-quality-badge').textContent = level;
        document.getElementById('editor-quality-badge').className = `data-quality-badge quality-${level}`;
    } catch (e) {
        alert('保存失败：' + e.message);
    }
}

export function clearEditorData() {
    if (!confirm('确定清空所有节点和路径？')) return;
    editorNodes = [];
    editorEdges = [];
    renderEditorNodes();
    document.getElementById('editor-node-count').textContent = '节点: 0';
    document.getElementById('editor-edge-count').textContent = '路径: 0';
    document.getElementById('editor-quality-badge').textContent = 'L3';
    document.getElementById('editor-quality-badge').className = 'data-quality-badge quality-L3';
}

// ============================================================
// 工具函数（导出给前端使用）
// ============================================================
export function getPoiList() {
    return allPois;
}

export function getRouteList() {
    return allRoutes;
}

export function getTransportPresetsData() {
    return transportPresets;
}