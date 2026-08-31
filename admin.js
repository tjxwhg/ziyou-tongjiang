// admin.js - 管理后台核心功能
import {
  getPois, insertPoi, updatePoi, deletePoi, getPoisWithFilter,
  getRoutes, insertRoute, updateRoute, deleteRoute,
  getRouteNodes, insertRouteNodes, deleteRouteNodes,
  getTransportPresets, upsertTransportPreset, deleteTransportPresetsForPoi,
  getMerchantsByPoi, updateMerchant, createMerchantRecord,
  getReservations, updateReservation,
  getFeedbacks, updateFeedback, deleteFeedback,
  uploadFile
} from './api.js';
import { getCurrentUser, signInAnonymously } from './auth.js';
import { EXCLUDED_TRANSPORT_CATS, POI_CATEGORIES } from './config.js';

// ---------- POI 管理 ----------
export async function loadAllPois() {
  return getPois();
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
export async function removePoi(id) {
  // 级联删除：交通预设、子点、路线节点
  await deleteTransportPresetsForPoi(id);
  // 删除子点
  const subs = await getPoisWithFilter({ parent_id: id });
  for (let sub of subs) await deletePoi(sub.id);
  // 删除路线节点（需额外实现，暂略）
  await deletePoi(id);
}

// ---------- 路线管理 ----------
export async function loadAllRoutes() {
  return getRoutes();
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
export async function getNodesForRoute(routeId) {
  return getRouteNodes(routeId);
}
export async function saveRouteNodes(routeId, nodes) {
  await deleteRouteNodes(routeId);
  if (nodes && nodes.length) {
    await insertRouteNodes(nodes);
  }
}

// ---------- 交通预设 ----------
export async function loadTransportPresets() {
  return getTransportPresets();
}
export async function saveTransportTime(from, to, time) {
  await upsertTransportPreset(from, to, time);
}
export async function removeTransportPoi(poiId) {
  // 从排除列表中移除（前端维护），这里不涉及数据库
}

// ---------- 商户管理 ----------
export async function createMerchantAccount(email, password, displayName, poiId) {
  // 注意：此操作需要管理员权限，通常应通过 Supabase Auth Admin API 或云函数实现
  // 这里仅作示例，实际需调用服务端接口
  throw new Error('请通过后端云函数或 Admin API 创建商户账号');
}
export async function getMerchantsForPoi(poiId) {
  return getMerchantsByPoi(poiId);
}
export async function updateMerchantInfo(id, updates) {
  await updateMerchant(id, updates);
}

// ---------- 留言管理 ----------
export async function fetchAllFeedbacks() {
  return getFeedbacks(null);
}
export async function replyToFeedback(id, reply) {
  await updateFeedback(id, { reply });
}
export async function removeFeedback(id) {
  await deleteFeedback(id);
}// admin.js - 管理后台核心功能
import {
  getPois, insertPoi, updatePoi, deletePoi, getPoisWithFilter,
  getRoutes, insertRoute, updateRoute, deleteRoute,
  getRouteNodes, insertRouteNodes, deleteRouteNodes,
  getTransportPresets, upsertTransportPreset, deleteTransportPresetsForPoi,
  getMerchantsByPoi, updateMerchant, createMerchantRecord,
  getReservations, updateReservation,
  getFeedbacks, updateFeedback, deleteFeedback,
  uploadFile
} from './api.js';
import { getCurrentUser, signInAnonymously } from './auth.js';
import { EXCLUDED_TRANSPORT_CATS, POI_CATEGORIES } from './config.js';

// ---------- POI 管理 ----------
export async function loadAllPois() {
  return getPois();
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
export async function removePoi(id) {
  // 级联删除：交通预设、子点、路线节点
  await deleteTransportPresetsForPoi(id);
  // 删除子点
  const subs = await getPoisWithFilter({ parent_id: id });
  for (let sub of subs) await deletePoi(sub.id);
  // 删除路线节点（需额外实现，暂略）
  await deletePoi(id);
}

// ---------- 路线管理 ----------
export async function loadAllRoutes() {
  return getRoutes();
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
export async function getNodesForRoute(routeId) {
  return getRouteNodes(routeId);
}
export async function saveRouteNodes(routeId, nodes) {
  await deleteRouteNodes(routeId);
  if (nodes && nodes.length) {
    await insertRouteNodes(nodes);
  }
}

// ---------- 交通预设 ----------
export async function loadTransportPresets() {
  return getTransportPresets();
}
export async function saveTransportTime(from, to, time) {
  await upsertTransportPreset(from, to, time);
}
export async function removeTransportPoi(poiId) {
  // 从排除列表中移除（前端维护），这里不涉及数据库
}

// ---------- 商户管理 ----------
export async function createMerchantAccount(email, password, displayName, poiId) {
  // 注意：此操作需要管理员权限，通常应通过 Supabase Auth Admin API 或云函数实现
  // 这里仅作示例，实际需调用服务端接口
  throw new Error('请通过后端云函数或 Admin API 创建商户账号');
}
export async function getMerchantsForPoi(poiId) {
  return getMerchantsByPoi(poiId);
}
export async function updateMerchantInfo(id, updates) {
  await updateMerchant(id, updates);
}

// ---------- 留言管理 ----------
export async function fetchAllFeedbacks() {
  return getFeedbacks(null);
}
export async function replyToFeedback(id, reply) {
  await updateFeedback(id, { reply });
}
export async function removeFeedback(id) {
  await deleteFeedback(id);
}
