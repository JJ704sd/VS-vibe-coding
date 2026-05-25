import type { EpochData, EvaluationData, ParamHistory } from '../../services/trainingApi';

export interface TrainingRoundDetailApi {
  getHistoryLog: (round: string) => Promise<{ round: string; epochs: EpochData[] }>;
  getHistoryEval: (round: string) => Promise<EvaluationData>;
  getHistoryParamStats: (round: string) => Promise<ParamHistory | null>;
}

export interface TrainingRoundDetails {
  epochs: EpochData[];
  evalData: EvaluationData | null;
  paramHistory: ParamHistory | null;
  missing: Array<'log' | 'eval' | 'paramStats'>;
}

export async function loadTrainingRoundDetails(
  round: string,
  api: TrainingRoundDetailApi
): Promise<TrainingRoundDetails> {
  const [logResult, evalResult, paramResult] = await Promise.allSettled([
    api.getHistoryLog(round),
    api.getHistoryEval(round),
    api.getHistoryParamStats(round),
  ]);

  const missing: TrainingRoundDetails['missing'] = [];
  if (logResult.status === 'rejected') missing.push('log');
  if (evalResult.status === 'rejected') missing.push('eval');
  if (paramResult.status === 'rejected') missing.push('paramStats');

  return {
    epochs: logResult.status === 'fulfilled' ? logResult.value.epochs : [],
    evalData: evalResult.status === 'fulfilled' ? evalResult.value : null,
    paramHistory: paramResult.status === 'fulfilled' ? paramResult.value : null,
    missing,
  };
}
