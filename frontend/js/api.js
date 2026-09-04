// js/api.js - 前端API调用层（含所有数据库操作）
import { SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL } from './config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// Supabase 直接操作（基础数据）
// ============================================================

// ---------- POI ----------
export async function getPois() {
    const { data, error } = await supabase.from('ztj_poi').select('*').eq('status', 'active');
    if (error) throw error;
    return data;
}

export async function getPoi(id) {
    const { data, error } = await supabase.from('ztj_poi').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
}

export async function insertPoi(poi) {
    const { data, error } = await supabase.from('ztj_poi').insert(poi).select();
    if (error) throw error;
    return data[0];
}

export async function updatePoi(id, updates) {
    const { error } = await supabase.from('ztj_poi').update(updates).eq('id', id);
    if (error) throw error;
}

export async function deletePoi(id) {
    const { error } = await supabase.from('ztj_poi').delete().eq('id', id);
    if (error) throw error;
}

// ---------- 景区管理（新增） ----------
export async function getScenicList() {
    const { data, error } = await supabase.from('ztj_scenic').select('*').order('name');
    if (error) throw error;
    return data || [];
}

export async function insertScenic(scenic) {
    const { data, error } = await supabase.from('ztj_scenic').insert(scenic).select();
    if (error) throw error;
    return data[0];
}

export async function updateScenic(id, updates) {
    const { error } = await supabase.from('ztj_scenic').update(updates).eq('id', id);
    if (error) throw error;
}

export async function deleteScenic(id) {
    const { error } = await supabase.from('ztj_scenic').delete().eq('id', id);
    if (error) throw error;
}

// ---------- 内部节点和边 ----------
export async function getPoiInternal(poiId) {
    const { data: nodes, error: nodesError } = await supabase
        .from('poi_internal_nodes')
        .select('*')
        .eq('poi_id', poiId)
        .order('sort_order');
    if (nodesError) throw nodesError;
    const nodeIds = nodes.map(n => n.id);
    let edges = [];
    if (nodeIds.length > 0) {
        const { data: edgesData, error: edgesError } = await supabase
            .from('poi_internal_edges')
            .select('*')
            .in('from_node_id', nodeIds);
        if (edgesError) throw edgesError;
        edges = edgesData || [];
    }
    return { nodes: nodes || [], edges: edges || [] };
}

export async function insertPoiInternalNode(node) {
    const { data, error } = await supabase.from('poi_internal_nodes').insert(node).select();
    if (error) throw error;
    return data[0];
}

export async function insertPoiInternalEdge(edge) {
    const { data, error } = await supabase.from('poi_internal_edges').insert(edge).select();
    if (error) throw error;
    return data[0];
}

export async function deletePoiInternalNodes(poiId) {
    const { error } = await supabase.from('poi_internal_nodes').delete().eq('poi_id', poiId);
    if (error) throw error;
}

// ---------- 路线 ----------
export async function getRoutes() {
    const { data, error } = await supabase.from('ztj_routes').select('*');
    if (error) throw error;
    return data;
}

export async function getRoute(id) {
    const { data, error } = await supabase.from('ztj_routes').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
}

export async function insertRoute(route) {
    const { data, error } = await supabase.from('ztj_routes').insert(route).select();
    if (error) throw error;
    return data[0];
}

export async function updateRoute(id, updates) {
    const { error } = await supabase.from('ztj_routes').update(updates).eq('id', id);
    if (error) throw error;
}

export async function deleteRoute(id) {
    const { error } = await supabase.from('ztj_routes').delete().eq('id', id);
    if (error) throw error;
}

export async function getRouteNodes(routeId) {
    const { data, error } = await supabase.from('ztj_route_nodes').select('*').eq('route_id', routeId).order('order_num');
    if (error) throw error;
    return data;
}

export async function insertRouteNodes(nodes) {
    const { error } = await supabase.from('ztj_route_nodes').insert(nodes);
    if (error) throw error;
}

export async function deleteRouteNodes(routeId) {
    const { error } = await supabase.from('ztj_route_nodes').delete().eq('route_id', routeId);
    if (error) throw error;
}

// ---------- 交通预设 ----------
export async function getTransportPresets() {
    const { data, error } = await supabase.from('ztj_transport_presets').select('*');
    if (error) throw error;
    return data;
}

export async function upsertTransportPreset(from, to, time) {
    const { error } = await supabase.from('ztj_transport_presets').upsert(
        { from_poi_id: from, to_poi_id: to, travel_mode: 'auto', time_min: time },
        { onConflict: 'from_poi_id,to_poi_id' }
    );
    if (error) throw error;
}

export async function deleteTransportPresetsForPoi(poiId) {
    const { error } = await supabase.from('ztj_transport_presets').delete().or(`from_poi_id.eq.${poiId},to_poi_id.eq.${poiId}`);
    if (error) throw error;
}

// ---------- 商户 ----------
export async function getMerchant(id) {
    const { data, error } = await supabase.from('ztj_merchants').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
}

export async function updateMerchant(id, updates) {
    const { error } = await supabase.from('ztj_merchants').update(updates).eq('id', id);
    if (error) throw error;
}

export async function getMerchantsByPoi(poiId) {
    const { data, error } = await supabase.from('ztj_merchants').select('*').eq('poi_id', poiId);
    if (error) throw error;
    return data;
}

export async function createMerchantRecord(id, displayName, poiId) {
    const { error } = await supabase.from('ztj_merchants').insert({ id, display_name: displayName, poi_id: poiId });
    if (error) throw error;
}

// ---------- 预约 ----------
export async function getReservations(merchantId) {
    const query = supabase.from('reservations').select('*');
    if (merchantId) query.eq('merchant_id', merchantId);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

export async function insertReservation(res) {
    const { data, error } = await supabase.from('reservations').insert(res).select();
    if (error) throw error;
    return data[0];
}

export async function updateReservation(id, updates) {
    const { error } = await supabase.from('reservations').update(updates).eq('id', id);
    if (error) throw error;
}

export async function deleteReservation(id) {
    const { error } = await supabase.from('reservations').delete().eq('id', id);
    if (error) throw error;
}

// ---------- 留言 ----------
export async function getFeedbacks(merchantId) {
    const query = supabase.from('ztj_feedbacks').select('*');
    if (merchantId) query.eq('merchant_id', merchantId);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

export async function insertFeedback(fb) {
    const { data, error } = await supabase.from('ztj_feedbacks').insert(fb).select();
    if (error) throw error;
    return data[0];
}

export async function updateFeedback(id, updates) {
    const { error } = await supabase.from('ztj_feedbacks').update(updates).eq('id', id);
    if (error) throw error;
}

export async function deleteFeedback(id) {
    const { error } = await supabase.from('ztj_feedbacks').delete().eq('id', id);
    if (error) throw error;
}

// ---------- 文件上传 ----------
export async function uploadFile(bucket, path, file) {
    const { error } = await supabase.storage.from(bucket).upload(path, file);
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
    return publicUrl;
}

// ---------- 用户偏好 ----------
export async function getUserPreferences(userId) {
    const { data, error } = await supabase.from('user_preferences').select('*').eq('user_id', userId).single();
    if (error && error.code === 'PGRST116') return null;
    if (error) throw error;
    return data;
}

export async function saveUserPreferences(prefs) {
    const { error } = await supabase.from('user_preferences').upsert(prefs);
    if (error) throw error;
}

// ---------- 行程方案 ----------
export async function saveTripSolution(userId, solutionData, style, score) {
    const { data, error } = await supabase.from('trip_solutions').insert({
        user_id: userId,
        solution_data: solutionData,
        style: style,
        score: score
    }).select();
    if (error) throw error;
    return data[0];
}

export async function getUserTripSolutions(userId) {
    const { data, error } = await supabase.from('trip_solutions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

// ============================================================
// 后端API调用（行程规划核心）
// ============================================================

/**
 * 生成行程方案
 */
export async function generatePlans(params) {
    const response = await fetch(`${API_BASE_URL}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || '生成方案失败');
    }
    return response.json();
}

/**
 * 选择方案
 */
export async function selectPlan(params) {
    const response = await fetch(`${API_BASE_URL}/plan/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || '保存方案失败');
    }
    return response.json();
}

/**
 * 上报偏差
 */
export async function reportDeviation(params) {
    const response = await fetch(`${API_BASE_URL}/trip/deviation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || '上报偏差失败');
    }
    return response.json();
}
