// trip.js - 行程规划引擎（顺序版）
import { getTransportPresets } from './api.js';
import {
  DAY_START, DAY_END, LUNCH_START, LUNCH_END, DINNER_START, DINNER_END,
  MEAL_DURATION, NEW_ARRIVAL_CUTOFF, MAX_RETURN_TIME,
  LONG_SPOT_NAMES
} from './config.js';
import { formatTime } from './utils.js';

let transportPresets = {};

export async function loadTransportPresets() {
  const data = await getTransportPresets();
  transportPresets = {};
  if (data) {
    data.forEach(p => {
      transportPresets[`${p.from_poi_id}_${p.to_poi_id}`] = p.time_min;
    });
  }
}

export function getTransportTime(fromId, toId, mode) {
  if (fromId === 'mylocation' || toId === 'mylocation') return 0;
  const fId = fromId === 'county' ? 0 : fromId;
  const tId = toId === 'county' ? 0 : toId;
  let t = transportPresets[`${fId}_${tId}`];
  if (t !== undefined) return t;
  t = transportPresets[`${tId}_${fId}`];
  return t !== undefined ? t : null;
}

function isLongSpot(spot) {
  return LONG_SPOT_NAMES.some(name => spot.name.includes(name));
}

export function generateTripPlan(spots, startDate, startTime, mode, allowFill = true, fillOnlyMeals = false) {
  // 1. 初始化
  const allSpots = spots.filter(s => s && s.id && s.name && typeof s.visitDuration === 'number' && s.visitDuration >= 0);
  if (allSpots.length === 0) {
    return { nodes: [], error: true, errorMsg: '没有有效的景点数据', warnings: [] };
  }

  // 分类：长耗时、半天、用户短耗时、系统填充景点
  const longSpots = [];
  const halfSpots = [];
  const userShortSpots = [];
  const systemShortSpots = [];

  for (let s of allSpots) {
    if (s.isCounty) {
      systemShortSpots.push(s);
    } else if (isLongSpot(s)) {
      s.type = 'long';
      longSpots.push(s);
    } else if (s.visitDuration >= 100) {
      s.type = 'half';
      halfSpots.push(s);
    } else {
      s.type = 'short';
      userShortSpots.push(s);
    }
  }

  // 按游览时长降序排列半天景点
  halfSpots.sort((a,b) => b.visitDuration - a.visitDuration);

  // 当前状态
  let currentDate = new Date(startDate);
  let currentMin = startTime;
  let lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
  const nodes = [];
  const warnings = [];
  const usedIds = new Set();

  // 每日餐食标记
  let lunchInserted = false;
  let dinnerInserted = false;
  let isIdleDay = false;

  // 2. 辅助函数
  function endDay() {
    if (nodes.length > 0 && nodes[nodes.length-1].type !== 'dayEnd') {
      nodes.push({ type: 'dayEnd' });
    }
    lunchInserted = false;
    dinnerInserted = false;
    isIdleDay = false;
  }

  function addNode(node) {
    if (!node) return;
    let idx = nodes.length;
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].type === 'dayEnd') continue;
      if (nodes[i].startTime <= node.startTime) {
        idx = i + 1;
        break;
      }
      idx = i;
    }
    nodes.splice(idx, 0, node);
  }

  function insertMeal(time, force = false) {
    let t = time;
    if (!lunchInserted && (force || (t >= LUNCH_START && t < LUNCH_END))) {
      let start = Math.max(t, LUNCH_START);
      if (force && t > LUNCH_START) start = t;
      let end = start + MEAL_DURATION;
      if (end > DAY_END) end = DAY_END;
      if (end > start) {
        addNode({ type: 'meal', name: '午餐时间', startTime: start, endTime: end, duration: end - start });
        lunchInserted = true;
        return end;
      }
      return t;
    }
    if (!dinnerInserted && (force || (t >= DINNER_START && t < DINNER_END))) {
      let start = Math.max(t, DINNER_START);
      if (force && t > DINNER_START) start = t;
      let end = start + MEAL_DURATION;
      if (end > DAY_END) end = DAY_END;
      if (end > start) {
        addNode({ type: 'meal', name: '晚餐时间', startTime: start, endTime: end, duration: end - start });
        dinnerInserted = true;
        return end;
      }
      return t;
    }
    return t;
  }

  function checkMealCrossing(startTime, endTime) {
    if (!lunchInserted && startTime < LUNCH_END && endTime > LUNCH_START) return 'lunch';
    if (!dinnerInserted && startTime < DINNER_END && endTime > DINNER_START) return 'dinner';
    return null;
  }

  function arrangeSpot(spot, travelTime, startTime) {
    let time = startTime;
    let poi = lastPoi;

    if (travelTime > 0) {
      if (time + travelTime > 1440) return { error: '交通跨天', newTime: time };
      addNode({
        type: 'transport',
        name: spot.name,
        startTime: time,
        endTime: time + travelTime,
        duration: travelTime,
        fromPoi: poi.id,
        toPoi: spot.id,
        isReturn: false
      });
      time += travelTime;
      poi = { id: spot.id, name: spot.name, lat: spot.lat, lng: spot.lng, type: spot.type };
    }

    // 交通结束后插入餐食
    let mealCross = checkMealCrossing(startTime, time);
    if (mealCross) {
      time = insertMeal(time, true);
    } else {
      time = insertMeal(time);
    }

    let remaining = spot.visitDuration || 0;
    if (time >= DAY_END) {
      lastPoi = poi;
      return { error: null, newTime: time, remaining: remaining };
    }
    if (time >= NEW_ARRIVAL_CUTOFF) {
      lastPoi = poi;
      return { error: null, newTime: time, remaining: remaining };
    }

    while (remaining > 0) {
      if (time >= DAY_END) {
        if (remaining > 0) warnings.push(`因时间不足，景区 "${spot.name}" 剩余 ${remaining} 分钟游览被省略。`);
        break;
      }
      let mealInserted = false;
      if (remaining > 60) {
        let newTime = insertMeal(time);
        if (newTime > time) {
          time = newTime;
          mealInserted = true;
        }
      }
      if (!mealInserted) {
        let nextMeal = DAY_END;
        if (!lunchInserted && time < LUNCH_START) nextMeal = Math.min(nextMeal, LUNCH_START);
        else if (!dinnerInserted && time < DINNER_START) nextMeal = Math.min(nextMeal, DINNER_START);
        let maxSeg = nextMeal - time;
        if (maxSeg <= 0) maxSeg = 1;
        let seg = Math.min(remaining, maxSeg, DAY_END - time);
        if (seg <= 0) break;
        addNode({
          type: 'visit',
          name: spot.name,
          startTime: time,
          endTime: time + seg,
          duration: seg,
          spotId: spot.id
        });
        time += seg;
        remaining -= seg;
      }
    }
    if (remaining > 0) warnings.push(`因时间不足，景区 "${spot.name}" 剩余 ${remaining} 分钟游览被省略。`);
    lastPoi = poi;
    return { error: null, newTime: time, remaining: remaining };
  }

  function returnToCounty(currentTime) {
    let travelBack = getTransportTime(lastPoi.id, 'county', mode);
    if (travelBack == null) travelBack = 0;
    if (currentTime + travelBack > 1440) return { error: '返回县城交通跨天', newTime: currentTime };
    let newTime = currentTime + travelBack;
    if (newTime > MAX_RETURN_TIME) {
      return { error: `返回县城交通结束时间 ${formatTime(newTime)} 超过21:00`, newTime: currentTime };
    }
    addNode({
      type: 'transport',
      name: '返回县城',
      startTime: currentTime,
      endTime: newTime,
      duration: travelBack,
      fromPoi: lastPoi.id,
      toPoi: 'county',
      isReturn: true
    });
    let mealCross = checkMealCrossing(currentTime, newTime);
    if (mealCross === 'lunch') {
      newTime = insertMeal(newTime, true);
    } else if (mealCross === 'dinner') {
      newTime = insertMeal(newTime, true);
    } else {
      newTime = insertMeal(newTime);
    }
    lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
    return { error: null, newTime: newTime };
  }

  // 填充短耗时（空闲日）
  function fillShortSpots(maxEndTime, fillList) {
    if (!allowFill || !isIdleDay) return;
    let available = fillList.filter(s => !usedIds.has(s.id));
    while (currentMin < maxEndTime && currentMin < DAY_END) {
      let found = false;
      for (let s of available) {
        let t = getTransportTime(lastPoi.id, s.id, mode);
        if (t == null) t = 0;
        if (currentMin + t >= NEW_ARRIVAL_CUTOFF) continue;
        if (currentMin + t + s.visitDuration > maxEndTime) continue;
        let result = arrangeSpot(s, t, currentMin);
        if (result.error) continue;
        currentMin = result.newTime;
        usedIds.add(s.id);
        found = true;
        available = available.filter(item => item.id !== s.id);
        break;
      }
      if (!found) break;
    }
    // 短耗时结束不返回县城
  }

  // 3. 顺序安排所有景点
  // 处理顺序：长耗时 -> 半天 -> 用户短耗时 -> 系统填充（仅在空闲日）
  // 注意：系统填充不单独处理，仅在长耗时产生的空闲日中通过 fillShortSpots 处理

  // 3.1 长耗时
  for (let spot of longSpots) {
    if (usedIds.has(spot.id)) continue;

    // 如果当前时间 > DAY_START，说明当天已有安排或空闲日，先处理当天（填充短耗时）
    if (currentMin > DAY_START) {
      isIdleDay = true;
      const fillList = [...userShortSpots, ...systemShortSpots];
      fillShortSpots(DAY_END, fillList);
      // 如果最后不是县城且不是短耗时，返回县城（但短耗时不会返回）
      if (lastPoi.type !== 'county' && lastPoi.type !== 'short') {
        let ret = returnToCounty(currentMin);
        if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
        currentMin = ret.newTime;
      }
      endDay();
      const dateStr = currentDate.toLocaleDateString('zh-CN');
      warnings.push(`因长耗时景区 "${spot.name}" 需调整，${dateStr} 当天为空闲日，建议在县城附近游览。`);
      // 移到下一天 8:00
      currentDate.setDate(currentDate.getDate() + 1);
      currentMin = DAY_START;
      lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
      lunchInserted = false;
      dinnerInserted = false;
      isIdleDay = false;
    }

    // 确保当前是 DAY_START
    currentMin = DAY_START;
    let travel = getTransportTime(lastPoi.id, spot.id, mode);
    if (travel == null) travel = 0;
    let result = arrangeSpot(spot, travel, currentMin);
    if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
    currentMin = result.newTime;

    // 长耗时结束返回县城
    let ret = returnToCounty(currentMin);
    if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
    currentMin = ret.newTime;
    endDay();

    // 下一天
    currentDate.setDate(currentDate.getDate() + 1);
    currentMin = DAY_START;
    lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
    lunchInserted = false;
    dinnerInserted = false;
    usedIds.add(spot.id);
  }

  // 3.2 半天景点
  for (let spot of halfSpots) {
    if (usedIds.has(spot.id)) continue;

    // 尝试当天安排
    let travel = getTransportTime(lastPoi.id, spot.id, mode);
    if (travel == null) travel = 0;

    // 判断当前时段
    let slot = 'morning';
    if (currentMin >= LUNCH_END && currentMin < DINNER_START) slot = 'afternoon';
    else if (currentMin >= DINNER_START) slot = 'night';

    if (slot === 'night') {
      endDay();
      currentDate.setDate(currentDate.getDate() + 1);
      currentMin = DAY_START;
      lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
      lunchInserted = false;
      dinnerInserted = false;
      slot = 'morning';
      travel = getTransportTime(lastPoi.id, spot.id, mode);
      if (travel == null) travel = 0;
    }

    if (currentMin >= LUNCH_START && currentMin < LUNCH_END) {
      let newTime = insertMeal(currentMin);
      if (newTime > currentMin) currentMin = newTime;
      else currentMin = LUNCH_END;
      slot = 'afternoon';
    }

    if (slot === 'morning') {
      let blockStart = Math.max(currentMin, DAY_START);
      let blockEnd = LUNCH_START;
      if (travel + spot.visitDuration <= blockEnd - blockStart && blockStart + travel < NEW_ARRIVAL_CUTOFF) {
        let result = arrangeSpot(spot, travel, blockStart);
        if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
        currentMin = result.newTime;
        let ret = returnToCounty(currentMin);
        if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
        currentMin = ret.newTime;
        endDay();
        currentDate.setDate(currentDate.getDate() + 1);
        currentMin = DAY_START;
        lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
        lunchInserted = false;
        dinnerInserted = false;
        usedIds.add(spot.id);
        continue;
      } else {
        currentMin = LUNCH_END;
        slot = 'afternoon';
        travel = getTransportTime(lastPoi.id, spot.id, mode);
        if (travel == null) travel = 0;
      }
    }

    if (slot === 'afternoon') {
      let blockStart = Math.max(currentMin, LUNCH_END);
      let blockEnd = DINNER_START;
      if (blockStart >= NEW_ARRIVAL_CUTOFF) {
        // 太晚，移到下一天
        endDay();
        currentDate.setDate(currentDate.getDate() + 1);
        currentMin = DAY_START;
        lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
        lunchInserted = false;
        dinnerInserted = false;
        // 重新尝试（递归思想：将当前景点放回队列，但为了简单，直接重新安排）
        // 我们重新计算，从早上开始
        currentMin = DAY_START;
        travel = getTransportTime(lastPoi.id, spot.id, mode);
        if (travel == null) travel = 0;
        // 尝试安排在上午
        let blockStart2 = DAY_START;
        let blockEnd2 = LUNCH_START;
        if (travel + spot.visitDuration <= blockEnd2 - blockStart2 && blockStart2 + travel < NEW_ARRIVAL_CUTOFF) {
          let result = arrangeSpot(spot, travel, blockStart2);
          if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
          currentMin = result.newTime;
          let ret = returnToCounty(currentMin);
          if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
          currentMin = ret.newTime;
          endDay();
          currentDate.setDate(currentDate.getDate() + 1);
          currentMin = DAY_START;
          lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
          lunchInserted = false;
          dinnerInserted = false;
          usedIds.add(spot.id);
          continue;
        } else {
          throw new Error(`半天景点 "${spot.name}" 无法安排。`);
        }
      }
      let available = blockEnd - blockStart;
      if (travel + spot.visitDuration <= available && blockStart + travel < NEW_ARRIVAL_CUTOFF) {
        let result = arrangeSpot(spot, travel, blockStart);
        if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
        currentMin = result.newTime;
        let ret = returnToCounty(currentMin);
        if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
        currentMin = ret.newTime;
        endDay();
        currentDate.setDate(currentDate.getDate() + 1);
        currentMin = DAY_START;
        lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
        lunchInserted = false;
        dinnerInserted = false;
        usedIds.add(spot.id);
        continue;
      } else {
        throw new Error(`半天景点 "${spot.name}" 无法在下午安排。`);
      }
    }
  }

  // 3.3 用户短耗时景点（顺序安排）
  for (let spot of userShortSpots) {
    if (usedIds.has(spot.id)) continue;
    let travel = getTransportTime(lastPoi.id, spot.id, mode);
    if (travel == null) travel = 0;
    if (currentMin + travel >= NEW_ARRIVAL_CUTOFF) {
      endDay();
      currentDate.setDate(currentDate.getDate() + 1);
      currentMin = DAY_START;
      lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
      lunchInserted = false;
      dinnerInserted = false;
      travel = getTransportTime(lastPoi.id, spot.id, mode);
      if (travel == null) travel = 0;
    }
    let result = arrangeSpot(spot, travel, currentMin);
    if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
    currentMin = result.newTime;
    usedIds.add(spot.id);
    // 短耗时不返回县城
  }

  // 3.4 系统填充景点（仅在长耗时产生的空闲日已处理，此处不再重复）

  // 如果最后还有时间且 lastPoi 不是县城且不是短耗时，返回县城
  if (lastPoi.type !== 'county' && lastPoi.type !== 'short') {
    let ret = returnToCounty(currentMin);
    if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
    currentMin = ret.newTime;
  }

  // 结束最后一天
  if (nodes.length > 0 && nodes[nodes.length-1].type !== 'dayEnd') {
    nodes.push({ type: 'dayEnd' });
  }

  return { nodes: nodes, error: false, warnings: warnings };
}

export function generateTimeline(nodes) {
  if (!nodes || nodes.length === 0) return { days: [], mealCount: 0 };
  let filtered = nodes.filter(n => n.type !== 'dayEnd');
  let merged = [];
  for (let node of filtered) {
    if (!node) continue;
    if (node.type === 'visit' && merged.length > 0 && merged[merged.length-1].type === 'visit' && merged[merged.length-1].spotId === node.spotId) {
      let last = merged[merged.length-1];
      last.endTime = node.endTime;
      last.duration += node.duration;
    } else {
      merged.push({ ...node });
    }
  }
  let lines = [], mealCount = 0;
  for (let node of merged) {
    if (!node) continue;
    let text = '';
    if (node.type === 'transport') {
      let start = formatTime(node.startTime), end = formatTime(node.endTime);
      let name = node.name;
      if (node.isReturn) name = '返回县城';
      else if (!name.startsWith('前往 ')) name = '前往 ' + name;
      text = `🚗 ${start}-${end} ${name} (交通${node.duration}分钟)`;
    } else if (node.type === 'visit') {
      let start = formatTime(node.startTime), end = formatTime(node.endTime);
      text = `⏱️ ${start}-${end} 游览 ${node.name} (游览${node.duration}分钟)`;
    } else if (node.type === 'meal') {
      let start = formatTime(node.startTime), end = formatTime(node.endTime);
      text = `🍽️ ${start}-${end} ${node.name}`;
      mealCount++;
    }
    if (text) lines.push(text);
  }

  let daysArray = [];
  let currentDayLines = [];
  let lineIndex = 0;
  for (let node of nodes) {
    if (node.type === 'dayEnd') {
      if (currentDayLines.length > 0) {
        daysArray.push([...currentDayLines]);
        currentDayLines = [];
      }
    } else {
      if (lineIndex < lines.length) {
        currentDayLines.push(lines[lineIndex]);
        lineIndex++;
      }
    }
  }
  if (currentDayLines.length > 0) daysArray.push(currentDayLines);

  let days = [];
  for (let i = 0; i < daysArray.length; i++) {
    let date = new Date();
    date.setDate(date.getDate() + i);
    let dateStr = date.toLocaleDateString('zh-CN');
    days.push({ date: dateStr, lines: daysArray[i] });
  }
  return { days, mealCount };
}
