// user.js - 游客端“我的”功能
import { getReservations, insertFeedback, getFeedbacks, updateReservation, deleteReservation as apiDeleteReservation } from './api.js';
import { getCurrentUser } from './auth.js';

// ---------- 行程本地存储 ----------
export function getMyTrips() {
  return JSON.parse(localStorage.getItem('trips') || '[]');
}
export function saveTrip(trip) {
  const trips = getMyTrips();
  trips.push(trip);
  localStorage.setItem('trips', JSON.stringify(trips));
}
export function deleteTrip(index) {
  const trips = getMyTrips();
  trips.splice(index, 1);
  localStorage.setItem('trips', JSON.stringify(trips));
}

// ---------- 预约 ----------
export async function loadMyReservations(userId) {
  return getReservations(null);
}
export async function deleteReservation(id) {
  // 硬删除
  await apiDeleteReservation(id);
}

// ---------- 留言 ----------
export async function submitFeedback(message, userId, merchantId = null) {
  return insertFeedback({ user_id: userId, message, merchant_id: merchantId });
}
export async function getMyFeedbacks(userId) {
  return getFeedbacks(null);
}
