
export const SUPABASE_URL = 'https://aermnnksvhezfykxefla.supabase.co';   // 请替换为您的实际 URL

// 您的 Supabase 项目 anon public 密钥（同样在 API 设置中）
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFlcm1ubmtzdmhlemZ5a3hlZmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzQ4ODEsImV4cCI6MjA5NzY1MDg4MX0.c2Wemu90PiezEaXn2Hv3tBL-D5YFXYTVxei14CI-Rvk';   // 请替换为您的实际 anon key


// config.js
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GAODE_API_KEY: process.env.GAODE_API_KEY,
  OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY,

  // 算法默认参数
  ALGO: {
    INIT_TEMP: 1000,
    COOLING_RATE: 0.98,
    MAX_ITERATIONS: 5000,
    EARLY_STOP_THRESHOLD: 0.001, // 目标函数改善阈值
  },

  // 约束默认值
  CONSTRAINTS: {
    DAY_START: 480,   // 8:00
    DAY_END: 1080,    // 18:00
    LUNCH_START: 690, // 11:30
    LUNCH_END: 750,   // 12:30
    DINNER_START: 1050, // 17:30
    DINNER_END: 1110,    // 18:30
    MEAL_DURATION: 60,
    NEW_ARRIVAL_CUTOFF: 1020, // 17:00后不新安排游览
    MAX_RETURN_TIME: 1260,    // 21:00前必须返回
  },

  // 权重模板（紧凑/悠闲/深度游）
  WEIGHT_TEMPLATES: {
    compact: { alpha: 0.35, beta: 0.10, gamma: 0.15, delta: 0.25, epsilon: 0.15 },
    relaxed: { alpha: 0.25, beta: 0.15, gamma: 0.30, delta: 0.15, epsilon: 0.15 },
    indepth: { alpha: 0.20, beta: 0.20, gamma: 0.20, delta: 0.20, epsilon: 0.20 }
  }
};