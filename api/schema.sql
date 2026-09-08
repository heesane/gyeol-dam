CREATE TABLE IF NOT EXISTS readings (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  mode TEXT NOT NULL CHECK (mode IN ('saju', 'saju_palm')),
  birth_date DATE NOT NULL,
  date_type TEXT NOT NULL CHECK (date_type IN ('solar', 'lunar')),
  birth_time TIME NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('female', 'male')),
  birth_place TEXT NOT NULL,
  dominant_hand TEXT CHECK (dominant_hand IN ('right', 'left')),
  image_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  result JSONB,          -- (레거시)
  analysis TEXT,         -- 완성 분석 마크다운 (30,000자+)
  error_text TEXT,
  agent TEXT,            -- 'codex' | 'claude'
  model TEXT,            -- 실제 사용된 모델 id
  prompt_version TEXT    -- server.mjs PROMPT_VERSION
);

CREATE INDEX IF NOT EXISTS idx_readings_created_at ON readings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_status ON readings (status) WHERE status != 'completed';
