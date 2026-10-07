import { MixerError } from '../errors.js';
import type { StrategyName } from '../types.js';
import { gainSharing } from './gain-sharing.js';
import { plainSum } from './plain-sum.js';
import type { MixStrategy } from './strategy.js';

export type { MixStrategy } from './strategy.js';

const strategies: Record<StrategyName, MixStrategy> = {
  'gain-sharing': gainSharing,
  'plain-sum': plainSum,
};

export const STRATEGY_NAMES = Object.keys(strategies) as StrategyName[];

export function strategyByName(name: string): MixStrategy {
  const strategy = (strategies as Record<string, MixStrategy | undefined>)[name];
  if (!strategy) {
    throw new MixerError(
      'unknown_strategy',
      `Unknown strategy "${name}"; use one of ${STRATEGY_NAMES.join(', ')}`,
    );
  }
  return strategy;
}
