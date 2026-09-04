// controllers/tripController.js
const { simulatedAnnealing } = require('../planner/optimizer');
const { checkHardConstraints } = require('../planner/constraint-checker');
const { calculateObjective } = require('../planner/objective');
const poiGraph = require('../data/poi-graph');
const externalApis = require('../data/external-apis');
const { CONSTRAINTS, WEIGHT_TEMPLATES } = require('../config');

/**
 * 生成行程方案
 * POST /api/plan/generate
 * Body: { poiIds, startDate, startTime, days, style, allowFill, userId }
 */
async function generatePlan(req, res) {
  try {
    const { poiIds, startDate, startTime, days, style = 'relaxed', allowFill = true, userId } = req.body;

    if (!poiIds || poiIds.length === 0) {
      return res.status(400).json({ error: '请至少选择一个景点' });
    }

    // 1. 获取POI信息
    const poiList = await poiGraph.getPoisInfo(poiIds);
    if (poiList.length === 0) {
      return res.status(404).json({ error: '未找到有效的景点信息' });
    }

    // 2. 获取交通矩阵
    const travelTimes = await poiGraph.getTravelTimeMatrix();

    // 3. 获取用户偏好
    let userPref = { preferred_categories: [], cuisine_prefs: [], pace: style };
    if (userId) {
      try {
        userPref = await poiGraph.getUserPreferences(userId);
      } catch (e) {
        // 使用默认偏好
      }
    }

    // 4. 获取天气（用于体能消耗计算）
    const weather = await externalApis.fetchWeather(31.911705, 107.245033);

    // 5. 构建约束对象
    const constraints = {
      open_times: {},
      close_times: {},
      travel_times: travelTimes,
      day_start: CONSTRAINTS.DAY_START,
      day_end: CONSTRAINTS.DAY_END,
      max_days: days || 3,
      lodging_required: true, // 默认需要返回县城住宿
      return_travel_time: 0, // 由交通矩阵提供
      meal_windows: {
        lunch: [CONSTRAINTS.LUNCH_START, CONSTRAINTS.LUNCH_END],
        dinner: [CONSTRAINTS.DINNER_START, CONSTRAINTS.DINNER_END]
      }
    };

    // 填充开放时间
    for (let poi of poiList) {
      constraints.open_times[poi.id] = poi.open_time ? timeToMinutes(poi.open_time) : CONSTRAINTS.DAY_START;
      constraints.close_times[poi.id] = poi.close_time ? timeToMinutes(poi.close_time) : CONSTRAINTS.DAY_END;
    }

    // 6. 生成三种风格的方案
    const styles = ['compact', 'relaxed', 'in-depth'];
    const solutions = [];
    const startMin = timeToMinutes(startTime);

    for (let s of styles) {
      // 计算起始时间
      let start = startMin;
      // 根据风格调整起始时间（紧凑型可早出发）
      if (s === 'compact') start = Math.max(start, CONSTRAINTS.DAY_START);
      else if (s === 'relaxed') start = Math.max(start, CONSTRAINTS.DAY_START + 60); // 悠闲型晚出发

      // 调整约束中的起始时间
      const styleConstraints = { ...constraints, start_time: start };

      const result = simulatedAnnealing(poiList, styleConstraints, userPref, s);

      if (result) {
        // 构建完整行程数据
        const solutionData = buildSolutionData(result, poiList, constraints, startDate, startTime);
        solutions.push({
          style: s,
          data: solutionData,
          score: result.score,
          sequence: result.sequence
        });
      }
    }

    // 如果所有方案都生成失败，返回错误
    if (solutions.length === 0) {
      return res.status(500).json({ error: '无法生成有效的行程方案，请调整选择' });
    }

    // 返回结果，包含天气信息
    res.json({
      success: true,
      solutions: solutions,
      weather: weather,
      poiList: poiList
    });

  } catch (error) {
    console.error('[生成方案] 错误:', error);
    res.status(500).json({ error: error.message || '生成方案失败' });
  }
}

/**
 * 用户选择方案
 * POST /api/plan/select
 * Body: { solutionId, userId }
 */
async function selectPlan(req, res) {
  try {
    const { solutionId, userId, solutionData, style, score } = req.body;

    // 标记该方案为选中
    // 实际可更新 trip_solutions 表的 selected 字段
    const { id } = await poiGraph.saveTripSolution(solutionData, userId, style, score);

    res.json({
      success: true,
      tripId: id,
      message: '行程已保存'
    });
  } catch (error) {
    console.error('[选择方案] 错误:', error);
    res.status(500).json({ error: error.message || '保存方案失败' });
  }
}

/**
 * 获取POI内部路网数据
 * GET /api/poi/internal/:poiId
 */
async function getPoiInternal(req, res) {
  try {
    const { poiId } = req.params;
    const graph = await poiGraph.getPoiInternalGraph(poiId);
    res.json({
      success: true,
      data: graph
    });
  } catch (error) {
    console.error('[获取内部路网] 错误:', error);
    res.status(500).json({ error: error.message || '获取内部路网失败' });
  }
}

// ========== 辅助函数 ==========

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function buildSolutionData(result, poiList, constraints, startDate, startTime) {
  const { sequence, durations } = result;
  const days = [];
  let currentDay = 1;
  let currentTime = constraints.start_time || CONSTRAINTS.DAY_START;
  let dayNodes = [];
  let lastPoiId = 'county';

  for (let i = 0; i < sequence.length; i++) {
    const poiId = sequence[i];
    const poi = poiList.find(p => p.id === poiId);
    if (!poi) continue;

    const travelKey = `${lastPoiId}_${poiId}`;
    const travel = constraints.travel_times[travelKey] || 0;
    const duration = durations[poiId] || 30;

    // 检查是否需要跨天
    if (currentTime + travel + duration > constraints.day_end) {
      // 结束当天
      if (dayNodes.length > 0) {
        days.push({
          day: currentDay,
          date: addDays(startDate, currentDay - 1),
          nodes: dayNodes
        });
        dayNodes = [];
      }
      currentDay++;
      currentTime = CONSTRAINTS.DAY_START;
      lastPoiId = 'county';
      // 重新计算交通（从县城出发）
      const newTravel = constraints.travel_times[`${lastPoiId}_${poiId}`] || 0;
      currentTime += newTravel;
    } else {
      currentTime += travel;
    }

    // 添加游览节点
    dayNodes.push({
      poi_id: poiId,
      poi_name: poi.name,
      arrival_time: formatTime(currentTime),
      departure_time: formatTime(currentTime + duration),
      duration: duration,
      travel_from: lastPoiId,
      travel_time: travel
    });

    currentTime += duration;
    lastPoiId = poiId;
  }

  // 最后一天
  if (dayNodes.length > 0) {
    days.push({
      day: currentDay,
      date: addDays(startDate, currentDay - 1),
      nodes: dayNodes
    });
  }

  return {
    start_date: startDate,
    start_time: startTime,
    days: days,
    total_days: days.length,
    total_pois: sequence.length,
    total_duration: Object.values(durations).reduce((a, b) => a + b, 0)
  };
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

module.exports = {
  generatePlan,
  selectPlan,
  getPoiInternal
};