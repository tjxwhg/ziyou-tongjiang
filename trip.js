// trip.js - 行程规划引擎（最终完整版）
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

class PlanGenerator {
  constructor(spots, startDate, startTime, mode, getTravelTimeFn, countySpots, allowFill, fillOnlyMeals) {
    this.spots = spots;
    this.startDate = new Date(startDate);
    this.startTime = startTime;
    this.mode = mode;
    this.getTravelTime = getTravelTimeFn || ((a,b) => 0);
    this.countySpots = countySpots || [];
    this.allowFill = allowFill !== undefined ? allowFill : true;
    this.fillOnlyMeals = fillOnlyMeals === true;

    this.currentDate = new Date(this.startDate);
    this.currentMin = this.startTime;
    this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
    this.allNodes = []; // 所有节点，按时间顺序维护
    this.usedIds = new Set();
    this.warnings = [];

    // 分类
    this.longSpots = [];
    this.halfSpots = [];
    this.userShortSpots = [];
    this.systemShortSpots = [];
    this.classifySpots();
    this.halfSpots.sort((a,b) => b.visitDuration - a.visitDuration);

    this.lunchInserted = false;
    this.dinnerInserted = false;
    this.isIdleDay = false;       // 当前天是否为空闲日
    this.idleDayDate = null;      // 空闲日日期（用于填充）
  }

  classifySpots() {
    for (let s of this.spots) {
      if (!s || !s.id) continue;
      if (LONG_SPOT_NAMES.some(name => s.name.includes(name))) {
        s.type = 'long';
        this.longSpots.push(s);
      } else if (s.visitDuration >= 100) {
        s.type = 'half';
        this.halfSpots.push(s);
      } else {
        s.type = 'short';
        // 区分用户选择的和系统填充
        if (s.isCounty) {
          this.systemShortSpots.push(s);
        } else {
          this.userShortSpots.push(s);
        }
      }
    }
  }

  // 向 allNodes 插入节点，保持时间顺序
  addNode(node) {
    if (!node) return;
    // 排除 dayEnd 特殊处理
    if (node.type === 'dayEnd') {
      this.allNodes.push(node);
      return;
    }
    // 按 startTime 插入
    let idx = this.allNodes.length;
    for (let i = this.allNodes.length - 1; i >= 0; i--) {
      if (this.allNodes[i].type === 'dayEnd') continue;
      if (this.allNodes[i].startTime <= node.startTime) {
        idx = i + 1;
        break;
      }
      idx = i;
    }
    this.allNodes.splice(idx, 0, node);
  }

  // 结束当天，插入 dayEnd，重置餐食标记
  endDay() {
    this.addNode({ type: 'dayEnd' });
    this.lunchInserted = false;
    this.dinnerInserted = false;
    this.isIdleDay = false;
  }

  // 动态插入餐食（支持强制）
  insertMeal(currentTime, force = false) {
    let time = currentTime;
    // 午餐
    if (!this.lunchInserted && (force || (time >= LUNCH_START && time < LUNCH_END))) {
      let start = Math.max(time, LUNCH_START);
      if (force && time > LUNCH_START) start = time;
      let end = start + MEAL_DURATION;
      if (end > DAY_END) end = DAY_END;
      if (end > start) {
        this.addNode({
          type: 'meal',
          name: '午餐时间',
          startTime: start,
          endTime: end,
          duration: end - start
        });
        this.lunchInserted = true;
        return end;
      }
      return time;
    }
    // 晚餐
    if (!this.dinnerInserted && (force || (time >= DINNER_START && time < DINNER_END))) {
      let start = Math.max(time, DINNER_START);
      if (force && time > DINNER_START) start = time;
      let end = start + MEAL_DURATION;
      if (end > DAY_END) end = DAY_END;
      if (end > start) {
        this.addNode({
          type: 'meal',
          name: '晚餐时间',
          startTime: start,
          endTime: end,
          duration: end - start
        });
        this.dinnerInserted = true;
        return end;
      }
      return time;
    }
    return time;
  }

  // 检查交通是否跨越餐食窗口
  checkMealCrossing(startTime, endTime) {
    if (!this.lunchInserted && startTime < LUNCH_END && endTime > LUNCH_START) return 'lunch';
    if (!this.dinnerInserted && startTime < DINNER_END && endTime > DINNER_START) return 'dinner';
    return null;
  }

  // 安排一个景点（游览+交通），动态插入餐食，返回结束时间
  arrangeSpot(spot, travelTime, startTime) {
    let time = startTime;
    let poi = this.lastPoi;

    // 1. 交通
    if (travelTime > 0) {
      if (time + travelTime > 1440) return { error: '交通跨天', newTime: time };
      const transportNode = {
        type: 'transport',
        name: spot.name,
        startTime: time,
        endTime: time + travelTime,
        duration: travelTime,
        fromPoi: poi.id,
        toPoi: spot.id,
        isReturn: false
      };
      this.addNode(transportNode);
      time += travelTime;
      poi = { id: spot.id, name: spot.name, lat: spot.lat, lng: spot.lng, type: spot.type };
    }

    // 2. 交通结束后检测餐食跨越
    let mealCross = this.checkMealCrossing(startTime, time);
    if (mealCross === 'lunch') {
      time = this.insertMeal(time, true);
    } else if (mealCross === 'dinner') {
      time = this.insertMeal(time, true);
    } else {
      time = this.insertMeal(time);
    }

    // 3. 游览
    let remaining = spot.visitDuration || 0;
    if (time >= DAY_END) {
      this.lastPoi = poi;
      return { error: null, newTime: time, remaining: remaining };
    }
    if (time >= NEW_ARRIVAL_CUTOFF) {
      // 17:00后不开始新游览
      this.lastPoi = poi;
      return { error: null, newTime: time, remaining: remaining };
    }

    while (remaining > 0) {
      if (time >= DAY_END) {
        if (remaining > 0) {
          this.warnings.push(`因时间不足，景区 "${spot.name}" 剩余 ${remaining} 分钟游览被省略。`);
        }
        break;
      }

      let mealInserted = false;
      // 如果剩余 > 60，尝试插入餐食；否则先完成游览
      if (remaining > 60) {
        let newTime = this.insertMeal(time);
        if (newTime > time) {
          time = newTime;
          mealInserted = true;
        }
      }
      if (!mealInserted) {
        // 确定到下一个餐食窗口或 DAY_END 的最大游览段
        let nextMeal = DAY_END;
        if (!this.lunchInserted && time < LUNCH_START) nextMeal = Math.min(nextMeal, LUNCH_START);
        else if (!this.dinnerInserted && time < DINNER_START) nextMeal = Math.min(nextMeal, DINNER_START);
        let maxSeg = nextMeal - time;
        if (maxSeg <= 0) maxSeg = 1;
        let seg = Math.min(remaining, maxSeg, DAY_END - time);
        if (seg <= 0) break;
        this.addNode({
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
      this.warnings.push(`因时间不足，景区 "${spot.name}" 剩余 ${remaining} 分钟游览被省略。`);
    }

    this.lastPoi = poi;
    return { error: null, newTime: time, remaining: remaining };
  }

  // 返回县城（仅长耗时和半天）
  addReturnToCounty(currentTime) {
    let travelBack = this.getTravelTime(this.lastPoi.id, 'county', this.mode);
    if (travelBack == null) travelBack = 0;
    if (currentTime + travelBack > 1440) return { error: '返回县城交通跨天', newTime: currentTime };
    let newTime = currentTime + travelBack;
    if (newTime > MAX_RETURN_TIME) {
      return { error: `返回县城交通结束时间 ${formatTime(newTime)} 超过21:00`, newTime: currentTime };
    }
    this.addNode({
      type: 'transport',
      name: '返回县城',
      startTime: currentTime,
      endTime: newTime,
      duration: travelBack,
      fromPoi: this.lastPoi.id,
      toPoi: 'county',
      isReturn: true
    });
    // 返回后检测餐食跨越
    let mealCross = this.checkMealCrossing(currentTime, newTime);
    if (mealCross === 'lunch') {
      newTime = this.insertMeal(newTime, true);
    } else if (mealCross === 'dinner') {
      newTime = this.insertMeal(newTime, true);
    } else {
      newTime = this.insertMeal(newTime);
    }
    this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
    return { error: null, newTime: newTime };
  }

  // 填充短耗时（仅空闲日调用）
  fillShortSpots(maxEndTime) {
    if (!this.allowFill || !this.isIdleDay) return;
    // 优先用户选择的短耗时，然后是系统县城景点
    let fillList = [...this.userShortSpots, ...this.systemShortSpots];
    while (this.currentMin < maxEndTime && this.currentMin < DAY_END) {
      let found = false;
      for (let s of fillList) {
        if (this.usedIds.has(s.id)) continue;
        let t = this.getTravelTime(this.lastPoi.id, s.id, this.mode);
        if (t == null) t = 0;
        if (this.currentMin + t >= NEW_ARRIVAL_CUTOFF) continue;
        if (this.currentMin + t + s.visitDuration > maxEndTime) continue;
        let result = this.arrangeSpot(s, t, this.currentMin);
        if (result.error) continue;
        this.currentMin = result.newTime;
        this.usedIds.add(s.id);
        found = true;
        // 移除已使用的
        fillList = fillList.filter(item => item.id !== s.id);
        break;
      }
      if (!found) break;
    }
    // 短耗时结束后不返回县城，直接结束当天
  }

  // 处理长耗时
  processLongSpots() {
    for (let spot of this.longSpots) {
      if (this.usedIds.has(spot.id)) continue;

      // 如果当前时间 > DAY_START，则产生空闲日
      if (this.currentMin > DAY_START) {
        // 标记为空闲日
        this.isIdleDay = true;
        // 填充短耗时（不返回县城）
        this.fillShortSpots(DAY_END);
        // 如果最后不是县城且不是短耗时（但短耗时不会返回），则返回县城
        if (this.lastPoi.type !== 'county' && this.lastPoi.type !== 'short') {
          let ret = this.addReturnToCounty(this.currentMin);
          if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
          this.currentMin = ret.newTime;
        }
        this.endDay();
        let dateStr = this.currentDate.toLocaleDateString('zh-CN');
        this.warnings.push(`因长耗时景区 "${spot.name}" 需调整，${dateStr} 当天为空闲日，建议在县城附近游览。`);
        // 移到第二天
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentMin = DAY_START;
        this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
        this.lunchInserted = false;
        this.dinnerInserted = false;
        this.isIdleDay = false;
      }

      // 确保当前时间是 DAY_START
      this.currentMin = DAY_START;
      this.isIdleDay = false;

      let travel = this.getTravelTime(this.lastPoi.id, spot.id, this.mode);
      if (travel == null) travel = 0;
      if (this.currentMin + travel >= NEW_ARRIVAL_CUTOFF) {
        this.warnings.push(`景区 "${spot.name}" 游览开始时间 ${formatTime(this.currentMin + travel)} 超过17:00，可能无法完整游览。`);
      }

      let result = this.arrangeSpot(spot, travel, this.currentMin);
      if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
      this.currentMin = result.newTime;

      // 长耗时结束，必须返回县城
      let ret = this.addReturnToCounty(this.currentMin);
      if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
      this.currentMin = ret.newTime;
      this.endDay();

      // 下一天
      this.currentDate.setDate(this.currentDate.getDate() + 1);
      this.currentMin = DAY_START;
      this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
      this.lunchInserted = false;
      this.dinnerInserted = false;
      this.usedIds.add(spot.id);
    }
  }

  // 处理半天景点
  processHalfSpots() {
    let queue = [...this.halfSpots];
    let attempts = 0;
    while (queue.length > 0 && attempts < 200) {
      attempts++;
      let spot = queue.shift();
      if (this.usedIds.has(spot.id)) continue;

      let travel = this.getTravelTime(this.lastPoi.id, spot.id, this.mode);
      if (travel == null) travel = 0;

      let slot = 'morning';
      if (this.currentMin >= LUNCH_END && this.currentMin < DINNER_START) slot = 'afternoon';
      else if (this.currentMin >= DINNER_START) slot = 'night';

      if (slot === 'night') {
        this.endDay();
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentMin = DAY_START;
        this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
        this.lunchInserted = false;
        this.dinnerInserted = false;
        slot = 'morning';
        travel = this.getTravelTime(this.lastPoi.id, spot.id, this.mode);
      }

      if (this.currentMin >= LUNCH_START && this.currentMin < LUNCH_END) {
        let newTime = this.insertMeal(this.currentMin);
        if (newTime > this.currentMin) {
          this.currentMin = newTime;
        } else {
          this.currentMin = LUNCH_END;
        }
        slot = 'afternoon';
      }

      if (slot === 'morning') {
        let blockStart = Math.max(this.currentMin, DAY_START);
        let blockEnd = LUNCH_START;
        let available = blockEnd - blockStart;
        if (travel + spot.visitDuration <= available && blockStart + travel < NEW_ARRIVAL_CUTOFF) {
          let result = this.arrangeSpot(spot, travel, blockStart);
          if (result.error) { queue.push(spot); continue; }
          this.currentMin = result.newTime;
          // 半天结束，返回县城
          let ret = this.addReturnToCounty(this.currentMin);
          if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
          this.currentMin = ret.newTime;
          this.endDay();
          this.currentDate.setDate(this.currentDate.getDate() + 1);
          this.currentMin = DAY_START;
          this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
          this.lunchInserted = false;
          this.dinnerInserted = false;
          this.usedIds.add(spot.id);
          continue;
        } else {
          this.currentMin = LUNCH_END;
          slot = 'afternoon';
          travel = this.getTravelTime(this.lastPoi.id, spot.id, this.mode);
        }
      }

      if (slot === 'afternoon') {
        let blockStart = Math.max(this.currentMin, LUNCH_END);
        let blockEnd = DINNER_START;
        if (blockStart >= NEW_ARRIVAL_CUTOFF) {
          this.endDay();
          this.currentDate.setDate(this.currentDate.getDate() + 1);
          this.currentMin = DAY_START;
          this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
          this.lunchInserted = false;
          this.dinnerInserted = false;
          queue.push(spot);
          continue;
        }
        let available = blockEnd - blockStart;
        if (travel + spot.visitDuration <= available && blockStart + travel < NEW_ARRIVAL_CUTOFF) {
          let result = this.arrangeSpot(spot, travel, blockStart);
          if (result.error) { queue.push(spot); continue; }
          this.currentMin = result.newTime;
          let ret = this.addReturnToCounty(this.currentMin);
          if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
          this.currentMin = ret.newTime;
          this.endDay();
          this.currentDate.setDate(this.currentDate.getDate() + 1);
          this.currentMin = DAY_START;
          this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
          this.lunchInserted = false;
          this.dinnerInserted = false;
          this.usedIds.add(spot.id);
          continue;
        } else {
          this.endDay();
          this.currentDate.setDate(this.currentDate.getDate() + 1);
          this.currentMin = DAY_START;
          this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
          this.lunchInserted = false;
          this.dinnerInserted = false;
          queue.push(spot);
          continue;
        }
      }
    }
  }

  // 处理用户选择的短耗时（非空闲日，且没有长耗时/半天时）
  processUserShorts() {
    if (this.userShortSpots.length === 0) return;
    for (let spot of this.userShortSpots) {
      if (this.usedIds.has(spot.id)) continue;
      let travel = this.getTravelTime(this.lastPoi.id, spot.id, this.mode);
      if (travel == null) travel = 0;
      if (this.currentMin + travel >= NEW_ARRIVAL_CUTOFF) {
        // 太晚，移到下一天
        this.endDay();
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentMin = DAY_START;
        this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
        this.lunchInserted = false;
        this.dinnerInserted = false;
        travel = this.getTravelTime(this.lastPoi.id, spot.id, this.mode);
        if (travel == null) travel = 0;
      }
      let result = this.arrangeSpot(spot, travel, this.currentMin);
      if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
      this.currentMin = result.newTime;
      this.usedIds.add(spot.id);
      // 短耗时不返回县城
    }
    // 所有短耗时安排完毕，如果还有时间则结束当天
    if (this.currentMin < DAY_END) {
      // 不填充其他
    }
    this.endDay();
  }

  generate() {
    try {
      if (this.currentMin > DAY_END) {
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentMin = DAY_START;
      }

      // 1. 处理长耗时
      this.processLongSpots();

      // 2. 处理半天景点
      this.processHalfSpots();

      // 3. 处理用户短耗时（非空闲日）
      if (!this.isIdleDay && this.userShortSpots.length > 0) {
        this.processUserShorts();
      }

      // 如果最后不是县城且不是短耗时，则返回县城（但长/半天已处理）
      if (this.lastPoi.type !== 'county' && this.lastPoi.type !== 'short') {
        let ret = this.addReturnToCounty(this.currentMin);
        if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
        this.currentMin = ret.newTime;
      }

      // 确保最后有 dayEnd
      if (this.allNodes.length > 0 && this.allNodes[this.allNodes.length-1].type !== 'dayEnd') {
        this.addNode({ type: 'dayEnd' });
      }

      return { nodes: this.allNodes, error: false, warnings: this.warnings };
    } catch (e) {
      return { nodes: [], error: true, errorMsg: e.message, warnings: this.warnings };
    }
  }
}

export function generateTripPlan(spots, startDate, startTime, mode, allowFill = true, fillOnlyMeals = false) {
  if (!spots || !Array.isArray(spots) || spots.length === 0) {
    return { nodes: [], error: true, errorMsg: '没有有效的景点数据', warnings: [] };
  }
  const validSpots = spots.filter(s => s && s.id && s.name && typeof s.visitDuration === 'number' && s.visitDuration >= 0);
  if (validSpots.length === 0) {
    return { nodes: [], error: true, errorMsg: '没有有效的景点数据', warnings: [] };
  }

  const getTravelTimeFn = (fromId, toId, mode) => {
    const t = getTransportTime(fromId, toId, mode);
    return (t != null && !isNaN(t)) ? t : 0;
  };

  let countySpots = [];
  if (typeof window !== 'undefined' && window.__countySpots) {
    countySpots = window.__countySpots;
    countySpots.forEach(s => s.isCounty = true);
  }

  const generator = new PlanGenerator(validSpots, startDate, startTime, mode, getTravelTimeFn, countySpots, allowFill, fillOnlyMeals);
  return generator.generate();
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
  for (let node of nodes) {
    if (node.type === 'dayEnd') {
      if (currentDayLines.length > 0) {
        daysArray.push([...currentDayLines]);
        currentDayLines = [];
      }
    } else {
      // 找到对应的文本
      let text = lines.shift();
      if (text) currentDayLines.push(text);
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
