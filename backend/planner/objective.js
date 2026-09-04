// planner/objective.js

/**
 * 计算目标函数值（最大化）
 * 目标 = α*偏好匹配度 + β*时间利用率 - γ*体能消耗 - δ*交通成本 + ε*停留满意度
 */
function calculateObjective(solution, poiList, constraints, userPref, weights) {
  const { sequence, durations } = solution;
  const { alpha, beta, gamma, delta, epsilon } = weights;

  let preferenceScore = 0;
  let timeUtilization = 0;
  let energyCost = 0;
  let transportCost = 0;
  let staySatisfaction = 0;

  // 1. 偏好匹配度：景点类型与用户偏好的重合度
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

  // 2. 时间利用率：实际游览时间占可用时间比例（不算交通）
  const totalVisitTime = Object.values(durations).reduce((a, b) => a + b, 0);
  // 估算总可用时间：天数 * (DAY_END - DAY_START)
  const totalAvailable = constraints.max_days * (constraints.day_end - constraints.day_start);
  timeUtilization = Math.min(totalVisitTime / totalAvailable, 1);

  // 3. 体能消耗：基于步行距离、景点数量等简单估算
  // 此处简化，可用实际距离累加
  const totalDistance = sequence.length * 1000; // 假设每个景点间步行1000米（实际应由数据提供）
  energyCost = Math.min(totalDistance / 15000, 1); // 归一化

  // 4. 交通成本：交通时间总和
  let totalTravel = 0;
  let last = 'county';
  for (let id of sequence) {
    const key = `${last}_${id}`;
    const t = constraints.travel_times[key] || 0;
    totalTravel += t;
    last = id;
  }
  // 最后返回县城
  if (constraints.lodging_required) {
    const key = `${last}_county`;
    totalTravel += constraints.travel_times[key] || 0;
  }
  transportCost = Math.min(totalTravel / 600, 1); // 归一化（假设10小时以上为1）

  // 5. 停留满意度：实际停留时长与建议时长的匹配度
  // 此处简化，假设所有景点建议时长为30分钟
  let totalDeviation = 0;
  for (let id of sequence) {
    const suggested = 30; // 可从poiList获取
    totalDeviation += Math.abs(durations[id] - suggested) / suggested;
  }
  staySatisfaction = 1 - Math.min(totalDeviation / sequence.length, 1);

  // 计算加权和
  const score = alpha * preferenceScore
              + beta * timeUtilization
              - gamma * energyCost
              - delta * transportCost
              + epsilon * staySatisfaction;

  return score;
}

module.exports = {
  calculateObjective
};