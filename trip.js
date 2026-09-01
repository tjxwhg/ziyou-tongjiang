// trip.js - 行程规划引擎（重构版，动态餐食插入，严格时间截断）
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
    // 每日餐食标记（动态插入时使用）
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
    // 重置餐食标记
    this.lunchInserted = false;
    this.dinnerInserted = false;
  }

  // 动态插入餐食：仅在当前时间处于午餐/晚餐窗口内且未插入过时插入
  insertMeal(currentTime) {
    let time = currentTime;
    // 午餐：11:30-12:30 窗口
    if (!this.lunchInserted && time >= LUNCH_START && time < LUNCH_END) {
      let start = Math.max(time, LUNCH_START);
      let end = start + MEAL_DURATION;
      // 确保不超出 DAY_END
      if (end <= DAY_END) {
        this.allNodes.push({
          type: 'meal',
          name: '午餐时间',
          startTime: start,
          endTime: end,
          duration: MEAL_DURATION
        });
        this.lunchInserted = true;
        return end;
      } else {
        // 如果超出18:00，不插入午餐
        return time;
      }
    }
    // 晚餐：17:30-18:30 窗口
    if (!this.dinnerInserted && time >= DINNER_START && time < DINNER_END) {
      let start = Math.max(time, DINNER_START);
      let end = start + MEAL_DURATION;
      if (end <= DAY_END) {
        this.allNodes.push({
          type: 'meal',
          name: '晚餐时间',
          startTime: start,
          endTime: end,
          duration: MEAL_DURATION
        });
        this.dinnerInserted = true;
        return end;
      } else {
        return time;
      }
    }
    return time;
  }

  // 安排一个景点（游览+交通），动态插入餐食
  arrangeSpot(spot, travelTime, startTime) {
    let nodes = [];
    let time = startTime;
    let poi = this.lastPoi;

    // 交通
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

    // 交通结束后尝试插入餐食
    time = this.insertMeal(time);

    let remaining = spot.visitDuration || 0;
    if (time >= DAY_END) {
      // 如果当前时间已到18:00，无法游览
      return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
    }
    if (time >= NEW_ARRIVAL_CUTOFF) {
      // 17:00后不再开始新游览
      return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
    }

    // 游览分段
    while (remaining > 0) {
      if (time >= DAY_END) {
        // 超出18:00，剩余时间丢弃
        if (remaining > 0) {
          this.warnings.push(`因时间不足，景区 "${spot.name}" 剩余 ${remaining} 分钟游览被省略。`);
        }
        break;
      }

      // 检查餐食窗口（仅当剩余时间 > 60 分钟时尝试插入餐食）
      let mealInserted = false;
      if (remaining > 60) {
        let newTime = this.insertMeal(time);
        if (newTime > time) {
          time = newTime;
          mealInserted = true;
        }
      }
      if (!mealInserted) {
        // 计算可以游览的时长：到下一个餐食窗口或DAY_END
        let nextMeal = DAY_END;
        if (!this.lunchInserted && time < LUNCH_START) nextMeal = Math.min(nextMeal, LUNCH_START);
        else if (!this.dinnerInserted && time < DINNER_START) nextMeal = Math.min(nextMeal, DINNER_START);
        let maxSeg = nextMeal - time;
        if (maxSeg <= 0) maxSeg = 1;
        let seg = Math.min(remaining, maxSeg, DAY_END - time);
        if (seg <= 0) break;
        nodes.push({
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

    // 如果剩余时间 > 0 但 time 已达 DAY_END，记录警告
    if (remaining > 0) {
      this.warnings.push(`因时间不足，景区 "${spot.name}" 剩余 ${remaining} 分钟游览被省略。`);
    }

    return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
  }

  // 返回县城，并在返回后尝试插入餐食
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
    // 返回后尝试插入餐食
    newTime = this.insertMeal(newTime);
    return { newTime };
  }

  // 填充短耗时（碎片化），但不会在返回县城后调用
  fillShortSpots(maxEndTime) {
    if (!this.allowFill) return;
    // 如果当前已经是返回县城后的状态（lastPoi.id === 'county' 且当前时间 > 18:00），则不再填充
    while (this.currentMin < maxEndTime && this.currentMin < DAY_END) {
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

  // 处理长耗时（独占一天，若当前时间 > 8:00 则移到第二天）
  processLongSpots() {
    for (let spot of this.longSpots) {
      if (this.usedIds.has(spot.id)) continue;

      // 如果当前时间 > DAY_START，则先填充当天短耗时并结束当天，移到第二天
      if (this.currentMin > DAY_START) {
        // 填充当天剩余时间（短耗时）
        this.fillShortSpots(DAY_END);
        // 确保返回县城（如果还未返回）
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
      }

      // 确保当前时间是 DAY_START
      this.currentMin = DAY_START;

      // 安排长耗时
      let travel = this.getTravelTime(this.lastPoi.id, spot.id, this.mode);
      if (travel == null) travel = 0;
      if (this.currentMin + travel + spot.visitDuration > DAY_END) {
        // 如果总时间超过18:00，仍然安排，但会在 arrangeSpot 中截断
        // 不报错，只是记录警告
      }
      if (this.currentMin + travel >= NEW_ARRIVAL_CUTOFF) {
        // 如果开始游览时间超过17:00，仍安排，但可能被截断
        // 同样记录警告，但不阻止
        this.warnings.push(`景区 "${spot.name}" 游览开始时间 ${formatTime(this.currentMin + travel)} 超过17:00，可能无法完整游览。`);
      }

      let result = this.arrangeSpot(spot, travel, this.currentMin);
      if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
      this.allNodes.push(...result.nodes);
      this.currentMin = result.newTime;
      this.lastPoi = result.newPoi;

      // 长耗时结束，必须返回县城（不再填充短耗时）
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
        // 如果当前在午餐窗口内，先插入午餐并移到午餐结束
        let newTime = this.insertMeal(this.currentMin);
        if (newTime > this.currentMin) {
          this.currentMin = newTime;
        } else {
          // 如果无法插入（可能窗口已过），则直接跳到 LUNCH_END
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
          this.allNodes.push(...result.nodes);
          this.currentMin = result.newTime;
          this.lastPoi = result.newPoi;
          // 填充短耗时（至午餐前）
          this.fillShortSpots(blockEnd);
          // 尝试插入午餐
          let newTime = this.insertMeal(this.currentMin);
          if (newTime > this.currentMin) this.currentMin = newTime;
          // 下午填充短耗时（至晚餐前）
          this.fillShortSpots(DINNER_START);
          // 返回县城
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
          // 上午不够，填充短耗时到午餐，然后移到下午
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
          // 下午太晚，结束当天
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
          // 填充短耗时（至晚餐前）
          this.fillShortSpots(blockEnd);
          // 尝试插入晚餐
          let newTime = this.insertMeal(this.currentMin);
          if (newTime > this.currentMin) this.currentMin = newTime;
          // 填充剩余时间到 DAY_END
          this.fillShortSpots(DAY_END);
          // 返回县城
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
          // 下午不足，填充短耗时到晚餐，然后结束当天
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
      // 如果当前时间 > DAY_END，移到第二天
      if (this.currentMin > DAY_END) {
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentMin = DAY_START;
      }

      // 1. 处理长耗时（独占，自动处理当天空白填充及移动）
      this.processLongSpots();

      // 2. 处理半天景点
      this.processHalfSpots();

      // 3. 处理剩余的短耗时（如果还有时间且当天未结束）
      if (this.allowFill && this.lastPoi.id === 'county' && this.currentMin < DAY_END) {
        this.fillShortSpots(DAY_END);
        // 如果还有时间且未返回，则返回县城
        if (this.lastPoi.id !== 'county') {
          let ret = this.addReturnToCounty(this.currentMin);
          if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
          this.currentMin = ret.newTime;
        }
        this.endDay();
      }

      // 确保结尾有 dayEnd
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
