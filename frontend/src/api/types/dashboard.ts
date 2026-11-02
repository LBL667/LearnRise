export interface HistogramItem {
  bucket: string
  count: number
}

export interface CurveItem {
  days: number
  retrievability: number
}

export interface HeatmapItem {
  date: string
  count: number
}

export interface RadarItem {
  name: string
  value: number
}

export interface DashboardSummaryOut {
  due_count: number
  reviewed_today: number
  streak_days: number
  mastery_radar: RadarItem[]
  difficulty_histogram: HistogramItem[]
  heatmap: HeatmapItem[]
  forgetting_curve: CurveItem[]
}
