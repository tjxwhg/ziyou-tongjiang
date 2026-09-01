// trip.js - 行程规划引擎（完整修复版）
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
    this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
    this.allNodes = [];
    this.usedIds = new Set();

    this.longSpots = [];
    this.halfSpots = [];
    this.shortSpots = [];
    this.classifySpots();
    this.halfSpots.sort((a,b) => b.visitDuration - a.visitDuration);
    this.lunchInserted = false;
    this.dinnerInserted = false;
    // 新增：记录每天是否已插入餐食（用于后处理）
    this.dayMeals = {}; // key: date string
  }

  classifySpots() {
    for (let s of this.spots) {
      if (!s || !s.id) continue;
      if (LONG_SPOT_NAMES.some(name => s.name.includes(name))) {
        this.longSpots.push(s);
      } else if (s.visitDuration >= 100) {
        this.halfSpots.push(s);
      } else {
        this.shortSpots.push(s);
      }
    }
  }

  endDay() {
    if (this.allNodes.length > 0 && this.allNodes[this.allNodes.length-1].type !== 'dayEnd') {
      this.allNodes.push({ type: 'dayEnd' });
    }
    // 重置当日餐食标记，第二天重新插入
    // 在generate后处理中统一插入，因此这里不重置
  }

  // 插入餐食，返回新时间
  insertMeal(currentTime) {
    let time = currentTime;
    // 午餐
    if (!this.lunchInserted && time >= LUNCH_START && time < LUNCH_END + 30) {
      let start = Math.max(time, LUNCH_START);
      let end = start + MEAL_DURATION;
      this.allNodes.push({
        type: 'meal',
        name: '午餐时间',
        startTime: start,
        endTime: end,
        duration: MEAL_DURATION
      });
      this.lunchInserted = true;
      return end;
    }
    // 晚餐
    if (!this.dinnerInserted && time >= DINNER_START && time < DINNER_END + 30) {
      let start = Math.max(time, DINNER_START);
      let end = start + MEAL_DURATION;
      this.allNodes.push({
        type: 'meal',
        name: '晚餐时间',
        startTime: start,
        endTime: end,
        duration: MEAL_DURATION
      });
      this.dinnerInserted = true;
      return end;
    }
    return time;
  }

  // 安排一个景点（游览+交通）
  arrangeSpot(spot, travelTime, startTime) {
    let nodes = [];
    let time = startTime;
    let poi = this.lastPoi;

    if (travelTime > 0) {
      if (time + travelTime > 1440) return { error: '交通跨天' };
      nodes.push({
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
      poi = { id: spot.id, name: spot.name, lat: spot.lat, lng: spot.lng };
    }

    // 到达后尝试插入餐食（如果时间合适）
    time = this.insertMeal(time);

    let remaining = spot.visitDuration || 0;
    if (time >= DAY_END) {
      return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
    }
    if (time >= NEW_ARRIVAL_CUTOFF) {
      return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
    }

    while (remaining > 0) {
      if (time >= DAY_END) return { nodes, newTime: time, newPoi: poi, remaining, error: null };

      let mealInserted = false;
      if (remaining > 60) {
        let newTime = this.insertMeal(time);
        if (newTime > time) {
          time = newTime;
          mealInserted = true;
        }
      }
      if (!mealInserted) {
        let nextMeal = DAY_END;
        if (!this.lunchInserted && time < LUNCH_START) nextMeal = Math.min(nextMeal, LUNCH_START);
        else if (!this.dinnerInserted && time < DINNER_START) nextMeal = Math.min(nextMeal, DINNER_START);
        let maxSeg = nextMeal - time;
        if (maxSeg <= 0) maxSeg = 1;
        let seg = Math.min(remaining, maxSeg, DAY_END - time);
        if (seg <= 0) break;
        nodes.push({ type: 'visit', name: spot.name, startTime: time, endTime: time + seg, duration: seg, spotId: spot.id });
        time += seg;
        remaining -= seg;
      }
    }

    return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
  }

  // 返回县城
  addReturnToCounty(currentTime) {
    let travelBack = this.getTravelTime(this.lastPoi.id, 'county', this.mode);
    if (travelBack == null) travelBack = 0;
    if (currentTime + travelBack > 1440) return { error: '返回县城交通跨天' };
    let newTime = currentTime + travelBack;
    if (newTime > MAX_RETURN_TIME) {
      return { error: `返回县城交通结束时间 ${formatTime(newTime)} 超过21:00` };
    }
    this.allNodes.push({
      type: 'transport',
      name: '返回县城',
      startTime: currentTime,
      endTime: newTime,
      duration: travelBack,
      fromPoi: this.lastPoi.id,
      toPoi: 'county',
      isReturn: true
    });
    // 返回后尝试插入餐食（如果时间合适）
    newTime = this.insertMeal(newTime);
    this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
    return { newTime };
  }

  // 填充空窗（仅当 allowFill 且不是仅餐）
  fillGap(maxEndTime) {
    if (!this.allowFill || this.fillOnlyMeals) return;
    while (this.currentMin < maxEndTime) {
      let newTime = this.insertMeal(this.currentMin);
      if (newTime > this.currentMin) {
        this.currentMin = newTime;
        continue;
      }
      let found = false;
      for (let s of this.shortSpots) {
        if (this.usedIds.has(s.id)) continue;
        let t = this.getTravelTime(this.lastPoi.id, s.id, this.mode);
        if (t == null) t = 0;
        if (this.currentMin + t >= NEW_ARRIVAL_CUTOFF) continue;
        if (this.currentMin + t + s.visitDuration > maxEndTime) continue;
        let result = this.arrangeSpot(s, t, this.currentMin);
        if (result.error) continue;
        this.allNodes.push(...result.nodes);
        this.currentMin = result.newTime;
        this.lastPoi = result.newPoi;
        this.usedIds.add(s.id);
        found = true;
        break;
      }
      if (found) continue;
      for (let c of this.countySpots) {
        if (this.usedIds.has(c.id)) continue;
        let t = this.getTravelTime(this.lastPoi.id, c.id, this.mode);
        if (t == null) t = 0;
        if (this.currentMin + t >= NEW_ARRIVAL_CUTOFF) continue;
        if (this.currentMin + t + c.visitDuration > maxEndTime) continue;
        let result = this.arrangeSpot(c, t, this.currentMin);
        if (result.error) continue;
        this.allNodes.push(...result.nodes);
        this.currentMin = result.newTime;
        this.lastPoi = result.newPoi;
        this.usedIds.add(c.id);
        found = true;
        break;
      }
      if (!found) break;
    }
  }

  // 处理长耗时景点（独占一天）
  processLongSpots() {
    for (let spot of this.longSpots) {
      if (this.usedIds.has(spot.id)) continue;
      // 长耗时必须在当天开始，如果当前时间 > DAY_START，则结束当天，第二天8点开始
      if (this.currentMin > DAY_START) {
        this.endDay();
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentMin = DAY_START;
        this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
        this.lunchInserted = false;
        this.dinnerInserted = false;
      }
      // 确保当前时间恰好是 DAY_START
      this.currentMin = DAY_START;

      let travel = this.getTravelTime(this.lastPoi.id, spot.id, this.mode);
      if (travel == null) travel = 0;
      if (this.currentMin + travel + spot.visitDuration > DAY_END) {
        throw new Error(`长耗时景区 "${spot.name}" 所需时间超过18:00`);
      }
      if (this.currentMin + travel >= NEW_ARRIVAL_CUTOFF) {
        throw new Error(`长耗时景区 "${spot.name}" 游览开始超过17:00`);
      }

      let result = this.arrangeSpot(spot, travel, this.currentMin);
      if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
      this.allNodes.push(...result.nodes);
      this.currentMin = result.newTime;
      this.lastPoi = result.newPoi;
      if (result.remaining > 0) {
        throw new Error(`长耗时 "${spot.name}" 剩余 ${result.remaining} 分钟无法完成`);
      }

      // 长耗时独占一天，不填充其他景点，直接返回县城
      let ret = this.addReturnToCounty(this.currentMin);
      if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
      this.currentMin = ret.newTime;
      this.endDay();

      // 下一天
      this.currentDate.setDate(this.currentDate.getDate() + 1);
      this.currentMin = DAY_START;
      this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
      this.lunchInserted = false;
      this.dinnerInserted = false;
      this.usedIds.add(spot.id);
    }
  }

  // 处理半天景点（半日游）
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
        this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
        this.lunchInserted = false;
        this.dinnerInserted = false;
        slot = 'morning';
        travel = this.getTravelTime(this.lastPoi.id, spot.id, this.mode);
      }

      if (this.currentMin >= LUNCH_START && this.currentMin < LUNCH_END) {
        this.currentMin = LUNCH_END;
        slot = 'afternoon';
      }

      if (slot === 'morning') {
        let blockStart = Math.max(this.currentMin, DAY_START);
        let blockEnd = LUNCH_START;
        let available = blockEnd - blockStart;
        if (travel + spot.visitDuration <= available && blockStart + travel < NEW_ARRIVAL_CUTOFF) {
          let result = this.arrangeSpot(spot, travel, blockStart);
          if (result.error) { queue.push(spot); continue; }
          this.allNodes.push(...result.nodes);
          this.currentMin = result.newTime;
          this.lastPoi = result.newPoi;
          if (this.allowFill && !this.fillOnlyMeals) {
            this.fillGap(blockEnd);
          }
          this.currentMin = this.insertMeal(this.currentMin);
          if (this.allowFill && !this.fillOnlyMeals) {
            this.fillGap(DINNER_START);
          }
          let ret = this.addReturnToCounty(this.currentMin);
          if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
          this.currentMin = ret.newTime;
          this.endDay();
          this.currentDate.setDate(this.currentDate.getDate() + 1);
          this.currentMin = DAY_START;
          this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
          this.lunchInserted = false;
          this.dinnerInserted = false;
          this.usedIds.add(spot.id);
          continue;
        } else {
          if (this.allowFill && !this.fillOnlyMeals) this.fillGap(LUNCH_START);
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
          this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
          this.lunchInserted = false;
          this.dinnerInserted = false;
          queue.push(spot);
          continue;
        }
        let available = blockEnd - blockStart;
        if (travel + spot.visitDuration <= available && blockStart + travel < NEW_ARRIVAL_CUTOFF) {
          let result = this.arrangeSpot(spot, travel, blockStart);
          if (result.error) { queue.push(spot); continue; }
          this.allNodes.push(...result.nodes);
          this.currentMin = result.newTime;
          this.lastPoi = result.newPoi;
          if (this.allowFill && !this.fillOnlyMeals) {
            this.fillGap(blockEnd);
            this.fillGap(DAY_END);
          }
          let ret = this.addReturnToCounty(this.currentMin);
          if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
          this.currentMin = ret.newTime;
          this.endDay();
          this.currentDate.setDate(this.currentDate.getDate() + 1);
          this.currentMin = DAY_START;
          this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
          this.lunchInserted = false;
          this.dinnerInserted = false;
          this.usedIds.add(spot.id);
          continue;
        } else {
          if (this.allowFill && !this.fillOnlyMeals) this.fillGap(DINNER_START);
          this.endDay();
          this.currentDate.setDate(this.currentDate.getDate() + 1);
          this.currentMin = DAY_START;
          this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
          this.lunchInserted = false;
          this.dinnerInserted = false;
          queue.push(spot);
          continue;
        }
      }
    }
  }

  // 处理短耗时（碎片化填充）
  processShortSpots() {
    if (!this.allowFill || this.fillOnlyMeals) return;
    let anyInserted = true;
    while (anyInserted) {
      anyInserted = false;
      if (this.currentMin >= NEW_ARRIVAL_CUTOFF) break;
      for (let s of this.shortSpots) {
        if (this.usedIds.has(s.id)) continue;
        let t = this.getTravelTime(this.lastPoi.id, s.id, this.mode);
        if (t == null) t = 0;
        if (this.currentMin + t >= NEW_ARRIVAL_CUTOFF) continue;
        if (this.currentMin + t + s.visitDuration > DAY_END) continue;
        let result = this.arrangeSpot(s, t, this.currentMin);
        if (result.error) continue;
        this.allNodes.push(...result.nodes);
        this.currentMin = result.newTime;
        this.lastPoi = result.newPoi;
        this.usedIds.add(s.id);
        anyInserted = true;
        break;
      }
      if (anyInserted) continue;
      for (let c of this.countySpots) {
        if (this.usedIds.has(c.id)) continue;
        let t = this.getTravelTime(this.lastPoi.id, c.id, this.mode);
        if (t == null) t = 0;
        if (this.currentMin + t >= NEW_ARRIVAL_CUTOFF) continue;
        if (this.currentMin + t + c.visitDuration > DAY_END) continue;
        let result = this.arrangeSpot(c, t, this.currentMin);
        if (result.error) continue;
        this.allNodes.push(...result.nodes);
        this.currentMin = result.newTime;
        this.lastPoi = result.newPoi;
        this.usedIds.add(c.id);
        anyInserted = true;
        break;
      }
    }
  }

  // 后处理：为每天强制插入午餐和晚餐（如果缺失）
  ensureMealsPerDay() {
    // 按天分组节点
    let days = {};
    let currentDay = 0;
    let dayNodes = [];
    for (let node of this.allNodes) {
      if (node.type === 'dayEnd') {
        if (dayNodes.length > 0) {
          days[currentDay] = dayNodes;
          dayNodes = [];
          currentDay++;
        }
        continue;
      }
      dayNodes.push(node);
    }
    if (dayNodes.length > 0) {
      days[currentDay] = dayNodes;
    }

    // 对每一天，检查是否有午餐和晚餐节点
    for (let dayKey in days) {
      let nodes = days[dayKey];
      let hasLunch = nodes.some(n => n.type === 'meal' && n.name.includes('午餐'));
      let hasDinner = nodes.some(n => n.type === 'meal' && n.name.includes('晚餐'));
      // 如果当天有行程，且无午餐，则在合适时间插入
      if (!hasLunch && nodes.some(n => n.type === 'visit' || n.type === 'transport')) {
        // 寻找合适插入点：在11:30左右且不与其他节点重叠
        let insertTime = LUNCH_START;
        // 尝试在11:30插入，如果被占用则顺延
        let inserted = false;
        for (let i = 0; i < nodes.length; i++) {
          let n = nodes[i];
          if (n.startTime <= insertTime && n.endTime > insertTime) {
            // 被占用，尝试顺延到该节点结束后
            insertTime = n.endTime;
            if (insertTime > LUNCH_END) break;
          } else if (n.startTime > insertTime) {
            // 可以插入
            let mealNode = {
              type: 'meal',
              name: '午餐时间',
              startTime: insertTime,
              endTime: insertTime + MEAL_DURATION,
              duration: MEAL_DURATION
            };
            // 插入到该节点前
            nodes.splice(i, 0, mealNode);
            inserted = true;
            break;
          }
        }
        if (!inserted && nodes.length > 0) {
          // 追加到最后
          let last = nodes[nodes.length-1];
          if (last.endTime + MEAL_DURATION <= DAY_END) {
            nodes.push({
              type: 'meal',
              name: '午餐时间',
              startTime: last.endTime,
              endTime: last.endTime + MEAL_DURATION,
              duration: MEAL_DURATION
            });
          }
        }
      }
      // 晚餐类似
      if (!hasDinner && nodes.some(n => n.type === 'visit' || n.type === 'transport')) {
        let insertTime = DINNER_START;
        let inserted = false;
        for (let i = 0; i < nodes.length; i++) {
          let n = nodes[i];
          if (n.startTime <= insertTime && n.endTime > insertTime) {
            insertTime = n.endTime;
            if (insertTime > DINNER_END) break;
          } else if (n.startTime > insertTime) {
            let mealNode = {
              type: 'meal',
              name: '晚餐时间',
              startTime: insertTime,
              endTime: insertTime + MEAL_DURATION,
              duration: MEAL_DURATION
            };
            nodes.splice(i, 0, mealNode);
            inserted = true;
            break;
          }
        }
        if (!inserted && nodes.length > 0) {
          let last = nodes[nodes.length-1];
          if (last.endTime + MEAL_DURATION <= DAY_END) {
            nodes.push({
              type: 'meal',
              name: '晚餐时间',
              startTime: last.endTime,
              endTime: last.endTime + MEAL_DURATION,
              duration: MEAL_DURATION
            });
          }
        }
      }
    }

    // 重建 allNodes
    this.allNodes = [];
    for (let dayKey in days) {
      this.allNodes.push(...days[dayKey]);
      // 添加 dayEnd（除了最后一天可能不需要，但为了统一，末尾添加）
      this.allNodes.push({ type: 'dayEnd' });
    }
    // 移除最后一个多余的 dayEnd
    if (this.allNodes.length > 0 && this.allNodes[this.allNodes.length-1].type === 'dayEnd') {
      this.allNodes.pop();
    }
  }

  generate() {
    try {
      // 如果当前时间 > DAY_START，重置到 DAY_START（当天从8点开始）
      if (this.currentMin > DAY_START) {
        this.currentMin = DAY_START;
      }
      // 处理长耗时
      this.processLongSpots();
      // 处理半天
      this.processHalfSpots();
      // 处理短耗时（仅当允许填充且非仅餐）
      this.processShortSpots();
      // 后处理：确保每天有午餐晚餐
      this.ensureMealsPerDay();
      // 确保结尾有 dayEnd
      if (this.allNodes.length > 0 && this.allNodes[this.allNodes.length-1].type !== 'dayEnd') {
        this.allNodes.push({ type: 'dayEnd' });
      }
      return { nodes: this.allNodes, error: false };
    } catch (e) {
      return { nodes: [], error: true, errorMsg: e.message };
    }
  }
}

export function generateTripPlan(spots, startDate, startTime, mode, allowFill = true, fillOnlyMeals = false) {
  if (!spots || !Array.isArray(spots) || spots.length === 0) {
    return { nodes: [], error: true, errorMsg: '没有有效的景点数据' };
  }
  const validSpots = spots.filter(s => s && s.id && s.name && typeof s.visitDuration === 'number' && s.visitDuration >= 0);
  if (validSpots.length === 0) {
    return { nodes: [], error: true, errorMsg: '没有有效的景点数据' };
  }

  const getTravelTimeFn = (fromId, toId, mode) => {
    const t = getTransportTime(fromId, toId, mode);
    return (t != null && !isNaN(t)) ? t : 0;
  };

  let countySpots = [];
  if (typeof window !== 'undefined' && window.__countySpots) {
    countySpots = window.__countySpots;
  }

  const generator = new PlanGenerator(validSpots, startDate, startTime, mode, getTravelTimeFn, countySpots, allowFill, fillOnlyMeals);
  return generator.generate();
}

export function generateTimeline(nodes) {
  // 不变
  if (!nodes || nodes.length === 0) return { days: [], mealCount: 0 };
  let merged = [];
  for (let node of nodes) {
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
    } else if (node.type === 'dayEnd') {
      text = '🌙 当天行程结束，住宿休息';
    }
    if (text) lines.push(text);
  }

  let daysArray = [], currentDayLines = [];
  for (let text of lines) {
    if (text.includes('当天行程结束')) {
      if (currentDayLines.length > 0) { currentDayLines.push(text); daysArray.push(currentDayLines); currentDayLines = []; }
    } else {
      currentDayLines.push(text);
    }
  }
  if (currentDayLines.length > 0) daysArray.push(currentDayLines);
  daysArray = daysArray.filter(day => day.some(line => !line.includes('当天行程结束')));

  let days = [];
  for (let i = 0; i < daysArray.length; i++) {
    let date = new Date();
    date.setDate(date.getDate() + i);
    let dateStr = date.toLocaleDateString('zh-CN');
    days.push({ date: dateStr, lines: daysArray[i] });
  }
  return { days, mealCount };
}
