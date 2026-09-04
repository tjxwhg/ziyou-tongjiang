// data/poi-graph.js
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

/**
 * 获取单个POI的内部路网数据（节点+边）
 * @param {string} poiId
 * @returns {Promise<{ nodes: Array, edges: Array }>}
 */
async function getPoiInternalGraph(poiId) {
  // 获取节点
  const { data: nodes, error: nodesError } = await supabase
    .from('poi_internal_nodes')
    .select('*')
    .eq('poi_id', poiId)
    .order('sort_order');

  if (nodesError) throw new Error(`获取内部节点失败: ${nodesError.message}`);

  // 获取边
  const { data: edges, error: edgesError } = await supabase
    .from('poi_internal_edges')
    .select('*')
    .in('from_node_id', nodes.map(n => n.id));

  if (edgesError) throw new Error(`获取内部边失败: ${edgesError.message}`);

  return { nodes: nodes || [], edges: edges || [] };
}

/**
 * 获取所有POI的基本信息（含开放时间）
 * @param {Array} poiIds - 可选，指定POI ID列表
 * @returns {Promise<Array>}
 */
async function getPoisInfo(poiIds = null) {
  let query = supabase
    .from('ztj_poi')
    .select('id, name, lat, lng, category, description, open_time, close_time, visit_duration, voice_mp3')
    .eq('status', 'active');

  if (poiIds && poiIds.length > 0) {
    query = query.in('id', poiIds);
  }

  const { data, error } = await query;
  if (error) throw new Error(`获取POI信息失败: ${error.message}`);
  return data || [];
}

/**
 * 获取景点间交通耗时矩阵
 * @returns {Promise<Object>} { 'fromId_toId': minutes }
 */
async function getTravelTimeMatrix() {
  const { data, error } = await supabase
    .from('ztj_transport_presets')
    .select('from_poi_id, to_poi_id, time_min');

  if (error) throw new Error(`获取交通矩阵失败: ${error.message}`);

  const matrix = {};
  for (let row of data) {
    const key = `${row.from_poi_id}_${row.to_poi_id}`;
    matrix[key] = row.time_min;
  }
  return matrix;
}

/**
 * 获取商户信息（用于预约展示）
 * @param {string} merchantId
 * @returns {Promise<Object>}
 */
async function getMerchantInfo(merchantId) {
  const { data, error } = await supabase
    .from('ztj_merchants')
    .select('id, display_name, business_type, phone, address, status, parking_spots, service_data')
    .eq('id', merchantId)
    .single();

  if (error) return null;
  return data;
}

/**
 * 保存行程方案
 * @param {Object} solutionData - 完整行程数据
 * @param {string} userId - 用户ID
 * @param {string} style - 方案风格
 * @param {number} score - 目标函数值
 * @returns {Promise<{ id: string }>}
 */
async function saveTripSolution(solutionData, userId, style, score) {
  const { data, error } = await supabase
    .from('trip_solutions')
    .insert({
      user_id: userId,
      solution_data: solutionData,
      style: style,
      score: score
    })
    .select('id')
    .single();

  if (error) throw new Error(`保存行程方案失败: ${error.message}`);
  return { id: data.id };
}

/**
 * 保存实时偏差记录
 * @param {string} solutionId - 关联的行程方案ID
 * @param {number} deviationMinutes - 偏差分钟数
 * @param {string} reason - 触发原因
 * @param {Object} adjustedSolution - 调整后的方案(可选)
 */
async function saveDeviationRecord(solutionId, deviationMinutes, reason, adjustedSolution = null) {
  const { error } = await supabase
    .from('real_time_deviation')
    .insert({
      trip_solution_id: solutionId,
      deviation_minutes: deviationMinutes,
      trigger_reason: reason,
      adjusted_solution: adjustedSolution
    });

  if (error) throw new Error(`保存偏差记录失败: ${error.message}`);
}

/**
 * 获取用户偏好
 * @param {string} userId
 * @returns {Promise<Object>}
 */
async function getUserPreferences(userId) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code === 'PGRST116') {
    // 未找到记录，返回默认偏好
    return {
      user_id: userId,
      preferred_categories: [],
      cuisine_prefs: [],
      pace: 'relaxed',
      max_walking_per_day: 15000
    };
  }
  if (error) throw new Error(`获取用户偏好失败: ${error.message}`);
  return data;
}

/**
 * 更新用户偏好
 * @param {string} userId
 * @param {Object} updates
 */
async function updateUserPreferences(userId, updates) {
  const { error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id: userId,
      ...updates,
      updated_at: new Date().toISOString()
    });

  if (error) throw new Error(`更新用户偏好失败: ${error.message}`);
}

/**
 * 保存行程评价
 * @param {string} userId
 * @param {string} solutionId
 * @param {number} rating
 * @param {string} comment
 */
async function saveFeedback(userId, solutionId, rating, comment) {
  const { error } = await supabase
    .from('feedback_ratings')
    .insert({
      user_id: userId,
      trip_solution_id: solutionId,
      rating: rating,
      comment: comment
    });

  if (error) throw new Error(`保存评价失败: ${error.message}`);
}

module.exports = {
  getPoiInternalGraph,
  getPoisInfo,
  getTravelTimeMatrix,
  getMerchantInfo,
  saveTripSolution,
  saveDeviationRecord,
  getUserPreferences,
  updateUserPreferences,
  saveFeedback
};