// js/config.js - 全局配置
export const SUPABASE_URL = 'https://aermnnksvhezfykxefla.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFlcm1ubmtzdmhlemZ5a3hlZmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzQ4ODEsImV4cCI6MjA5NzY1MDg4MX0.c2Wemu90PiezEaXn2Hv3tBL-D5YFXYTVxei14CI-Rvk';

// ========== 时间参数 ==========
export const DAY_START = 480;          // 08:00 每日起始
export const PLAN_CUTOFF = 1020;       // 17:00 规划截止（不再安排新景点）
export const VISIT_END = 1080;         // 18:00 游览截止（必须结束游览）
export const LUNCH_START = 690;        // 11:30
export const LUNCH_END = 750;          // 12:30
export const DINNER_START = 1080;      // 18:00
export const DINNER_END = 1140;        // 19:00
export const MEAL_DURATION = 60;       // 每餐时长
export const MAX_RETURN_TIME = 180;    // 返回县城最大耗时
export const MIN_SEGMENT = 45;         // 最小游览段（低于此值不插餐，直接游览完）

// 兼容旧引用
export const DAY_END = VISIT_END;
export const NEW_ARRIVAL_CUTOFF = PLAN_CUTOFF;

// ========== POI 分类 ==========
export const POI_CATEGORIES = [
    '自然景区',
    '红色景区',
    '文博场馆',
    '餐饮住宿',
    '交通枢纽',
    '游玩娱乐',
    '购物消费',
    '公共服务'
];

export const poiColors = {
    '自然景区': '#2E7D32',
    '红色景区': '#C62828',
    '文博场馆': '#6A1B9A',
    '餐饮住宿': '#FF9800',
    '交通枢纽': '#00BCD4',
    '游玩娱乐': '#FF5722',
    '购物消费': '#F9A825',
    '公共服务': '#607D8B'
};

export const SA_CONFIG = {
    INIT_TEMP: 1000,
    COOLING_RATE: 0.98,
    MAX_ITERATIONS: 3000,
    EARLY_STOP_THRESHOLD: 0.001
};

export const WEIGHT_TEMPLATES = {
    compact: { alpha: 0.35, beta: 0.10, gamma: 0.15, delta: 0.25, epsilon: 0.15 },
    relaxed: { alpha: 0.25, beta: 0.15, gamma: 0.30, delta: 0.15, epsilon: 0.15 },
    indepth: { alpha: 0.20, beta: 0.20, gamma: 0.20, delta: 0.20, epsilon: 0.20 }
};

export const COUNTY_SPOT_KEYWORDS = ['轿房沟美食街', '银耳博物馆', '红四方面军总指挥部旧址纪念馆', '省委党校旧址纪念馆', '通江花月夜'];
export const LONG_SPOT_NAMES = ['空山天盆', '诺水河溶洞', '王坪烈士陵园', '红军烈士陵园'];
export const ALLOWED_CATEGORIES = ['自然景区', '红色景区', '文博场馆'];
export const NON_VISIT_CATEGORIES = ['交通枢纽', '餐饮住宿', '公共服务', '购物消费', '游玩娱乐'];
export const EXCLUDED_TRANSPORT_CATS = ['公共服务', '游玩娱乐', '购物消费'];
export const COUNTY = { lat: 31.911705, lng: 107.245033, name: '红军广场', id: 'county' };
