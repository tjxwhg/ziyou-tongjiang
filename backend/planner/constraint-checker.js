// planner/constraint-checker.js
const { CONSTRAINTS } = require('../config');

/**
 * 检查硬约束是否满足
 * @param {Array} sequence - 景点ID顺序
 * @param {Object} durations - 每个景点的停留分钟
 * @param {Object} constraints - 包含 open_times, close_times, travel_times, meal_windows, lodging_required 等
 * @returns {Boolean}
 */
function checkHardConstraints(sequence, durations, constraints) {
  const {
    open_times = {},      // { poiId: { open: 480, close: 1080 } }
    close_times = {},
    travel_times = {},    // { from_to: minutes }
    meal_windows = { lunch: [690,750], dinner: [1050,1110] },
    lodging_required = false, // 是否必须返回县城住宿
    return_travel_time = 0,   // 返回县城交通时间
    max_days = 3,
    day_start = CONSTRAINTS.DAY_START,
    day_end = CONSTRAINTS.DAY_END,
  } = constraints;

  let currentTime = day_start;
  let currentDay = 1;
  let lastPoiId = 'county'; // 起始地点为县城
  let lunchServed = false;
  let dinnerServed = false;

  for (let i = 0; i < sequence.length; i++) {
    const poiId = sequence[i];
    const duration = durations[poiId] || 30;

    // 1. 交通时间
    const travelKey = `${lastPoiId}_${poiId}`;
    const travel = travel_times[travelKey] || 0;
    currentTime += travel;

    // 2. 检查是否在开放时间内
    const open = open_times[poiId] || day_start;
    const close = close_times[poiId] || day_end;
    if (currentTime < open) {
      // 可以等待到开放时间，但等待不应过长（如超过2小时则不合理）
      if (open - currentTime > 120) return false;
      currentTime = open;
    }
    if (currentTime + duration > close) {
      return false; // 游览结束时间超过闭馆
    }

    // 3. 检查是否超过当日最大时间
    if (currentTime + duration > day_end) {
      // 若当日无法完成，尝试下一天（但需要满足跨天逻辑）
      // 简单处理：若离闭馆不足1小时则不允许
      if (day_end - currentTime < 60) return false;
    }

    // 4. 检查餐饮窗口（若在午餐窗口内，必须安排午餐）
    // 注意：这里只做标记，实际插入由算法完成
    // 但硬约束中，若到达某景点时间在午餐窗口内，则必须能安排午餐时间
    // 我们这里仅检查是否有足够时间在游览前/后插入午餐
    // 暂不强制，由算法生成时考虑

    // 5. 更新当前时间
    currentTime += duration;
    lastPoiId = poiId;

    // 6. 如果当天剩余时间不足以继续，则结束当天
    if (i < sequence.length - 1) {
      const nextTravel = travel_times[`${poiId}_${sequence[i+1]}`] || 0;
      if (currentTime + nextTravel + durations[sequence[i+1]] > day_end) {
        // 需要检查是否允许跨天
        // 若不允许跨天，则必须返回县城住宿
        if (lodging_required) {
          // 返回县城时间
          const returnTravel = travel_times[`${poiId}_county`] || return_travel_time;
          if (currentTime + returnTravel > CONSTRAINTS.MAX_RETURN_TIME) {
            return false;
          }
        }
        // 进入下一天
        currentDay++;
        if (currentDay > max_days) return false;
        currentTime = day_start;
        lastPoiId = 'county';
        lunchServed = false;
        dinnerServed = false;
      }
    }
  }

  // 最后一天结束后，若需要返回县城，检查返回时间
  if (lodging_required && lastPoiId !== 'county') {
    const returnTravel = travel_times[`${lastPoiId}_county`] || return_travel_time;
    if (currentTime + returnTravel > CONSTRAINTS.MAX_RETURN_TIME) {
      return false;
    }
  }

  return true;
}

module.exports = {
  checkHardConstraints
};