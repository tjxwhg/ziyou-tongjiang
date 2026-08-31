import {
  getPois, insertPoi, updatePoi, deletePoi,
  getRoutes, insertRoute, updateRoute, deleteRoute,
  getRouteNodes, insertRouteNodes, deleteRouteNodes,
  getTransportPresets, upsertTransportPreset, deleteTransportPresetsForPoi,
  getMerchantsByPoi, updateMerchant,
  getReservations, updateReservation,
  getFeedbacks, updateFeedback, deleteFeedback,
  uploadFile
} from './api.js';
import { getCurrentUser } from './auth.js';
import { EXCLUDED_TRANSPORT_CATS } from './config.js';

// POI 管理
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
  // 级联删除：交通预设、子点、路线节点（此处需额外 API，简化）
  await deleteTransportPresetsForPoi(id);
  // 子点删除（需先查询所有子点）
  const subs = await getPois({ parent_id: id }); // 需扩展 getPois 支持过滤
  for (let sub of subs) await deletePoi(sub.id);
  // 删除自身
  await deletePoi(id);
}

// 路线管理（类似，略）

// 交通耗时
export async function loadTransportPresets() {
  return getTransportPresets();
}
export async function saveTransportTime(from, to, time) {
  await upsertTransportPreset(from, to, time);
}

// 商户创建（需 admin 权限，建议后端实现）
export async function createMerchantAccount(email, password, displayName, poiId) {
  // 实际应调用云函数或服务端 API
  throw new Error('Not implemented in client');
}

// 留言管理
export async function fetchAllFeedbacks() {
  return getFeedbacks(null);
}
export async function replyToFeedback(id, reply) {
  await updateFeedback(id, { reply });
}
export async function removeFeedback(id) {
  await deleteFeedback(id);
}
