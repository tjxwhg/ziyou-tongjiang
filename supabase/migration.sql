-- 修正迁移脚本（假设ztj_poi.id为integer）
-- 1. 扩展ztj_poi（如果还没有open_time字段）
ALTER TABLE ztj_poi 
ADD COLUMN IF NOT EXISTS open_time TIME DEFAULT '08:00:00',
ADD COLUMN IF NOT EXISTS close_time TIME DEFAULT '18:00:00',
ADD COLUMN IF NOT EXISTS data_level TEXT DEFAULT 'L3';

-- 2. POI内部节点表（poi_id引用ztj_poi.id，类型匹配）
CREATE TABLE IF NOT EXISTS poi_internal_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poi_id INTEGER NOT NULL REFERENCES ztj_poi(id) ON DELETE CASCADE,
  node_name TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK (node_type IN ('entrance','core_view','rest_area','wc','food','exit','other')),
  lat NUMERIC(10,7) NOT NULL,
  lng NUMERIC(10,7) NOT NULL,
  suggested_duration_min INTEGER DEFAULT 10,
  suggested_duration_max INTEGER DEFAULT 30,
  sort_order INTEGER DEFAULT 0,
  audio_mp3 TEXT,
  radius_geofence INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. POI内部连接边表（引用节点id，类型UUID）
CREATE TABLE IF NOT EXISTS poi_internal_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id UUID NOT NULL REFERENCES poi_internal_nodes(id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES poi_internal_nodes(id) ON DELETE CASCADE,
  distance INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  path_geojson JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 用户偏好表（user_id uuid引用auth.users）
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_categories TEXT[] DEFAULT '{}',
  cuisine_prefs TEXT[] DEFAULT '{}',
  pace TEXT CHECK (pace IN ('compact','relaxed','in-depth')) DEFAULT 'relaxed',
  max_walking_per_day INTEGER DEFAULT 15000,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 行程方案存储表（user_id uuid）
CREATE TABLE IF NOT EXISTS trip_solutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  solution_data JSONB NOT NULL,
  style TEXT NOT NULL CHECK (style IN ('compact','relaxed','in-depth','custom')),
  score NUMERIC DEFAULT 0,
  selected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 实时偏差记录表（引用trip_solutions.id）
CREATE TABLE IF NOT EXISTS real_time_deviation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_solution_id UUID NOT NULL REFERENCES trip_solutions(id) ON DELETE CASCADE,
  deviation_minutes INTEGER DEFAULT 0,
  trigger_reason TEXT,
  adjusted_solution JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. 行程后评价表
CREATE TABLE IF NOT EXISTS feedback_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_solution_id UUID NOT NULL REFERENCES trip_solutions(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. 导览图提交表（商户提交POI导览图）
CREATE TABLE IF NOT EXISTS guide_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  poi_id INTEGER REFERENCES ztj_poi(id) ON DELETE CASCADE,
  image_url TEXT,
  nodes JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用RLS
ALTER TABLE poi_internal_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE poi_internal_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_solutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE real_time_deviation ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_submissions ENABLE ROW LEVEL SECURITY;

-- 创建基本策略（简化）
-- 用户偏好：用户可读写自己的
CREATE POLICY "用户可读写自己的偏好" ON user_preferences
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 行程方案：用户可读写自己的
CREATE POLICY "用户可读写自己的行程方案" ON trip_solutions
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 偏差记录：用户可读自己的（关联行程）
CREATE POLICY "用户可读自己的偏差记录" ON real_time_deviation
  USING (auth.uid() = (SELECT user_id FROM trip_solutions WHERE id = trip_solution_id));

-- 评价：用户可读写自己的
CREATE POLICY "用户可读写自己的评价" ON feedback_ratings
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 导览图提交：商户可读写自己的
CREATE POLICY "商户可读写自己的导览图" ON guide_submissions
  USING (auth.uid() = merchant_id)
  WITH CHECK (auth.uid() = merchant_id);

-- 内部节点和边：所有认证用户可读（用于展示），仅管理员可写（稍后单独设置）
CREATE POLICY "允许认证用户读取内部节点" ON poi_internal_nodes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "允许认证用户读取内部边" ON poi_internal_edges
  FOR SELECT USING (auth.role() = 'authenticated');