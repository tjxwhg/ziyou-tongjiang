// planner/optimizer.js
const { ALGO, WEIGHT_TEMPLATES } = require('../config');
const { checkHardConstraints } = require('./constraint-checker');
const { calculateObjective } = require('./objective');

/**
 * 生成初始解（混沌映射）
 * @param {Array} poiIds - 所有候选POI ID列表
 * @param {Object} constraints - 约束对象
 * @param {Object} userPref - 用户偏好
 * @returns {Object} { sequence: [], durations: {} }
 */
function generateInitialSolution(poiIds, constraints, userPref) {
  // 混沌初始化：使用逻辑映射产生多样性
  const sequence = [...poiIds];
  // 简单洗牌（后续可改进为混沌映射）
  for (let i = sequence.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
  }
  // 为每个景点分配停留时长（默认取最大值，但约束内）
  const durations = {};
  for (let id of poiIds) {
    // 假设从外部传入的 POI 数据包含建议时长范围
    // 这里使用默认值，实际会从数据中读取
    durations[id] = 30; // 占位
  }
  return { sequence, durations };
}

/**
 * 邻域操作：Insert, Swap, Shake
 */
function applyNeighbor(solution, operation) {
  const seq = [...solution.sequence];
  const dur = { ...solution.durations };
  const n = seq.length;
  if (n < 2) return solution;

  if (operation === 'Insert' && n > 2) {
    // 随机选择一个元素插入到另一个位置
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
    // 随机打乱一段子序列
    const start = Math.floor(Math.random() * (n - 2));
    const end = start + Math.floor(Math.random() * (n - start - 1)) + 1;
    const sub = seq.slice(start, end);
    for (let i = sub.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sub[i], sub[j]] = [sub[j], sub[i]];
    }
    seq.splice(start, end - start, ...sub);
  }

  // 调整停留时长（在允许范围内随机微调）
  // 这里简单处理，实际可根据范围调整
  return { sequence: seq, durations: dur };
}

/**
 * 自适应邻域选择（ANSA）
 */
class AdaptiveNeighborhoodSelector {
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
    // 使用滑动平均更新奖励
    this.rewards[idx] = (this.rewards[idx] * (this.counts[idx] - 1) + improvement) / this.counts[idx];
    // 更新概率（基于奖励的softmax）
    const expRewards = this.rewards.map(r => Math.exp(r / 0.1)); // 温度参数
    const sum = expRewards.reduce((a, b) => a + b, 0);
    this.probabilities = expRewards.map(e => e / sum);
  }
}

/**
 * 模拟退火主函数
 */
function simulatedAnnealing(poiList, constraints, userPref, style) {
  const weights = WEIGHT_TEMPLATES[style] || WEIGHT_TEMPLATES.relaxed;
  const initialSol = generateInitialSolution(
    poiList.map(p => p.id),
    constraints,
    userPref
  );
  // 初始检查硬约束
  if (!checkHardConstraints(initialSol.sequence, initialSol.durations, constraints)) {
    // 若初始解无效，尝试修复（简单重排）
    // 这里简化：直接返回空
    return null;
  }

  let current = { sequence: initialSol.sequence, durations: initialSol.durations };
  let best = { ...current };
  let bestScore = calculateObjective(current, poiList, constraints, userPref, weights);

  let T = ALGO.INIT_TEMP;
  const coolingRate = ALGO.COOLING_RATE;
  const maxIter = ALGO.MAX_ITERATIONS;
  const earlyStop = ALGO.EARLY_STOP_THRESHOLD;

  const selector = new AdaptiveNeighborhoodSelector();

  let lastImprovement = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    // 选择邻域操作
    const op = selector.select();
    const neighbor = applyNeighbor(current, op);
    // 检查硬约束
    if (!checkHardConstraints(neighbor.sequence, neighbor.durations, constraints)) {
      continue;
    }
    const neighborScore = calculateObjective(neighbor, poiList, constraints, userPref, weights);
    const delta = neighborScore - bestScore;
    // 接受准则（最大化问题）
    if (delta > 0 || Math.exp(delta / T) > Math.random()) {
      current = { ...neighbor };
      if (neighborScore > bestScore) {
        best = { ...neighbor };
        bestScore = neighborScore;
        lastImprovement = 0;
        // 更新邻域选择奖励（正反馈）
        selector.update(op, 1);
      } else {
        selector.update(op, 0);
      }
    } else {
      selector.update(op, -0.2);
    }

    // 早停判断
    lastImprovement += 1;
    if (lastImprovement > 100 && (bestScore - neighborScore) < earlyStop) {
      break;
    }

    // 降温
    T *= coolingRate;
    if (T < 0.001) break;
  }

  return { sequence: best.sequence, durations: best.durations, score: bestScore };
}

module.exports = {
  simulatedAnnealing,
  generateInitialSolution,
  applyNeighbor,
  AdaptiveNeighborhoodSelector
};