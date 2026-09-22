// js/config.js - 全局配置（三层级架构）

export const SUPABASE_URL = 'https://aermnnksvhezfykxefla.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFlcm1ubmtzdmhlemZ5a3hlZmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzQ4ODEsImV4cCI6MjA5NzY1MDg4MX0.c2Wemu90PiezEaXn2Hv3tBL-D5YFXYTVxei14CI-Rvk';

// ========== 时间参数 ==========
export const DAY_START = 480;          // 08:00
export const PLAN_CUTOFF = 1020;       // 17:00 规划截止
export const VISIT_END = 1080;         // 18:00 普通游览截止
export const NIGHT_END = 1320;         // 22:00 24h POI 夜间上限
export const DAY_END = VISIT_END;      // ★ 新增：日程结束（算法默认）
export const NEW_ARRIVAL_CUTOFF = 960; // ★ 新增：16:00 后不再新增到达

export const LUNCH_START = 690;        // 11:30
export const LUNCH_END = 750;          // 12:30
export const DINNER_START = 1080;      // 18:00
export const DINNER_END = 1140;        // 19:00
export const MEAL_DURATION = 60;       // 每餐时长
export const MAX_RETURN_TIME = 180;
export const MIN_SEGMENT = 45;         // L2 打断阈值
export const MIN_REST_DURATION = 10;

// L3 错过判定阈值（就餐窗口结束 + 120 分钟）
export const LUNCH_THRESHOLD = LUNCH_END + 120;    // 14:30
export const DINNER_THRESHOLD = DINNER_END + 120;  // 21:00

// ========== 等级定义 ==========
export const LEVEL_LABELS = {
    L1: '🏞️ 一级 - 景区（容器）',
    L2: '📍 二级 - 普通景点',
    L3: '⭐ 三级 - 连续景点（含节点）',
    L4: '🏛️ 四级 - 服务场所/设施'
};

// ========== POI 类型 ==========
export const POI_TYPES = {
    scenic: '🏞️ 景区',
    spot: '📍 景点',
    core_node: '⭐ 核心节点',
    service_place: '🏛️ 服务场所',
    facility: '🚻 公共设施'
};

// ========== POI 分类 ==========
export const POI_CATEGORIES = [
    '自然景区', '红色景区', '文博场馆', '餐饮住宿',
    '交通枢纽', '游玩娱乐', '购物消费', '公共服务'
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

// ========== 模拟退火参数 ==========
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

// ========== 分类常量 ==========
export const COUNTY_SPOT_KEYWORDS = [
    '轿房沟美食街', '银耳博物馆', '红四方面军总指挥部旧址纪念馆',
    '省委党校旧址纪念馆', '通江花月夜'
];
export const LONG_SPOT_NAMES = ['空山天盆', '诺水河溶洞', '王坪烈士陵园', '红军烈士陵园'];
export const ALLOWED_CATEGORIES = ['自然景区', '红色景区', '文博场馆'];
export const NON_VISIT_CATEGORIES = ['交通枢纽', '餐饮住宿', '公共服务', '购物消费', '游玩娱乐'];
export const EXCLUDED_TRANSPORT_CATS = ['公共服务', '游玩娱乐', '购物消费'];

// ========== 县城统一定义（唯一真源） ==========
export const COUNTY = {
    id: 'county',
    numericId: 0,
    lat: 31.911705,
    lng: 107.245033,
    name: '红军广场',
    displayName: '红军广场（县城）'
};
