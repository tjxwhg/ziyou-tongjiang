// trip.js - 行程规划引擎（完整版，包含警告收集）
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
    this.warnings = [];

    this.longSpots = [];
    this.halfSpots = [];
    this.shortSpots = [];
    this.classifySpots();
    this.halfSpots.sort((a,b) => b.visitDuration - a.visitDuration);
    this.lunchInserted = false;
    this.dinnerInserted = false;
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
    this.lunchInserted = false;
    this.dinnerInserted = false;
  }

  // 插入餐食（后处理用，已弃用，但保留以防调用）
  insertMealAt(nodeList, time, mealName) { /* 暂不用 */ }

  // 后处理：为每天插入午餐和晚餐（严格规则）
  postProcessMeals() {
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

    for (let dayKey in days) {
      let nodes = days[dayKey];
      if (nodes.length === 0) continue;
      nodes.sort((a,b) => a.startTime - b.startTime);

      // 插入午餐
      let lunchInserted = false;
      for (let i = 0; i < nodes.length; i++) {
        let node = nodes[i];
        if (node.startTime <= LUNCH_START && node.endTime > LUNCH_START) {
          if (node.type === 'visit' && node.duration > 60) {
            let splitTime = LUNCH_START;
            let firstPart = { ...node, endTime: splitTime, duration: splitTime - node.startTime };
            let secondPart = { ...node, startTime: splitTime + MEAL_DURATION, endTime: node.endTime + MEAL_DURATION, duration: node.duration - (splitTime - node.startTime) };
            nodes.splice(i, 1, firstPart, { type: 'meal', name: '午餐时间', startTime: splitTime, endTime: splitTime + MEAL_DURATION, duration: MEAL_DURATION }, secondPart);
            lunchInserted = true;
            for (let j = i+2; j < nodes.length; j++) {
              nodes[j].startTime += MEAL_DURATION;
              nodes[j].endTime += MEAL_DURATION;
            }
            break;
          } else {
            let insertTime = node.endTime;
            nodes.splice(i+1, 0, { type: 'meal', name: '午餐时间', startTime: insertTime, endTime: insertTime + MEAL_DURATION, duration: MEAL_DURATION });
            lunchInserted = true;
            for (let j = i+2; j < nodes.length; j++) {
              nodes[j].startTime += MEAL_DURATION;
              nodes[j].endTime += MEAL_DURATION;
            }
            break;
          }
        } else if (node.startTime > LUNCH_START && !lunchInserted) {
          let insertTime = LUNCH_START;
          let prevEnd = i > 0 ? nodes[i-1].endTime : DAY_START;
          if (prevEnd > insertTime) insertTime = prevEnd;
          if (insertTime + MEAL_DURATION <= node.startTime) {
            nodes.splice(i, 0, { type: 'meal', name: '午餐时间', startTime: insertTime, endTime: insertTime + MEAL_DURATION, duration: MEAL_DURATION });
            lunchInserted = true;
            for (let j = i+1; j < nodes.length; j++) {
              nodes[j].startTime += MEAL_DURATION;
              nodes[j].endTime += MEAL_DURATION;
            }
            break;
          }
        }
      }
      if (!lunchInserted) {
        let lastEnd = nodes[nodes.length-1].endTime;
        if (lastEnd < LUNCH_START) {
          let insertTime = Math.max(lastEnd, LUNCH_START);
          if (insertTime + MEAL_DURATION <= DAY_END) {
            nodes.push({ type: 'meal', name: '午餐时间', startTime: insertTime, endTime: insertTime + MEAL_DURATION, duration: MEAL_DURATION });
          }
        }
      }

      nodes.sort((a,b) => a.startTime - b.startTime);

      // 插入晚餐
      let dinnerInserted = false;
      for (let i = 0; i < nodes.length; i++) {
        let node = nodes[i];
        if (node.startTime <= DINNER_START && node.endTime > DINNER_START) {
          if (node.type === 'visit' && node.duration > 60) {
            let splitTime = DINNER_START;
            let firstPart = { ...node, endTime: splitTime, duration: splitTime - node.startTime };
            let secondPart = { ...node, startTime: splitTime + MEAL_DURATION, endTime: node.endTime + MEAL_DURATION, duration: node.duration - (splitTime - node.startTime) };
            nodes.splice(i, 1, firstPart, { type: 'meal', name: '晚餐时间', startTime: splitTime, endTime: splitTime + MEAL_DURATION, duration: MEAL_DURATION }, secondPart);
            dinnerInserted = true;
            for (let j = i+2; j < nodes.length; j++) {
              nodes[j].startTime += MEAL_DURATION;
              nodes[j].endTime += MEAL_DURATION;
            }
            break;
          } else {
            let insertTime = node.endTime;
            nodes.splice(i+1, 0, { type: 'meal', name: '晚餐时间', startTime: insertTime, endTime: insertTime + MEAL_DURATION, duration: MEAL_DURATION });
            dinnerInserted = true;
            for (let j = i+2; j < nodes.length; j++) {
              nodes[j].startTime += MEAL_DURATION;
              nodes[j].endTime += MEAL_DURATION;
            }
            break;
          }
        } else if (node.startTime > DINNER_START && !dinnerInserted) {
          let insertTime = DINNER_START;
          let prevEnd = i > 0 ? nodes[i-1].endTime : DAY_START;
          if (prevEnd > insertTime) insertTime = prevEnd;
          if (insertTime + MEAL_DURATION <= node.startTime) {
            nodes.splice(i, 0, { type: 'meal', name: '晚餐时间', startTime: insertTime, endTime: insertTime + MEAL_DURATION, duration: MEAL_DURATION });
            dinnerInserted = true;
            for (let j = i+1; j < nodes.length; j++) {
              nodes[j].startTime += MEAL_DURATION;
              nodes[j].endTime += MEAL_DURATION;
            }
            break;
          }
        }
      }
      if (!dinnerInserted) {
        let lastEnd = nodes[nodes.length-1].endTime;
        if (lastEnd < DINNER_START) {
          let insertTime = Math.max(lastEnd, DINNER_START);
          if (insertTime + MEAL_DURATION <= DAY_END) {
            nodes.push({ type: 'meal', name: '晚餐时间', startTime: insertTime, endTime: insertTime + MEAL_DURATION, duration: MEAL_DURATION });
          }
        }
      }

      nodes.sort((a,b) => a.startTime - b.startTime);
      days[dayKey] = nodes;
    }

    this.allNodes = [];
    for (let dayKey in days) {
      this.allNodes.push(...days[dayKey]);
      this.allNodes.push({ type: 'dayEnd' });
    }
    if (this.allNodes.length > 0 && this.allNodes[this.allNodes.length-1].type === 'dayEnd') {
      this.allNodes.pop();
    }
  }

  // 安排一个景点（生成游览节点，截断超出18:00的部分）
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

    let remaining = spot.visitDuration || 0;
    if (time >= DAY_END) {
      return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
    }
    if (time >= NEW_ARRIVAL_CUTOFF) {
      return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
    }

    // 游览时间限制到 DAY_END
    let visitEnd = Math.min(time + remaining, DAY_END);
    let actualDuration = visitEnd - time;
    if (actualDuration > 0) {
      nodes.push({
        type: 'visit',
        name: spot.name,
        startTime: time,
        endTime: visitEnd,
        duration: actualDuration,
        spotId: spot.id
      });
    }
    time = visitEnd;
    remaining -= actualDuration;
    if (remaining > 0) {
      // 有剩余，表示被截断
      return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
    }

    return { nodes, newTime: time, newPoi: poi, remaining: 0, error: null };
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
    this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
    return { newTime };
  }

  // 填充短耗时（碎片化）
  fillShortSpots(maxEndTime) {
    if (!this.allowFill) return;
    while (this.currentMin < maxEndTime) {
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

  // 处理长耗时（独占一天，若时间不合适则移到第二天）
  processLongSpots() {
    for (let spot of this.longSpots) {
      if (this.usedIds.has(spot.id)) continue;

      // 如果当前时间 > DAY_START，则先填充当天短耗时并结束当天，移到第二天
      let moved = false;
      if (this.currentMin > DAY_START) {
        // 填充当天剩余时间（短耗时）
        this.fillShortSpots(DAY_END);
        if (this.lastPoi.id !== 'county') {
          let ret = this.addReturnToCounty(this.currentMin);
          if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
          this.currentMin = ret.newTime;
        }
        this.endDay();
        // 记录警告
        let dateStr = this.currentDate.toLocaleDateString('zh-CN');
        this.warnings.push(`因长耗时景区 "${spot.name}" 需调整，${dateStr} 当天为空闲日，建议在县城附近游览。`);
        // 下一天
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentMin = DAY_START;
        this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
        this.lunchInserted = false;
        this.dinnerInserted = false;
        moved = true;
      }

      // 确保当前时间是 DAY_START
      this.currentMin = DAY_START;

      // 安排长耗时
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

      // 检查是否有剩余（即被截断）
      if (result.remaining > 0) {
        this.warnings.push(`因时间不足，景区 "${spot.name}" 部分游览被省略（剩余 ${result.remaining} 分钟）。`);
      }

      // 长耗时结束，必须返回县城
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
          if (result.remaining > 0) {
            this.warnings.push(`因时间不足，景区 "${spot.name}" 部分游览被省略。`);
          }
          this.fillShortSpots(blockEnd);
          this.currentMin = Math.max(this.currentMin, LUNCH_END);
          this.fillShortSpots(DINNER_START);
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
          this.fillShortSpots(LUNCH_START);
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
          if (result.remaining > 0) {
            this.warnings.push(`因时间不足，景区 "${spot.name}" 部分游览被省略。`);
          }
          this.fillShortSpots(blockEnd);
          this.fillShortSpots(DAY_END);
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
          this.fillShortSpots(DINNER_START);
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

  generate() {
    try {
      if (this.currentMin > DAY_END) {
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentMin = DAY_START;
      }
      // 处理长耗时（包含自动移动和截断警告）
      this.processLongSpots();
      // 处理半天
      this.processHalfSpots();
      // 填充短耗时（如果还有时间）
      if (this.allowFill) {
        this.fillShortSpots(DAY_END);
        if (this.lastPoi.id !== 'county') {
          let ret = this.addReturnToCounty(this.currentMin);
          if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
          this.currentMin = ret.newTime;
        }
        this.endDay();
      }
      // 后处理插入餐食
      this.postProcessMeals();

      if (this.allNodes.length > 0 && this.allNodes[this.allNodes.length-1].type !== 'dayEnd') {
        this.allNodes.push({ type: 'dayEnd' });
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
  }

  const generator = new PlanGenerator(validSpots, startDate, startTime, mode, getTravelTimeFn, countySpots, allowFill, fillOnlyMeals);
  return generator.generate();
}

export function generateTimeline(nodes) {
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
