// trip.js - 行程规划引擎（最终版）
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
    this.allNodes = [];
    this.usedIds = new Set();
    this.warnings = [];
    this.allSpotsPlanned = false; // 标记所有景点是否已规划完毕

    // 分类
    this.longSpots = [];
    this.halfSpots = [];
    this.shortSpots = [];
    this.classifySpots();
    this.halfSpots.sort((a,b) => b.visitDuration - a.visitDuration);
    // 用户选择的短耗时和系统县城景点分别存储
    this.userShortSpots = [];
    this.systemShortSpots = []; // 县城景点（系统填充用）

    // 区分用户选择的短耗时和系统填充
    for (let s of this.shortSpots) {
      if (s.isCounty) {
        this.systemShortSpots.push(s);
      } else {
        this.userShortSpots.push(s);
      }
    }

    this.lunchInserted = false;
    this.dinnerInserted = false;
    // 记录当天是否为空闲日（因长耗时移动产生）
    this.isIdleDay = false;
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
        if (start < DAY_END) {
          this.allNodes.push({
            type: 'meal',
            name: '午餐时间',
            startTime: start,
            endTime: DAY_END,
            duration: DAY_END - start
          });
          this.lunchInserted = true;
          return DAY_END;
        }
        return time;
      }
    }
    // 晚餐
    if (!this.dinnerInserted && (force || (time >= DINNER_START && time < DINNER_END))) {
      let start = Math.max(time, DINNER_START);
      if (force && time > DINNER_START) start = time;
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
        if (start < DAY_END) {
          this.allNodes.push({
            type: 'meal',
            name: '晚餐时间',
            startTime: start,
            endTime: DAY_END,
            duration: DAY_END - start
          });
          this.dinnerInserted = true;
          return DAY_END;
        }
        return time;
      }
    }
    return time;
  }

  // 检查交通是否跨越餐食窗口
  checkMealCrossing(startTime, endTime) {
    if (!this.lunchInserted && startTime < LUNCH_END && endTime > LUNCH_START) return 'lunch';
    if (!this.dinnerInserted && startTime < DINNER_END && endTime > DINNER_START) return 'dinner';
    return null;
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
      poi = { id: spot.id, name: spot.name, lat: spot.lat, lng: spot.lng, type: spot.type };
    }

    // 交通结束后检查是否跨越餐食窗口，若是则强制插入
    let mealCross = this.checkMealCrossing(startTime, time);
    if (mealCross === 'lunch') {
      time = this.insertMeal(time, true);
    } else if (mealCross === 'dinner') {
      time = this.insertMeal(time, true);
    } else {
      // 正常尝试插入
      time = this.insertMeal(time);
    }

    let remaining = spot.visitDuration || 0;
    if (time >= DAY_END) {
      return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
    }
    if (time >= NEW_ARRIVAL_CUTOFF) {
      // 17:00后不再开始新游览
      return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
    }

    // 游览分段
    while (remaining > 0) {
      if (time >= DAY_END) {
        if (remaining > 0) {
          this.warnings.push(`因时间不足，景区 "${spot.name}" 剩余 ${remaining} 分钟游览被省略。`);
        }
        break;
      }

      let mealInserted = false;
      // 如果剩余游览时间 > 60，尝试插入餐食；否则先完成游览
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

    if (remaining > 0) {
      this.warnings.push(`因时间不足，景区 "${spot.name}" 剩余 ${remaining} 分钟游览被省略。`);
    }

    return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
  }

  // 返回县城（仅用于长耗时和半天景点）
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
    return { newTime };
  }

  // 填充短耗时（仅在空闲日调用）
  fillShortSpots(maxEndTime) {
    if (!this.allowFill || !this.isIdleDay) return;
    // 先填充用户选择的短耗时
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
        this.allNodes.push(...result.nodes);
        this.currentMin = result.newTime;
        this.lastPoi = result.newPoi;
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
        // 标记当前为空闲日，允许填充短耗时
        this.isIdleDay = true;
        // 填充短耗时（不返回县城）
        this.fillShortSpots(DAY_END);
        // 如果最后不是县城且不是短耗时，则返回县城（但短耗时不会返回）
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
        this.isIdleDay = false; // 重置，长耗时当天不是空闲日
      }

      // 确保当前时间是 DAY_START
      this.currentMin = DAY_START;
      this.isIdleDay = false; // 长耗时当天不是空闲日

      let travel = this.getTravelTime(this.lastPoi.id, spot.id, this.mode);
      if (travel == null) travel = 0;
      if (this.currentMin + travel >= NEW_ARRIVAL_CUTOFF) {
        this.warnings.push(`景区 "${spot.name}" 游览开始时间 ${formatTime(this.currentMin + travel)} 超过17:00，可能无法完整游览。`);
      }

      let result = this.arrangeSpot(spot, travel, this.currentMin);
      if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
      this.allNodes.push(...result.nodes);
      this.currentMin = result.newTime;
      this.lastPoi = result.newPoi;

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
          this.allNodes.push(...result.nodes);
          this.currentMin = result.newTime;
          this.lastPoi = result.newPoi;
          // 半天景点结束后，返回县城
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
          this.allNodes.push(...result.nodes);
          this.currentMin = result.newTime;
          this.lastPoi = result.newPoi;
          // 半天景点结束后返回县城
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

  // 处理用户选择的短耗时（非空闲日，且独立规划）
  processUserShorts() {
    if (this.userShortSpots.length === 0) return;
    // 如果当前没有长耗时和半天，则直接安排短耗时，但不返回县城
    for (let spot of this.userShortSpots) {
      if (this.usedIds.has(spot.id)) continue;
      let travel = this.getTravelTime(this.lastPoi.id, spot.id, this.mode);
      if (travel == null) travel = 0;
      if (this.currentMin + travel >= NEW_ARRIVAL_CUTOFF) {
        // 太晚了，移到下一天
        this.endDay();
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentMin = DAY_START;
        this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0, type: 'county' };
        this.lunchInserted = false;
        this.dinnerInserted = false;
        // 重新计算交通
        travel = this.getTravelTime(this.lastPoi.id, spot.id, this.mode);
        if (travel == null) travel = 0;
      }
      let result = this.arrangeSpot(spot, travel, this.currentMin);
      if (result.error) throw new Error(`安排 "${spot.name}" 失败: ${result.error}`);
      this.allNodes.push(...result.nodes);
      this.currentMin = result.newTime;
      this.lastPoi = result.newPoi;
      this.usedIds.add(spot.id);
      // 短耗时不返回县城
    }
    // 所有短耗时安排完毕后，如果当天还有剩余时间且没有其他景点，直接结束当天
    if (this.currentMin < DAY_END) {
      // 不填充任何内容
    }
    this.endDay();
  }

  generate() {
    try {
      if (this.currentMin > DAY_END) {
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentMin = DAY_START;
      }

      // 1. 处理长耗时（可能产生空闲日）
      this.processLongSpots();

      // 2. 处理半天景点
      this.processHalfSpots();

      // 3. 处理用户选择的短耗时（非空闲日规划）
      // 但在处理之前，如果当前还有剩余时间且不是空闲日，则安排用户短耗时
      // 但如果当前是空闲日，短耗时已经在 processLongSpots 的 fillShortSpots 中处理过了，所以跳过
      if (!this.isIdleDay && this.userShortSpots.length > 0) {
        this.processUserShorts();
      }

      // 如果还有系统县城景点未使用且当前是空闲日，但在 fillShortSpots 中已处理，不需要再处理

      // 如果当前还有时间且 lastPoi 不是县城，则返回县城（仅针对长/半天，但已处理）
      if (this.lastPoi.type !== 'county' && this.lastPoi.type !== 'short') {
        let ret = this.addReturnToCounty(this.currentMin);
        if (ret.error) throw new Error(`返回县城失败: ${ret.error}`);
        this.currentMin = ret.newTime;
      }

      // 结束最后一天
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
    // 标记为系统填充景点
    countySpots.forEach(s => s.isCounty = true);
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
