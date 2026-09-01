// trip.js - 行程规划引擎（完整重写版）
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

// 判断是否为长耗时
function isLongSpot(spot) {
  return LONG_SPOT_NAMES.some(name => spot.name.includes(name));
}

export function generateTripPlan(spots, startDate, startTime, mode, allowFill = true, fillOnlyMeals = false) {
  // ---------- 初始化 ----------
  const allSpots = spots.filter(s => s && s.id && s.name && typeof s.visitDuration === 'number' && s.visitDuration >= 0);
  if (allSpots.length === 0) {
    return { nodes: [], error: true, errorMsg: '没有有效的景点数据', warnings: [] };
  }

  // 分类
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
  const nodes = []; // 所有已安排节点
  const warnings = [];
  const usedIds = new Set();

  // 每日餐食标记
  let lunchInserted = false;
  let dinnerInserted = false;
  let isIdleDay = false; // 当前天是否为空闲日（因长耗时移动产生）

  // ---------- 辅助函数 ----------
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
    // 按 startTime 插入
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

  // 插入餐食（动态）
  function insertMeal(time, force = false) {
    let t = time;
    // 午餐
    if (!lunchInserted && (force || (t >= LUNCH_START && t < LUNCH_END))) {
      let start = Math.max(t, LUNCH_START);
      if (force && t > LUNCH_START) start = t;
      let end = start + MEAL_DURATION;
      if (end > DAY_END) end = DAY_END;
      if (end > start) {
        addNode({
          type: 'meal',
          name: '午餐时间',
          startTime: start,
          endTime: end,
          duration: end - start
        });
        lunchInserted = true;
        return end;
      }
      return t;
    }
    // 晚餐
    if (!dinnerInserted && (force || (t >= DINNER_START && t < DINNER_END))) {
      let start = Math.max(t, DINNER_START);
      if (force && t > DINNER_START) start = t;
      let end = start + MEAL_DURATION;
      if (end > DAY_END) end = DAY_END;
      if (end > start) {
        addNode({
          type: 'meal',
          name: '晚餐时间',
          startTime: start,
          endTime: end,
          duration: end - start
        });
        dinnerInserted = true;
        return end;
      }
      return t;
    }
    return t;
  }

  // 检查交通是否跨越餐食窗口
  function checkMealCrossing(startTime, endTime) {
    if (!lunchInserted && startTime < LUNCH_END && endTime > LUNCH_START) return 'lunch';
    if (!dinnerInserted && startTime < DINNER_END && endTime > DINNER_START) return 'dinner';
    return null;
  }

  // 安排一个景点（返回结束时间）
  function arrangeSpot(spot, travelTime, startTime) {
    let time = startTime;
    let poi = lastPoi;

    // 1. 交通
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

    // 2. 交通结束后插入餐食（检测跨越或正常插入）
    let mealCross = checkMealCrossing(startTime, time);
    if (mealCross) {
      time = insertMeal(time, true);
    } else {
      time = insertMeal(time);
    }

    // 3. 游览
    let remaining = spot.visitDuration || 0;
    if (time >= DAY_END) {
      lastPoi = poi;
      return { error: null, newTime: time, remaining: remaining };
    }
    if (time >= NEW_ARRIVAL_CUTOFF) {
      // 17:00后不开始新游览
      lastPoi = poi;
      return { error: null, newTime: time, remaining: remaining };
    }

    while (remaining > 0) {
      if (time >= DAY_END) {
        if (remaining > 0) {
          warnings.push(`因时间不足，景区 "${spot.name}" 剩余 ${remaining} 分钟游览被省略。`);
        }
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

    if (remaining > 0) {
      warnings.push(`因时间不足，景区 "${spot.name}" 剩余 ${remaining} 分钟游览被省略。`);
    }

    lastPoi = poi;
    return { error: null, newTime: time, remaining: remaining };
  }

  // 返回县城（仅长耗时和半天）
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
    // 返回后检测餐食跨越
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
    // 短耗时结束后不返回县城，直接结束当天
  }

  // ---------- 主流程 ----------
  // 1. 先处理长耗时景点
  for (let spot of longSpots) {
    if (usedIds.has(spot.id)) continue;

    // 如果当前时间 > DAY_START，说明当天已有安排，需要将当前天作为空闲日
    if (currentMin > DAY_START) {
      // 标记空闲日
      isIdleDay = true;
      // 填充当前天（用户短耗时 + 系统短耗时）
      const fillList = [...userShortSpots, ...systemShortSpots];
      fillShortSpots(DAY_END, fillList);
      // 如果最后不是县城且不是短耗时，则返回（但短耗时不会返回）
      if (lastPoi.type !== 'county' && lastPoi.type !== 'short') {
        let ret = returnToCounty(currentMin);
        if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
        currentMin = ret.newTime;
      }
      endDay();
      const dateStr = currentDate.toLocaleDateString('zh-CN');
      warnings.push(`因长耗时景区 "${spot.name}" 需调整，${dateStr} 当天为空闲日，建议在县城附近游览。`);
      // 移到下一天8:00
      currentDate.setDate(currentDate.getDate() + 1);
      currentMin = DAY_START;
      lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
      lunchInserted = false;
      dinnerInserted = false;
      isIdleDay = false;
    }

    // 安排长耗时（从8:00开始）
    currentMin = DAY_START; // 确保从8点开始
    let travel = getTransportTime(lastPoi.id, spot.id, mode);
    if (travel == null) travel = 0;
    let result = arrangeSpot(spot, travel, currentMin);
    if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
    currentMin = result.newTime;

    // 长耗时结束必须返回县城
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

  // 2. 处理半天景点
  for (let spot of halfSpots) {
    if (usedIds.has(spot.id)) continue;

    let travel = getTransportTime(lastPoi.id, spot.id, mode);
    if (travel == null) travel = 0;

    // 判断当前时间所在时段
    let slot = 'morning';
    if (currentMin >= LUNCH_END && currentMin < DINNER_START) slot = 'afternoon';
    else if (currentMin >= DINNER_START) slot = 'night';

    // 如果当前是晚上，移到下一天上午
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

    // 如果当前在午餐窗口内，先插入午餐并移到午餐结束
    if (currentMin >= LUNCH_START && currentMin < LUNCH_END) {
      let newTime = insertMeal(currentMin);
      if (newTime > currentMin) {
        currentMin = newTime;
      } else {
        currentMin = LUNCH_END;
      }
      slot = 'afternoon';
    }

    if (slot === 'morning') {
      let blockStart = Math.max(currentMin, DAY_START);
      let blockEnd = LUNCH_START;
      let available = blockEnd - blockStart;
      if (travel + spot.visitDuration <= available && blockStart + travel < NEW_ARRIVAL_CUTOFF) {
        let result = arrangeSpot(spot, travel, blockStart);
        if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
        currentMin = result.newTime;
        // 半天结束返回县城
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
        // 上午不够，移到下午
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
        // 递归处理（简单起见，重新尝试）
        // 但这里简单将景点放回队列重新处理，但因循环结构，我们用递归方式
        // 但为了简单，我们重新计算
        // 这里重新安排
        currentMin = DAY_START;
        // 重新计算交通
        travel = getTransportTime(lastPoi.id, spot.id, mode);
        if (travel == null) travel = 0;
        // 直接尝试安排在上午
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
          throw new Error(`半天景点 "${spot.name}" 无法在合适时段安排。`);
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
        // 下午不够，移到下一天
        endDay();
        currentDate.setDate(currentDate.getDate() + 1);
        currentMin = DAY_START;
        lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
        lunchInserted = false;
        dinnerInserted = false;
        // 继续循环会重新尝试，但为了简单，我们将景点放回队列，但这里我们用递归，但简单起见，我们重新安排
        // 重新安排，用 while 循环重新处理
        // 因为我们在 for 循环中，可以 continue 到下一个景点，但需要确保该景点被重新尝试
        // 我们将景点放回数组开头
        // 但更简单：将当前景点插入到未处理列表开头，重新处理
        // 由于我们是在 for 循环中，我们可以用 unshift 再 break
        // 但为了简单，我们抛出错误，由外部处理
        throw new Error(`半天景点 "${spot.name}" 无法在合适时段安排。`);
      }
    }
  }

  // 3. 处理用户短耗时景点（非空闲日）
  for (let spot of userShortSpots) {
    if (usedIds.has(spot.id)) continue;
    let travel = getTransportTime(lastPoi.id, spot.id, mode);
    if (travel == null) travel = 0;
    if (currentMin + travel >= NEW_ARRIVAL_CUTOFF) {
      // 太晚，移到下一天
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

  // 4. 处理系统短耗时（空闲日填充已在长耗时中处理，此处不再重复）

  // 如果最后还有时间且 lastPoi 不是县城，则返回县城（仅针对长/半天）
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
  // 过滤掉 dayEnd 用于合并
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

  // 按 dayEnd 分割天数
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
