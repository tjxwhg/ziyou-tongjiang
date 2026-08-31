// trip.js - 行程规划核心
import { getTransportPresets } from './api.js';
import {
  DAY_START, DAY_END, LUNCH_START, LUNCH_END, DINNER_START, DINNER_END,
  MEAL_DURATION, NEW_ARRIVAL_CUTOFF, MAX_RETURN_TIME,
  LONG_SPOT_NAMES, COUNTY_SPOT_KEYWORDS, ALLOWED_CATEGORIES
} from './config.js';
import { getDistance, formatTime, getCountySpots as getCountySpotsUtil } from './utils.js';

// ---------- 交通预设缓存 ----------
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
  if (fromId === 'mylocation' || toId === 'mylocation') {
    // 若需要，可调用外部位置，但这里简化返回0
    return 0;
  }
  const fId = fromId === 'county' ? 0 : fromId;
  const tId = toId === 'county' ? 0 : toId;
  let t = transportPresets[`${fId}_${tId}`];
  if (t !== undefined) return t;
  t = transportPresets[`${tId}_${fId}`];
  return t !== undefined ? t : null;
}

// ---------- 行程规划引擎（PlanGenerator） ----------
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
  }

  insertMeal(currentTime) {
    let time = currentTime;
    if (!this.lunchInserted && time >= LUNCH_START && time < LUNCH_END + 30) {
      let start = Math.max(time, LUNCH_START);
      let end = start + MEAL_DURATION;
      this.allNodes.push({
        type: 'meal',
        name: '午餐',
        startTime: start,
        endTime: end,
        duration: MEAL_DURATION
      });
      this.lunchInserted = true;
      return end;
    }
    if (!this.dinnerInserted && time >= DINNER_START && time < DINNER_END + 30) {
      let start = Math.max(time, DINNER_START);
      let end = start + MEAL_DURATION;
      this.allNodes.push({
        type: 'meal',
        name: '晚餐',
        startTime: start,
        endTime: end,
        duration: MEAL_DURATION
      });
      this.dinnerInserted = true;
      return end;
    }
    return time;
  }

  arrangeSpot(spot, travelTime, startTime) {
    let nodes = [];
    let time = startTime;
    let poi = this.lastPoi;

    if (travelTime > 0) {
      if (time + travelTime > 1440) {
        return { error: '交通跨天' };
      }
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

    time = this.insertMeal(time);

    let remaining = spot.visitDuration || 0;
    if (time >= DAY_END) {
      return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
    }
    if (time >= NEW_ARRIVAL_CUTOFF) {
      return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
    }

    while (remaining > 0) {
      if (time >= DAY_END) {
        return { nodes, newTime: time, newPoi: poi, remaining: remaining, error: null };
      }

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

  addReturnToCounty(currentTime) {
    let travelBack = this.getTravelTime(this.lastPoi.id, 'county', this.mode);
    if (travelBack == null) travelBack = 0;
    if (currentTime + travelBack > 1440) {
      return { error: '返回县城交通跨天' };
    }
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
    newTime = this.insertMeal(newTime);
    this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
    return { newTime };
  }

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

  processLongSpots() {
    for (let spot of this.longSpots) {
      if (this.usedIds.has(spot.id)) continue;
      if (this.currentMin !== DAY_START) {
        this.endDay();
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentMin = DAY_START;
        this.lastPoi = { id: 'county', name: '红军广场', lat: 0, lng: 0 };
        this.lunchInserted = false;
        this.dinnerInserted = false;
      }

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

      if (this.allowFill && !this.fillOnlyMeals) {
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
    }
  }

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
          if (result.error) {
            queue.push(spot);
            continue;
          }
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
          if (result.error) {
            queue.push(spot);
            continue;
          }
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

  generate() {
    try {
      if (this.currentMin < DAY_START) this.currentMin = DAY_START;
      if (this.currentMin >= DAY_END) {
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        this.currentMin = DAY_START;
      }
      this.processLongSpots();
      this.processHalfSpots();
      this.processShortSpots();
      // 兜底用餐
      if (!this.lunchInserted && this.currentMin >= LUNCH_START && this.currentMin < LUNCH_END + 30) {
        this.allNodes.push({ type: 'meal', name: '午餐', startTime: this.currentMin, endTime: this.currentMin + MEAL_DURATION, duration: MEAL_DURATION });
        this.currentMin += MEAL_DURATION;
        this.lunchInserted = true;
      }
      if (!this.dinnerInserted && this.currentMin >= DINNER_START && this.currentMin < DINNER_END + 30) {
        this.allNodes.push({ type: 'meal', name: '晚餐', startTime: this.currentMin, endTime: this.currentMin + MEAL_DURATION, duration: MEAL_DURATION });
        this.currentMin += MEAL_DURATION;
        this.dinnerInserted = true;
      }
      if (this.allNodes.length > 0 && this.allNodes[this.allNodes.length-1].type !== 'dayEnd') {
        this.allNodes.push({ type: 'dayEnd' });
      }
      return { nodes: this.allNodes, error: false };
    } catch (e) {
      return { nodes: [], error: true, errorMsg: e.message };
    }
  }
}

// ---------- 对外接口 ----------
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

  // 获取县城景点（依赖 utils 中的函数）
  const countySpots = getCountySpotsUtil();

  const generator = new PlanGenerator(validSpots, startDate, startTime, mode, getTravelTimeFn, countySpots, allowFill, fillOnlyMeals);
  return generator.generate();
}

// ---------- 生成时间线 ----------
export function generateTimeline(nodes) {
  if (!nodes || nodes.length === 0) return { days: [], mealCount: 0 };

  // 合并连续visit
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

  let lines = [];
  let mealCount = 0;

  for (let node of merged) {
    if (!node) continue;
    let text = '';
    if (node.type === 'transport') {
      let start = formatTime(node.startTime);
      let end = formatTime(node.endTime);
      let name = node.name;
      if (node.isReturn) name = '返回县城';
      else if (!name.startsWith('前往 ')) name = '前往 ' + name;
      text = `🚗 ${start}-${end} ${name} (交通${node.duration}分钟)`;
    } else if (node.type === 'visit') {
      let start = formatTime(node.startTime);
      let end = formatTime(node.endTime);
      text = `⏱️ ${start}-${end} 游览 ${node.name} (游览${node.duration}分钟)`;
    } else if (node.type === 'meal') {
      let start = formatTime(node.startTime);
      let end = formatTime(node.endTime);
      text = `🍽️ ${node.name} (${start}-${end})`;
      mealCount++;
    } else if (node.type === 'dayEnd') {
      text = '🌙 当天行程结束，住宿休息';
    }
    if (text) lines.push(text);
  }

  let daysArray = [];
  let currentDayLines = [];
  for (let text of lines) {
    if (text.includes('当天行程结束')) {
      if (currentDayLines.length > 0) {
        currentDayLines.push(text);
        daysArray.push(currentDayLines);
        currentDayLines = [];
      }
    } else {
      currentDayLines.push(text);
    }
  }
  if (currentDayLines.length > 0) {
    daysArray.push(currentDayLines);
  }
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
