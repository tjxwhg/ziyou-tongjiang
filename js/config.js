// js/config.js - 全局配置（三层级架构）
// 注：SA_CONFIG 和 WEIGHT_TEMPLATES 已移除（2026-10-16）。
//     交通限时调整为 240 分钟（2026-10-21）。
//     2026-11-04 v1.4 清理了零调用常量（DAY_END / NEW_ARRIVAL_CUTOFF /
//     MIN_SEGMENT / LEVEL_LABELS / COUNTY_SPOT_KEYWORDS / LONG_SPOT_NAMES /
//     ALLOWED_CATEGORIES / NON_VISIT_CATEGORIES / EXCLUDED_TRANSPORT_CATS）。
//     本文件所有导出均为"纯逻辑层"，可直接用于微信小程序。

export const SUPABASE_URL = 'https://aermnnksvhezfykxefla.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFlcm1ubmtzdmhlemZ5a3hlZmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzQ4ODEsImV4cCI6MjA5NzY1MDg4MX0.c2Wemu90PiezEaXn2Hv3tBL-D5YFXYTVxei14CI-Rvk';

// ========== 时间参数 ==========
export const DAY_START = 480;          // 08:00
export const PLAN_CUTOFF = 1020;       // 17:00 最后游览开始时间
export const VISIT_END = 1080;         // 18:00 默认硬结束
export const NIGHT_END = 1320;         // 22:00 24h POI 夜间上限

export const LUNCH_START = 690;        // 11:30
export const LUNCH_END = 750;          // 12:30
export const DINNER_START = 1080;      // 18:00
export const DINNER_END = 1140;        // 19:00
export const MEAL_DURATION = 60;       // 每餐时长
export const MAX_RETURN_TIME = 240;    // ★ 交通耗时上限，改为 240 分钟（4小时）
export const MIN_REST_DURATION = 10;

// ========== 规划约束 ==========
export const MAX_WAIT_FOR_MEAL = 59;       // 收尾阶段（整个行程结束）距下一餐的最大等待分钟
export const MIN_VISIT_SEGMENT = 45;       // L2 剩余游览 < 45 分钟则丢弃
export const MAX_POI_DURATION = 14400;     // 单 POI 最大游览时长（240 小时）
export const MEAL_BREAK_THRESHOLD = 30;    // L2 被就餐中断时，剩余 < 30 分钟则做完再插餐
export const MAX_WAIT_FOR_DINNER_DAY_END = 100; // 当天结束（队列还有剩余）距晚餐的最大等待分钟
export const MAX_TRANSPORT_TIME = 1440;    // 单对 POI 交通耗时上限（24 小时）

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

// ========== 县城统一标识 ==========
export const COUNTY = {
    id: 'county',
    numericId: 0,
    lat: 31.911705,
    lng: 107.245033,
    name: '红军广场',
    displayName: '红军广场（县城）'
};