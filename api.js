import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- POI ----------
export async function getPois() {
  const { data, error } = await supabase.from('ztj_poi').select('*').eq('status','active');
  if (error) throw error;
  return data;
}
export async function getPoi(id) {
  const { data, error } = await supabase.from('ztj_poi').select('*').eq('id',id).single();
  if (error) throw error;
  return data;
}
export async function insertPoi(poi) {
  const { data, error } = await supabase.from('ztj_poi').insert(poi).select();
  if (error) throw error;
  return data[0];
}
export async function updatePoi(id, updates) {
  const { error } = await supabase.from('ztj_poi').update(updates).eq('id',id);
  if (error) throw error;
}
export async function deletePoi(id) {
  const { error } = await supabase.from('ztj_poi').delete().eq('id',id);
  if (error) throw error;
}
export async function getSubPois(parentId) {
  const { data, error } = await supabase.from('ztj_poi').select('*').eq('parent_id', parentId).order('sort_order');
  if (error) throw error;
  return data;
}

// ---------- 路线 ----------
export async function getRoutes() {
  const { data, error } = await supabase.from('ztj_routes').select('*');
  if (error) throw error;
  return data;
}
export async function getRoute(id) {
  const { data, error } = await supabase.from('ztj_routes').select('*').eq('id',id).single();
  if (error) throw error;
  return data;
}
export async function insertRoute(route) {
  const { data, error } = await supabase.from('ztj_routes').insert(route).select();
  if (error) throw error;
  return data[0];
}
export async function updateRoute(id, updates) {
  const { error } = await supabase.from('ztj_routes').update(updates).eq('id',id);
  if (error) throw error;
}
export async function deleteRoute(id) {
  const { error } = await supabase.from('ztj_routes').delete().eq('id',id);
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
  const { data, error } = await supabase.from('ztj_merchants').select('*').eq('id',id).single();
  if (error) throw error;
  return data;
}
export async function updateMerchant(id, updates) {
  const { error } = await supabase.from('ztj_merchants').update(updates).eq('id',id);
  if (error) throw error;
}
export async function getMerchantsByPoi(poiId) {
  const { data, error } = await supabase.from('ztj_merchants').select('*').eq('poi_id', poiId);
  if (error) throw error;
  return data;
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
  const { error } = await supabase.from('reservations').update(updates).eq('id',id);
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
  const { error } = await supabase.from('ztj_feedbacks').update(updates).eq('id',id);
  if (error) throw error;
}
export async function deleteFeedback(id) {
  const { error } = await supabase.from('ztj_feedbacks').delete().eq('id',id);
  if (error) throw error;
}

// ---------- 文件上传 ----------
export async function uploadFile(bucket, path, file) {
  const { error } = await supabase.storage.from(bucket).upload(path, file);
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
  return publicUrl;
}
