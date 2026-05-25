import type { ParamStats } from '../../services/trainingApi';

type LiveLayerStats = ParamStats['layers'][number];

export interface LayerStatRow {
  label: string;
  value: string;
}

const formatStat = (value: number): string => value.toFixed(6);

export function buildLiveLayerStatRows(layer: LiveLayerStats): LayerStatRow[] {
  const rows: LayerStatRow[] = [
    { label: 'Mean', value: formatStat(layer.mean) },
    { label: 'Std', value: formatStat(layer.std) },
    { label: 'Min', value: formatStat(layer.min) },
    { label: 'Max', value: formatStat(layer.max) },
  ];

  if (layer.grad_mean != null) {
    rows.push({ label: 'Grad Mean', value: formatStat(layer.grad_mean) });
  }
  if (layer.grad_std != null) {
    rows.push({ label: 'Grad Std', value: formatStat(layer.grad_std) });
  }

  return rows;
}
