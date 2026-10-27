import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Pool, Projection, Sample, Vertex } from './model';
import { HOUR } from './model';
import styles from './PooledOverview.module.scss';

function splitRecorded(rows: { at: number; value: number }[]) {
  const segments: { at: number; value: number }[][] = [];
  rows.forEach((point, index) => {
    if (!index || point.at - rows[index - 1].at > 10 * 60_000) segments.push([]);
    segments[segments.length - 1].push(point);
  });
  return segments;
}

export type ChartMode = 'remaining' | 'drain' | 'burn';
export function ProjectionChart({
  pool,
  projection,
  history,
  now,
  start,
  end,
  mode,
  burn,
  color,
}: {
  pool: Pool;
  projection: Projection;
  history: Sample[];
  now: number;
  start: number;
  end: number;
  mode: ChartMode;
  burn: number | null;
  color: string;
}) {
  const { t, i18n } = useTranslation();
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const left = 62,
    right = 980,
    top = 32,
    bottom = 270;
  const x = (at: number) => left + ((at - start) / (end - start)) * (right - left);
  const recorded = history.filter((s) => s.signature === pool.signature && s.at <= now);
  const rateOf = (v: number) => (mode === 'drain' ? (v / pool.capacity) * 100 : v);
  const values =
    mode === 'remaining'
      ? recorded.map((s) => ({ at: s.at, value: s.remaining }))
      : recorded.flatMap((s, i) => {
          const prev = recorded[i - 1];
          const dt = prev ? s.at - prev.at : 0;
          if (
            !prev ||
            dt <= 0 ||
            dt > 10 * 60_000 ||
            s.remaining > prev.remaining ||
            (prev.resetAt && prev.resetAt > prev.at && prev.resetAt <= s.at)
          )
            return [];
          return [{ at: s.at, value: rateOf(((prev.remaining - s.remaining) * HOUR) / dt) }];
        });
  const future: Vertex[] =
    mode === 'remaining'
      ? projection.points
      : projection.points.flatMap((p) => {
          const value = p.value <= 0 ? 0 : rateOf(burn ?? 0);
          const point = { ...p, value, boost: undefined };
          return p.kind === 'empty' ? [{ ...point, value: rateOf(burn ?? 0) }, point] : [point];
        });
  const max =
    mode === 'remaining'
      ? pool.capacity
      : Math.max(1, rateOf(burn ?? 0) * 1.3, ...values.map((v) => v.value * 1.1));
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  const line = (rows: { at: number; value: number }[], gaps: boolean) =>
    rows
      .map(
        (p, i) =>
          `${i === 0 || (gaps && p.at - rows[i - 1].at > 10 * 60_000) ? 'M' : 'L'}${x(p.at).toFixed(2)},${y(p.value).toFixed(2)}`
      )
      .join(' ');
  const recordedSegments = splitRecorded(values);
  const recordedPath = line(values, true);
  const projectedPath = line(future, false);
  const visibleResets =
    mode === 'remaining'
      ? future.filter((p) => p.kind === 'reset' && p.at >= start && p.at <= end)
      : [];
  const labels = visibleResets.reduce<{ p: Vertex; px: number; row: number }[]>((placed, p) => {
    const px = x(p.at);
    if (Math.abs(px - x(now)) < 34) return placed;
    const row = [0, 1, 2].find((lane) => {
      const previous = placed.filter((label) => label.row === lane);
      return !previous.length || px - previous[previous.length - 1].px >= 59;
    });
    return row === undefined ? placed : [...placed, { p, px, row }];
  }, []);
  const formatDate = (at: number) =>
    new Date(at).toLocaleString(i18n.language, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  const interpolate = (rows: { at: number; value: number }[], at: number) => {
    let before: { at: number; value: number } | undefined;
    let after: { at: number; value: number } | undefined;
    for (const row of rows) {
      if (row.at <= at) before = row;
      else {
        after = row;
        break;
      }
    }
    if (!before || (!after && at > before.at + 60_000)) return null;
    if (!after || after.at === before.at) return before.value;
    if (at < now && after.at - before.at > 10 * 60_000) return null;
    return (
      before.value + ((after.value - before.value) * (at - before.at)) / (after.at - before.at)
    );
  };
  const hoveredValue = hover === null ? null : interpolate(hover <= now ? values : future, hover);
  const nowValue = future[0]?.value;
  const ticks = Array.from({ length: 14 }, (_, i) => start + ((i + 0.5) * (end - start)) / 14);
  const empty =
    projection.emptyAt !== null && projection.emptyAt >= start && projection.emptyAt <= end
      ? { at: projection.emptyAt, value: 0 }
      : null;
  return (
    <div className={styles.chartWrap}>
      <svg
        className={styles.chart}
        viewBox="0 0 1000 312"
        preserveAspectRatio="none"
        role="img"
        aria-label={t('prox.chart_label', { provider: pool.provider })}
        tabIndex={0}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - bounds.left) / bounds.width) * 1000;
          setHover(start + Math.max(0, Math.min(1, (px - left) / (right - left))) * (end - start));
        }}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            setHover(
              Math.max(
                start,
                Math.min(end, (hover ?? now) + (event.key === 'ArrowRight' ? 1 : -1) * 6 * HOUR)
              )
            );
          }
        }}
      >
        <title>{t('prox.chart_label', { provider: pool.provider })}</title>
        <desc>{t('prox.assumptions')}</desc>
        <defs>
          <clipPath id={`${id}-clip`}>
            <rect x={left} y={top - 1} width={right - left} height={bottom - top + 2} />
          </clipPath>
          <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".15" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={left} x2={right} y1={y(v)} y2={y(v)} className={styles.guide} />
            <text x={left - 12} y={y(v) + 4} textAnchor="end" className={styles.axis}>
              {Number(v.toFixed(1))}
              {mode === 'burn' ? '' : '%'}
              {mode !== 'remaining' ? '/h' : ''}
            </text>
          </g>
        ))}
        {ticks.map((at) => (
          <g key={at}>
            <line x1={x(at)} x2={x(at)} y1={top} y2={bottom} className={styles.dayGuide} />
            <text x={x(at)} y={bottom + 22} textAnchor="middle" className={styles.axis}>
              {new Date(at).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric' })}
            </text>
          </g>
        ))}
        <g clipPath={`url(#${id}-clip)`}>
          {mode === 'remaining' && future.length > 0 && (
            <path
              d={`${projectedPath} L${x(future[future.length - 1].at)},${bottom} L${x(future[0].at)},${bottom} Z`}
              fill={`url(#${id}-fill)`}
            />
          )}
          {mode === 'remaining' &&
            recordedSegments
              .filter((segment) => segment.length > 1)
              .map((segment, index) => (
                <path
                  key={index}
                  d={`${line(segment, false)} L${x(segment[segment.length - 1].at)},${bottom} L${x(segment[0].at)},${bottom} Z`}
                  fill={`url(#${id}-fill)`}
                />
              ))}
          <path
            d={recordedPath}
            stroke={color}
            strokeWidth="2.2"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={projectedPath}
            stroke={color}
            strokeWidth="2"
            strokeDasharray="6 5"
            strokeLinejoin="round"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        {now >= start && now <= end && (
          <g>
            <line
              x1={x(now)}
              x2={x(now)}
              y1={top - 9}
              y2={bottom + 28}
              className={styles.nowLine}
            />
            {nowValue !== undefined && (
              <circle
                cx={x(now)}
                cy={y(nowValue)}
                r="4.5"
                fill={color}
                stroke="var(--bg-primary)"
                strokeWidth="2"
              />
            )}
          </g>
        )}
        {visibleResets.map((p) => (
          <circle key={`event-${p.at}`} cx={x(p.at)} cy={y(p.value)} r="2" fill={color}>
            <title>{`+${Math.round(p.boost ?? 0)}% · ${formatDate(p.at)}`}</title>
          </circle>
        ))}
        {labels.map(({ p, px, row }) => (
          <g key={`${p.at}-${p.value}`}>
            <rect
              x={Math.min(right - 46, Math.max(left, px - 23))}
              y={Math.max(1, y(p.value) - 25 - row * 17)}
              width="46"
              height="17"
              rx="5"
              fill="var(--bg-tertiary)"
            />
            <text
              x={Math.min(right - 23, Math.max(left + 23, px))}
              y={Math.max(13, y(p.value) - 13 - row * 17)}
              textAnchor="middle"
              className={styles.resetText}
            >
              +{Math.round(p.boost ?? 0)}%
            </text>
          </g>
        ))}
        {empty && mode === 'remaining' && (
          <g>
            <circle
              cx={x(empty.at)}
              cy={bottom}
              r="5"
              fill="var(--bg-primary)"
              stroke={color}
              strokeWidth="2"
            />
            <text
              x={Math.min(right - 80, Math.max(left + 80, x(empty.at)))}
              y={bottom - 12}
              textAnchor="middle"
              className={styles.emptyText}
            >
              {t('prox.empty_at', { date: formatDate(empty.at) })}
            </text>
          </g>
        )}
        {now >= start && now <= end && (
          <g>
            <rect x={x(now) - 20} y="0" width="40" height="20" rx="4" fill="var(--bg-primary)" />
            <text x={x(now)} y="14" textAnchor="middle" className={styles.nowText}>
              {t('prox.now')}
            </text>
          </g>
        )}
        {hover !== null && hoveredValue !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={top} y2={bottom} stroke={color} opacity=".5" />
            <circle cx={x(hover)} cy={y(hoveredValue)} r="4" fill={color} />
            <rect
              x={Math.max(left, Math.min(right - 280, x(hover) - 140))}
              y="4"
              width="280"
              height="25"
              rx="5"
              fill="var(--bg-tertiary)"
            />
            <text
              x={Math.max(left + 140, Math.min(right - 140, x(hover)))}
              y="21"
              textAnchor="middle"
              className={styles.tooltip}
            >
              {formatDate(hover)} · {hoveredValue.toFixed(1)}
              {mode === 'burn' ? '' : '%'}
              {mode === 'remaining' ? '' : '/h'} ·{' '}
              {t(hover <= now ? 'prox.recorded' : 'prox.projected')}
            </text>
          </g>
        )}
      </svg>
      <div className={styles.legend}>
        <span>{t('prox.pool')}</span>
        <span>
          <i style={{ background: color }} />
          {t('prox.recorded')}
        </span>
        <span>
          <i style={{ borderColor: color }} />
          {t('prox.projected')}
        </span>
      </div>
    </div>
  );
}
