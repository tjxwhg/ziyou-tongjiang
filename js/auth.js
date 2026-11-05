// js/auth.js - 用户认证
// ★ 引入 api.js 的 supabase 实例，避免多次实例化导致登录状态不统一
import { supabase } from './api.js';

export async function getCurrentUser() {
    const { data } = await supabase.auth.getSession();
    return data.session?.user || null;
}

export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

export async function signInAnonymously() {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    return data;
}

export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
}