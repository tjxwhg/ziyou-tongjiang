// js/simulated-annealing.js - 模拟退火算法（浏览器端执行）
import { DAY_START, DAY_END, LUNCH_START, LUNCH_END, DINNER_START, DINNER_END, MEAL_DURATION, NEW_ARRIVAL_CUTOFF, MAX_RETURN_TIME, SA_CONFIG, WEIGHT_TEMPLATES } from './config.js';
import { formatTime } from './utils.js';

// ============================================================
// 硬约束检查
// ============================================================
export function checkHardConstraints(sequence, durations, constraints) {
    const {
        open_times = {},
        close_times = {},
        travel_times = {},
        day_start = DAY_START,
        day_end = DAY_END,
        max_days = 3,
        lodging_required = true
    } = constraints;

    let currentTime = day_start;
    let currentDay = 1;
    let lastPoiId = 'county';

    for (let i = 0; i < sequence.length; i++) {
        const poiId = sequence[i];
        const duration = durations[poiId] || 30;

        const travelKey = `${lastPoiId}_${poiId}`;
        const travel = travel_times[travelKey] || 0;
        currentTime += travel;

        const open = open_times[poiId] || day_start;
        const close = close_times[poiId] || day_end;
        if (currentTime < open) {
            if (open - currentTime > 120) return false;
            currentTime = open;
        }
        if (currentTime + duration > close) return false;

        if (currentTime + duration > day_end) {
            if (day_end - currentTime < 60) return false;
        }

        currentTime += duration;
        lastPoiId = poiId;

        if (i < sequence.length - 1) {
            const nextTravel = travel_times[`${poiId}_${sequence[i+1]}`] || 0;
            if (currentTime + nextTravel + durations[sequence[i+1]] > day_end) {
                if (lodging_required) {
                    const returnTravel = travel_times[`${poiId}_county`] || 0;
                    if (currentTime + returnTravel > MAX_RETURN_TIME) return false;
                }
                currentDay++;
                if (currentDay > max_days) return false;
                currentTime = day_start;
                lastPoiId = 'county';
            }
        }
    }

    if (lodging_required && lastPoiId !== 'county') {
        const returnTravel = travel_times[`${lastPoiId}_county`] || 0;
        if (currentTime + returnTravel > MAX_RETURN_TIME) return false;
    }

    return true;
}

// ============================================================
// 目标函数计算
// ============================================================
export function calculateObjective(solution, poiList, constraints, userPref, weights) {
    const { sequence, durations } = solution;
    const { alpha, beta, gamma, delta, epsilon } = weights;

    let preferenceScore = 0;
    let timeUtilization = 0;
    let energyCost = 0;
    let transportCost = 0;
    let staySatisfaction = 0;

    const prefCategories = userPref.preferred_categories || [];
    for (let id of sequence) {
        const poi = poiList.find(p => p.id === id);
        if (poi) {
            const cats = (poi.category || '').split(',').map(c => c.trim());
            const match = cats.some(c => prefCategories.includes(c));
            if (match) preferenceScore += 1;
        }
    }
    preferenceScore = preferenceScore / Math.max(1, sequence.length);

    const totalVisitTime = Object.values(durations).reduce((a, b) => a + b, 0);
    const totalAvailable = constraints.max_days * (DAY_END - DAY_START);
    timeUtilization = Math.min(totalVisitTime / totalAvailable, 1);

    const totalDistance = sequence.length * 1000;
    energyCost = Math.min(totalDistance / 15000, 1);

    let totalTravel = 0;
    let last = 'county';
    for (let id of sequence) {
        const key = `${last}_${id}`;
        const t = constraints.travel_times[key] || 0;
        totalTravel += t;
        last = id;
    }
    if (constraints.lodging_required) {
        const key = `${last}_county`;
        totalTravel += constraints.travel_times[key] || 0;
    }
    transportCost = Math.min(totalTravel / 600, 1);

    let totalDeviation = 0;
    for (let id of sequence) {
        const suggested = 30;
        totalDeviation += Math.abs(durations[id] - suggested) / suggested;
    }
    staySatisfaction = 1 - Math.min(totalDeviation / sequence.length, 1);

    return alpha * preferenceScore + beta * timeUtilization - gamma * energyCost - delta * transportCost + epsilon * staySatisfaction;
}

// ============================================================
// 邻域操作
// ============================================================
export function applyNeighbor(solution, operation) {
    const seq = [...solution.sequence];
    const dur = { ...solution.durations };
    const n = seq.length;
    if (n < 2) return solution;

    if (operation === 'Insert' && n > 2) {
        const idx1 = Math.floor(Math.random() * n);
        let idx2 = Math.floor(Math.random() * n);
        while (idx2 === idx1) idx2 = Math.floor(Math.random() * n);
        const [item] = seq.splice(idx1, 1);
        seq.splice(idx2, 0, item);
    } else if (operation === 'Swap') {
        const i = Math.floor(Math.random() * n);
        let j = Math.floor(Math.random() * n);
        while (j === i) j = Math.floor(Math.random() * n);
        [seq[i], seq[j]] = [seq[j], seq[i]];
    } else if (operation === 'Shake' && n > 3) {
        const start = Math.floor(Math.random() * (n - 2));
        const end = start + Math.floor(Math.random() * (n - start - 1)) + 1;
        const sub = seq.slice(start, end);
        for (let i = sub.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sub[i], sub[j]] = [sub[j], sub[i]];
        }
        seq.splice(start, end - start, ...sub);
    }

    return { sequence: seq, durations: dur };
}

// ============================================================
// 自适应邻域选择
// ============================================================
export class AdaptiveNeighborhoodSelector {
    constructor(ops = ['Insert', 'Swap', 'Shake']) {
        this.ops = ops;
        this.probabilities = ops.map(() => 1 / ops.length);
        this.rewards = ops.map(() => 0);
        this.counts = ops.map(() => 0);
    }

    select() {
        const r = Math.random();
        let cum = 0;
        for (let i = 0; i < this.probabilities.length; i++) {
            cum += this.probabilities[i];
            if (r < cum) return this.ops[i];
        }
        return this.ops[0];
    }

    update(operation, improvement) {
        const idx = this.ops.indexOf(operation);
        if (idx === -1) return;
        this.counts[idx] += 1;
        this.rewards[idx] = (this.rewards[idx] * (this.counts[idx] - 1) + improvement) / this.counts[idx];
        const expRewards = this.rewards.map(r => Math.exp(r / 0.1));
        const sum = expRewards.reduce((a, b) => a + b, 0);
        this.probabilities = expRewards.map(e => e / sum);
    }
}

// ============================================================
// 模拟退火主函数
// ============================================================
export function simulatedAnnealing(poiList, constraints, userPref, style) {
    const weights = WEIGHT_TEMPLATES[style] || WEIGHT_TEMPLATES.relaxed;
    const poiIds = poiList.map(p => p.id);

    // 生成初始解
    const sequence = [...poiIds];
    for (let i = sequence.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
    }
    const durations = {};
    for (let id of poiIds) {
        const poi = poiList.find(p => p.id === id);
        durations[id] = poi?.visit_duration || 30;
    }

    let current = { sequence, durations };
    let best = { ...current };
    let bestScore = calculateObjective(current, poiList, constraints, userPref, weights);

    let T = SA_CONFIG.INIT_TEMP;
    const coolingRate = SA_CONFIG.COOLING_RATE;
    const maxIter = SA_CONFIG.MAX_ITERATIONS;
    const earlyStop = SA_CONFIG.EARLY_STOP_THRESHOLD;

    const selector = new AdaptiveNeighborhoodSelector();
    let lastImprovement = 0;

    for (let iter = 0; iter < maxIter; iter++) {
        const op = selector.select();
        const neighbor = applyNeighbor(current, op);
        if (!checkHardConstraints(neighbor.sequence, neighbor.durations, constraints)) {
            continue;
        }
        const neighborScore = calculateObjective(neighbor, poiList, constraints, userPref, weights);
        const delta = neighborScore - bestScore;
        if (delta > 0 || Math.exp(delta / T) > Math.random()) {
            current = { ...neighbor };
            if (neighborScore > bestScore) {
                best = { ...neighbor };
                bestScore = neighborScore;
                lastImprovement = 0;
                selector.update(op, 1);
            } else {
                selector.update(op, 0);
            }
        } else {
            selector.update(op, -0.2);
        }

        lastImprovement += 1;
        if (lastImprovement > 100 && (bestScore - neighborScore) < earlyStop) {
            break;
        }

        T *= coolingRate;
        if (T < 0.001) break;
    }

    return { sequence: best.sequence, durations: best.durations, score: bestScore };
}