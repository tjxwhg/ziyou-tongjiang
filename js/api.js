// js/api.js - Supabase API 操作（交通耗时改用 ztj_transport_times 无方向表）
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// 缓存版本号
// ============================================================
export function bumpCacheVersion() {
    try {
        const v = parseInt(localStorage.getItem('ztj_cache_version') || '0', 10) + 1;
        localStorage.setItem('ztj_cache_version', String(v));
    } catch (e) { /* ignore */ }
}
export function getCacheVersion() {
    try { return localStorage.getItem('ztj_cache_version') || '0'; }
    catch (e) { return '0'; }
}

// ========== POI ==========
export async function getPois() {
    const { data, error } = await supabase
        .from('ztj_poi')
        .select('*')
        .eq('status', 'active')
        .order('id', { ascending: true });
    if (error) throw error;
    return data || [];
}

export async function getPoi(id) {
    const { data, error } = await supabase.from('ztj_poi').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
}

export async function insertPoi(poi) {
    const { data, error } = await supabase.from('ztj_poi').insert(poi).select();
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('插入失败：未返回数据');
    bumpCacheVersion();
    return data[0];
}

export async function updatePoi(id, updates) {
    const { error } = await supabase.from('ztj_poi').update(updates).eq('id', id);
    if (error) throw error;
    bumpCacheVersion();
}

export async function deletePoi(id) {
    const { error } = await supabase.from('ztj_poi').delete().eq('id', id);
    if (error) throw error;
    bumpCacheVersion();
}

// ========== 景区 ==========
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

// ========== POI 内部节点 ==========
export async function getPoiInternal(poiId) {
    const { data: nodes, error: nodesError } = await supabase
        .from('poi_internal_nodes').select('*').eq('poi_id', poiId).order('sort_order');
    if (nodesError) throw nodesError;
    const nodeIds = (nodes || []).map(n => n.id);
    let edges = [];
    if (nodeIds.length > 0) {
        const { data: edgesData, error: edgesError } = await supabase
            .from('poi_internal_edges').select('*').in('from_node_id', nodeIds);
        if (edgesError) throw edgesError;
        edges = edgesData || [];
    }
    return { nodes: nodes || [], edges: edges || [] };
}
export async function insertInternalNode(node) {
    const { data, error } = await supabase.from('poi_internal_nodes').insert(node).select();
    if (error) throw error;
    return data[0];
}
export async function insertInternalEdge(edge) {
    const { data, error } = await supabase.from('poi_internal_edges').insert(edge).select();
    if (error) throw error;
    return data[0];
}
export async function deleteInternalNodes(poiId) {
    const { error } = await supabase.from('poi_internal_nodes').delete().eq('poi_id', poiId);
    if (error) throw error;
}
export async function deleteInternalEdges(poiId) {
    const { error } = await supabase.from('poi_internal_edges').delete().eq('poi_id', poiId);
    if (error) throw error;
}

// ========== 路线 ==========
export async function getRoutes() {
    const { data, error } = await supabase.from('ztj_routes').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
}
export async function getRoute(id) {
    const { data, error } = await supabase.from('ztj_routes').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
}
export async function insertRoute(route) {
    const { data, error } = await supabase.from('ztj_routes').insert(route).select();
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('路线插入失败');
    bumpCacheVersion();
    return data[0];
}
export async function updateRoute(id, updates) {
    const { error } = await supabase.from('ztj_routes').update(updates).eq('id', id);
    if (error) throw error;
    bumpCacheVersion();
}
export async function deleteRoute(id) {
    const { error } = await supabase.from('ztj_routes').delete().eq('id', id);
    if (error) throw error;
    bumpCacheVersion();
}
export async function getRouteNodes(routeId) {
    const { data, error } = await supabase
        .from('ztj_route_nodes').select('*').eq('route_id', routeId).order('order_num');
    if (error) throw error;
    return data || [];
}
export async function insertRouteNodes(nodes) {
    if (!nodes || nodes.length === 0) return;
    const { error } = await supabase.from('ztj_route_nodes').insert(nodes);
    if (error) throw error;
}
export async function deleteRouteNodes(routeId) {
    const { error } = await supabase.from('ztj_route_nodes').delete().eq('route_id', routeId);
    if (error) throw error;
}

// ============================================================
// 交通耗时（新表 ztj_transport_times，无方向，poi_a < poi_b）
// ============================================================

/**
 * 读取所有交通耗时记录
 * 返回 [{ poi_a, poi_b, time_min, updated_at }, ...]
 */
export async function getTransportTimes() {
    const { data, error } = await supabase
        .from('ztj_transport_times')
        .select('*')
        .order('poi_a', { ascending: true })
        .order('poi_b', { ascending: true });
    if (error) throw error;
    return data || [];
}

/**
 * 写入/更新一对 POI 之间的耗时（无论哪个方向）
 */
export async function setTransportTime(poiX, poiY, timeMin) {
    const a = Math.min(Number(poiX), Number(poiY));
    const b = Math.max(Number(poiX), Number(poiY));
    const { error } = await supabase
        .from('ztj_transport_times')
        .upsert(
            { poi_a: a, poi_b: b, time_min: timeMin, updated_at: new Date().toISOString() },
            { onConflict: 'poi_a,poi_b' }
        );
    if (error) throw error;
    bumpCacheVersion();
}

/**
 * 删除一对 POI 的耗时
 */
export async function deleteTransportTime(poiX, poiY) {
    const a = Math.min(Number(poiX), Number(poiY));
    const b = Math.max(Number(poiX), Number(poiY));
    const { error } = await supabase
        .from('ztj_transport_times')
        .delete()
        .eq('poi_a', a)
        .eq('poi_b', b);
    if (error) throw error;
    bumpCacheVersion();
}

/**
 * 删除涉及某 POI 的所有交通耗时
 */
export async function deleteTransportTimesForPoi(poiId) {
    const id = Number(poiId);
    const { error: e1 } = await supabase
        .from('ztj_transport_times').delete().eq('poi_a', id);
    if (e1) throw e1;
    const { error: e2 } = await supabase
        .from('ztj_transport_times').delete().eq('poi_b', id);
    if (e2) throw e2;
    bumpCacheVersion();
}

/**
 * 应用"基准 + 偏移"：为 poiId 生成完整的耗时数据
 * - 读取 basePoiId 的所有数据
 * - 规则：与 basePoiId 那一对用原值；其他项 = 原值 + offset
 * - 先删 poiId 的旧数据，再批量插入
 * - 记录 base_poi_id / base_offset 到 ztj_poi
 */
export async function applyBaseWithOffset(poiId, basePoiId, offset) {
    const poiIdNum = Number(poiId);
    const baseIdNum = Number(basePoiId);
    if (poiIdNum === baseIdNum) throw new Error('基准 POI 不能是自己');

    // 1. 读取基准 POI 的所有数据
    const { data: baseTimes, error } = await supabase
        .from('ztj_transport_times')
        .select('*')
        .or(`poi_a.eq.${baseIdNum},poi_b.eq.${baseIdNum}`);
    if (error) throw error;

    // 2. 生成新的行
    const newRows = [];
    const seen = new Set();   // 防止重复 (poi_a, poi_b)
    for (const bt of (baseTimes || [])) {
        const other = Number(bt.poi_a) === baseIdNum ? Number(bt.poi_b) : Number(bt.poi_a);
        if (other === poiIdNum) continue;   // 自身跳过（下面单独处理）
        let newTime;
        if (other === baseIdNum) {
            newTime = bt.time_min;           // 理论上不会到这里
        } else {
            newTime = Math.max(0, bt.time_min + offset);
        }
        const a = Math.min(poiIdNum, other);
        const b = Math.max(poiIdNum, other);
        const key = `${a}_${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        newRows.push({ poi_a: a, poi_b: b, time_min: newTime });
    }

    // 3. 特殊处理：当前 POI ↔ 基准 POI 这一对
    //    从 baseTimes 里找 base ↔ current 的原始值
    let baseCurrentRow = null;
    for (const bt of (baseTimes || [])) {
        const a = Number(bt.poi_a);
        const b = Number(bt.poi_b);
        if ((a === baseIdNum && b === poiIdNum) || (a === poiIdNum && b === baseIdNum)) {
            baseCurrentRow = bt;
            break;
        }
    }
    if (baseCurrentRow) {
        const a = Math.min(baseIdNum, poiIdNum);
        const b = Math.max(baseIdNum, poiIdNum);
        const key = `${a}_${b}`;
        if (!seen.has(key)) {
            newRows.push({ poi_a: a, poi_b: b, time_min: baseCurrentRow.time_min });
        }
    }

    // 4. 删除当前 POI 的旧数据
    const { error: delA } = await supabase
        .from('ztj_transport_times').delete().eq('poi_a', poiIdNum);
    if (delA) throw delA;
    const { error: delB } = await supabase
        .from('ztj_transport_times').delete().eq('poi_b', poiIdNum);
    if (delB) throw delB;

    // 5. 批量插入新数据
    if (newRows.length > 0) {
        const { error: insertError } = await supabase
            .from('ztj_transport_times')
            .insert(newRows);
        if (insertError) throw insertError;
    }

    // 6. 记录基准关系到 POI 表
    const { error: poiError } = await supabase
        .from('ztj_poi')
        .update({ base_poi_id: baseIdNum, base_offset: offset })
        .eq('id', poiIdNum);
    if (poiError) throw poiError;

    bumpCacheVersion();
}

/**
 * 清除基准关系（不删数据）
 */
export async function clearBaseRelation(poiId) {
    const { error } = await supabase
        .from('ztj_poi')
        .update({ base_poi_id: null, base_offset: 0 })
        .eq('id', poiId);
    if (error) throw error;
    bumpCacheVersion();
}

/**
 * 查出参照某 POI 作为基准的所有 POI
 */
export async function getDependents(poiId) {
    const { data, error } = await supabase
        .from('ztj_poi')
        .select('id, name')
        .eq('base_poi_id', poiId);
    if (error) throw error;
    return data || [];
}

// ========== 商户 ==========
export async function getMerchant(id) {
    const { data, error } = await supabase.from('ztj_merchants').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
}
export async function updateMerchant(id, updates) {
    const { error } = await supabase.from('ztj_merchants').update(updates).eq('id', id);
    if (error) throw error;
}
export async function getMerchantsByPoi(poiId) {
    let query = supabase.from('ztj_merchants').select('*');
    if (poiId !== undefined && poiId !== null) {
        query = query.eq('poi_id', poiId);
    } else if (poiId === null) {
        query = query.is('poi_id', null);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}
export async function createMerchantRecord(id, displayName, poiId) {
    const { error } = await supabase.from('ztj_merchants').insert({ id, display_name: displayName, poi_id: poiId });
    if (error) throw error;
}
export async function getMerchantByPoi(poiId) {
    const { data, error } = await supabase
        .from('ztj_merchants').select('*').eq('poi_id', poiId).maybeSingle();
    if (error) throw error;
    return data;
}

// ========== 预约 ==========
export async function getReservations(merchantId) {
    let query = supabase.from('reservations').select('*');
    if (merchantId) query = query.eq('merchant_id', merchantId);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}
export async function getReservationsByDevice(deviceId) {
    const { data, error } = await supabase
        .from('reservations').select('*').eq('device_id', deviceId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
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

// ========== 留言 ==========
export async function getFeedbacks(merchantId) {
    let query = supabase.from('ztj_feedbacks').select('*');
    if (merchantId) query = query.eq('merchant_id', merchantId);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}
export async function getFeedbacksByDevice(deviceId) {
    const { data, error } = await supabase
        .from('ztj_feedbacks').select('*').eq('device_id', deviceId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
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

// ========== 文件上传 ==========
export async function uploadFile(bucket, path, file) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
    return publicUrl;
}

// ========== 用户偏好 ==========
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

// ========== 行程方案 ==========
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
    if (!userId) return [];
    const { data, error } = await supabase.from('trip_solutions')
        .select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

// ========== 偏差记录 ==========
export async function saveDeviationRecord(solutionId, deviationMinutes, reason, adjustedSolution) {
    const { error } = await supabase.from('real_time_deviation').insert({
        trip_solution_id: solutionId,
        deviation_minutes: deviationMinutes,
        trigger_reason: reason,
        adjusted_solution: adjustedSolution
    });
    if (error) throw error;
}
