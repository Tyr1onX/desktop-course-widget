export function formatMinutesDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0
    ? `${hours} 小时 ${remainingMinutes} 分钟`
    : `${hours} 小时`
}
