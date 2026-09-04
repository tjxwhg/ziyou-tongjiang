// frontend/js/api.js - 前端API调用层
import { SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL } from './config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// Supabase 直接操作（基础数据）
// ============================================================

// POI
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

// POI内部路网
export async function getPoiInternal(poiId) {
    // 获取节点
    const { data: nodes, error: nodesError } = await supabase
        .from('poi_internal_nodes')
        .select('*')
        .eq('poi_id', poiId)
        .order('sort_order');
    if (nodesError) throw nodesError;
    // 获取边
    const nodeIds = (nodes || []).map(n => n.id);
    let edges = [];
    if (nodeIds.length > 0) {
        const { data: edgeData, error: edgeError } = await supabase
            .from('poi_internal_edges')
            .select('*')
            .in('from_node_id', nodeIds);
        if (!edgeError) edges = edgeData || [];
    }
    return { nodes: nodes || [], edges: edges };
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

export async function deletePoiInternalEdges(nodeIds) {
    if (!nodeIds || nodeIds.length === 0) return;
    const { error } = await supabase.from('poi_internal_edges').delete().in('from_node_id', nodeIds);
    if (error) throw error;
}

// 商户
export async function getMerchantsByPoi(poiId) {
    const { data, error } = await supabase.from('ztj_merchants').select('*').eq('poi_id', poiId);
    if (error) throw error;
    return data;
}

export async function getMerchant(id) {
    const { data, error } = await supabase.from('ztj_merchants').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
}

export async function updateMerchant(id, updates) {
    const { error } = await supabase.from('ztj_merchants').update(updates).eq('id', id);
    if (error) throw error;
}

export async function createMerchantRecord(id, displayName, poiId) {
    const { error } = await supabase.from('ztj_merchants').insert({ id, display_name: displayName, poi_id: poiId });
    if (error) throw error;
}

// 预约
export async function getReservations(userId) {
    let query = supabase.from('reservations').select('*');
    if (userId) query = query.eq('user_id', userId);
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

// 留言
export async function getFeedbacks(userId) {
    let query = supabase.from('ztj_feedbacks').select('*');
    if (userId) query = query.eq('user_id', userId);
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

// 行程方案
export async function saveTripSolution(userId, solutionData, style, score) {
    const { data, error } = await supabase.from('trip_solutions').insert({
        user_id: userId,
        solution_data: solutionData,
        style: style || 'custom',
        score: score || 0
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

export async function deleteTripSolution(id) {
    const { error } = await supabase.from('trip_solutions').delete().eq('id', id);
    if (error) throw error;
}

// 用户偏好
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

// 文件上传
export async function uploadFile(bucket, path, file) {
    const { error } = await supabase.storage.from(bucket).upload(path, file);
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
    return publicUrl;
}

// ============================================================
// 后端API调用（行程规划核心）
// ============================================================

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